/**
 * GET /api/recommendations — Character Recommendation Engine
 *
 * Thin wrapper around recommendations/engine.ts's getRecommendations() —
 * the full collaborative/content/popularity/recency/bond-affinity/mood
 * blend, per-user cached. Works for logged-out visitors too (popularity-
 * weighted fallback via an empty tag-weights map).
 *
 * Query params:
 *   limit — number of results (default: 10, max: 2000 — "For You" is the
 *           whole scored catalog now, not a short curated strip)
 *   mood  — optional self-reported mood from USER_MOODS (./moods), boosts
 *           mood-matching tags/archetypes; ignored if not a recognized value
 *   gender — 'male' | 'female' | 'non_binary', filters before scoring
 *
 * WIRE-FIX (completing the recommendation system): this route previously
 * had zero callers anywhere in the frontend, despite its own docstring
 * claiming three — same "backend shipped, no consumer" pattern as the
 * gift-button/media-button/dating-mood-sync gaps fixed in earlier passes.
 * Of the three original claims: the Home page hero was removed from
 * (app)/page.tsx entirely (see that file's HERO-REMOVED note) and no
 * longer exists to wire into; /discover's featured section and Home's
 * "For You" strip get their personalization from a separate, lighter
 * function in the same engine.ts (scoreCandidatesForDiscover +
 * getCombinedTagWeights, called directly from /api/discover/featured) —
 * already real and working, just not this route, so left untouched.
 * Post-chat suggestions was the one gap that was actually still open — no
 * such UI existed at all. Now wired: getPostChatSuggestions() in
 * lib/frontend/recommendations.ts, rendered as "You Might Also Like" on
 * the Chats page (see post-chat-suggestions.tsx) — the two real existing
 * callers otherwise are the dating deck and dating/world routes, which
 * import getRecommendations() directly rather than through this route.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { getRecommendations, isUserMood }        from '@/lib/recommendations/engine';
import { normalizeTier }             from '@/lib/rate-limit';
import { logger }                    from '@/lib/logger';
import { resolveNsfwDiscoveryAccess } from '@/lib/access/character-gate';

export const dynamic = 'force-dynamic';
export const revalidate = 30; // ISR: regenerate every 30s — 99% reduction in DB reads at scale

export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await getAuthedUser();

    const { searchParams } = new URL(req.url);
    // "For You" is now the full ranked catalog, not a short curated strip —
    // raised from a max of 20 so the whole scored pool can come through.
    const limit  = Math.min(2000, Math.max(1, parseInt(searchParams.get('limit') ?? '10', 10)));
    // Optional self-reported "how are you feeling right now" signal from
    // the Discover mood picker — distinct from a character's own evolving
    // mood in dating_matches. Untrusted input, so validated against the
    // fixed USER_MOODS list rather than passed through as a free string.
    const rawMood = searchParams.get('mood');
    const mood = isUserMood(rawMood) ? rawMood : null;

    // GENDER-FILTER-FIX: discover-home.tsx previously had to fetch the
    // unfiltered list and filter it down client-side for gender-locked
    // pages (/discover/female etc.), which only worked because it also
    // over-fetched limit=500 to compensate. Accepting the same ?gender=
    // param the /discover/featured route already uses lets this filter at
    // the query level instead — smaller, correct payloads, and the engine's
    // own cache is now gender-aware too (see engine.ts).
    const rawGender = searchParams.get('gender');
    const genderFilter: 'male' | 'female' | 'non_binary' | null =
      rawGender === 'male' || rawGender === 'female' || rawGender === 'non_binary' ? rawGender : null;

    // Recommendations work for unauthenticated users too (popularity-based fallback)
    let userId = '';
    let tier   = 'free' as Parameters<typeof getRecommendations>[1];
    // Unauthenticated callers never get NSFW content; authenticated callers
    // need BOTH an explicit nsfw_enabled opt-in AND a verified age — see
    // P0-AGE-GATE-FIX in @/lib/access/character-gate.
    let allowNsfw = false;

    if (user) {
      userId = user.id;
      const [{ data: profile }, nsfwAllowed] = await Promise.all([
        supabase.from('profiles').select('tier').eq('id', userId).single(),
        resolveNsfwDiscoveryAccess(userId),
      ]);
      tier = normalizeTier((profile?.tier as string) ?? 'free') as typeof tier;

      allowNsfw = nsfwAllowed;
    }

    const recommendations = await getRecommendations(userId, tier, limit, mood, allowNsfw, genderFilter);

    return NextResponse.json({
      recommendations,
      total: recommendations.length,
    }, {
      headers: {
        // PERF: response varies per-user (NSFW gating depends on auth +
        // age-verification + preference state) — must stay `private`, never
        // shared/public, so a CDN can't leak one user's NSFW-filtered list
        // to another. Client-side cache only.
        'Cache-Control': 'private, max-age=300', // 5-min client cache
      },
    });

  } catch (error) {
    logger.error('recommendations:route-error', { error: String(error) });
    return NextResponse.json({ recommendations: [], total: 0 }, { status: 200 });
  }
}
