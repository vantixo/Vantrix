/**
 * GET /api/dating/deck
 *
 * Feed for the premium dating swipe deck. Deliberately does not duplicate
 * any candidate-scoring logic — it's a thin wrapper around
 * lib/recommendations/engine.ts's getRecommendations(), which already:
 *   - excludes characters the user has already swiped on (getSwipedIds)
 *   - excludes existing dating_matches
 *   - restricts free-tier users to non-premium characters
 *   - applies the same NSFW-gating rule as every other discovery surface
 *
 * Also returns the caller's current daily swipe usage (checkSwipeLimit,
 * same source of truth POST /api/dating/swipe enforces) so the deck UI can
 * show "X swipes left today" and disable swiping once the cap is hit,
 * instead of letting the user swipe blind into a 429.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { getRecommendations } from '@/lib/recommendations/engine';
import { normalizeTier, checkSwipeLimit, resolveEffectiveTier } from '@/lib/rate-limit';
import { getTierLimits } from '@/lib/tiers/limits';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolveNsfwDiscoveryAccess } from '@/lib/access/character-gate';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // preferred_gender lives on `dating_profiles`, not `profiles` — fetched
    // separately (and tolerantly: a user with no dating_profiles row yet,
    // i.e. never onboarded into Dating, simply has no gender preference on
    // file, not an error).
    const [{ data: profile }, { data: datingProfile }] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        .select('tier,role,is_admin,nsfw_enabled')
        .eq('id', user.id)
        .single(),
      supabaseAdmin
        .from('dating_profiles')
        .select('preferred_gender')
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);

    const tier = normalizeTier((profile?.tier as string) ?? 'free') as Parameters<typeof getRecommendations>[1];
    const effectiveTier = resolveEffectiveTier(profile ?? {});
    // P0-AGE-GATE-FIX: was profile?.nsfw_enabled === true (preference
    // only). Now also requires is_user_age_verified() — see
    // resolveNsfwDiscoveryAccess() in @/lib/access/character-gate.
    const nsfwEnabled = await resolveNsfwDiscoveryAccess(user.id);

    const sp = req.nextUrl.searchParams;
    const rawLimit = parseInt(sp.get('limit') ?? '20', 10);
    const limit = Math.min(50, Math.max(5, Number.isFinite(rawLimit) ? rawLimit : 20));

    // GENDER-FILTER-FIX: the deck previously called getRecommendations()
    // with no gender argument at all, so it silently returned the full
    // mixed catalog — male, female, and anime characters could all land in
    // the same swipe stack regardless of what the caller wanted. An
    // explicit ?gender= param (mirroring the /discover/[gender] pages'
    // convention) lets a gender-scoped entry point (e.g. a future
    // /dating/swipe?gender=female) get a correctly-filtered deck instead of
    // a mixed one truncated down after the fact.
    // GENDER-FILTER-FIX (deck route): an explicit ?gender= query param still
    // wins (used by gender-scoped entry points), but when the caller doesn't
    // pass one we must NOT fall back to an unfiltered/mixed deck — that was
    // the actual root cause of male characters surfacing on a female-only
    // swipe session and vice versa, since the client (SwipeDeck) never sent
    // ?gender= at all. Default to the signed-in user's own preferred_gender
    // so every swipe session is gender-scoped unless the user has no
    // preference on file (null preference deliberately falls through to an
    // unfiltered deck rather than guessing).
    const rawGender = sp.get('gender');
    const explicitGender: 'male' | 'female' | 'non_binary' | null =
      rawGender === 'male' || rawGender === 'female' || rawGender === 'non_binary' ? rawGender : null;
    const profileGender = datingProfile?.preferred_gender ?? null;
    const genderFilter: 'male' | 'female' | 'non_binary' | null =
      explicitGender ??
      (profileGender === 'male' || profileGender === 'female' || profileGender === 'non_binary' ? profileGender : null);

    const [candidates, swipeStatus] = await Promise.all([
      getRecommendations(user.id, tier, limit, null, nsfwEnabled, genderFilter),
      checkSwipeLimit(user.id, effectiveTier),
    ]);

    return NextResponse.json({
      candidates,
      swipes: {
        used:      swipeStatus.used,
        limit:     swipeStatus.limit,
        remaining: Math.max(0, swipeStatus.limit - swipeStatus.used),
      },
      tier: effectiveTier,
    });
  } catch (err) {
    logger.error('dating-deck:route-error', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({
      candidates: [],
      swipes: { used: 0, limit: getTierLimits('free').dailySwipes, remaining: 0 },
      tier: 'free',
    });
  }
}
