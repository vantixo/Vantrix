"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SeedMemory } from "@/components/studio/builder/memory-builder";

/**
 * FRONTEND_DIRECTIVE §10 domain hook for studio/* (character builder,
 * memories, visibility, train-lora/animate). Four studio components
 * previously hand-rolled fetches against overlapping /api/characters/:id
 * routes; consolidated here as one set of imperative actions per §10's
 * "new hooks are the only thing written per new feature" goal. Kept as
 * plain async functions (not the generic `{data,isLoading,error}` shape)
 * because every call site owns its own local edit-in-progress state
 * (a draft form, a draft memory, a polling status) that it merges results
 * into — same rationale as use-dating-deck.ts's swipe().
 */

export async function setCharacterVisibility(characterId: string, visibility: "public" | "private") {
  const res = await fetch(`/api/characters/${characterId}/visibility`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visibility }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Couldn't update visibility.");
  return body;
}

export async function saveCharacterFields(characterId: string, patch: Record<string, unknown>) {
  const res = await fetch(`/api/characters/${characterId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Couldn't save changes.");
  return body;
}

export async function addSeedMemory(
  characterId: string,
  draft: { headline: string; content: string; category: string; importance: number; position: number }
): Promise<SeedMemory> {
  const res = await fetch(`/api/characters/${characterId}/memories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Couldn't add memory.");
  return body.memory as SeedMemory;
}

export function deleteSeedMemory(characterId: string, memoryId: string) {
  return fetch(`/api/characters/${characterId}/memories?memoryId=${memoryId}`, {
    method: "DELETE",
  }).catch(() => {});
}

/** Thrown by trainCharacterLora/animateCharacterPortrait so call sites can
 *  tell a paywall-gated failure (e.g. code: 'DAILY_LIMIT_EXCEEDED') apart
 *  from a genuine error — same shape as ConceptGenerationError above. */
export interface StudioActionError extends Error {
  code?: string;
}

export async function trainCharacterLora(characterId: string) {
  const res = await fetch(`/api/characters/${characterId}/train-lora`, { method: "POST" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: StudioActionError = new Error(body.error ?? "Couldn't start training.");
    err.code = body.code;
    throw err;
  }
  return body;
}

export async function animateCharacterPortrait(characterId: string) {
  const res = await fetch(`/api/characters/${characterId}/animate`, { method: "POST" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: StudioActionError = new Error(body.error ?? "Couldn't start animation.");
    err.code = body.code;
    throw err;
  }
  return body;
}

// ── Character Creation Studio: AI Concept stage ─────────────────────────
// Mirrors generate-concept/route.ts's request/response shape exactly —
// see that route for the full field list. `refineOf` carries the previous
// draft back as context for a "Refine with AI" regeneration rather than
// starting cold.
export interface ConceptGenerationError extends Error {
  code?: string;
}

export async function generateCharacterConcept(input: {
  prompt: string;
  gender?: "female" | "male" | "anime" | "other";
  refineOf?: Record<string, unknown>;
}): Promise<{ concept: Record<string, unknown>; prompt: string }> {
  const res = await fetch("/api/characters/generate-concept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: input.prompt,
      gender: input.gender,
      refineOf: input.refineOf ? JSON.stringify(input.refineOf) : undefined,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: ConceptGenerationError = new Error(body.error ?? "Couldn't generate a concept.");
    err.code = body.code;
    throw err;
  }
  return body;
}

// ── Gallery: batch image generation ─────────────────────────────────────
// Mirrors POST /api/images/generate-batch (see that route's own docstring):
// NDJSON stream, one `{ specId, url, failed, seed? }` line per finished
// image, so results appear as they complete rather than all at once after
// the whole batch. Kept as a plain async generator (not the studio-cards
// SWR shape) for the same "streaming endpoints get their own hook" reason
// as use-chat-stream.ts — onResult below fires once per line as it's
// parsed off the reader, before the stream closes.
export interface BatchImageSpec {
  id: string;
  outfit?: string;
  pose?: string;
  background?: string;
  expression?: string;
  style?: "realistic" | "anime" | "artistic";
  angle?: "portrait" | "full_body" | "close_up" | "over_shoulder" | "selfie";
}

export interface BatchImageResult {
  specId: string;
  url: string;
  failed: boolean;
  seed?: string;
  timedOut?: boolean;
}

export async function generateImageBatch(
  characterId: string,
  specs: BatchImageSpec[],
  consistencyMode: boolean,
  onResult: (result: BatchImageResult) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch("/api/images/generate-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ characterId, specs, consistencyMode }),
    signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Batch generation failed (${res.status})`);
  }
  if (!res.body) throw new Error("No response stream from server.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) continue;
      try {
        onResult(JSON.parse(line) as BatchImageResult);
      } catch {
        // Malformed line — skip rather than aborting the whole batch.
      }
    }
  }

  const trailing = buffer.trim();
  if (trailing) {
    try {
      onResult(JSON.parse(trailing) as BatchImageResult);
    } catch {
      // ignore
    }
  }
}

export interface CharacterJobStatus {
  lora_training_status: string | null;
  lora_training_error: string | null;
  video_status: string;
  video_error: string | null;
}

/**
 * Fire-and-poll status watcher for Train LoRA / Animate. Both jobs
 * complete via a Fal webhook, not a synchronous response, so this is the
 * only way the UI learns a job finished — polls GET /api/characters/:id
 * (same endpoint the builder tabs already use) every 6s while either job
 * is in a busy state, and stops itself otherwise.
 */
export function useCharacterJobPolling(
  characterId: string,
  busy: boolean,
  onUpdate: (status: CharacterJobStatus) => void
) {
  const pollRef = useRef<number | null>(null);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!busy) {
      if (pollRef.current) window.clearInterval(pollRef.current);
      return;
    }
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/characters/${characterId}`);
        if (!res.ok) return;
        const body = await res.json();
        onUpdateRef.current({
          lora_training_status: body.character.lora_training_status,
          lora_training_error: body.character.lora_training_error,
          video_status: body.character.video_status,
          video_error: body.character.video_error,
        });
      } catch {
        // transient — next tick retries
      }
    }, 6000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [busy, characterId]);
}

/** Small convenience wrapper for callers that just want start/loading/error. */
export function useStudioAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setPending(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      return null;
    } finally {
      setPending(false);
    }
  }, []);

  return { pending, error, run };
}
