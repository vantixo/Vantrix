/**
 * GET /api/queue/worker
 *
 * Worker trigger endpoint — called every minute by Vercel Cron, or on-demand
 * by external schedulers / the standalone worker-runner process.
 *
 * Auth (dual-mode):
 *   • Vercel Cron injects:  Authorization: Bearer {CRON_SECRET}
 *   • Manual/standalone:    x-worker-secret: {WORKER_SECRET}
 *   requireCronAuth() handles both patterns with timing-safe comparison.
 *
 * Throughput:
 *   Jobs are processed in parallel (Promise.allSettled) rather than
 *   sequentially, achieving up to BATCH_SIZE × throughput improvement.
 *   A distributed Redis lock prevents double-invocation from cron failover.
 */

import { NextRequest, NextResponse }  from 'next/server';
import { processNextJob }              from '@/lib/queue/worker';
import { getQueueDepths }              from '@/lib/queue';
import { logger }                      from '@/lib/logger';
import { requireCronAuth, timingSafeEqual } from '@/lib/security';
import { env }                         from '@/env';
import { redis }              from '@/lib/redis';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BATCH_SIZE = env.WORKER_BATCH_SIZE;

export async function GET(req: NextRequest) {
  // ── Auth — accept Vercel Cron OR manual worker secret ────────────────────
  // Vercel Cron: Authorization: Bearer {CRON_SECRET}
  // Manual:      x-worker-secret: {WORKER_SECRET}
  const isValidCron   = requireCronAuth(req, env.CRON_SECRET);
  const xWorkerHeader = req.headers.get('x-worker-secret');
  const isValidWorker = xWorkerHeader
    ? timingSafeEqual(xWorkerHeader, env.WORKER_SECRET)
    : false;

  if (!isValidCron && !isValidWorker) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Distributed lock — prevents double-invocation from cron failover ─────
  // Window: 1 minute (matches Vercel Cron schedule). TTL: 90s gives a full
  // invocation window plus buffer before the next cron fires.
  const workerLockKey = `vantrix:worker:lock:${Math.floor(Date.now() / 60_000)}`;
  const acquired = await redis.set(workerLockKey, '1', { nx: true, ex: 90 });
  if (!acquired) {
    return NextResponse.json({
      skipped:   true,
      reason:    'another worker instance is running this minute',
      remaining: await getQueueDepths(),
      ts:        new Date().toISOString(),
    });
  }

  // ── Parallel job processing ────────────────────────────────────────────────
  // Previously sequential: 5 jobs × ~3s avg = up to 15s total.
  // Now parallel: all BATCH_SIZE jobs start concurrently; bounded by the
  // Vercel function timeout (60s). Each job is independent with its own
  // Redis lock, so parallel execution is safe.
  const startedAt = Date.now();
  let jobsRun     = 0;
  let jobsFailed  = 0;

  try {
    const results = await Promise.allSettled(
      Array.from({ length: BATCH_SIZE }, () => processNextJob()),
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) jobsRun++;
      if (r.status === 'rejected') {
        jobsFailed++;
        logger.error('Worker job threw', {
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    }
  } catch (err: unknown) {
    logger.error('Worker batch fatal', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const depths  = await getQueueDepths();
  const elapsed = Date.now() - startedAt;

  logger.info('worker:batch-complete', {
    processed: jobsRun,
    failed:    jobsFailed,
    elapsed_ms: elapsed,
    remaining: depths,
  });

  return NextResponse.json({
    processed: jobsRun,
    failed:    jobsFailed,
    remaining: depths,
    elapsed_ms: elapsed,
    ts:        new Date().toISOString(),
  });
}
