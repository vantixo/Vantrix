/**
 * GET /api/cron/legacy-tick
 *
 * Scheduled every 6 hours via vercel.json.
 * Enqueues the legacy systems jobs — status/legend evaluation, character
 * attribute evolution (folded into status_tick), history aggregation, and
 * a one-time visual identity backfill — then triggers the world worker.
 *
 * Lower frequency than governance (4h) or economy (1h) intentionally:
 * status, legends, and deep attribute changes should feel slow and earned,
 * not jittery. "Legendary status should be rare."
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth }           from '@/lib/security';
import { logger }                    from '@/lib/logger';
import { env }                       from '@/env';
import { enqueueJob }                from '@/lib/workers';
import { heartbeatStart, heartbeatSuccess, heartbeatFail } from '@/lib/cron/heartbeat';
import { acquireCronLock } from '@/lib/cron/lock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Lock for slightly less than the tick interval (6h = 21600s). See lib/cron/lock.ts.
  const gotLock = await acquireCronLock('legacy-tick', 21300);
  if (!gotLock) {
    logger.warn('cron:legacy-tick:skipped-duplicate');
    return NextResponse.json({ ok: true, skipped: 'duplicate-invocation' });
  }

  const startedAt = Date.now();

  try {
    await heartbeatStart('LEGACY_TICK');
    const jobs = await Promise.all([
      enqueueJob('status_tick', {}, 5),
      enqueueJob('market_value_tick', {}, 5),
      enqueueJob('world_provisioning_sweep', {}, 4),
      enqueueJob('history_aggregate', {}, 3),
      enqueueJob('visual_identity_backfill', {}, 2),
    ]);

    const enqueued = jobs.filter(j => j.enqueued).length;

    void fetch(`${env.NEXT_PUBLIC_APP_URL}/api/workers/run`, {
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    }).catch(() => { /* fire and forget */ });

    await heartbeatSuccess('LEGACY_TICK');
    logger.info('cron:legacy-tick:complete', { enqueued, duration_ms: Date.now() - startedAt });
    return NextResponse.json({ ok: true, enqueued, duration_ms: Date.now() - startedAt });

  } catch (err) {
    await heartbeatFail('LEGACY_TICK');
    logger.error('cron:legacy-tick:failed', { error: String(err) });
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
