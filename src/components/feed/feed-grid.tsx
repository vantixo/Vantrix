"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { FilterPillGroup } from "@/components/ui/filter-pills";
import { Button } from "@/components/ui/button";
import { FeedPostCard } from "./feed-post-card";
import { FeedInlineAd } from "./feed-inline-ad";
import { FeedStoriesRail } from "./feed-stories-rail";
import { useFeed } from "@/hooks/use-feed";
import type { FeedPost, FeedFilter, FeedCharacterSummary } from "@/types/feed";
import type { HeroAd } from "@/lib/frontend/ads";

const FILTER_OPTIONS = [
  { value: "new", label: "New" },
  { value: "trending", label: "Trending" },
  { value: "all", label: "All" },
];

// Instagram-style cadence: first ad after 3 posts, then one every 5 after
// that. Ads cycle (modulo) if the feed page renders more ad slots than
// getInlineAds() returned rows for — a thin 'inline' inventory still
// spreads across a long scroll session instead of drying up after one card.
const FIRST_AD_AFTER = 3;
const AD_INTERVAL = 5;

type FeedItem =
  | { kind: "post"; key: string; post: FeedPost }
  | { kind: "ad"; key: string; ad: HeroAd };

function interleaveAds(posts: FeedPost[], ads: HeroAd[]): FeedItem[] {
  if (ads.length === 0) return posts.map((post) => ({ kind: "post", key: post.id, post }));

  const items: FeedItem[] = [];
  let adCursor = 0;
  posts.forEach((post, i) => {
    items.push({ kind: "post", key: post.id, post });
    const postsSoFar = i + 1;
    const dueForAd =
      postsSoFar === FIRST_AD_AFTER ||
      (postsSoFar > FIRST_AD_AFTER && (postsSoFar - FIRST_AD_AFTER) % AD_INTERVAL === 0);
    if (dueForAd) {
      const ad = ads[adCursor % ads.length];
      items.push({ kind: "ad", key: `ad-${ad.id}-${adCursor}`, ad });
      adCursor += 1;
    }
  });
  return items;
}

export function FeedGrid({
  initialPosts,
  initialNextCursor,
  ads = [],
}: {
  initialPosts: FeedPost[];
  initialNextCursor: string | null;
  ads?: HeroAd[];
}) {
  const [filter, setFilter] = useState<FeedFilter>("new");
  const [activeCharacter, setActiveCharacter] = useState<string | null>(null);
  const [posts, setPosts] = useState(initialPosts);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [loading, setLoading] = useState(false);
  const { fetchPosts } = useFeed();

  // Ads don't get refetched on filter/character changes — getInlineAds()
  // ran once, server-side, for this page load, same lifetime as the props
  // this component was mounted with. interleaveAds() recomputes on every
  // `posts` change (filter switch, load more) so slot positions stay
  // correct against whatever's currently rendered.
  const feedItems = useMemo(() => interleaveAds(posts, ads), [posts, ads]);

  // Stories rail is drawn from whoever has posted recently — no extra
  // fetch, just the characters already embedded in the loaded page.
  const storyCharacters = useMemo(() => {
    const seen = new Map<string, FeedCharacterSummary>();
    for (const p of initialPosts) {
      if (p.character && !seen.has(p.character.id)) seen.set(p.character.id, p.character);
    }
    return Array.from(seen.values()).slice(0, 20);
  }, [initialPosts]);

  async function refetch(nextFilter: FeedFilter, nextCharacter: string | null) {
    setLoading(true);
    const page = await fetchPosts(nextFilter, undefined, nextCharacter ?? undefined);
    if (page) {
      setPosts(page.posts);
      setNextCursor(page.nextCursor);
    }
    setLoading(false);
  }

  async function handleFilterChange(value: string) {
    const target = value as FeedFilter;
    setFilter(target);
    await refetch(target, activeCharacter);
  }

  async function handleCharacterSelect(id: string | null) {
    setActiveCharacter(id);
    await refetch(filter, id);
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoading(true);
    const page = await fetchPosts(filter, nextCursor, activeCharacter ?? undefined);
    if (page) {
      setPosts((prev) => [...prev, ...page.posts]);
      setNextCursor(page.nextCursor);
    }
    setLoading(false);
  }

  return (
    <div>
      <FeedStoriesRail
        characters={storyCharacters}
        activeId={activeCharacter}
        onSelect={handleCharacterSelect}
      />

      <FilterPillGroup
        options={FILTER_OPTIONS}
        value={filter}
        onChange={handleFilterChange}
        className="px-4 md:px-0 mb-4"
      />

      {posts.length === 0 && !loading ? (
        <p className="text-sm text-text-tertiary py-16 text-center">
          {filter === "trending" ? "Nothing trending yet." : "No posts yet — check back soon."}
        </p>
      ) : (
        <div className="flex flex-col gap-4 px-4 md:px-0">
          {feedItems.map((item, i) => (
            <motion.div
              key={item.key}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1], delay: Math.min(i, 6) * 0.03 }}
            >
              {item.kind === "post" ? <FeedPostCard post={item.post} /> : <FeedInlineAd ad={item.ad} />}
            </motion.div>
          ))}
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
        </div>
      )}

      {/*
        Same gate discussion-feed.tsx applies to its own "new"-only sort:
        /api/feed/posts only applies cursor filtering on the "new"/"all"
        branch (see route.ts) — "trending" always re-runs its
        likes_count-sorted query unfiltered, so a cursor there would just
        re-fetch the same top page rather than continuing it.
      */}
      {!loading && filter !== "trending" && nextCursor && (
        <div className="flex justify-center mt-4">
          <Button variant="secondary" size="sm" onClick={loadMore}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
