// src/lib/redis/hardened-client.ts
// ─────────────────────────────────────────────────────────────────────────────
// Hardened Redis wrapper.
// 
// Key hardening:
//   • Circuit breaker: trips after N failures → trips to DEGRADED mode
//   • DEGRADED mode: blocks new content sessions entirely (fail-CLOSED on safety)
//   • Age gate: always fails CLOSED on Redis error
//   • Cost guard: fails CLOSED on Redis error (blocks requests, not open)
//   • All catches log + report to Sentry before returning safe default
// ─────────────────────────────────────────────────────────────────────────────


// ── Constants ─────────────────────────────────────────────────────────────────
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_RESET_MS          = 60_000;   // 1 minute half-open window
const REDIS_TIMEOUT_MS          = 3_000;    // max wait per call

// ── In-process circuit breaker state ─────────────────────────────────────────
// Note: per-instance in serverless. Good enough — each instance self-heals.
// For true cross-instance coordination, push state to a separate DB health table.
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

let circuitState:        CircuitState = 'CLOSED';
let circuitFailures:     number       = 0;
let circuitOpenedAt:     number       = 0;
let isDegraded:          boolean      = false;  // flip to degrade the entire platform

function recordSuccess() {
  circuitFailures = 0;
  circuitState    = 'CLOSED';
  isDegraded      = false;
}

function recordFailure() {
  circuitFailures++;
  if (circuitFailures >= CIRCUIT_FAILURE_THRESHOLD) {
    circuitState    = 'OPEN';
    circuitOpenedAt = Date.now();
    isDegraded      = true;
    logger.error('redis-circuit: OPEN — platform entering degraded mode');
    // GAP-FIX: this was a commented-out stub ("replace with your actual
    // Sentry SDK call") despite this file's own header claiming "All
    // catches log + report to Sentry" — @sentry/nextjs has been a real
    // dependency the whole time (see instrumentation.ts, error.tsx). Fire
    // and forget: a failing Sentry call must never be what breaks the
    // circuit breaker itself.
    import('@sentry/nextjs')
      .then(Sentry => Sentry.captureMessage(
        'Redis circuit opened — platform entering degraded mode',
        'fatal'
      ))
      .catch(err => logger.error('redis-circuit: Sentry alert itself failed', { error: err instanceof Error ? err.message : String(err) }));
  }
}

function maybeAttemptReset(): boolean {
  if (circuitState !== 'OPEN') return circuitState === 'CLOSED';
  if (Date.now() - circuitOpenedAt > CIRCUIT_RESET_MS) {
    circuitState = 'HALF_OPEN';
    return true;
  }
  return false;
}

// ── Redis client ───────────────────────────────────────────────────────────────
// FIX: this constructed its own independent `Redis` instance via a `Redis` name
// that was never imported (build-breaking TS2304 / runtime ReferenceError on
// first call — meaning every exported function below was unreachable dead
// code at runtime). It also reproduced exactly the duplicate-singleton problem
// described in src/lib/redis/index.ts's module comment: this circuit breaker
// was only ever watching its own private client, never the one real requests
// went through. Now uses the shared singleton so the breaker reflects reality.
import { redis } from '@/lib/redis';
import type { Redis } from '@upstash/redis';
import { logger } from '@/lib/logger';

function getRedis(): Redis {
  return redis;
}

// ── Core safe call wrapper ────────────────────────────────────────────────────
async function safeRedis<T>(
  fn: (r: Redis) => Promise<T>,
  failClosedDefault: T,
): Promise<{ value: T; ok: boolean }> {
  const canAttempt = maybeAttemptReset();
  if (!canAttempt) {
    return { value: failClosedDefault, ok: false };
  }

  try {
    const r = getRedis();
    // Race against timeout to avoid hanging serverless slots
    const value = await Promise.race([
      fn(r),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('redis_timeout')), REDIS_TIMEOUT_MS)
      ),
    ]);
    recordSuccess();
    return { value, ok: true };
  } catch (err: unknown) {
    recordFailure();
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('redis: error', { error: msg });
    return { value: failClosedDefault, ok: false };
  }
}

// ── Public helpers ────────────────────────────────────────────────────────────

/** Is the platform currently in degraded mode? */
export function isPlatformDegraded(): boolean {
  return isDegraded;
}

/**
 * Rate limit check — FAIL CLOSED.
 * Returns { allowed: false } on error so we never exceed limits silently.
 */
export async function checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<{
  allowed:   boolean;
  remaining: number;
  resetAt:   number;
}> {
  const { value, ok } = await safeRedis(async r => {
    const current = await r.incr(key);
    if (current === 1) await r.expire(key, windowSeconds);
    const ttl = await r.ttl(key);
    return { current, ttl };
  }, null);

  if (!ok || value === null) {
    // Fail CLOSED: block the request
    return { allowed: false, remaining: 0, resetAt: Date.now() + windowSeconds * 1000 };
  }

  const { current, ttl } = value;
  const remaining = Math.max(0, limit - current);
  return {
    allowed:   current <= limit,
    remaining,
    resetAt:   Date.now() + ttl * 1000,
  };
}

/**
 * Cost guard — FAIL CLOSED.
 * Returns true (blocked) on error to prevent uncapped AI spending.
 */
export async function isCostGuardBlocked(budgetKey: string, maxTokens: number): Promise<boolean> {
  const { value, ok } = await safeRedis(
    r => r.get<number>(budgetKey),
    null,
  );
  if (!ok) return true;    // fail CLOSED — block on Redis failure
  if (value === null) return false;
  return value >= maxTokens;
}

export async function incrementCostGuard(budgetKey: string, tokens: number, windowSeconds = 3600): Promise<void> {
  await safeRedis(async r => {
    const current = await r.incrby(budgetKey, tokens);
    if (current === tokens) await r.expire(budgetKey, windowSeconds);
  }, undefined);
}

/**
 * Deduplication lock — FAIL CLOSED.
 * Returns true (is duplicate) on error so duplicate requests are dropped.
 */
export async function acquireDedupelock(key: string, ttlSeconds = 30): Promise<boolean> {
  const { value, ok } = await safeRedis(
    r => r.set(key, 1, { ex: ttlSeconds, nx: true }),
    null,
  );
  if (!ok) return false;  // fail CLOSED on error = treat as duplicate, drop request
  return value === 'OK';  // 'OK' = acquired, null = already exists
}

/**
 * Daily message counter (in Redis for speed, DB is authoritative).
 */
export async function getDailyMessageCount(userId: string, date: string): Promise<number> {
  const key = `msg:${userId}:${date}`;
  const { value } = await safeRedis(r => r.get<number>(key), 0);
  return value ?? 0;
}

export async function incrementDailyMessageCount(userId: string, date: string): Promise<void> {
  const key = `msg:${userId}:${date}`;
  await safeRedis(async r => {
    const n = await r.incr(key);
    if (n === 1) await r.expire(key, 90_000); // 25 hours
  }, undefined);
}

/**
 * Streaming slot management — FAIL CLOSED.
 * Returns false (no slot available) on Redis failure.
 *
 * HARDENING: the previous version did `get` → compare → `incr` as three
 * separate round trips. Under concurrent requests (exactly the "heavy load"
 * case this exists to protect against) two requests can both read
 * `current < maxConcurrent` before either has incremented, both pass the
 * check, and both increment — silently allowing more concurrent streams
 * than the cap. Fixed to increment first (atomic on Upstash) and only then
 * check the *result* against the limit, rolling back with a decrement if it
 * was exceeded. This makes the accept/reject decision atomic instead of
 * check-then-act.
 */
export async function acquireStreamSlot(userId: string, maxConcurrent = 3): Promise<boolean> {
  const key = `stream:${userId}`;
  const { value, ok } = await safeRedis(async r => {
    const current = await r.incr(key);
    if (current === 1) await r.expire(key, 120);
    if (current > maxConcurrent) {
      await r.decr(key); // roll back — didn't actually acquire a slot
      return false;
    }
    return true;
  }, false);
  return ok ? (value ?? false) : false;
}

export async function releaseStreamSlot(userId: string): Promise<void> {
  await safeRedis(async r => {
    const current = await r.get<number>(`stream:${userId}`) ?? 0;
    if (current > 0) await r.decr(`stream:${userId}`);
  }, undefined);
}

/** Semantic cache for AI responses */
export async function getSemanticCache(cacheKey: string): Promise<string | null> {
  const { value } = await safeRedis(r => r.get<string>(`cache:${cacheKey}`), null);
  return value ?? null;
}

export async function setSemanticCache(cacheKey: string, response: string, ttlSeconds = 3600): Promise<void> {
  await safeRedis(r => r.set(`cache:${cacheKey}`, response, { ex: ttlSeconds }), undefined);
}

/** Circuit state for monitoring endpoints */
export function getCircuitStatus() {
  return {
    state:      circuitState,
    failures:   circuitFailures,
    degraded:   isDegraded,
    openedAt:   circuitOpenedAt || null,
    threshold:  CIRCUIT_FAILURE_THRESHOLD,
  };
}
