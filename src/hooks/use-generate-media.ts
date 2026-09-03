"use client";

import { useCallback, useRef, useState } from "react";

/**
 * CHAT-MEDIA-WIRE: backs the camera/video buttons in ChatComposer.
 *
 * The generation endpoints themselves (POST /api/chat/image,
 * POST /api/chat/video + GET /api/chat/video/status) were fully built —
 * moderation, visual-seed consistency, Fal.ai circuit breaker, R2 upload,
 * token deduction, message persistence, all real — but nothing in the
 * frontend ever called them. Same "backend shipped, no consumer" pattern
 * as the dating Gift Shop before gift-drawer.tsx was added. This hook is
 * that missing consumer for chat.
 *
 * Mirrors each route's own documented response shapes:
 *   POST /api/chat/image  -> 200 { url, tokenCost, seedLocked, messageId, createdAt }
 *                            402 { error, code: 'INSUFFICIENT_TOKENS', tokensRequired }
 *                            422 { error, code: 'CONTENT_POLICY_VIOLATION' }
 *                            429 { error, code: 'RATE_LIMIT_EXCEEDED' | 'DAILY_LIMIT_EXCEEDED' }
 *                            503 { error, code: 'IMAGE_PROVIDER_DOWN' }
 *   POST /api/chat/video  -> 200 { jobId }
 *                            402 { error, code: 'INSUFFICIENT_TOKENS' | 'RATE_LIMIT_EXCEEDED' (free tier) }
 *                            422 { error, code: 'NO_SOURCE_IMAGE' | 'CONTENT_POLICY_VIOLATION' }
 *                            503 { error, code: 'FEATURE_DISABLED' }
 *   GET  /api/chat/video/status?jobId=
 *                         -> 200 { status: 'processing' }
 *                            200 { status: 'succeed'|'completed', url, messageId, createdAt }
 *                            200 { status: 'failed', error }
 *                            404 { error, code: 'JOB_NOT_FOUND' }
 */

export interface GeneratedMedia {
  kind: "image" | "video";
  url: string;
  messageId?: string;
}

interface ApiErrorBody {
  error: string;
  code?: string;
  // Image/video daily-cap errors nest the real used/limit numbers under a
  // cap-specific key rather than top-level (see chat/image and chat/video
  // routes' own DAILY_LIMIT_EXCEEDED response bodies) — captured here so
  // the paywall can show a real "X of Y used today" stat instead of
  // generic copy.
  dailyImageCap?: { used: number; limit: number };
  dailyVideoCap?: { used: number; limit: number };
}

export interface MediaError {
  message: string;
  code?: string;
  /** Which action produced this error — image and video routes both use
   *  the generic DAILY_LIMIT_EXCEEDED/RATE_LIMIT_EXCEEDED codes (see each
   *  route's own error body), so the code alone can't tell a photo cap
   *  from a video cap apart. Callers use this to pick the right paywall
   *  copy instead of guessing from the shared code. */
  kind: "image" | "video";
  usageStat?: { used: number; limit: number };
}

const VIDEO_POLL_INTERVAL_MS = 4_000;
const VIDEO_MAX_WAIT_MS = 5 * 60_000;

export function useGenerateMedia({
  characterId,
  conversationId,
}: {
  characterId: string;
  conversationId?: string;
}) {
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [error, setError] = useState<MediaError | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const generateImage = useCallback(
    async (userMessage: string): Promise<GeneratedMedia | null> => {
      setIsGeneratingImage(true);
      setError(null);
      try {
        const res = await fetch("/api/chat/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ characterId, conversationId, userMessage }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.url) {
          const err = body as ApiErrorBody | null;
          setError({ message: err?.error ?? "Could not generate photo", code: err?.code, kind: "image", usageStat: err?.dailyImageCap });
          return null;
        }
        return { kind: "image", url: body.url, messageId: body.messageId };
      } catch {
        setError({ message: "Could not generate photo", kind: "image" });
        return null;
      } finally {
        setIsGeneratingImage(false);
      }
    },
    [characterId, conversationId]
  );

  const generateVideo = useCallback(
    async (userMessage: string): Promise<GeneratedMedia | null> => {
      setIsGeneratingVideo(true);
      setError(null);
      try {
        const submitRes = await fetch("/api/chat/video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ characterId, conversationId, userMessage }),
        });
        const submitBody = await submitRes.json().catch(() => null);
        if (!submitRes.ok || !submitBody?.jobId) {
          const err = submitBody as ApiErrorBody | null;
          setError({ message: err?.error ?? "Could not start video generation", code: err?.code, kind: "video", usageStat: err?.dailyVideoCap });
          return null;
        }

        const jobId = submitBody.jobId as string;
        const deadline = Date.now() + VIDEO_MAX_WAIT_MS;

        return await new Promise<GeneratedMedia | null>((resolve) => {
          const poll = async () => {
            if (Date.now() > deadline) {
              setError({ message: "Video is taking longer than expected — please try again", kind: "video" });
              resolve(null);
              return;
            }
            try {
              const statusRes = await fetch(
                `/api/chat/video/status?jobId=${encodeURIComponent(jobId)}`
              );
              const statusBody = await statusRes.json().catch(() => null);

              if (!statusRes.ok) {
                setError({ message: (statusBody as ApiErrorBody | null)?.error ?? "Video generation failed", code: (statusBody as ApiErrorBody | null)?.code, kind: "video" });
                resolve(null);
                return;
              }
              if (statusBody?.status === "processing") {
                pollTimeoutRef.current = setTimeout(poll, VIDEO_POLL_INTERVAL_MS);
                return;
              }
              if (statusBody?.status === "failed") {
                setError({ message: statusBody.error ?? "Video generation failed", code: statusBody.code, kind: "video" });
                resolve(null);
                return;
              }
              // 'succeed' / 'completed'
              if (statusBody?.url) {
                resolve({ kind: "video", url: statusBody.url, messageId: statusBody.messageId });
              } else {
                setError({ message: "Video generation failed", kind: "video" });
                resolve(null);
              }
            } catch {
              setError({ message: "Could not check video status", kind: "video" });
              resolve(null);
            }
          };
          poll();
        });
      } catch {
        setError({ message: "Could not start video generation", kind: "video" });
        return null;
      } finally {
        setIsGeneratingVideo(false);
        if (pollTimeoutRef.current) {
          clearTimeout(pollTimeoutRef.current);
          pollTimeoutRef.current = null;
        }
      }
    },
    [characterId, conversationId]
  );

  return {
    generateImage,
    generateVideo,
    isGeneratingImage,
    isGeneratingVideo,
    error,
    clearError: () => setError(null),
  };
}
