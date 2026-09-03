import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface HeroAd {
  id: string;
  title: string;
  image_url: string;
  link: string;
  /** True for banners whose headline/CTA is already baked into the
   *  image itself (see 20261220_seed_baked_hero_ad_creatives.sql) — the
   *  carousel's own gradient+title overlay is built for photo-only
   *  ad images and would otherwise darken and duplicate text on top
   *  of a design that already has its own. */
  hide_overlay: boolean;
}

/**
 * Mirrors GET /api/ads?position=hero exactly (same table, same filters,
 * same order/limit) — see that route's own docstring: "Public,
 * unauthenticated read of active advertising rows only... never joins
 * or falls back to `characters`."
 *
 * PERF: querying Supabase directly here rather than going through
 * fetchInternal("/api/ads?...") (the pattern getDiscoverHome/
 * getHomeContext use) is a deliberate deviation, not an inconsistency.
 * FRONTEND_DIRECTIVE §10 (see api.ts's own comment) draws the line at
 * whether the route does "real request-shaping you don't want to
 * reimplement" — /api/ads has none of that (no auth, no personalization,
 * a single .eq/.order/.limit chain), unlike featured/home-context. Going
 * through HTTP here would cost a full extra server-to-server round trip,
 * on every Home render, for a query this route handler already runs in
 * three lines. The public route itself is untouched and still serves
 * the ad board / any other future client-side caller directly.
 */
export async function getHeroAds(limit = 8): Promise<HeroAd[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("ads")
      .select("id,title,image_url,link,hide_overlay")
      .eq("active", true)
      .eq("position", "hero")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data ?? [];
  } catch {
    // Same fail-quiet contract as getDiscoverHome/getHomeContext — an ads
    // outage should never break Home; HeroAdsCarousel already renders
    // nothing for an empty array.
    return [];
  }
}

/**
 * Same shape/contract as getHeroAds(), for the 'inline' position — the
 * Feed's previously-unwired ad channel (position existed in the `ads`
 * table/admin form since the original schema, but nothing on the
 * frontend ever queried it; only 'hero' had a consuming component).
 * Mirrors GET /api/ads?position=inline. Kept as its own function rather
 * than parameterizing getHeroAds() so each call site's intent stays
 * grep-able and either slot's row limit can change independently.
 */
export async function getInlineAds(limit = 6): Promise<HeroAd[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("ads")
      .select("id,title,image_url,link,hide_overlay")
      .eq("active", true)
      .eq("position", "inline")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data ?? [];
  } catch {
    // Fail-quiet: an ads outage should never break the Feed. FeedGrid
    // just interleaves nothing when this comes back empty.
    return [];
  }
}
