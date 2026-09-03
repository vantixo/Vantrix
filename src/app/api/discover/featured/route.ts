/**
 * GET /api/discover/featured
 *
 * Unified discover endpoint with two modes:
 *
 *   mode=full  (default, offset=0)
 *     Returns featured + avatars + experiences + allCharacters.
 *     Used on initial page load only.
 *
 *   mode=chars  (or offset > 0)
 *     Returns only allCharacters for a given gender filter + page.
 *     Used for tab switches and infinite scroll — avoids re-fetching
 *     the static hero/avatar/experience data that doesn't change on tab.
 *
 * Query params:
 *   gender   — "female" | "male" | "anime" | omit for all — applies to
 *              every section in mode=full (hero, avatars, experiences,
 *              allCharacters), not just the grid, so a gender-locked page
 *              (/discover/female etc.) never mixes in another gender.
 *   category — archetype filter for experiences
 *   offset   — pagination offset for allCharacters (default 0)
 *   limit    — page size for allCharacters (default 40, max 80)
 *   mode     — "full" | "chars" (auto-detected from offset when omitted)
 *
 * Cache:
 *   mode=full  → CDN 60s / SWR 120s (hero data rarely changes)
 *   mode=chars → CDN 30s / SWR 60s  (grid changes more often)
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient }              from "@/lib/supabase/server";
import { resolveNsfwDiscoveryAccess } from "@/lib/access/character-gate";
import { getCombinedTagWeights, scoreCandidatesForDiscover, type DiscoverCandidate } from "@/lib/recommendations/engine";
import { curateForUser } from "@/lib/recommendations/ai-curator";
import { getTrendingCharacters } from "@/lib/recommendations/trending";
import { logger } from "@/lib/logger";

export const dynamic  = "force-dynamic";
export const revalidate = 60;

const ARCHETYPE_CATEGORY: Record<string, string> = {
  romantic:    "romance",
  adventurous: "adventure",
  mysterious:  "mystery",
  playful:     "romance",
  dominant:    "adventure",
  submissive:  "romance",
};
const SERIES_ARCHETYPES = new Set(["mysterious", "dominant", "complex"]);

type DbRow = Record<string, unknown>;

/**
 * P0-AGE-GATE-FIX: this used to gate purely on the nsfw_enabled profile
 * preference, with signup-time self-attested age never re-checked here.
 * Delegates to the shared resolveNsfwDiscoveryAccess(), which requires
 * BOTH is_user_age_verified() and nsfw_enabled. Unauthenticated users
 * never receive NSFW content (userId === null short-circuits to false).
 */
async function resolveNsfwAccess(
  userId: string | null,
): Promise<boolean> {
  return resolveNsfwDiscoveryAccess(userId);
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const sp          = req.nextUrl.searchParams;
  const genderParam = sp.get("gender") ?? null;
  const catParam    = sp.get("category") ?? null;
  // "trending" — real click-rank order (lib/recommendations/trending.ts),
  // requested explicitly by explore-characters.tsx's Trending tab. Any
  // other/missing value keeps today's personalized-first-page/recency
  // behavior untouched.
  const sortParam   = sp.get("sort") ?? null;
  // NaN guard (same pattern as earlier Phase B fixes) — parseInt('abc') is
  // NaN, and Math.max(0, NaN)/Math.min(80, Math.max(1, NaN)) are BOTH still
  // NaN (Math.max/min do not filter NaN out), so ?offset=abc or ?limit=abc
  // would reach .range(NaN, NaN) and surface a raw Postgrest error instead
  // of falling back to the documented defaults.
  const rawOffset = parseInt(sp.get("offset") ?? "0", 10);
  const rawLimit  = parseInt(sp.get("limit") ?? "40", 10);
  const offset    = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0);
  const limit     = Math.min(80, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 40));
  const modeParam   = sp.get("mode") ?? (offset > 0 ? "chars" : "full");
  const charsOnly   = modeParam === "chars";

  try {
    const { data: { user } } = await supabase.auth.getUser();
    const allowNsfw = await resolveNsfwAccess(user?.id ?? null);

    // ── Trending tab (explore-characters.tsx) ───────────────────────────
    // Real click-rank order, not the personalized/recency pool below —
    // see lib/recommendations/trending.ts. Always requested as mode=chars
    // (the tab fetches its own small page independent of Home's first-page
    // load), so this only ever short-circuits the fast path, never the
    // mode=full response featured/avatars/experiences depend on.
    if (charsOnly && sortParam === "trending") {
      const trending = await getTrendingCharacters(supabase, {
        allowNsfw,
        gender: genderParam,
        limit,
      });
      return NextResponse.json(
        { allCharacters: trending.map((c) => shapeChar(c as unknown as DbRow)), offset: 0, hasMore: false },
        { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=90" } },
      );
    }

    // Personalized ordering (see lib/recommendations/engine.ts) applies to
    // the FIRST page for every visitor, not just logged-in users — with an
    // empty tag-weights map, scoreCandidatesForDiscover() already degrades
    // gracefully to pure popularity+recency ordering (see its own doc
    // comment), so there's no reason logged-out visitors were getting raw
    // unscored recency instead of that. The LLM curator pass on top still
    // requires a real user id (it needs one for budget/cache keying), so
    // that part alone stays gated to authenticated users below.
    //
    // Deeper pagination (offset > 0, infinite scroll) stays on the plain
    // recency order below — reordering an already-fetched-and-displayed
    // page out from under a user mid-scroll would be jarring, and a bigger
    // unordered pool query for every scroll page would cost far more than
    // the personalization is worth that deep into the feed. The first page
    // is where personalization actually matters: it's what everyone sees
    // before deciding whether to scroll.
    const canPersonalizeFirstPage = offset === 0;

    // ── Characters query (always runs) ────────────────────────────────────
    const CHAR_SELECT = "id,name,age,gender,description,image_url,tags,is_premium,min_tier,is_new,is_live,tokens_cost,archetype,opening_line,like_count,follower_count,created_at,model_url,hair_color,eye_color,skin_tone,body_type";

    const charsQuery = (async (): Promise<{ data: DbRow[] | null }> => {
      if (canPersonalizeFirstPage) {
        // Wider pool than the page size — personalization needs candidates
        // to choose *among*, not just the `limit` newest rows re-ordered
        // among themselves. Bounded at 150 to keep this a single cheap
        // query rather than something that scales with catalog size.
        const poolSize = Math.min(150, Math.max(limit * 3, 60));
        try {
          let poolQ = supabase
            .from("characters")
            .select(CHAR_SELECT)
            .eq("is_live", true)
            .eq("active", true)
            .eq("is_public", true);
          if (!allowNsfw) poolQ = poolQ.eq("is_nsfw", false);
          if (genderParam && genderParam !== "all") poolQ = poolQ.eq("gender", genderParam);

          const { data: pool, error } = await poolQ
            .order("created_at", { ascending: false })
            .range(0, poolSize - 1);

          if (error || !pool?.length) throw error ?? new Error("empty pool");

          const tagWeights = user?.id ? await getCombinedTagWeights(user.id) : new Map<string, number>();
          const ordered = scoreCandidatesForDiscover(
            pool as unknown as DiscoverCandidate[],
            tagWeights,
            { userId: user?.id ?? "anon" },
          );

          // LLM curator: re-ranks the top of the deterministic shortlist and
          // writes short display reasons. Requires a real user id (budget
          // tracking + per-user cache), so logged-out visitors skip this
          // step and keep the deterministic popularity+recency order —
          // never blocked on it, never worse off than before. Fails open to
          // `ordered` unchanged (see ai-curator.ts guardrails) either way.
          let finalOrder: DiscoverCandidate[] = ordered;
          if (user?.id) {
            try {
              const curated = await curateForUser(
                user.id,
                ordered.map(c => ({
                  id:           c.id as string,
                  name:         (c as unknown as DbRow).name as string,
                  archetype:    ((c as unknown as DbRow).archetype as string | null) ?? null,
                  tags:         c.tags,
                  opening_line: ((c as unknown as DbRow).opening_line as string | null) ?? null,
                })),
                tagWeights,
              );
              if (curated.wasCurated) {
                const byId = new Map(ordered.map(c => [c.id, c]));
                finalOrder = curated.orderedIds
                  .map(id => byId.get(id))
                  .filter((c): c is DiscoverCandidate => Boolean(c));
                for (const c of finalOrder as unknown as DbRow[]) {
                  const reason = curated.reasons.get(c.id as string);
                  if (reason) c.__curatorReason = reason;
                }
              }
            } catch (err) {
              logger.warn("discover: ai-curator failed, using deterministic order", {
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          return { data: finalOrder.slice(0, limit) as unknown as DbRow[] };
        } catch (err) {
          logger.warn("discover: first-page personalization failed, falling back to recency order", {
            error: err instanceof Error ? err.message : String(err),
          });
          // Fall through to the plain recency query below.
        }
      }

      let q = supabase
        .from("characters")
        .select(CHAR_SELECT)
        .eq("is_live", true)
        .eq("active", true)
        .eq("is_public", true);
      if (!allowNsfw) q = q.eq("is_nsfw", false);
      if (genderParam && genderParam !== "all") q = q.eq("gender", genderParam);
      return q
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
    })();

    if (charsOnly) {
      // Fast path — only fetch char grid (tab switch or pagination)
      const { data: rawAll } = await charsQuery;
      const allCharacters = (rawAll ?? []).map(shapeChar);
      return NextResponse.json(
        { allCharacters, offset, hasMore: allCharacters.length === limit },
        { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" } }
      );
    }

    // ── Full mode — all four queries in parallel ───────────────────────────
    const [featuredRes, avatarsRes, experiencesRes, allCharsRes] = await Promise.all([

      // 1. Hero carousel — featured characters
      //    FEATURED-SHOWCASE FIX: like_count/follower_count/is_premium/
      //    min_tier added so Home's new premium Featured showcase
      //    (featured-showcase.tsx) can render real engagement stats and
      //    the premium-lock badge on these tiles, matching the same
      //    fields CompanionCard already shows elsewhere — previously
      //    this query only carried enough for the single-hero-banner use
      //    on the logged-out /discover page.
      (async () => {
        let q = supabase
          .from("characters")
          .select("id,name,description,image_url,is_featured,featured_image_url,opening_line,archetype,gender,tags,is_live,is_new,like_count,follower_count,is_premium,min_tier")
          .eq("is_featured", true)
          .eq("is_live", true)
          .eq("active", true)
          .eq("is_public", true);
        if (!allowNsfw) q = q.eq("is_nsfw", false);
        // Gender-locked pages (/discover/female etc.) must never show a
        // hero/avatar/experience from another gender — see genderParam use
        // on charsQuery above for the same rule applied to the main grid.
        if (genderParam && genderParam !== "all") q = q.eq("gender", genderParam);
        return q.order("featured_position", { ascending: true }).limit(5);
      })(),

      // 2. Avatar strip — newest + live characters
      //    video_url/intro_video_url/gallery_*_urls added so the strip can
      //    drive the status-ring story viewer (character-status-ring.tsx)
      //    without a second round-trip per character.
      (async () => {
        let q = supabase
          .from("characters")
          .select("id,name,image_url,is_new,is_live,gender,video_url,intro_video_url,gallery_image_urls,gallery_video_urls")
          .eq("is_live", true)
          .eq("active", true)
          .eq("is_public", true);
        if (!allowNsfw) q = q.eq("is_nsfw", false);
        if (genderParam && genderParam !== "all") q = q.eq("gender", genderParam);
        return q.order("created_at", { ascending: false }).limit(14);
      })(),

      // 3. Experiences
      (async () => {
        let q = supabase
          .from("characters")
          .select("id,name,description,image_url,gender,archetype,opening_line,is_new,is_live,tags,created_at,age")
          .eq("is_live", true)
          .eq("active", true)
          .eq("is_public", true)
          .not("archetype", "is", null);
        if (!allowNsfw) q = q.eq("is_nsfw", false);
        if (catParam) q = q.eq("archetype", catParam);
        if (genderParam && genderParam !== "all") q = q.eq("gender", genderParam);
        return q.order("created_at", { ascending: false }).limit(8);
      })(),

      // 4. Character grid (first page)
      charsQuery,
    ]);

    // Supabase's generated types would give us
    // proper Row types; until supabase gen types is run, use unknown[] and
    // narrow each field access at the shaping layer rather than widening to any.
    const rawFeatured = (featuredRes.data ?? []) as DbRow[];
    const rawAvatars  = (avatarsRes.data  ?? []) as DbRow[];
    const rawExp      = (experiencesRes.data ?? []) as DbRow[];
    const rawAll      = (allCharsRes.data  ?? []) as DbRow[];

    // ── Shape featured items ───────────────────────────────────────────────
    // FEATURED-SHOWCASE FIX: dropped the dead `badgeColor: "pink"` field —
    // no consumer ever read it (grep confirmed), and it contradicted the
    // gold-monochrome-only rule badge.tsx's own §9.4 comment documents.
    // Added tags/archetype/likeCount/followerCount/isPremium/minTier, all
    // real columns already selected above/in CHAR_SELECT — nothing
    // fabricated — so the new premium showcase can show genuine trait
    // pills, engagement stats, and a premium-lock badge instead of a
    // bare image+title banner.
    const featured = rawFeatured.length > 0
      ? rawFeatured.map((c: DbRow) => ({
          id:             c.id,
          title:          c.name,
          subtitle:       c.opening_line ?? c.description ?? "",
          image:          c.featured_image_url ?? c.image_url,
          badge:          c.is_new ? "NEW" : "FEATURED",
          cta:            "Chat Now",
          characterId:    c.id,
          tags:           c.tags ?? [],
          archetype:      c.archetype ?? null,
          likeCount:      c.like_count ?? 0,
          followerCount:  c.follower_count ?? 0,
          isPremium:      c.is_premium ?? false,
          minTier:        c.min_tier ?? null,
        }))
      : rawAll.slice(0, 5).map((c: DbRow) => ({
          id:             c.id,
          title:          c.name,
          subtitle:       c.opening_line ?? c.description ?? "",
          image:          c.image_url,
          badge:          c.is_new ? "NEW" : "FEATURED",
          cta:            "Chat Now",
          characterId:    c.id,
          tags:           c.tags ?? [],
          archetype:      c.archetype ?? null,
          likeCount:      c.like_count ?? 0,
          followerCount:  c.follower_count ?? 0,
          isPremium:      c.is_premium ?? false,
          minTier:        c.min_tier ?? null,
        }));

    // ── Shape avatars ──────────────────────────────────────────────────────
    const avatars = rawAvatars.map((c: DbRow) => ({
      id:               c.id,
      name:             c.name,
      image:            c.image_url,
      isNew:            c.is_new,
      isLive:           c.is_live,
      videoUrl:         (c.video_url as string | null) ?? null,
      introVideoUrl:    (c.intro_video_url as string | null) ?? null,
      galleryImageUrls: (c.gallery_image_urls as string[] | null) ?? null,
      galleryVideoUrls: (c.gallery_video_urls as string[] | null) ?? null,
    }));

    // ── Shape experiences ──────────────────────────────────────────────────
    const experiences = rawExp.map((c: DbRow) => ({
      id:             c.id,
      title:          c.name,
      subtitle:       c.description ?? "",
      image:          c.image_url,
      category:       ARCHETYPE_CATEGORY[(c.archetype as string | null)?.toLowerCase() ?? ""] ?? "romance",
      characterName:  c.name,
      characterAge:   c.age ?? null,
      isNew:          c.is_new,
      isSeries:       SERIES_ARCHETYPES.has(((c.archetype as string | null) ?? "").toLowerCase()),
      hasNewEpisode:  c.is_new && SERIES_ARCHETYPES.has(((c.archetype as string | null) ?? "").toLowerCase()),
      characterId:    c.id,
    }));

    const allCharacters = rawAll.map(shapeChar);

    return NextResponse.json(
      { featured, avatars, experiences, allCharacters, offset: 0, hasMore: allCharacters.length === limit },
      { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=120" } }
    );

  } catch (error) {
    logger.error("discover: API error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: "Failed to fetch discover data", featured: [], avatars: [], experiences: [], allCharacters: [], offset: 0, hasMore: false },
      { status: 500 }
    );
  }
}

function shapeChar(c: DbRow) {
  return {
    id:           c.id,
    name:         c.name,
    age:          c.age,
    gender:       c.gender,
    description:  c.description,
    image_url:    c.image_url,
    tags:         c.tags ?? [],
    is_premium:   c.is_premium,
    min_tier:     c.min_tier,
    is_new:       c.is_new,
    is_live:      c.is_live,
    tokens_cost:  c.tokens_cost,
    archetype:    c.archetype,
    opening_line: c.opening_line,
    like_count:   c.like_count ?? 0,
    follower_count: c.follower_count ?? 0,
    // 3D pipeline (character-3d.tsx / 20261213_character_model_url.sql):
    // null for effectively every character today — character-portrait-
    // viewer.tsx falls back to the procedural CharacterAvatar3D (using
    // the appearance fields below), then the 2D LivingPortrait, whenever
    // this is null.
    model_url:    (c.model_url as string | null | undefined) ?? null,
    hair_color:   (c.hair_color as string | null | undefined) ?? null,
    eye_color:    (c.eye_color as string | null | undefined) ?? null,
    skin_tone:    (c.skin_tone as string | null | undefined) ?? null,
    body_type:    (c.body_type as string | null | undefined) ?? null,
    reason:       (c.__curatorReason as string | undefined) ?? undefined,
  };
}
