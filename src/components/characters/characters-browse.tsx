"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, Loader2, Users, Sparkles } from "lucide-react";
import { FilterPillGroup, type FilterPillOption } from "@/components/ui/filter-pills";
import { Button } from "@/components/ui/button";
import { CompanionCard } from "@/components/home/companion-card";
import {
  useCharacterSearch,
  type GenderFilter,
} from "@/hooks/use-character-search";
import { useCharacterRecommendations } from "@/hooks/use-character-recommendations";
import type { DiscoverCharacter } from "@/lib/frontend/discover";

// CATEGORY-TRIM: "All" removed by request — only the three real character
// categories (characters.gender/category are the same three values in the
// DB: female/male/anime; a 4th internal-only value, "archive-of-echoes",
// exists in the schema for the universe/lore system but was never surfaced
// as a browse category here, so no filtering change was needed for it).
// GenderFilter itself (use-character-search.ts) still includes "all" as a
// value — that's the "no category filter" sentinel the fetch query already
// keys off (`if (params.gender !== "all") sp.set("category", ...)`), kept
// internally even with no pill exposed for it.
const GENDER_OPTIONS: { value: GenderFilter; label: string }[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "anime", label: "Anime" },
];

const MODE_OPTIONS: FilterPillOption[] = [
  { value: "search", label: "Search" },
  { value: "describe", label: "Describe your type", icon: <Sparkles className="h-3.5 w-3.5" /> },
];

const PAGE_SIZE = 60;

/**
 * §3's "search icon" target and the Characters nav item both land here.
 * Seeded with the server-rendered `initial` list (fast first paint, no
 * client-side loading flash on arrival) and then hands off to
 * useCharacterSearch for every filter/search change — GET /api/characters
 * has no offset param (see lib/frontend/characters.ts), so "Load more"
 * widens `limit` and refetches rather than paging a cursor.
 *
 * WIRE-FIX: added the "Describe" mode toggle. POST /api/recommendations/
 * characters (free-text -> ranked catalog matches, see that route and
 * character-recommender.ts) was fully built with no caller anywhere in
 * the frontend — DiscoverCharacter's `reason?: string` field existed with
 * no writer either, clearly prepared for exactly this. Plain name search
 * (ilike via GET /api/characters) and free-text description search are
 * different enough queries — "Aria" vs "someone funny who plays games
 * with me" — that they get their own toggle rather than one input trying
 * to guess intent from query shape.
 *
 * URL-SEED FIX: Home's search bar (discover-search-bar.tsx) links here
 * with `?q=`, but this component's `q` state previously always
 * initialized to "" and nothing ever read the URL — the param was
 * silently dropped and the search bar did nothing on arrival. Seeded
 * from useSearchParams() once on mount so a query typed on Home
 * actually carries through to this page's first render.
 */
export function CharactersBrowse({
  initial,
}: {
  initial: DiscoverCharacter[];
}) {
  const searchParams = useSearchParams();
  const initialQ = searchParams.get("q") ?? "";
  // CATEGORY-SEED FIX: the sidebar's "Browse Companions" category links
  // (?gender=female/male/anime) previously landed here with no effect —
  // gender always initialized to the hardcoded default below regardless
  // of the URL. Mirrors the existing `q` URL-seed pattern (see URL-SEED
  // FIX above) so a category tapped from the sidebar actually lands on
  // that pill pre-selected, not just on an unfiltered/default view.
  const genderParam = searchParams.get("gender");
  const initialGender: GenderFilter =
    genderParam === "female" || genderParam === "male" || genderParam === "anime"
      ? genderParam
      : "female";

  const [mode, setMode] = useState<"search" | "describe">("search");
  const [q, setQ] = useState(initialQ);
  const [describeQ, setDescribeQ] = useState("");
  // Defaults to the first remaining pill ("all" is no longer offered as an
  // option above) so a pill is always visibly active on load, not none.
  const [gender, setGender] = useState<GenderFilter>(initialGender);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [debouncedQ, setDebouncedQ] = useState(initialQ);
  const [debouncedDescribeQ, setDebouncedDescribeQ] = useState("");

  // Debounce both inputs so every keystroke doesn't fire a request.
  const onQueryChange = (value: string) => {
    setQ(value);
    window.clearTimeout((onQueryChange as unknown as { t?: number }).t);
    (onQueryChange as unknown as { t?: number }).t = window.setTimeout(
      () => setDebouncedQ(value),
      300
    );
  };
  const onDescribeChange = (value: string) => {
    setDescribeQ(value);
    window.clearTimeout((onDescribeChange as unknown as { t?: number }).t);
    (onDescribeChange as unknown as { t?: number }).t = window.setTimeout(
      () => setDebouncedDescribeQ(value),
      500
    );
  };

  // Mirrors page.tsx's SSR seed query (gender: "female", limit: 60) — only
  // valid to fall back to `initial` when the live query would ask for the
  // exact same thing the server already fetched.
  // Unchanged condition: `initial` was only ever fetched server-side for
  // gender="female" (page.tsx's SSR seed), so it's still only valid to
  // reuse when the live gender state matches that — which also correctly
  // falls through to a fresh fetch when the sidebar's category links seed
  // a non-female initialGender above.
  const isDefaultView = debouncedQ === "" && gender === "female" && limit === PAGE_SIZE;
  const { data, isLoading, error } = useCharacterSearch({
    q: debouncedQ,
    gender,
    limit,
  });

  const {
    recommend,
    data: recommendedData,
    isLoading: isRecommending,
    error: recommendError,
  } = useCharacterRecommendations();

  useEffect(() => {
    if (mode !== "describe") return;
    recommend(debouncedDescribeQ, gender, limit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, debouncedDescribeQ, gender, limit]);

  const searchResults = isDefaultView && data.length === 0 && !isLoading ? initial : data;
  const results = mode === "describe" ? recommendedData : searchResults;
  const loading = mode === "describe" ? isRecommending : isLoading;
  const activeError = mode === "describe" ? recommendError : error;
  const hasDescribeQuery = debouncedDescribeQ.trim().length > 0;

  return (
    <div className="mx-auto max-w-7xl px-4 md:px-8 py-6">
      <h1 className="font-display text-2xl text-text-primary mb-4">
        Characters
      </h1>

      <div className="flex gap-2 mb-4">
        <FilterPillGroup options={MODE_OPTIONS} value={mode} onChange={(v) => setMode(v as "search" | "describe")} />
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
        {mode === "search" ? (
          <input
            value={q}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search companions by name…"
            className="w-full h-11 rounded-sm bg-base border border-interactive pl-10 pr-4 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-gold-500/60"
          />
        ) : (
          <input
            value={describeQ}
            onChange={(e) => onDescribeChange(e.target.value)}
            maxLength={400}
            placeholder="e.g. someone funny who plays games and remembers everything about me…"
            className="w-full h-11 rounded-sm bg-base border border-interactive pl-10 pr-4 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-gold-500/60"
          />
        )}
      </div>

      <FilterPillGroup
        options={GENDER_OPTIONS}
        value={gender}
        onChange={(v) => setGender(v as GenderFilter)}
        className="mb-6"
      />

      {activeError && (
        <p className="text-sm text-danger mb-4">{activeError}</p>
      )}

      {mode === "describe" && !hasDescribeQuery ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Sparkles className="h-10 w-10 text-text-tertiary" />
          <p className="text-text-secondary">
            Tell us what you&apos;re looking for and we&apos;ll find your best matches.
          </p>
        </div>
      ) : results.length === 0 && !loading ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Users className="h-10 w-10 text-text-tertiary" />
          <p className="text-text-secondary">No companions match that search.</p>
        </div>
      ) : (
        /* §5 tablet bridge (768–1024px): stays 2-column through that whole
           range — only bump at lg (1024px), not sm/md, or the 768-1023
           band ends up on 3 or 4 columns instead of the specified 2. */
        <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {results.map((c) => (
            <CompanionCard key={c.id} character={c} className="w-full" />
          ))}
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 text-gold-500 animate-spin" />
        </div>
      )}

      {mode === "search" && !isLoading && results.length >= limit && (
        <div className="flex justify-center mt-8">
          <Button
            variant="secondary"
            onClick={() => setLimit((l) => Math.min(l + PAGE_SIZE, 200))}
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
