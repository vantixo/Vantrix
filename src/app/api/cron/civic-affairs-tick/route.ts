/**
 * GET /api/cron/civic-affairs-tick
 *
 * Scheduled every 3 hours via vercel.json.
 *
 * DEAD-CODE-FIX: election_process, law_vote, city_crisis, diplomatic_event,
 * trade_process, and public_perception_tick were all fully implemented and
 * dispatchable in workers/run/route.ts, but the only place any of them was
 * ever enqueued was inside the 'full_universe_tick' case — and nothing in
 * vercel.json ever schedules a full_universe_tick job. Elections never
 * advanced, proposed laws never resolved, city crises never triggered or
 * recovered, diplomatic relations never shifted, the trade engine's
 * surplus/shortage matching never ran, and public perception never
 * transitioned traits from private to public — all silently, since each
 * function is self-gated (checks its own table before acting) and simply
 * no-ops when called, so there was no error to surface.
 *
 * Each job here is safe on a shared cadence:
 *   - election_process / law_vote / city_crisis are per-location and
 *     self-gate on existing rows (advance-if-active, else maybe-trigger),
 *     so calling them every 3h is equivalent to calling them constantly —
 *     they just do nothing on ticks where there's nothing to do.
 *   - diplomatic_event, trade_process, public_perception_tick are global,
 *     single-pass sweeps with their own internal per-tick limits.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth }           from '@/lib/security';
import { logger }                    from '@/lib/logger';
import { env }                       from '@/env';
import { enqueueJob, enqueueJobsForAllCities } from '@/lib/workers';
import { heartbeatStart, heartbeatSuccess, heartbeatFail } from '@/lib/cron/heartbeat';
import { acquireCronLock } from '@/lib/cron/lock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Lock for slightly less than the tick interval (3h = 10800s). See lib/cron/lock.ts.
  const gotLock = await acquireCronLock('civic-affairs-tick', 10500);
  if (!gotLock) {
    logger.warn('cron:civic-affairs-tick:skipped-duplicate');
    return NextResponse.json({ ok: true, skipped: 'duplicate-invocation' });
  }

  const startedAt = Date.now();

  try {
    await heartbeatStart('CIVIC_AFFAIRS_TICK');

    const [electionCount, lawVoteCount, crisisCount, diplomaticJob, tradeJob, perceptionJob] = await Promise.all([
      enqueueJobsForAllCities('election_process', 4),
      enqueueJobsForAllCities('law_vote', 4),
      enqueueJobsForAllCities('city_crisis', 3),
      enqueueJob('diplomatic_event', {}, 4, { dedupe: true }),
      enqueueJob('trade_process', {}, 5, { dedupe: true }),
      enqueueJob('public_perception_tick', {}, 4, { dedupe: true }),
    ]);

    const enqueued = electionCount + lawVoteCount + crisisCount
      + (diplomaticJob.enqueued ? 1 : 0)
      + (tradeJob.enqueued ? 1 : 0)
      + (perceptionJob.enqueued ? 1 : 0);

    void fetch(`${env.NEXT_PUBLIC_APP_URL}/api/workers/run`, {
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    }).catch(() => { /* fire and forget */ });

    await heartbeatSuccess('CIVIC_AFFAIRS_TICK');
    logger.info('cron:civic-affairs-tick:complete', {
      electionCount, lawVoteCount, crisisCount, enqueued, duration_ms: Date.now() - startedAt,
    });
    return NextResponse.json({
      ok: true, electionCount, lawVoteCount, crisisCount, enqueued, duration_ms: Date.now() - startedAt,
    });

  } catch (err) {
    await heartbeatFail('CIVIC_AFFAIRS_TICK');
    logger.error('cron:civic-affairs-tick:failed', { error: String(err) });
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
