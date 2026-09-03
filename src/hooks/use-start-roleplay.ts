"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Mirrors POST /api/roleplay/start's documented response/error shapes:
 *   200 { conversationId, sessionId, status, chapter, chapterCount, beatNumber, narrative, choices, isChapterEnd, isSessionComplete }
 *   401 { error: "Unauthorized" }
 *   403 { error, code: "SCENARIO_TIER_LOCKED" | "SCENARIO_CHARACTER_MISMATCH" }
 *   404 { error, code: "SCENARIO_NOT_FOUND" | "CHARACTER_NOT_FOUND" }
 *   500 { error, code: "SESSION_CREATE_FAILED" | "CONVERSATION_CREATE_FAILED" | "INTERNAL_ERROR" }
 */
export interface StartRoleplayError {
  error: string;
  code?: "VALIDATION_ERROR" | "SCENARIO_TIER_LOCKED" | "SCENARIO_CHARACTER_MISMATCH" | "SCENARIO_FACTION_LOCKED" | "SCENARIO_LOCATION_LOCKED" | "SCENARIO_NOT_FOUND" | "CHARACTER_NOT_FOUND" | "SESSION_CREATE_FAILED" | "CONVERSATION_CREATE_FAILED" | "INTERNAL_ERROR";
}

export function useStartRoleplay() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<StartRoleplayError | null>(null);

  const startRoleplay = useCallback(
    async (characterId: string, scenarioId: string) => {
      setIsPending(true);
      setError(null);
      try {
        const res = await fetch("/api/roleplay/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ characterId, scenarioId }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body) {
          setError((body as StartRoleplayError | null) ?? { error: `Could not start this story (${res.status})` });
          setIsPending(false);
          return;
        }
        router.push(`/roleplay/${body.sessionId}`);
      } catch (err) {
        setError({ error: err instanceof Error ? err.message : "Could not start this story" });
        setIsPending(false);
      }
    },
    [router],
  );

  return { startRoleplay, isPending, error, clearError: () => setError(null) };
}
