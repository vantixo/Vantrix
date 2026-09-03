/**
 * Async Job Queue — Redis-backed, worker-isolated, concurrency-governed.
 *
 * Per-user queue depth limit (new):
 *   Free-tier users could exhaust worker capacity by enqueuing many jobs
 *   before any complete. We track pending job count per user with an atomic
 *   Redis counter. Enqueue is rejected server-side when the user's pending
 *   count exceeds their tier limit — no client cooperation required.
 *
 * originTraceId on ChatJob (new):
 *   The queue worker previously created a new trace with traceId = "queue-{jobId}",
 *   disconnected from the originating HTTP request. Adding originTraceId to
 *   ChatJob allows the worker to record the parent trace relationship, enabling
 *   end-to-end incident investigation across the async boundary.
 */

// FIX: this file used `redis.*` throughout (pipeline, get, set, del, setex,
// rpop, lpush) with no import at all — a build-breaking TS2304 plus a runtime
// ReferenceError on first call. Restored the shared singleton import.
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';



export type QueuePriority = 'high' | 'normal' | 'low';
export type JobStatus     = 'pending' | 'processing' | 'done' | 'failed' | 'dead';

export interface ChatJob {
  id:             string;
  userId:         string;
  characterId:    string;
  conversationId: string | undefined;
  message:        string;
  tier:           string;
  priority:       QueuePriority;
  enqueuedAt:     number;
  attempts:       number;
  maxAttempts:    number;
  // Dating mode fields (DATING-1)
  datingMode:     boolean;
  matchId:        string | undefined;
  /** Originating HTTP request traceId — links this job's worker trace to the enqueue trace. */
  originTraceId?: string;
}

export interface JobResult {
  jobId:       string;
  userId?:     string; // MED-6: stored so the polling endpoint can verify ownership
  status:      JobStatus;
  reply?:      string;
  tokensUsed?: number;
  error?:      string;
  doneAt?:     number;
  loreReveal?: { key: string; content: string };
}

const QUEUE: Record<QueuePriority, string> = {
  high:   'vantrix:queue:chat:high',
  normal: 'vantrix:queue:chat:normal',
  low:    'vantrix:queue:chat:low',
};

const concurrencyKey  = (userId: string) => `vantrix:lock:chat:${userId}`;
const resultKey       = (jobId: string)  => `vantrix:job:result:${jobId}`;
const statusKey       = (jobId: string)  => `vantrix:job:status:${jobId}`;
const pendingCountKey = (userId: string) => `vantrix:user:queue:pending:${userId}`;

const RESULT_TTL_SECONDS = 600;

// QUEUE-LEASE-FIX (P1): dequeueNextJob previously used a plain RPOP, which
// removes the job from Redis the instant it's popped — there was no record
// anywhere that the job existed once a worker had it. If that worker then
// died (crash, OOM, hard timeout, `kill -9`, Vercel function timeout cutting
// execution mid-flight) between the RPOP and writeJobResult()/requeueJob(),
// the job vanished permanently: no retry, no dead-letter, no trace. The
// try/catch in processNextJob only ever handled *thrown* errors during
// synchronous execution — it can't run at all if the process itself is
// gone.
//
// Fix: a lease pattern. dequeueNextJob() still RPOPs the job off its
// priority queue (list ops don't support a "peek and hold" primitive
// cheaply on Upstash), but immediately records it in a companion
// processing-lease store — a sorted set (job id -> lease-expiry timestamp)
// plus a hash (job id -> full job JSON), both keyed independently of
// which worker/process holds the job. Whichever process completes the job
// (success, terminal failure, or explicit retry) clears the lease via
// releaseJobLease(). reapExpiredLeases() — called opportunistically at the
// top of every dequeueNextJob(), so no separate cron/infra is required —
// scans for leases past their deadline with no release recorded, meaning
// the worker holding them died, and requeues (or dead-letters, if
// max attempts is exhausted) exactly like a normal retry.
const PROCESSING_LEASE_ZSET = 'vantrix:queue:processing:lease';
const processingJobKey = (jobId: string) => `vantrix:queue:processing:job:${jobId}`;

// Generous relative to real per-job latency (LLM call + context assembly),
// short enough that a genuinely dead worker's job doesn't sit orphaned for
// long. worker.ts's per-user concurrency lock (acquireUserLock) is set to
// this same duration — a shorter lock TTL than the lease used to let it
// expire mid-job on legitimately slow jobs, letting a second job for the
// same user start concurrently while the first was still running.
export const LEASE_MS = 3 * 60 * 1000;

/** Maximum concurrent pending queue jobs per tier */
const MAX_PENDING_JOBS: Record<string, number> = {
  free:    3,
  premium: 20,
};

export function tierToPriority(tier: string): QueuePriority {
  if (tier === 'elite' || tier === 'enterprise') return 'high';
  if (tier === 'basic' || tier === 'premium') return 'normal';
  return 'low';
}

/**
 * Enqueue a chat job. Returns the job ID for polling.
 * Server-side guard: rejects if the user already has too many pending jobs.
 */
export async function enqueueChatJob(
  params: Omit<ChatJob, 'id' | 'enqueuedAt' | 'attempts' | 'maxAttempts' | 'priority'>,
): Promise<{ jobId: string; queued: boolean; depth?: number; error?: string }> {
  const maxPending = MAX_PENDING_JOBS[params.tier] ?? MAX_PENDING_JOBS.free;

  // Server-side per-user depth guard
  try {
    const pendingRaw = await redis.get<string>(pendingCountKey(params.userId));
    const pending    = pendingRaw ? parseInt(pendingRaw, 10) : 0;
    if (pending >= maxPending) {
      return {
        jobId:  '',
        queued: false,
        error:  `Queue full: ${pending}/${maxPending} pending jobs for this account`,
      };
    }
  } catch { /* Redis unavailable — allow enqueue, fail open */ }

  const jobId    = crypto.randomUUID();
  const priority = tierToPriority(params.tier);

  const job: ChatJob = {
    ...params,
    id:          jobId,
    priority,
    enqueuedAt:  Date.now(),
    attempts:    0,
    maxAttempts: 3,
  };

  const queueName = QUEUE[priority];

  const pipe = redis.pipeline();
  pipe.setex(statusKey(jobId), RESULT_TTL_SECONDS, 'pending');
  pipe.lpush(queueName, JSON.stringify(job));
  pipe.llen(queueName);
  pipe.incr(pendingCountKey(params.userId));
  pipe.expire(pendingCountKey(params.userId), 3600); // 1h guard against leaked counts
  const results = await pipe.exec() as [unknown, number, number, number, unknown];
  const depth   = results[2];

  return { jobId, queued: true, depth };
}

/**
 * Decrement the per-user pending job counter on completion/failure.
 * Called by the worker after any terminal job state.
 */
export async function decrementUserPendingCount(userId: string): Promise<void> {
  try {
    const pipe = redis.pipeline();
    pipe.decr(pendingCountKey(userId));
    // Guard against drift — clamp to 0
    pipe.expire(pendingCountKey(userId), 3600);
    const results = await pipe.exec() as [number, unknown];
    if (results[0] < 0) await redis.set(pendingCountKey(userId), 0);
  } catch { /* non-critical */ }
}

export async function acquireUserLock(userId: string, ttlSeconds = 30): Promise<boolean> {
  const key    = concurrencyKey(userId);
  const result = await redis.set(key, '1', { nx: true, ex: ttlSeconds });
  return result === 'OK';
}

export async function releaseUserLock(userId: string): Promise<void> {
  await redis.del(concurrencyKey(userId));
}

export async function writeJobResult(result: JobResult): Promise<void> {
  await redis.setex(resultKey(result.jobId), RESULT_TTL_SECONDS, JSON.stringify(result));
  await redis.setex(statusKey(result.jobId), RESULT_TTL_SECONDS, result.status);
}

export async function getJobResult(jobId: string): Promise<JobResult | null> {
  try {
    const raw = await redis.get<string>(resultKey(jobId));
    if (!raw) return null;
    return JSON.parse(raw) as JobResult;
  } catch { return null; }
}

export async function getJobStatus(jobId: string): Promise<JobStatus | null> {
  try {
    const status = await redis.get<string>(statusKey(jobId));
    return (status as JobStatus) ?? null;
  } catch { return null; }
}

export async function getQueueDepths(): Promise<Record<QueuePriority, number>> {
  const pipe = redis.pipeline();
  pipe.llen(QUEUE.high);
  pipe.llen(QUEUE.normal);
  pipe.llen(QUEUE.low);
  const results = await pipe.exec() as number[];
  return { high: results[0], normal: results[1], low: results[2] };
}

export async function dequeueNextJob(): Promise<ChatJob | null> {
  // Self-healing: cheap opportunistic reap on every dequeue attempt, so no
  // separate cron/infra is needed to recover jobs orphaned by a dead
  // worker. See QUEUE-LEASE-FIX note above.
  await reapExpiredLeases();

  for (const priority of ['high', 'normal', 'low'] as QueuePriority[]) {
    try {
      const raw = await redis.rpop(QUEUE[priority]);
      if (raw) {
        const job = JSON.parse(raw as string) as ChatJob;
        await redis.setex(statusKey(job.id), RESULT_TTL_SECONDS, 'processing');
        await acquireJobLease(job);
        return job;
      }
    } catch { continue; }
  }
  return null;
}

/**
 * Record that a worker now holds `job` and start its processing lease.
 * Paired with releaseJobLease() — every code path that finishes handling a
 * dequeued job (success, terminal failure, or retry-requeue) MUST call
 * releaseJobLease(), or reapExpiredLeases() will (correctly) treat it as
 * an orphaned job once the lease expires and requeue/dead-letter it a
 * second time.
 */
async function acquireJobLease(job: ChatJob): Promise<void> {
  try {
    const pipe = redis.pipeline();
    pipe.set(processingJobKey(job.id), JSON.stringify(job), { ex: Math.ceil(LEASE_MS / 1000) + 60 });
    pipe.zadd(PROCESSING_LEASE_ZSET, { score: Date.now() + LEASE_MS, member: job.id });
    await pipe.exec();
  } catch {
    // Non-fatal: if this fails, the job still gets processed normally in
    // the common case — it just won't be recoverable by the reaper if this
    // particular worker then dies. Better than blocking the whole dequeue.
  }
}

/** Clear a job's processing lease once it has reached a terminal state or been requeued. */
export async function releaseJobLease(jobId: string): Promise<void> {
  try {
    const pipe = redis.pipeline();
    pipe.del(processingJobKey(jobId));
    pipe.zrem(PROCESSING_LEASE_ZSET, jobId);
    await pipe.exec();
  } catch { /* non-critical */ }
}

/**
 * Find leases whose deadline has passed with no corresponding
 * releaseJobLease() call — meaning the worker that held that job died
 * mid-processing — and recover them: requeue for another attempt if
 * attempts remain, otherwise dead-letter, exactly like a normal in-process
 * retry/failure would. Safe to call frequently and from multiple
 * concurrent workers: ZREM is atomic and only one caller will "win" each
 * expired job id, so a job can't be double-requeued by a reap race.
 */
export async function reapExpiredLeases(): Promise<number> {
  let recovered = 0;
  try {
    const now = Date.now();
    const expiredIds = await redis.zrange<string[]>(PROCESSING_LEASE_ZSET, 0, now, { byScore: true });
    if (!expiredIds || expiredIds.length === 0) return 0;

    for (const jobId of expiredIds) {
      // Atomically claim this expired lease — if zrem removes 0 members,
      // another concurrent reap call (or the original worker finishing
      // just in time) already handled it; skip.
      const claimed = await redis.zrem(PROCESSING_LEASE_ZSET, jobId);
      if (!claimed) continue;

      const raw = await redis.get<string>(processingJobKey(jobId));
      await redis.del(processingJobKey(jobId));
      if (!raw) continue; // job data expired/missing — nothing to recover

      const job = typeof raw === 'string' ? (JSON.parse(raw) as ChatJob) : (raw as unknown as ChatJob);

      logger.warn('queue:lease-expired-recovering', {
        jobId: job.id, userId: job.userId, attempts: job.attempts,
      });

      if (job.attempts + 1 < job.maxAttempts) {
        await requeueJob(job);
      } else {
        await writeJobResult({
          jobId: job.id, userId: job.userId, status: 'dead',
          error: `Worker died mid-processing and exhausted ${job.maxAttempts} attempts (lease expired)`,
          doneAt: Date.now(),
        });
        await decrementUserPendingCount(job.userId);
      }
      recovered++;
    }
  } catch (err) {
    logger.warn('queue:reap-expired-leases-failed', { error: err instanceof Error ? err.message : String(err) });
  }
  return recovered;
}

export async function requeueJob(job: ChatJob): Promise<void> {
  const retryJob: ChatJob = { ...job, attempts: job.attempts + 1 };
  await redis.lpush(QUEUE[job.priority], JSON.stringify(retryJob));
}
