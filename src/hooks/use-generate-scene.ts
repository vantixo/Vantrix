"use client";

import { useCallback, useState } from "react";

/**
 * Mirrors POST /api/dating/scene's documented response/error shapes:
 *   200 { url, tokenCost, rateLimit }
 *   402 { error, code: 'INSUFFICIENT_TOKENS', tokensRequired, tokensAvailable }
 *   403 { error, code: 'TIER_LOCKED' }
 *   404 { error, code: 'NOT_FOUND' } | { error: 'Match not found' } | { error: 'Character not found' }
 *   422 { error, code: 'NO_LORA_MODEL' | 'CONTENT_POLICY_VIOLATION' }
 *   429 { error, code: 'RATE_LIMIT_EXCEEDED' | 'DAILY_LIMIT_EXCEEDED', ... }
 *   503 { error, code: 'GENERATION_FAILED' }
 */
export interface GenerateSceneResult {
  url: string;
  tokenCost: number;
}

export interface GenerateSceneError {
  error: string;
  code?:
    | "INSUFFICIENT_TOKENS"
    | "TIER_LOCKED"
    | "NOT_FOUND"
    | "NO_LORA_MODEL"
    | "CONTENT_POLICY_VIOLATION"
    | "RATE_LIMIT_EXCEEDED"
    | "DAILY_LIMIT_EXCEEDED"
    | "GENERATION_FAILED"
    | "VALIDATION_ERROR";
  tokensRequired?: number;
  tokensAvailable?: number;
}

export function useGenerateScene(matchId: string) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<GenerateSceneError | null>(null);

  const generateScene = useCallback(
    async (
      opts: { moodRoomId?: string; customPrompt?: string }
    ): Promise<GenerateSceneResult | null> => {
      setIsGenerating(true);
      setError(null);
      try {
        const res = await fetch("/api/dating/scene", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchId, ...opts }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body) {
          setError(
            (body as GenerateSceneError | null) ?? {
              error: `Scene generation failed (${res.status})`,
            }
          );
          return null;
        }
        return body as GenerateSceneResult;
      } catch (err) {
        setError({
          error: err instanceof Error ? err.message : "Scene generation failed",
        });
        return null;
      } finally {
        setIsGenerating(false);
      }
    },
    [matchId]
  );

  return { generateScene, isGenerating, error, clearError: () => setError(null) };
}
