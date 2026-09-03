"use client";

import { useCallback, useState } from "react";

/**
 * Mirrors POST /api/dating/date/start and POST /api/dating/date/[id]/complete's
 * documented response/error shapes.
 */
export interface StartDateResult {
  sessionId: string;
  dateType: string;
  dateName: string;
  openingScene: string;
  tokenCost: number;
  conversationId: string | null;
}

export interface StartDateError {
  error: string;
  code?:
    | "VALIDATION_ERROR"
    | "NOT_FOUND"
    | "DATE_LOCKED"
    | "INSUFFICIENT_TOKENS"
    | "DATE_ALREADY_ACTIVE"
    | "RATE_LIMIT_EXCEEDED"
    | "CONTENT_POLICY_VIOLATION";
  requiredTier?: string;
  tokensRequired?: number;
  tokensAvailable?: number;
  sessionId?: string;
}

export interface CompleteDateResult {
  completed: true;
  newBond: number;
  memoryId: string | null;
  milestoneAwarded: string | null;
}

export function useFirstDate(matchId: string) {
  const [isStarting, setIsStarting] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [error, setError] = useState<StartDateError | null>(null);

  const startDate = useCallback(
    async (dateType: string, customPrompt?: string): Promise<StartDateResult | null> => {
      setIsStarting(true);
      setError(null);
      try {
        const res = await fetch("/api/dating/date/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchId, dateType, customPrompt }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body) {
          setError((body as StartDateError | null) ?? { error: `Could not start date (${res.status})` });
          return null;
        }
        return body as StartDateResult;
      } catch (err) {
        setError({ error: err instanceof Error ? err.message : "Could not start date" });
        return null;
      } finally {
        setIsStarting(false);
      }
    },
    [matchId]
  );

  const completeDate = useCallback(
    async (sessionId: string, recap?: string): Promise<CompleteDateResult | null> => {
      setIsCompleting(true);
      setError(null);
      try {
        const res = await fetch(`/api/dating/date/${sessionId}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recap }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body) {
          setError((body as StartDateError | null) ?? { error: `Could not end date (${res.status})` });
          return null;
        }
        return body as CompleteDateResult;
      } catch (err) {
        setError({ error: err instanceof Error ? err.message : "Could not end date" });
        return null;
      } finally {
        setIsCompleting(false);
      }
    },
    []
  );

  return { startDate, completeDate, isStarting, isCompleting, error, clearError: () => setError(null) };
}
