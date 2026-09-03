"use client";

import useSWR from "swr";
import type { DiscoverCharacter } from "@/lib/frontend/discover";

/**
 * §10's standardized Client Component shape ({ data, isLoading, error })
 * via SWR — a plain read against a filterable list is exactly the case
 * §10 names SWR/React Query for, unlike use-dating-deck.ts's swipe state
 * (that one deliberately opts out of background revalidation; this one
 * wants it, so a filter change reflects a genuinely fresh query).
 */
export type GenderFilter = "all" | "female" | "male" | "anime";

async function fetcher(url: string): Promise<DiscoverCharacter[]> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  const body = (await res.json()) as { characters: DiscoverCharacter[] };
  return body.characters ?? [];
}

export function useCharacterSearch(params: {
  q: string;
  gender: GenderFilter;
  limit: number;
  /**
   * PERF: defaults true (unchanged behavior for the existing caller,
   * characters-browse.tsx). explore-characters.tsx passes false for
   * every tab that isn't gender-filtered (For You/New draw from a pool
   * it already has; Trending has its own dedicated hook,
   * use-trending-characters.ts) — without this, the hook fired a real
   * request against /api/characters on every one of those tabs,
   * including the default landing tab, and threw the response away.
   * `null` as the SWR key is SWR's documented way to skip the fetch
   * entirely rather than fire-and-discard.
   */
  enabled?: boolean;
}) {
  const enabled = params.enabled ?? true;
  const sp = new URLSearchParams();
  if (params.q.trim()) sp.set("q", params.q.trim());
  if (params.gender !== "all") sp.set("category", params.gender);
  sp.set("limit", String(params.limit));

  const { data, error, isLoading } = useSWR(
    enabled ? `/api/characters?${sp.toString()}` : null,
    fetcher,
    { keepPreviousData: true }
  );

  return {
    data: data ?? [],
    isLoading: enabled && isLoading,
    error: error ? "Couldn't load companions. Try again." : null,
  };
}
