"use client";

import { useCallback, useState } from "react";

/**
 * Mirrors POST /api/dating/share-card's discriminated request union and
 * 200 { shareUrl, ogImageUrl, cardId } response.
 */
export type ShareCardRequest =
  | {
      type: "milestone";
      characterName: string;
      characterImage: string;
      milestoneKey: string;
      milestoneLabel: string;
      milestoneEmoji: string;
      bondScore: number;
      streakDays?: number;
      characterId?: string;
    }
  | {
      type: "relationship";
      characterId: string;
      characterName: string;
      characterImage: string;
      bondScore: number;
      matchTier: string;
      compatibility: number;
      mood: string;
      streakDays?: number;
      daysKnown?: number;
    };

export interface ShareCardResult {
  shareUrl: string;
  ogImageUrl: string;
  cardId: string;
}

export interface ShareCardError {
  error: string;
}

export function useShareCard() {
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<ShareCardError | null>(null);

  const createShareCard = useCallback(
    async (req: ShareCardRequest): Promise<ShareCardResult | null> => {
      setIsCreating(true);
      setError(null);
      try {
        const res = await fetch("/api/dating/share-card", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body) {
          setError(
            (body as ShareCardError | null) ?? {
              error: `Share card failed (${res.status})`,
            }
          );
          return null;
        }
        return body as ShareCardResult;
      } catch (err) {
        setError({
          error: err instanceof Error ? err.message : "Share card failed",
        });
        return null;
      } finally {
        setIsCreating(false);
      }
    },
    []
  );

  return { createShareCard, isCreating, error, clearError: () => setError(null) };
}
