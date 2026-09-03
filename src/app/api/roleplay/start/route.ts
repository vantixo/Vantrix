import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { resolveEffectiveTier } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { startSession, RoleplayError } from '@/lib/roleplay/engine';
import { getScenario, ALWAYS_FREE_SCENARIO_SLUG } from '@/lib/roleplay/scenarios';
import { requirePlan } from '@/lib/auth/plan';
import { toErrorBody } from '@/lib/errors';

const bodySchema = z.object({
  characterId: z.string().uuid(),
  scenarioId:  z.string().uuid(),
});

export async function POST(req: NextRequest) {
  const { supabase, user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', code: 'VALIDATION_ERROR' }, { status: 400 });
  }
  const { characterId, scenarioId } = parsed.data;

  const { data: profile } = await supabase
    .from('profiles')
    .select('tier,role,is_admin')
    .eq('id', user.id)
    .maybeSingle();
  const tier = resolveEffectiveTier(profile ?? {});

  try {
    // PREMIUM-GATE (this revision): roleplay used to just draw against the
    // shared daily message pool like regular chat — a free user could start
    // a story, they'd just run out of the pool fast. Product wants it hard-
    // gated instead: free users see the paywall immediately, before a
    // session (and its first generated turn) is created at all, rather than
    // discovering the gate mid-story. requirePlan throws PlanGateError
    // (403) for a 'free' tier and passes through admins, same as every
    // other premium-only route (characters/*, digital-twin/*).
    //
    // ONE FREE SAMPLE: ALWAYS_FREE_SCENARIO_SLUG ("First Date") is exempt
    // from this gate so every tier can try Story Mode once before hitting
    // the paywall — see scenarios/route.ts, which marks that same scenario
    // unlocked client-side. Every other scenario still requires premium
    // regardless of its own min_tier.
    const scenario = await getScenario(scenarioId);
    if (!scenario) {
      return NextResponse.json({ error: 'That story could not be found.', code: 'SCENARIO_NOT_FOUND' }, { status: 404 });
    }
    if (scenario.slug !== ALWAYS_FREE_SCENARIO_SLUG) {
      await requirePlan(user.id, 'premium', 'Roleplay');
    }

    const { conversationId, turn } = await startSession({ userId: user.id, tier, characterId, scenarioId });
    return NextResponse.json({ conversationId, ...turn });
  } catch (err) {
    if (err instanceof RoleplayError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    if (err && typeof err === 'object' && 'statusCode' in err) {
      return NextResponse.json(toErrorBody(err), { status: (err as { statusCode: number }).statusCode });
    }
    logger.error('api/roleplay/start error', { error: err instanceof Error ? err.message : String(err), userId: user.id });
    return NextResponse.json({ error: 'Could not start this story', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
