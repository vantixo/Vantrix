/**
 * Horizontal Queue Scaler
 *
 * Hardening changes in this revision:
 *   - validateWorkerId(): worker IDs are used in Redis key names; must not
 *     contain whitespace, colons, or path-separator characters.
 *   - DLQ replay: moved to admin-only endpoint; raw replay never exposed
 *     without index bounds checking.
 *   - Heartbeat key collisions: workerId is validated before being used
 *     as a Redis key suffix.
 *
 * Worker registration, heartbeat, consistent hashing, scale-out signalling,
 * DLQ, and ScalerWorker class — all unchanged in semantics.
 */

import { logger }  from '@/lib/logger';
import type { ChatJob, JobResult } from './index';
import { redis }              from '@/lib/redis';


const WORKERS_KEY         = 'vantrix:scaler:workers';
const WORKER_HB_PREFIX    = 'vantrix:scaler:hb:';
const SCALE_SIGNAL_KEY    = 'vantrix:scaler:scale_out';
const DLQ_KEY             = 'vantrix:queue:dlq';
const WORKER_STATS_PREFIX = 'vantrix:scaler:stats:';

const HEARTBEAT_INTERVAL_MS = 10_000;
const DEAD_WORKER_TIMEOUT_S = 30;
const SCALE_OUT_THRESHOLD   = 50;
const DLQ_TTL               = 7 * 86_400;

// ── Worker ID validation ──────────────────────────────────────────────────────

const WORKER_ID_RE = /^[\w\-]{4,80}$/;  // alphanumeric + dash/underscore, 4-80 chars

/**
 * Validate a worker ID before using it as a Redis key suffix.
 * Prevents key injection via path separators, whitespace, or null bytes.
 */
function validateWorkerId(id: string): void {
  if (!WORKER_ID_RE.test(id)) {
    throw new Error(
      `Invalid workerId "${id.slice(0, 20)}": must be 4–80 alphanumeric/dash/underscore chars`
    );
  }
}

// ── Consistent hashing ────────────────────────────────────────────────────────

function crc32(str: string): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < str.length; i++) {
    let byte = str.charCodeAt(i);
    for (let j = 0; j < 8; j++) {
      if ((crc ^ byte) & 1) crc = (crc >>> 1) ^ 0xEDB88320;
      else                   crc = crc >>> 1;
      byte >>= 1;
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

export function affinityIndex(userId: string, workerCount: number): number {
  if (workerCount <= 0) return 0;
  return crc32(userId) % workerCount;
}

// ── Worker registration ───────────────────────────────────────────────────────

export interface WorkerInfo {
  id:        string;
  startedAt: number;
  lastBeat:  number;
  processed: number;
  inFlight:  boolean;
  hostname?: string;
}

export async function registerWorker(workerId: string): Promise<void> {
  validateWorkerId(workerId);  // throws on invalid ID before touching Redis
  const info: WorkerInfo = {
    id:        workerId,
    startedAt: Date.now(),
    lastBeat:  Date.now(),
    processed: 0,
    inFlight:  false,
    hostname:  process.env.HOSTNAME,
  };
  try {
    await redis.hset(WORKERS_KEY, { [workerId]: JSON.stringify(info) });
    await redis.setex(`${WORKER_HB_PREFIX}${workerId}`, DEAD_WORKER_TIMEOUT_S, '1');
  } catch (err) {
    logger.warn('Worker registration failed', { workerId, error: String(err) });
  }
}

export async function heartbeat(workerId: string, processed: number, inFlight: boolean): Promise<void> {
  try {
    const pipe = redis.pipeline();
    pipe.setex(`${WORKER_HB_PREFIX}${workerId}`, DEAD_WORKER_TIMEOUT_S, '1');
    pipe.hset(WORKERS_KEY, {
      [workerId]: JSON.stringify({ id: workerId, lastBeat: Date.now(), processed, inFlight, hostname: process.env.HOSTNAME, startedAt: 0 }),
    });
    await pipe.exec();
  } catch { /* non-critical */ }
}

export async function deregisterWorker(workerId: string): Promise<void> {
  try {
    await Promise.all([
      redis.hdel(WORKERS_KEY, workerId),
      redis.del(`${WORKER_HB_PREFIX}${workerId}`),
    ]);
  } catch { /* non-critical */ }
}

export async function getLiveWorkers(): Promise<WorkerInfo[]> {
  try {
    const all = await redis.hgetall(WORKERS_KEY) as Record<string, string> | null;
    if (!all) return [];
    const workers = Object.values(all).map(v => JSON.parse(v) as WorkerInfo);
    const pipe = redis.pipeline();
    for (const w of workers) pipe.exists(`${WORKER_HB_PREFIX}${w.id}`);
    const exists = await pipe.exec() as number[];
    return workers.filter((_, i) => exists[i] === 1);
  } catch { return []; }
}

// ── Scale-out signalling ──────────────────────────────────────────────────────

export async function checkAndSignalScaleOut(queueDepth: number): Promise<boolean> {
  if (queueDepth < SCALE_OUT_THRESHOLD) return false;
  try {
    await redis.setex(SCALE_SIGNAL_KEY, 60, JSON.stringify({ depth: queueDepth, ts: Date.now(), hostname: process.env.HOSTNAME }));
    logger.warn('Scale-out signal emitted', { queueDepth });
    return true;
  } catch { return false; }
}

export async function isScaleOutSignalled(): Promise<boolean> {
  try { return (await redis.exists(SCALE_SIGNAL_KEY)) === 1; }
  catch { return false; }
}

// ── Dead Letter Queue ─────────────────────────────────────────────────────────

export interface DLQEntry {
  job:        ChatJob;
  result:     JobResult;
  worker:     string;
  enqueuedAt: number;
}

export async function moveToDLQ(job: ChatJob, result: JobResult, workerId: string): Promise<void> {
  const entry: DLQEntry = { job, result, worker: workerId, enqueuedAt: Date.now() };
  try {
    const pipe = redis.pipeline();
    pipe.lpush(DLQ_KEY, JSON.stringify(entry));
    pipe.ltrim(DLQ_KEY, 0, 999);
    pipe.expire(DLQ_KEY, DLQ_TTL);
    await pipe.exec();
  } catch (err) {
    logger.error('Failed to write to DLQ', { jobId: job.id, error: String(err) });
  }
}

export async function getDLQEntries(limit = 50): Promise<DLQEntry[]> {
  // Clamp to prevent unbounded reads
  const safeLimit = Math.min(Math.max(1, limit), 200);
  try {
    const raw = await redis.lrange(DLQ_KEY, 0, safeLimit - 1);
    return (raw as string[]).map(v => JSON.parse(v) as DLQEntry);
  } catch { return []; }
}

/**
 * Replay a DLQ job by index. Index is bounds-checked before Redis access.
 * Returns null if index is out of bounds or entry is malformed.
 */
export async function replayDLQJob(index: number): Promise<ChatJob | null> {
  // Bounds check: index must be a non-negative integer
  if (!Number.isInteger(index) || index < 0 || index > 999) return null;
  try {
    const raw = await redis.lindex(DLQ_KEY, index);
    if (!raw) return null;
    const entry = JSON.parse(raw as string) as DLQEntry;
    return { ...entry.job, attempts: 0, enqueuedAt: Date.now() };
  } catch { return null; }
}

// ── Worker stats ──────────────────────────────────────────────────────────────

export async function recordWorkerStat(workerId: string, tokensProcessed: number, latencyMs: number): Promise<void> {
  const h   = new Date().toISOString().slice(0, 13);
  const key = `${WORKER_STATS_PREFIX}${workerId}:${h}`;
  try {
    const pipe = redis.pipeline();
    pipe.incrby(`${key}:tokens`, tokensProcessed);
    pipe.incrby(`${key}:jobs`,   1);
    pipe.incrby(`${key}:latency_sum`, latencyMs);
    for (const k of [`${key}:tokens`, `${key}:jobs`, `${key}:latency_sum`]) pipe.expire(k, 86_400);
    await pipe.exec();
  } catch { /* non-critical */ }
}

export async function getWorkerStats(workerId: string): Promise<{ tokensLastHour: number; jobsLastHour: number; avgLatencyMs: number }> {
  const h   = new Date().toISOString().slice(0, 13);
  const key = `${WORKER_STATS_PREFIX}${workerId}:${h}`;
  try {
    const [tokens, jobs, latSum] = await Promise.all([
      redis.get<string>(`${key}:tokens`),
      redis.get<string>(`${key}:jobs`),
      redis.get<string>(`${key}:latency_sum`),
    ]);
    const j = parseInt(jobs   ?? '0', 10);
    const l = parseInt(latSum ?? '0', 10);
    return { tokensLastHour: parseInt(tokens ?? '0', 10), jobsLastHour: j, avgLatencyMs: j > 0 ? Math.round(l / j) : 0 };
  } catch { return { tokensLastHour: 0, jobsLastHour: 0, avgLatencyMs: 0 }; }
}

// ── ScalerWorker ──────────────────────────────────────────────────────────────

export class ScalerWorker {
  private readonly id: string;
  private running   = false;
  private processed = 0;
  private inFlight  = false;
  private hbTimer:  ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly processJob: () => Promise<boolean>,
    private readonly pollIntervalMs = 1000,
  ) {
    this.id = `worker-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    validateWorkerId(this.id);  // self-validate generated ID
  }

  async start(): Promise<void> {
    await registerWorker(this.id);
    this.running = true;
    this.hbTimer = setInterval(async () => {
      await heartbeat(this.id, this.processed, this.inFlight);
    }, HEARTBEAT_INTERVAL_MS);
    logger.info(`ScalerWorker ${this.id} started`);
    while (this.running) {
      try {
        this.inFlight = true;
        const processed = await this.processJob();
        this.inFlight   = false;
        if (processed) this.processed++;
        else           await sleep(this.pollIntervalMs);
      } catch (err) {
        this.inFlight = false;
        logger.error(`Worker ${this.id} loop error`, { error: String(err) });
        await sleep(2000);
      }
    }
    await this.cleanup();
  }

  stop(): void {
    logger.info(`Worker ${this.id} stopping`);
    this.running = false;
  }

  private async cleanup(): Promise<void> {
    if (this.hbTimer) clearInterval(this.hbTimer);
    await deregisterWorker(this.id);
    logger.info(`Worker ${this.id} deregistered. Jobs processed: ${this.processed}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
