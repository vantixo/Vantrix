"use client";

import { useCallback, useState } from "react";
import type { RoleplayActionType, RoleplayTurnResult } from "@/types/roleplay";

/**
 * Mirrors POST /api/roleplay/[sessionId]/turn's documented response/error shapes:
 *   200 RoleplayTurnResult
 *   400 { error, code: "VALIDATION_ERROR" }
 *   401 { error: "Unauthorized" }
 *   403 { error, code: "DAILY_CAP_REACHED" }
 *   404 { error, code: "SESSION_NOT_FOUND" | "SCENARIO_NOT_FOUND" | "CHARACTER_NOT_FOUND" }
 *   409 { error, code: "SESSION_NOT_ACTIVE" }
 *   429 { error, code: "RATE_LIMIT_EXCEEDED" }
 *   500 { error, code: "INTERNAL_ERROR" }
 */
export interface RoleplayTurnError {
  error: string;
  code?: "VALIDATION_ERROR" | "DAILY_CAP_REACHED" | "SESSION_NOT_FOUND" | "SCENARIO_NOT_FOUND" | "CHARACTER_NOT_FOUND" | "SESSION_NOT_ACTIVE" | "RATE_LIMIT_EXCEEDED" | "INTERNAL_ERROR";
}

export function useRoleplayTurn(sessionId: string) {
  const [isSending, setIsSending] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [error, setError] = useState<RoleplayTurnError | null>(null);

  const sendTurn = useCallback(
    async (actionType: RoleplayActionType, text: string): Promise<RoleplayTurnResult | null> => {
      setIsSending(true);
      setError(null);
      try {
        const res = await fetch(`/api/roleplay/${sessionId}/turn`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actionType, text }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body) {
          setError((body as RoleplayTurnError | null) ?? { error: `The story couldn't continue (${res.status})` });
          return null;
        }
        return body as RoleplayTurnResult;
      } catch (err) {
        setError({ error: err instanceof Error ? err.message : "The story couldn't continue" });
        return null;
      } finally {
        setIsSending(false);
      }
    },
    [sessionId],
  );

  const endStory = useCallback(async (): Promise<boolean> => {
    setIsEnding(true);
    setError(null);
    try {
      const res = await fetch(`/api/roleplay/${sessionId}/end`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) {
        setError((body as RoleplayTurnError | null) ?? { error: `Could not end the story (${res.status})` });
        return false;
      }
      return true;
    } catch (err) {
      setError({ error: err instanceof Error ? err.message : "Could not end the story" });
      return false;
    } finally {
      setIsEnding(false);
    }
  }, [sessionId]);

  return { sendTurn, endStory, isSending, isEnding, error, clearError: () => setError(null) };
}
