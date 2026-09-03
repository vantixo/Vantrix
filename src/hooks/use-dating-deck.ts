"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * FRONTEND_DIRECTIVE §10 names this hook directly as an example
 * (`hooks/use-dating-deck.ts`). Deck + swipe are both write-adjacent and
 * highly interactive (card removed from the stack the instant a swipe
 * resolves, swipe-limit countdown updates live) so this is a plain client
 * fetch hook rather than the generic SWR `{ data, isLoading, error }`
 * shape — a swiped card must not reappear on a background revalidation.
 */

export interface DeckCandidate {
  id: string;
  name: string;
  age: number | null;
  gender: string | null;
  description: string | null;
  image_url: string | null;
  tags: string[];
  archetype: string | null;
  opening_line: string | null;
  is_premium?: boolean;
  min_tier?: string | null;
}

export interface SwipeStatus {
  used: number;
  limit: number;
  remaining: number;
}

export type SwipeDirection = "like" | "pass" | "super_like";

export interface SwipeResult {
  matched: boolean;
  direction: SwipeDirection;
  match?: { id: string };
  compatibility?: { score: number; tier: string };
  reason?: string;
}

interface DeckResponse {
  candidates: DeckCandidate[];
  swipes: SwipeStatus;
  tier: string;
}

export function useDatingDeck() {
  const [candidates, setCandidates] = useState<DeckCandidate[]>([]);
  const [swipes, setSwipes] = useState<SwipeStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSwiping, setIsSwiping] = useState(false);
  const [lastMatch, setLastMatch] = useState<SwipeResult | null>(null);

  const loadDeck = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dating/deck");
      const body = (await res.json().catch(() => null)) as DeckResponse | null;
      if (!res.ok || !body) throw new Error("Could not load the deck");
      setCandidates(body.candidates);
      setSwipes(body.swipes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the deck");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDeck();
  }, [loadDeck]);

  const swipe = useCallback(
    async (characterId: string, direction: SwipeDirection) => {
      // Optimistic removal — a card that's been swiped must never linger
      // or reappear, even if the request is still in flight.
      setCandidates((prev) => prev.filter((c) => c.id !== characterId));
      setIsSwiping(true);
      setError(null);
      try {
        const res = await fetch("/api/dating/swipe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ characterId, direction }),
        });
        const body = await res.json().catch(() => null);
        if (res.status === 429) {
          setError(body?.error ?? "Daily swipe limit reached");
          setSwipes((s) =>
            s ? { ...s, used: body?.used ?? s.used, remaining: 0 } : s
          );
          return null;
        }
        if (!res.ok || !body) throw new Error(body?.error ?? "Swipe failed");

        setSwipes((s) =>
          s ? { ...s, used: s.used + 1, remaining: Math.max(0, s.remaining - 1) } : s
        );
        if (body.matched) setLastMatch(body as SwipeResult);
        return body as SwipeResult;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Swipe failed");
        return null;
      } finally {
        setIsSwiping(false);
      }
    },
    []
  );

  const dismissMatch = useCallback(() => setLastMatch(null), []);

  return {
    candidates,
    swipes,
    isLoading,
    isSwiping,
    error,
    swipe,
    lastMatch,
    dismissMatch,
    reload: loadDeck,
  };
}
