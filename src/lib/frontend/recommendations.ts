import "server-only";
import { fetchInternal } from "./api";
import type { DiscoverCharacter } from "./discover";

/**
 * "You Might Also Like" — the post-chat suggestions caller GET
 * /api/recommendations's own docstring has named since the route was
 * built ("Called by: ... Post-chat suggestions") but which never
 * actually existed anywhere in the frontend. lib/recommendations/
 * engine.ts's getRecommendations() is the real, already-working
 * personalization path — collaborative + content + popularity + recency +
 * bond-affinity + mood blend, per-user cached — and two real callers
 * already use it (the dating deck, dating/world). The route wrapping it
 * for general "For You" use had zero callers: same "backend shipped, no
 * consumer" shape as the gift-button/media-button/dating-mood-sync gaps
 * fixed in earlier passes. This is that consumer.
 *
 * Goes through the route (fetchInternal), not a direct getRecommendations()
 * import — per FRONTEND_DIRECTIVE §10 (see fetchInternal's own doc
 * comment): the route does real request-shaping (profile/tier lookup,
 * resolveNsfwDiscoveryAccess, mood/gender parsing) that a Server Component
 * shouldn't reimplement.
 *
 * Mirrors the route's JSON (RecommendedCharacter in engine.ts) into
 * DiscoverCharacter so the existing CompanionCard/HorizontalScrollRow
 * pair (already used by FeaturedCompanions) can render it with no new
 * card component. The engine doesn't select/return like_count,
 * follower_count, or is_live — filled with the same neutral defaults
 * use-character-recommendations.ts already established for this exact
 * situation (a narrower projection than DiscoverCharacter's full shape)
 * rather than widening the engine's query for fields this card doesn't
 * strictly need.
 */
export async function getPostChatSuggestions(limit = 10): Promise<DiscoverCharacter[]> {
  try {
    const { recommendations } = await fetchInternal<{
      recommendations: {
        id: string;
        name: string;
        age: number | null;
        gender: string | null;
        description: string | null;
        image_url: string | null;
        tags: string[];
        is_premium: boolean;
        min_tier?: string | null;
        is_new: boolean;
        tokens_cost: number | null;
        archetype?: string | null;
        opening_line?: string | null;
        reason: string;
      }[];
    }>(`/api/recommendations?limit=${limit}`);

    return recommendations.map((r) => ({
      id: r.id,
      name: r.name,
      age: r.age,
      gender: r.gender,
      description: r.description,
      image_url: r.image_url,
      tags: r.tags ?? [],
      is_premium: r.is_premium,
      min_tier: r.min_tier ?? null,
      is_new: r.is_new,
      is_live: true,
      tokens_cost: r.tokens_cost,
      archetype: r.archetype ?? null,
      opening_line: r.opening_line ?? null,
      like_count: 0,
      follower_count: 0,
      // Same narrower-projection situation as like_count/follower_count
      // above — the recommendations engine doesn't select model_url or
      // the appearance columns, so CharacterPortraitViewer falls through
      // to its 2D LivingPortrait tier for these cards (no model_url, no
      // appearance data to build a procedural avatar from either).
      model_url: null,
      hair_color: null,
      eye_color: null,
      skin_tone: null,
      body_type: null,
      reason: r.reason,
    }));
  } catch {
    // Same fail-open posture as getDiscoverHome() — a suggestions strip
    // is enhancement, never a reason to break the Chats page.
    return [];
  }
}
