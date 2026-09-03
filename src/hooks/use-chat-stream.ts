"use client";

import { useCallback, useRef, useState } from "react";

/**
 * FRONTEND_DIRECTIVE §10: "Streaming endpoints ... get their own hook using
 * fetch + a ReadableStream reader ... don't force these through the
 * generic SWR wrapper." This is that hook for POST /api/chat/stream.
 *
 * Wire protocol (reverse-engineered from src/app/api/chat/stream/route.ts,
 * not documented anywhere else — kept in one place so a future protocol
 * change only needs updating here):
 *
 *   `data: {"reset": true}\n\n`
 *     Discard whatever has been appended to the in-progress reply so far
 *     and start it over (the server occasionally re-generates after
 *     stripping a leaked classifier preamble from the start of a reply).
 *
 *   `data: {"delta": "<text>"}\n\n`
 *     Append <text> to the in-progress assistant reply.
 *
 *   `data: {"error": "<message>", "done": true}\n\n`
 *     Terminal error. Whatever text has streamed so far should stay
 *     visible; surface <message> separately rather than replacing it.
 *
 *   `data: {"done": true, "tokensUsed": n, "model": "...", ...}\n\n`
 *     Terminal success. Any accompanying `loreReveal` is surfaced but not
 *     handled here yet — left for a future pass per §12 phase ordering
 *     (World/lore is its own phase).
 *
 *   `: keepalive\n\n`
 *     SSE comment line, not a `data:` frame — ignored.
 *
 * WIRE-FIX (2026-08-20): /api/chat/stream returns 503
 * { code: 'PLATFORM_AT_CAPACITY' } when the platform-wide load shedder
 * trips. A fully-built async fallback already existed server-side —
 * POST /api/queue/enqueue → GET /api/queue/status/[jobId] polling, with
 * its own dedup/quota-parity handling. sendViaQueue() drives that
 * fallback, kept inside this hook so chat-window.tsx's interface
 * (sendMessage/streamingText/isStreaming/onDone) doesn't need to change —
 * a queued reply just arrives as one `onDone` call instead of incremental
 * deltas, same terminal shape either way. `isQueued` is exposed
 * separately so the UI can tell a ~90s queue wait apart from a normal
 * few-second generation instead of showing identical typing dots for both.
 *
 * UX-FIX (this revision): the 429 responses for DAILY_LIMIT_EXCEEDED and
 * PER_CHARACTER_LIMIT_EXCEEDED are the only two error shapes in the route
 * that put the human-readable copy in `message` while `error` holds a
 * machine slug ('daily_message_cap_exceeded') — every other error path in
 * the route puts human-readable copy directly in `error`. The old
 * `body?.error` fallback here surfaced the raw slug to users on exactly
 * those two paths. Now prefers `message` and falls back to `error`, and
 * also threads through `code`/`upgrade`/`canStillSwipe` so the UI can
 * offer a real next step (upgrade, or keep swiping) instead of a dead-end
 * red string. sendMessage now resolves to a boolean so callers can track
 * per-message send/fail state instead of firing-and-forgetting the call.
 */

export interface ChatStreamDoneMeta {
  tokensUsed?: number;
  model?: string;
  perCharacterRemaining?: { remaining: number; limit: number };
}

export interface ChatStreamError {
  message: string;
  code?: string;
  upgrade?: string;
  canStillSwipe?: boolean;
  used?: number;
  limit?: number;
}

const QUEUE_POLL_INTERVAL_MS = 1500;
// RESULT_TTL_SECONDS in lib/queue/index.ts is 600s server-side; this is a
// client-side ceiling so a stuck/lost job can't spin the poll loop forever.
const QUEUE_POLL_TIMEOUT_MS = 90_000;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

/** Reads a JSON error body and prefers the human-readable field. See
 *  UX-FIX above — `message` is only present on the two cap-exceeded
 *  paths, everywhere else `error` already is the human-readable text. */
function readErrorBody(body: Record<string, unknown> | null, fallback: string): ChatStreamError {
  if (!body) return { message: fallback };
  const message =
    (typeof body.message === "string" && body.message) ||
    (typeof body.error === "string" && body.error) ||
    fallback;
  return {
    message,
    code: typeof body.code === "string" ? body.code : undefined,
    upgrade: typeof body.upgrade === "string" ? body.upgrade : undefined,
    canStillSwipe: body.canStillSwipe === true,
    used: typeof body.used === "number" ? body.used : undefined,
    limit: typeof body.limit === "number" ? body.limit : undefined,
  };
}

interface UseChatStreamOptions {
  conversationId: string;
  characterId: string;
  onDone?: (fullText: string, meta: ChatStreamDoneMeta) => void;
}

export function useChatStream({
  conversationId,
  characterId,
  onDone,
}: UseChatStreamOptions) {
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isQueued, setIsQueued] = useState(false);
  const [error, setError] = useState<ChatStreamError | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Polls /api/queue/status/[jobId] until the job resolves. Reuses the same
  // AbortController the caller passed in, so stop() cancels this exactly
  // like it cancels an in-progress stream read.
  const sendViaQueue = useCallback(
    async (jobId: string, signal: AbortSignal): Promise<void> => {
      const deadline = Date.now() + QUEUE_POLL_TIMEOUT_MS;

      while (Date.now() < deadline) {
        await sleep(QUEUE_POLL_INTERVAL_MS, signal);

        const res = await fetch(`/api/queue/status/${jobId}`, { signal });
        if (!res.ok) {
          if (res.status === 404) throw new Error("Your message queue slot expired — please try again.");
          continue; // transient poll failure — keep trying until the deadline
        }

        const body = await res.json();
        if (body.status === "done") {
          onDone?.(body.reply ?? "", {
            tokensUsed: body.tokensUsed as number | undefined,
          });
          return;
        }
        if (body.status === "failed" || body.status === "dead") {
          throw new Error(body.error ?? "Couldn't send your message. Please try again.");
        }
        // 'pending' | 'processing' — keep polling.
      }

      throw new Error("This is taking longer than usual — please try again.");
    },
    [onDone]
  );

  const sendMessage = useCallback(
    async (message: string, sessionCount: number): Promise<boolean> => {
      setError(null);
      setStreamingText("");
      setIsStreaming(true);
      setIsQueued(false);

      const controller = new AbortController();
      abortRef.current = controller;

      let buffer = "";
      let fullText = "";
      let succeeded = false;

      try {
        const res = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            characterId,
            conversationId,
            sessionCount,
          }),
          signal: controller.signal,
        });

        if (res.status === 503) {
          const body = await res.json().catch(() => null);
          if (body?.code === "PLATFORM_AT_CAPACITY") {
            const enqueueRes = await fetch("/api/queue/enqueue", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message, characterId, conversationId }),
              signal: controller.signal,
            });
            const enqueueBody = await enqueueRes.json().catch(() => null);
            if (!enqueueRes.ok || !enqueueBody?.jobId) {
              throw readErrorBody(enqueueBody, "Platform at capacity — please try again shortly.");
            }
            setIsQueued(true);
            await sendViaQueue(enqueueBody.jobId, controller.signal);
            succeeded = true;
            return succeeded;
          }
          throw readErrorBody(body, `Stream failed (${res.status})`);
        }

        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => null);
          throw readErrorBody(body, `Stream failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by a blank line. Process every
          // complete frame currently in the buffer, keep any trailing
          // partial frame for the next chunk.
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const line = frame.trim();
            if (!line || line.startsWith(":")) continue; // keepalive comment
            if (!line.startsWith("data:")) continue;

            const payload = line.slice("data:".length).trim();
            let parsed: Record<string, unknown>;
            try {
              parsed = JSON.parse(payload);
            } catch {
              continue; // malformed frame — skip rather than crash the stream
            }

            if (parsed.reset) {
              fullText = "";
              setStreamingText("");
              continue;
            }
            if (typeof parsed.delta === "string") {
              fullText += parsed.delta;
              setStreamingText(fullText);
              continue;
            }
            if (parsed.error) {
              setError(readErrorBody(parsed as Record<string, unknown>, String(parsed.error)));
            }
            if (parsed.done) {
              succeeded = !parsed.error;
              onDone?.(fullText, {
                tokensUsed: parsed.tokensUsed as number | undefined,
                model: parsed.model as string | undefined,
                perCharacterRemaining: parsed.perCharacterRemaining as
                  | { remaining: number; limit: number }
                  | undefined,
              });
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          if (err && typeof err === "object" && "message" in err && !(err instanceof Error)) {
            setError(err as ChatStreamError);
          } else {
            setError({ message: err instanceof Error ? err.message : "Something went wrong" });
          }
        }
        succeeded = false;
      } finally {
        setIsStreaming(false);
        setIsQueued(false);
        abortRef.current = null;
      }

      return succeeded;
    },
    [characterId, conversationId, onDone, sendViaQueue]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { sendMessage, stop, streamingText, isStreaming, isQueued, error };
}
