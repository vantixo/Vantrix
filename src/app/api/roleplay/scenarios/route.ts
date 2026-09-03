import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { resolveEffectiveTier } from '@/lib/rate-limit';
import { listScenarios, isScenarioUnlockedForTier, getScenarioVotesForUser, ALWAYS_FREE_SCENARIO_SLUG } from '@/lib/roleplay/scenarios';

/**
 * GET /api/roleplay/scenarios?characterId=<uuid>
 *
 * Returns the full active catalog (universal templates + any templates
 * scoped to the given character), each annotated with `locked` for the
 * caller's tier and `myVote` ('like' | 'dislike' | null) for the caller's
 * own vote on that scenario. Locked scenarios are still returned (not
 * filtered out) so the picker can show them with a paywall affordance,
 * same UX as MOOD_ROOMS in scene-data.ts.
 */
export async function GET(req: NextRequest) {
  const { supabase, user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const characterId = req.nextUrl.searchParams.get('characterId') ?? undefined;

  const { data: profile } = await supabase
    .from('profiles')
    .select('tier,role,is_admin')
    .eq('id', user.id)
    .maybeSingle();
  const tier = resolveEffectiveTier(profile ?? {});

  const scenarios = await listScenarios(characterId);
  const votes = await getScenarioVotesForUser(user.id, scenarios.map(s => s.id));

  // ROLEPLAY-PAYWALL FIX: POST /api/roleplay/start hard-gates the entire
  // feature behind premium via requirePlan(userId, 'premium', 'Roleplay') —
  // that check runs before any per-scenario tier check even happens. This
  // list endpoint previously only evaluated isScenarioUnlockedForTier(),
  // which looks solely at each scenario's own min_tier column, so a
  // scenario authored with min_tier: 'free' rendered as a clickable
  // "Begin" card for free users even though starting it would always be
  // rejected server-side. Free users saw 3/4 stories "unlocked," tapped
  // Begin, and only then hit the paywall as a raw error banner.
  //
  // One exception: ALWAYS_FREE_SCENARIO_SLUG ("First Date") stays playable
  // for everyone as a taste of Story Mode — engine.ts's startSession()
  // grants it the same carve-out server-side, so this stays truthful for
  // every tier rather than just hiding the lock icon.
  const roleplayEnabled = tier !== 'free';

  return NextResponse.json({
    scenarios: scenarios.map(s => ({
      ...s,
      locked: s.slug === ALWAYS_FREE_SCENARIO_SLUG ? false : !roleplayEnabled || !isScenarioUnlockedForTier(s, tier),
      myVote: votes[s.id] ?? null,
    })),
  });
}
