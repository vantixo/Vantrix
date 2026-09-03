/**
 * worker-runner.ts — Queue worker entry point (dev + production standalone)
 *
 * Changes in this revision:
 *
 *   ScalerWorker integration:
 *     Uses ScalerWorker instead of a bare polling loop. This provides:
 *       - Worker registration + heartbeat (Redis-backed, 10s interval)
 *       - Consistent hashing for userId → workerId affinity
 *       - Dead letter queue (DLQ) for exhausted jobs
 *       - Scale-out signal emission when queue depth > 50
 *       - Graceful SIGTERM shutdown (finish current job, then exit)
 *
 *   Multiple workers:
 *     Set WORKER_CONCURRENCY=N (default 1) to run N concurrent workers in
 *     the same process. Each gets a unique ID and its own heartbeat.
 *     Ideal for Vercel background functions or dedicated worker VMs.
 *
 *   DLQ integration:
 *     Jobs that fail all maxAttempts are moved to the DLQ (vantrix:queue:dlq)
 *     instead of simply being dropped. Visible in /api/queue/workers.
 *
 * Run: npm run worker
 * Run N workers: WORKER_CONCURRENCY=4 npm run worker
 */

import { processNextJob }  from './worker';
import { ScalerWorker }    from './scaler';
import { getQueueDepths }  from './index';
import { checkAndSignalScaleOut } from './scaler';
import { writeFileSync }   from 'fs';
import { env }             from '@/env';
import { logger }          from '@/lib/logger';

const CONCURRENCY      = env.WORKER_CONCURRENCY;
const HEARTBEAT_FILE   = '/tmp/worker.heartbeat';

/** OPS-02 FIX: Touch the heartbeat file after each successful poll cycle.
 *  The Docker HEALTHCHECK reads this file's mtime and exits 1 if it is older
 *  than 120s (2× the poll interval), which means a hung or crashed worker
 *  will be detected and restarted instead of appearing healthy. */
function touchHeartbeat() {
  try {
    writeFileSync(HEARTBEAT_FILE, String(Date.now()));
  } catch { /* non-fatal: healthcheck will time out naturally */ }
}

/** Wrap processNextJob so we touch the heartbeat on every successful poll. */
async function processWithHeartbeat(...args: Parameters<typeof processNextJob>) {
  const result = await processNextJob(...args);
  touchHeartbeat();
  return result;
}

async function checkScaleOut() {
  try {
    const depths = await getQueueDepths();
    const total  = depths.high + depths.normal + depths.low;
    await checkAndSignalScaleOut(total);
  } catch { /* non-critical */ }
}

async function run() {
  logger.info('worker-runner: starting workers', { concurrency: CONCURRENCY });

  const workers = Array.from({ length: CONCURRENCY }, () =>
    new ScalerWorker(processWithHeartbeat, 50)
  );

  // Check scale-out signal every 30s
  const scaleCheckTimer = setInterval(checkScaleOut, 30_000);

  // SIGTERM: stop all workers gracefully
  const stop = () => {
    logger.info('worker-runner: shutdown signal received — draining');
    clearInterval(scaleCheckTimer);
    for (const w of workers) w.stop();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT',  stop);

  // Start all workers (returns when all have stopped)
  await Promise.all(workers.map(w => w.start()));

  logger.info('worker-runner: all workers stopped cleanly');
  process.exit(0);
}

run().catch(err => {
  logger.error('worker-runner: fatal error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
