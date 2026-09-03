"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FilterPillGroup, type FilterPillOption } from "@/components/ui/filter-pills";
import { CompanionCard } from "./companion-card";
import { useCharacterSearch, type GenderFilter } from "@/hooks/use-character-search";
import { useTrendingCharacters } from "@/hooks/use-trending-characters";
import type { DiscoverCharacter } from "@/lib/frontend/discover";

type Tab = "for-you" | "trending" | "new" | "female" | "male" | "anime";

const TABS: FilterPillOption[] = [
  { value: "trending", label: "Trending" },
  { value: "for-you", label: "For You" },
  { value: "new", label: "New" },
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "anime", label: "Anime" },
];

const GENDER_TABS = new Set<Tab>(["female", "male", "anime"]);
const PAGE_SIZE = 12;

/**
 * Replaces FeatureStrip's static "Persistent Memory / Proactive Messages
 * / ..." capability band.
 *
 * For You/New are derived client-side from the same `initial` pool Home
 * already fetched (getDiscoverHome()'s allCharacters — already run
 * through scoreCandidatesForDiscover()'s personalization on the server,
 * see /api/discover/featured's own comment, so For You needs no further
 * client-side reordering here) — filtering is_new for New, falling back
 * to the full pool if that filter comes up empty rather than showing a
 * dead end.
 *
 * Trending is its own server round-trip (useTrendingCharacters →
 * GET /api/discover/featured?sort=trending) rather than a client-side
 * sort of `initial`: real trending needs to rank by what visitors are
 * actually clicking right now (lib/recommendations/trending.ts), a
 * signal that isn't in the initial pool's ~40 rows at all, not just
 * re-sort whatever Home happened to already fetch.
 *
 * Female/Male/Anime go through useCharacterSearch (GET /api/characters
 * ?category=), the same hook/endpoint the /characters browse page uses,
 * since gender is a real server-side filter (`characters.gender`) and
 * the initial pool is capped at a couple dozen rows.
 *
 * PERF: each server-backed tab's hook only fetches while it's the active
 * tab (SWR key=null otherwise) — Trending is now the default landing tab
 * (BEGIN-WITH-TRENDING FIX, below), so its own fetch fires immediately on
 * mount instead of being skipped the way a server-backed tab is when
 * some other tab is active; For You (this section's only tab that never
 * needs a fetch, since it just reads the already-fetched `initial` pool)
 * takes over that "free" slot instead.
 *
 * BEGIN-WITH-TRENDING FIX: previously defaulted to "for-you", with
 * Trending second in the pill order — every Home visitor's first view of
 * this grid was the personalized pool, and Trending required an explicit
 * tap to ever see. Both the initial `tab` state and TABS' order now lead
 * with Trending.
 */
export function ExploreCharacters({ initial }: { initial: DiscoverCharacter[] }) {
  const [tab, setTab] = useState<Tab>("trending");
  const isGenderTab = GENDER_TABS.has(tab);
  const isTrendingTab = tab === "trending";

  const { data: fetchedGender, isLoading: genderLoading } = useCharacterSearch({
    q: "",
    gender: isGenderTab ? (tab as GenderFilter) : "all",
    limit: PAGE_SIZE,
    enabled: isGenderTab,
  });

  const { data: fetchedTrending, isLoading: trendingLoading } = useTrendingCharacters({
    limit: PAGE_SIZE,
    enabled: isTrendingTab,
  });

  const pool = isGenderTab ? fetchedGender : isTrendingTab ? fetchedTrending : initial;
  const isLoading = isGenderTab ? genderLoading : isTrendingTab ? trendingLoading : false;

  const characters = useMemo(() => {
    if (tab === "new") {
      const fresh = pool.filter((c) => c.is_new);
      return fresh.length > 0 ? fresh : pool;
    }
    // for-you / trending / gender tabs already arrive in the right order
    // from their respective source (personalized pool, click-rank RPC, or
    // the gender-filtered search endpoint) — nothing left to derive here.
    return pool;
  }, [pool, tab]);

  const topTrendingId = isTrendingTab ? characters[0]?.id : undefined;

  return (
    <section className="px-4 md:px-8 py-8 border-t border-border-hairline">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl md:text-2xl text-text-primary">
            Explore Characters
          </h2>
          <Link
            href="/characters"
            className="text-sm font-semibold text-gold-400 hover:text-gold-300 transition-colors ease-premium"
          >
            View All
          </Link>
        </div>

        <FilterPillGroup
          options={TABS}
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          className="mb-5"
        />

        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="aspect-[3/4] rounded-md border border-border-hairline bg-white/[0.03] animate-pulse"
              />
            ))}
          </div>
        ) : characters.length === 0 ? (
          <p className="text-text-secondary text-sm py-8 text-center">
            No companions found.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {characters.slice(0, 10).map((c) => (
              <CompanionCard
                key={c.id}
                character={c}
                className="w-full"
                hot={c.id === topTrendingId}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
