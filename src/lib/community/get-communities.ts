/**
 * getCommunityList — the actual community list logic.
 *
 * ROOT-CAUSE FIX (2026-08-23): same self-fetch issue as
 * lib/dating/get-world-home.ts (see that file's header comment for the
 * full explanation) — this used to live inline in
 * app/api/community/list/route.ts, reachable from
 * (app)/community/page.tsx only via an HTTP self-fetch through
 * fetchInternal(). Moved here so the Server Component can call it
 * in-process. route.ts is now a thin wrapper around this for any
 * client-side/external caller.
 *
 * PERF FIX (2026-08-23): the full source fetch is identical on every call
 * regardless of the type/q/limit params — CommunityBrowser (the client
 * component) does all of its filtering in memory against a single
 * `initial` list, so in practice this ran the same Supabase queries on
 * every single page load. Unlike feed/posts (which is per-user via
 * user_liked), this data has NO per-user personalization at all, making it
 * an even cleaner Redis-cache candidate than the existing feed cache —
 * same fail-open pattern (lib/redis), short TTL, key excludes nothing
 * user-specific because there's nothing user-specific to exclude.
 * Filtering by type/q/limit now happens in memory, post-cache, so those
 * params are free.
 *
 * REMOVAL (2026-08-24): per-character, per-world-location, and
 * per-faction auto-generated communities have been removed — this is now
 * just the two static, curated communities (General, Creator Hub).
 * Nothing else in the app links into a character-/world-/faction-*
 * community slug (confirmed via grep before removing), and
 * getCommunityBySlug() derives entirely from this same list, so an old
 * bookmarked link to one of those now 404s via the existing not-found
 * path rather than needing separate cleanup. Underlying community_posts
 * rows for those old slugs are left in place (unreachable, harmless) —
 * this only stops generating/surfacing the communities, it does not
 * purge historical post data.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";
import type { Community, CommunityType } from "@/types/community";

const STATIC_COMMUNITIES: Community[] = [
  {
    slug: "general",
    name: "General",
    type: "general",
    description: "The main hub — talk about anything Vantrix, share moments, and connect with other members.",
    memberCount: 0,
    postCount: 0,
  },
  {
    slug: "creator-hub",
    name: "Creator Hub",
    type: "creator",
    description: "A space for character creators to share tips, get feedback, and showcase their work.",
    memberCount: 0,
    postCount: 0,
  },
];

const FULL_LIST_CACHE_KEY = "community:list:full:v2";
const FULL_LIST_CACHE_TTL_SECONDS = 60;

/**
 * Builds the full, unfiltered community list (currently just the two
 * statics, with real post counts) straight from Supabase. No type/q/limit
 * here — those are applied in memory by the caller against whatever this
 * returns, cached or not.
 */
async function fetchFullCommunityList(): Promise<Community[]> {
  const communities: Community[] = [...STATIC_COMMUNITIES];

  try {
    // PERF (runtime pass): this used to `.select("community_slug")` with no
    // row limit and count matches by pulling every row into memory — for
    // two long-lived communities (General, Creator Hub) that's every post
    // either has ever gotten, transferred just to find its length. Same
    // result via Postgres's own COUNT (head: true skips the row payload
    // entirely) run once per slug, in parallel — cheap regardless of how
    // large community_posts grows, and this whole function already sits
    // behind FULL_LIST_CACHE_TTL_SECONDS's 60s cache so it's not even on
    // the hot path per-request, just cheaper on every cache-miss refill.
    const results = await Promise.all(
      communities.map((c) =>
        supabaseAdmin
          .from("community_posts")
          .select("*", { count: "exact", head: true })
          .eq("community_slug", c.slug)
      )
    );
    results.forEach((result, i) => {
      if (result.error) {
        logger.error("community-list:post-counts-error", {
          error: result.error.message,
          slug: communities[i].slug,
        });
      } else {
        communities[i].postCount = result.count ?? 0;
      }
    });
  } catch (err) {
    // community_posts table may not exist yet — return without post counts
    logger.error("community-list:post-counts-error", { error: String(err) });
  }

  return communities;
}

async function getFullCommunityListCached(): Promise<Community[]> {
  try {
    const cached = await redis.get<string>(FULL_LIST_CACHE_KEY);
    if (cached) return JSON.parse(cached) as Community[];
  } catch {
    // fail OPEN — cache miss/error, fall through to Supabase
  }

  const communities = await fetchFullCommunityList();

  try {
    await redis.set(FULL_LIST_CACHE_KEY, JSON.stringify(communities), { ex: FULL_LIST_CACHE_TTL_SECONDS });
  } catch {
    // Non-fatal — caching is best-effort
  }

  return communities;
}

export async function getCommunityList(params: {
  type?: CommunityType | null;
  q?: string;
  limit?: number;
}): Promise<Community[]> {
  const type = params.type ?? null;
  const q = (params.q ?? "").toLowerCase();
  const limit = Math.min(params.limit && params.limit > 0 ? params.limit : 40, 80);

  const all = await getFullCommunityListCached();

  let filtered = type ? all.filter((c) => c.type === type) : all;
  if (q) {
    filtered = filtered.filter((c) => c.name.toLowerCase().includes(q));
  }

  return filtered.slice(0, limit);
}
