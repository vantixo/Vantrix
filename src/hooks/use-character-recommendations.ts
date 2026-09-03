"use client";

import { useCallback, useRef, useState } from "react";
import type { DiscoverCharacter } from "@/lib/frontend/discover";
import type { GenderFilter } from "./use-character-search";

/**
 * Wires POST /api/recommendations/characters — built, tested, and never
 * called from anywhere in the frontend (see that route's own docstring:
 * "free-text description of what the user wants"). DiscoverCharacter
 * already carries an optional `reason?: string` field with no writer
 * anywhere in the codebase; this is that writer.
 *
 * POST rather than SWR's GET-keyed fetcher (same reasoning as
 * use-generate-scene.ts): this is a mutation-shaped, debounced, one-off
 * request per query, not a cacheable resource the rest of the app reads.
 * A request in flight is aborted if a newer one starts, so a fast typist
 * never has an old response race a new one into state.
 */
export function useCharacterRecommendations() {
  const [data, setData] = useState<DiscoverCharacter[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const recommend = useCallback(
    async (query: string, gender: GenderFilter, limit: number) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const trimmed = query.trim();
      if (!trimmed) {
        setData([]);
        setIsLoading(false);
        setError(null);
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/recommendations/characters", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: trimmed,
            gender: gender === "all" ? undefined : gender,
            limit,
          }),
          signal: controller.signal,
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body) {
          if (!controller.signal.aborted) {
            setError(body?.error ?? `Couldn't find matches (${res.status}).`);
            setData([]);
          }
          return;
        }
        const results = (body.results ?? []) as {
          character: {
            id: string;
            name: string;
            description: string | null;
            image_url: string | null;
            tags: string[] | null;
            gender: string | null;
            like_count: number | null;
            follower_count: number | null;
          };
          reason: string;
        }[];
        // The recommender's RecommendableCharacter is a narrower projection
        // than DiscoverCharacter (see character-recommender.ts's own select
        // list) — it doesn't carry age/is_new/is_premium/etc. Fill those
        // with the same "unknown" defaults CompanionCard already treats as
        // absent (null age hides the age suffix, is_new=false hides the
        // badge) rather than widening the recommender's DB query just to
        // populate fields this card doesn't otherwise need.
        setData(
          results.map((r) => ({
            id: r.character.id,
            name: r.character.name,
            age: null,
            gender: r.character.gender,
            description: r.character.description,
            image_url: r.character.image_url,
            tags: r.character.tags ?? [],
            is_premium: false,
            min_tier: null,
            is_new: false,
            is_live: true,
            tokens_cost: null,
            archetype: null,
            opening_line: null,
            like_count: r.character.like_count ?? 0,
            follower_count: r.character.follower_count ?? 0,
            // Same "narrower projection, fill with unknown defaults"
            // reasoning as the fields above — the recommender doesn't
            // select model_url or the appearance columns, so
            // CharacterPortraitViewer falls through to its 2D
            // LivingPortrait tier for these results.
            model_url: null,
            hair_color: null,
            eye_color: null,
            skin_tone: null,
            body_type: null,
            reason: r.reason,
          }))
        );
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Couldn't find matches.");
          setData([]);
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    },
    []
  );

  return { recommend, data, isLoading, error };
}
