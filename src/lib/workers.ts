/**
 * Universe Job Queue — World Simulation Worker
 *
 * Thin wrapper over the `universe_jobs` Supabase table.
 * The world worker (/api/workers/run) uses this to claim, process,
 * complete, and fail simulation jobs.
 *
 * Conventions:
 *   - Priority is 1–10; higher number = processed first (ORDER BY priority DESC).
 *   - A job is "claimed" by updating status to 'processing' atomically.
 *   - max_attempts defaults to 3; failed jobs beyond this threshold stay 'failed'.
 *   - Worker signal is a Redis key used to wake the worker immediately after
 *     enqueue rather than waiting for the next cron tick.
 *
 * Usage:
 *   import { enqueueJob, claimNextJob, completeJob } from '@/lib/workers';
 */

import { supabaseAdmin }  from '@/lib/supabase/admin';
import { logger }         from '@/lib/logger';
import type { UniverseJob, UniverseJobType } from '@/types/world-expansion';
import type { Json } from '@/types/supabase';
import { redis }              from '@/lib/redis';


const WORKER_SIGNAL_KEY = 'vantrix:world-worker:signal';
const SIGNAL_TTL_SECS   = 300; // 5 min — worker tick is 1 min, so signal always consumed

// ── Claim ──────────────────────────────────────────────────────────────────────

/**
 * Atomically claim the next pending job, ordered by priority DESC then created_at ASC.
 * Returns null when no jobs are pending.
 */
export async function claimNextJob(): Promise<UniverseJob | null> {
  // Use an RPC or a select-then-update with the claimed_at guard.
  // We select the oldest highest-priority job, then immediately update it.
  const { data: jobs, error: selectError } = await supabaseAdmin
    .from('universe_jobs')
    .select('*')
    .eq('status', 'pending')
    .lt('attempts', 3)              // respect max_attempts default
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1);

  if (selectError || !jobs || jobs.length === 0) return null;

  const job = jobs[0]!;

  const { data: claimed, error: updateError } = await supabaseAdmin
    .from('universe_jobs')
    .update({
      status:     'processing',
      claimed_at: new Date().toISOString(),
      attempts:   (job.attempts ?? 0) + 1,
    })
    .eq('id', job.id)
    .eq('status', 'pending')   // guard: another worker may have grabbed it
    .select('*')
    .single();

  if (updateError || !claimed) return null;

  return claimed as UniverseJob;
}

// ── Complete ───────────────────────────────────────────────────────────────────

export async function completeJob(
  id:     string,
  result: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('universe_jobs')
    .update({
      status:       'completed',
      result:       result as unknown as Json,
      completed_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    logger.warn('workers:complete-job:failed', { id, error });
  }
}

// ── Fail ───────────────────────────────────────────────────────────────────────

export async function failJob(id: string, errorMessage: string): Promise<void> {
  // If attempts < max_attempts, reset to pending so it's retried next tick.
  const { data: job } = await supabaseAdmin
    .from('universe_jobs')
    .select('attempts')
    .eq('id', id)
    .single();

  const attempts   = job?.attempts ?? 3;
  const maxAttempts = 3;
  const finalStatus = attempts >= maxAttempts ? 'failed' : 'pending';

  const { error } = await supabaseAdmin
    .from('universe_jobs')
    .update({
      status: finalStatus,
      error:  errorMessage,
      // Clear claimed_at so it's eligible for re-claim if retrying
      ...(finalStatus === 'pending' ? { claimed_at: null } : { completed_at: new Date().toISOString() }),
    })
    .eq('id', id);

  if (error) {
    logger.warn('workers:fail-job:failed', { id, error });
  }
}

// ── Enqueue ────────────────────────────────────────────────────────────────────

export async function enqueueJob(
  jobType:  UniverseJobType | string,
  payload:  Record<string, unknown> = {},
  priority: number = 5,
  options?: { dedupe?: boolean },
): Promise<{ enqueued: boolean; id?: string; deduped?: boolean }> {
  // Opt-in dedup guard — for job types that are enqueued on a fixed cadence
  // with an empty/near-empty payload (the 4h-tier bundle jobs are the main
  // callers), a slow worker, a retried cron invocation, or an admin manually
  // firing the same job_type can otherwise stack duplicate pending rows that
  // all do the same work when the worker catches up. Scoped to jobs with no
  // location_id in payload, since per-city jobs (governance_tick etc.) are
  // legitimately meant to have many concurrent rows.
  if (options?.dedupe) {
    const { count, error: checkError } = await supabaseAdmin
      .from('universe_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('job_type', jobType)
      .in('status', ['pending', 'processing']);

    if (checkError) {
      logger.warn('workers:enqueue-job:dedupe-check-failed', { jobType, error: checkError });
      // Fail open — better to risk a duplicate than silently drop a tick.
    } else if ((count ?? 0) > 0) {
      logger.info('workers:enqueue-job:deduped', { jobType, existing: count });
      return { enqueued: false, deduped: true };
    }
  }

  const { data, error } = await supabaseAdmin
    .from('universe_jobs')
    .insert({
      job_type:     jobType,
      payload:      payload as unknown as Json,
      priority,
      status:       'pending',
      attempts:     0,
      max_attempts: 3,
    })
    .select('id')
    .single();

  if (error) {
    logger.warn('workers:enqueue-job:failed', { jobType, error });
    return { enqueued: false };
  }

  // Signal worker that there's a new job (fire-and-forget)
  void setWorkerSignal();

  return { enqueued: true, id: data.id };
}

/**
 * Enqueue the same job type for every world_location.
 * Returns the count of successfully enqueued jobs.

 */
export async function enqueueJobsForAllCities(
  jobType:  UniverseJobType | string,
  priority: number = 5,
): Promise<number> {
  const { data: locations, error } = await supabaseAdmin
    .from('world_locations')
    .select('id')
    .order('name');

  if (error || !locations) {
    logger.warn('workers:enqueue-all-cities:fetch-failed', { jobType, error });
    return 0;
  }

  const results = await Promise.allSettled(
    locations.map((loc) =>
      enqueueJob(jobType, { location_id: loc.id }, priority)
    ),
  );

  const enqueued = results.filter(
    (r) => r.status === 'fulfilled' && r.value.enqueued
  ).length;

  logger.info('workers:enqueue-all-cities:complete', { jobType, enqueued, total: locations.length });
  return enqueued;
}

// ── Worker signal (Redis) ──────────────────────────────────────────────────────

/**
 * Returns true when a worker signal exists in Redis.
 * The world worker calls this at the start of each run to log whether it
 * was triggered by an enqueue event or by the cron schedule.
 */
export async function hasWorkerSignal(): Promise<boolean> {
  try {
    const val = await redis.get(WORKER_SIGNAL_KEY);
    return val !== null;
  } catch {
    return false;
  }
}

export async function clearWorkerSignal(): Promise<void> {
  try {
    await redis.del(WORKER_SIGNAL_KEY);
  } catch { /* non-critical */ }
}

async function setWorkerSignal(): Promise<void> {
  try {
    await redis.set(WORKER_SIGNAL_KEY, '1', { ex: SIGNAL_TTL_SECS });
  } catch { /* non-critical */ }
}
