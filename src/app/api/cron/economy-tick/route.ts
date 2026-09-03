/**
 * GET /api/cron/economy-tick
 *
 * Scheduled hourly via vercel.json. Restores the cadence implied by
 * legacy-tick's own comment ("Lower frequency than governance (4h) or
 * economy (1h) intentionally") — economy_tick existed in the dispatcher
 * but had no cron actually triggering it before this route.
 *
 * Bundles three hourly-cadence jobs:
 *   - economy_tick     — one per world_location (GDP, unemployment, etc.)
 *   - companion_life    — offline life simulation for active companions
 *   - feed_build        — fans companion_life output out to user feeds
 *
 * companion_life is enqueued at a higher priority than feed_build so the
 * queue worker (priority DESC) processes it first within the same run —
 * feeds should reflect this hour's life events, not last hour's.
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

  // Lock for slightly less than the tick interval (hourly = 3600s) so a
  // legitimately-late next tick isn't blocked by a stale lock, while a
  // duplicate invocation within the same hour (platform retry, manual
  // re-trigger) is skipped rather than enqueueing a second full batch of
  // per-city jobs. See lib/cron/lock.ts for why this isn't the only guard.
  const gotLock = await acquireCronLock('economy-tick', 3300);
  if (!gotLock) {
    logger.warn('cron:economy-tick:skipped-duplicate');
    return NextResponse.json({ ok: true, skipped: 'duplicate-invocation' });
  }

  const startedAt = Date.now();

  try {
    await heartbeatStart('ECONOMY_TICK');

    // employment_tick and housing_tick read the same location_economy
    // signal (GDP/unemployment) economy_tick just updated, so they ride
    // this same hourly per-city cadence. Both existed in the dispatcher
    // but were never enqueued anywhere (Phase 4 wiring fix).
    const [economyCount, employmentCount, housingCount, lifeJob, feedJob] = await Promise.all([
      enqueueJobsForAllCities('economy_tick', 6),
      enqueueJobsForAllCities('employment_tick', 5),
      enqueueJobsForAllCities('housing_tick', 5),
      enqueueJob('companion_life', {}, 6),
      enqueueJob('feed_build', {}, 4),
    ]);

    const enqueued = economyCount
      + employmentCount
      + housingCount
      + (lifeJob.enqueued ? 1 : 0)
      + (feedJob.enqueued ? 1 : 0);

    void fetch(`${env.NEXT_PUBLIC_APP_URL}/api/workers/run`, {
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    }).catch(() => { /* fire and forget */ });

    await heartbeatSuccess('ECONOMY_TICK');
    logger.info('cron:economy-tick:complete', { economyCount, employmentCount, housingCount, enqueued, duration_ms: Date.now() - startedAt });
    return NextResponse.json({ ok: true, economyCount, employmentCount, housingCount, enqueued, duration_ms: Date.now() - startedAt });

  } catch (err) {
    await heartbeatFail('ECONOMY_TICK');
    logger.error('cron:economy-tick:failed', { error: String(err) });
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
