/**
 * GET /api/cron/aging-tick
 *
 * Scheduled once daily via vercel.json — deliberately its own cron rather
 * than folded into companion_life (society-engine's tick runs far more
 * often than daily; a birthday is a once-a-year event and doesn't need to
 * compete for that job's frequent slots). Enqueues a single 'aging_tick'
 * job (lib/universe/aging-engine.ts) and wakes the world worker.
 *
 * Not to be confused with /api/cron/age-reverification-tick, which
 * re-checks real users' age-verification expiry — an unrelated,
 * user-facing compliance system. This cron only ever increments a
 * fictional character's stated age.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth }           from '@/lib/security';
import { logger }                    from '@/lib/logger';
import { env }                       from '@/env';
import { enqueueJob }                from '@/lib/workers';
import { heartbeatStart, heartbeatSuccess, heartbeatFail } from '@/lib/cron/heartbeat';
import { acquireCronLock }           from '@/lib/cron/lock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Lock for slightly less than the tick interval (24h = 86400s), same
  // pattern as deep-tick's lock — a duplicate invocation here wouldn't
  // double-age anyone (tickAging's per-character UPDATE is guarded by an
  // `.eq('age', char.age)` optimistic check), but it's still wasted work
  // worth skipping.
  const gotLock = await acquireCronLock('aging-tick', 86100);
  if (!gotLock) {
    logger.warn('cron:aging-tick:skipped-duplicate');
    return NextResponse.json({ ok: true, skipped: 'duplicate-invocation' });
  }

  const startedAt = Date.now();

  try {
    await heartbeatStart('AGING_TICK');

    const { enqueued } = await enqueueJob('aging_tick', {}, 4);

    void fetch(`${env.NEXT_PUBLIC_APP_URL}/api/workers/run`, {
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    }).catch(() => { /* fire and forget */ });

    await heartbeatSuccess('AGING_TICK');
    logger.info('cron:aging-tick:complete', { enqueued, duration_ms: Date.now() - startedAt });
    return NextResponse.json({ ok: true, enqueued, duration_ms: Date.now() - startedAt });

  } catch (err) {
    await heartbeatFail('AGING_TICK');
    logger.error('cron:aging-tick:failed', { error: String(err) });
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
