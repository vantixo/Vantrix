/**
 * GET /api/cron/deep-tick
 *
 * Scheduled once daily via vercel.json — deliberately rare. Enqueues a
 * single 'deep_tick' job (the multi-step LLM orchestrator in
 * lib/universe/deep-tick.ts) and wakes the world worker to process it.
 *
 * This is the only universe job type that calls an LLM at all. Everything
 * else in the queue (governance_tick, economy_tick, event_generate,
 * status_tick, ...) is deterministic filler by design. Keeping this on
 * its own rare cadence, behind its own cron, is intentional: best-tier
 * model spend, once a day, for the one high-visibility output that's
 * worth it — not something that should ever accidentally run hourly.
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

  // Lock for slightly less than the tick interval (24h = 86400s). See
  // lib/cron/lock.ts. Arguably the most important lock of the five —
  // this is the one job type that spends real best-tier LLM budget (see
  // header comment); a duplicate invocation here is a real cost, not just
  // queue churn.
  const gotLock = await acquireCronLock('deep-tick', 86100);
  if (!gotLock) {
    logger.warn('cron:deep-tick:skipped-duplicate');
    return NextResponse.json({ ok: true, skipped: 'duplicate-invocation' });
  }

  const startedAt = Date.now();

  try {
    await heartbeatStart('DEEP_TICK');

    // Priority 7: above legacy-tick's jobs (5/3/2) — this is the
    // high-visibility one — but daily cadence means it's never competing
    // for queue throughput against the frequent filler jobs anyway.
    const { enqueued } = await enqueueJob('deep_tick', {}, 7);

    void fetch(`${env.NEXT_PUBLIC_APP_URL}/api/workers/run`, {
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    }).catch(() => { /* fire and forget */ });

    await heartbeatSuccess('DEEP_TICK');
    logger.info('cron:deep-tick:complete', { enqueued, duration_ms: Date.now() - startedAt });
    return NextResponse.json({ ok: true, enqueued, duration_ms: Date.now() - startedAt });

  } catch (err) {
    await heartbeatFail('DEEP_TICK');
    logger.error('cron:deep-tick:failed', { error: String(err) });
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
