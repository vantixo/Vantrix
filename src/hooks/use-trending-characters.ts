"use client";

import useSWR from "swr";
import type { DiscoverCharacter } from "@/lib/frontend/discover";

/**
 * Backs explore-characters.tsx's Trending tab. Separate from
 * useCharacterSearch (which hits /api/characters and returns a bare
 * array) because this hits /api/discover/featured?mode=chars&sort=trending
 * — a different route/response shape (`{ allCharacters, hasMore }`) —
 * and because Trending shouldn't share that hook's `category=` gender
 * plumbing, which doesn't apply here. See lib/recommendations/trending.ts
 * for how the ranking itself is computed.
 */
async function fetcher(url: string): Promise<DiscoverCharacter[]> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Trending fetch failed: ${res.status}`);
  const body = (await res.json()) as { allCharacters: DiscoverCharacter[] };
  return body.allCharacters ?? [];
}

export function useTrendingCharacters({
  limit,
  enabled,
}: {
  limit: number;
  /** Same SWR-key-null skip pattern as useCharacterSearch's `enabled` —
   *  only fetch while the Trending tab is actually active. */
  enabled: boolean;
}) {
  const { data, error, isLoading } = useSWR(
    enabled ? `/api/discover/featured?mode=chars&sort=trending&limit=${limit}` : null,
    fetcher,
    { keepPreviousData: true },
  );

  return {
    data: data ?? [],
    isLoading: enabled && isLoading,
    error: error ? "Couldn't load trending companions. Try again." : null,
  };
}
