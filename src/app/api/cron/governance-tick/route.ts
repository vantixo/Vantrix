/**
 * GET /api/cron/governance-tick
 *
 * Scheduled every 4 hours via vercel.json — the cadence legacy-tick's
 * own comment names as intentional ("Lower frequency than governance
 * (4h)..."), restored here. governance_tick existed in the dispatcher
 * but had no cron actually triggering it before this route.
 *
 * Bundles six 4h-cadence jobs that all move political/social/economic standing:
 *   - governance_tick   — one per world_location (approval, stability, etc.)
 *   - reputation_update  — companion fame/notoriety, reacting to recent events
 *   - faction_evolve     — companion career progression AND company
 *                          founding/hiring/competition, bundled together
 *                          (tickCompanionCareers() + runGlobalPoliticsTick() +
 *                          runCompanyTick(); see workers/run/route.ts). Not
 *                          enqueued as a separate company_tick job here —
 *                          that would double-run the company tick every
 *                          cycle. company_tick exists as its own job_type
 *                          only so it can be dispatched standalone (e.g. by
 *                          an admin tool) without pulling in careers/politics.
 *   - community_tick        — neighborhoods/organizations/clubs (community-engine.ts)
 *   - civic_and_climate_tick — culture/religion/law/crime/court/migration/
 *                              technology/science/education/weather/season/
 *                              disaster, bundled (see workers/run/route.ts)
 *   - organization_tick      — the multi-agent organization layer: message
 *                              delivery, leadership terms, consensus
 *                              proposals, org cohesion, and collective
 *                              memory decay, bundled (see workers/run/route.ts)
 *
 * The last three exist fully implemented in the dispatcher, documented as
 * this exact cadence tier, but nothing enqueued them — same class of gap
 * this route's own original governance_tick fix addressed.
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

  // Lock for slightly less than the tick interval (4h = 14400s). See
  // lib/cron/lock.ts — this is the cheap first layer; the actual
  // correctness guarantee is the conditional write in runGovernanceTick()
  // itself, since full_universe_tick can also enqueue governance_tick jobs
  // independently of this cron's own schedule.
  const gotLock = await acquireCronLock('governance-tick', 14100);
  if (!gotLock) {
    logger.warn('cron:governance-tick:skipped-duplicate');
    return NextResponse.json({ ok: true, skipped: 'duplicate-invocation' });
  }

  const startedAt = Date.now();

  try {
    await heartbeatStart('GOVERNANCE_TICK');

    // tax_policy_tick nudges rates off governance approval_rating, so it
    // rides this 4h cadence rather than the hourly economy tier. Existed
    // in the dispatcher but was never enqueued anywhere (Phase 4 wiring fix).
    const [governanceCount, taxCount, reputationJob, factionJob, communityJob, civicClimateJob, organizationJob] = await Promise.all([
      enqueueJobsForAllCities('governance_tick', 6),
      enqueueJobsForAllCities('tax_policy_tick', 5),
      enqueueJob('reputation_update', {}, 5, { dedupe: true }),
      enqueueJob('faction_evolve', {}, 5, { dedupe: true }),
      enqueueJob('community_tick', {}, 5, { dedupe: true }),
      enqueueJob('civic_and_climate_tick', {}, 5, { dedupe: true }),
      enqueueJob('organization_tick', {}, 5, { dedupe: true }),
    ]);

    const enqueued = governanceCount
      + taxCount
      + (reputationJob.enqueued ? 1 : 0)
      + (factionJob.enqueued ? 1 : 0)
      + (communityJob.enqueued ? 1 : 0)
      + (civicClimateJob.enqueued ? 1 : 0)
      + (organizationJob.enqueued ? 1 : 0);

    void fetch(`${env.NEXT_PUBLIC_APP_URL}/api/workers/run`, {
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    }).catch(() => { /* fire and forget */ });

    await heartbeatSuccess('GOVERNANCE_TICK');
    logger.info('cron:governance-tick:complete', { governanceCount, taxCount, enqueued, duration_ms: Date.now() - startedAt });
    return NextResponse.json({ ok: true, governanceCount, taxCount, enqueued, duration_ms: Date.now() - startedAt });

  } catch (err) {
    await heartbeatFail('GOVERNANCE_TICK');
    logger.error('cron:governance-tick:failed', { error: String(err) });
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
