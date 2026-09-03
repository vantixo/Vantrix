/**
 * GET /api/cron/belief-maintenance — Belief Engine Maintenance Cron
 *
 * Runs weekly. Sweeps every (user, character) pair that has stored
 * beliefs and decays the whole set, including subjects nobody's brought
 * up again recently — belief-engine.ts's recordBelief() only ever decays
 * the one subject it's actively reconciling, so anything else would
 * otherwise never fade without this running on a schedule.
 *
 * belief-engine.ts's runBeliefMaintenance() (the per-pair function this
 * batches over) already existed and was already documented as "intended
 * to be cron-driven... weekly is plenty given the shortest half-life
 * above is 60 days" — this route is that missing cron, not a new engine.
 *
 * Deliberately NOT bundled with wisdom-engine.ts's or habit-engine.ts's
 * own maintenance sweeps (runWisdomMaintenance / runHabitMaintenance),
 * even though cognition-engine.ts's own header suggests running them on
 * the same cadence: both of those stores are in-process Maps (see
 * working-memory.ts's header on why that's deliberate for a same-warm-
 * instance scratchpad), which means a serverless cron invocation almost
 * certainly runs in a different process than any chat request ever did —
 * their buckets would be empty every time this fires, so calling them
 * here would look operational without doing anything. belief-store.ts is
 * the one store in this family actually backed by Supabase/Redis, which
 * is what makes a real cron meaningful for it and not (yet) for the
 * other two. Persisting wisdom/habit state durably is a real follow-up,
 * not something this route works around.
 *
 * Security: requires CRON_SECRET header.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth }           from '@/lib/security';
import { runBeliefMaintenanceCron }  from '@/lib/cognition/belief-engine';
import { logger }                    from '@/lib/logger';
import { env }                       from '@/env';
import { heartbeatStart, heartbeatSuccess, heartbeatFail } from '@/lib/cron/heartbeat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await heartbeatStart('BELIEF_MAINTENANCE');

  try {
    const result = await runBeliefMaintenanceCron();
    logger.info('cron:belief-maintenance:complete', { ...result });
    await heartbeatSuccess('BELIEF_MAINTENANCE');
    return NextResponse.json({ ok: true, ...result, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('cron:belief-maintenance:failed', { error: String(err) });
    await heartbeatFail('BELIEF_MAINTENANCE');
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
