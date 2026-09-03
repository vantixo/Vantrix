/**
 * POST /api/roleplay/[sessionId]/turn
 *
 * Advances an active story session by one beat: the user's action (say/do/
 * pick a listed choice) goes in, the narrator's next beat comes back —
 * along with chapter/choice/completion state so the client knows whether to
 * render a choice rail, a chapter divider, or an end-of-story card.
 *
 * All the actual work — safety checks, rate limits, model call, persistence,
 * retention hooks — lives in lib/roleplay/engine.ts's advanceTurn(). This
 * route is auth + validation + error-code mapping only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { resolveEffectiveTier } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { advanceTurn, RoleplayError } from '@/lib/roleplay/engine';
import { requirePlan } from '@/lib/auth/plan';
import { toErrorBody } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  actionType: z.enum(['say', 'do', 'choice']),
  text: z.string().min(1).max(800),
});

export async function POST(req: NextRequest, props: { params: Promise<{ sessionId: string }> }) {
  const params = await props.params;

  const { supabase, user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', code: 'VALIDATION_ERROR' }, { status: 400 });
  }
  const { actionType, text } = parsed.data;

  const { data: profile } = await supabase
    .from('profiles')
    .select('tier,role,is_admin')
    .eq('id', user.id)
    .maybeSingle();
  const tier = resolveEffectiveTier(profile ?? {});

  try {
    // PREMIUM-GATE: same reasoning as /api/roleplay/start — closes the gap
    // where a free user with an already-started session (e.g. one created
    // before this gate shipped) could keep advancing it indefinitely
    // without ever hitting a premium check.
    await requirePlan(user.id, 'premium', 'Roleplay');

    const turn = await advanceTurn({
      userId: user.id,
      tier,
      sessionId: params.sessionId,
      actionType,
      text,
    });
    return NextResponse.json(turn);
  } catch (err) {
    if (err instanceof RoleplayError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    if (err && typeof err === 'object' && 'statusCode' in err) {
      return NextResponse.json(toErrorBody(err), { status: (err as { statusCode: number }).statusCode });
    }
    logger.error('api/roleplay/turn error', {
      error: err instanceof Error ? err.message : String(err),
      userId: user.id,
      sessionId: params.sessionId,
    });
    return NextResponse.json({ error: 'Something went wrong continuing the story', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
