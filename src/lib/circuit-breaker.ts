/**
 * Circuit Breaker — distributed state via Redis.
 *
 * MED-1 / LOW-3 fix: state is now persisted to and read from Redis on every
 * execute() call. Previously state was module-level in-process only. In a
 * serverless/Vercel deployment with multiple instances, each new cold start
 * began with CLOSED state regardless of real service health — the breaker
 * provided no cross-instance protection, and the health/admin endpoints always
 * showed artificial "CLOSED, 0 failures".
 *
 * Redis sync is fail-open: if Redis is unavailable, the in-process state is
 * used and the circuit continues operating locally (same as before this fix).
 *
 * State machine: CLOSED → OPEN (after failureThreshold failures)
 *                OPEN   → HALF_OPEN (after timeout ms)
 *                HALF_OPEN → CLOSED (after successThreshold successes)
 *                HALF_OPEN → OPEN   (on any failure)
 */

import { logger, bg } from '@/lib/logger';
import { CircuitOpenError } from '@/lib/errors';
import { redis }              from '@/lib/redis';


type CBState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Consecutive failures before opening. Default: 5 */
  failureThreshold?: number;
  /** Successes in HALF_OPEN before closing. Default: 2 */
  successThreshold?: number;
  /** Ms to wait in OPEN before probing again. Default: 30_000 */
  timeout?: number;
}

export class CircuitBreaker {
  private state: CBState = 'CLOSED';
  private failures   = 0;
  private successes  = 0;
  private openedAt   = 0;
  private readonly cfg: Required<CircuitBreakerOptions & { name: string }>;

  constructor(name: string, opts: CircuitBreakerOptions = {}) {
    this.cfg = {
      name,
      failureThreshold: opts.failureThreshold ?? 5,
      successThreshold: opts.successThreshold ?? 2,
      timeout:          opts.timeout          ?? 30_000,
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // MED-1: sync OPEN state from Redis before deciding whether to allow the call
    await this.syncFromRedis();

    if (this.state === 'OPEN') {
      const elapsed    = Date.now() - this.openedAt;
      const retryInSec = Math.max(0, Math.round((this.cfg.timeout - elapsed) / 1000));
      if (elapsed < this.cfg.timeout) {
        throw new CircuitOpenError(this.cfg.name, retryInSec);
      }
      // Probe window — allow one request through
      this.state    = 'HALF_OPEN';
      this.successes = 0;
      logger.warn(`[CB:${this.cfg.name}] → HALF_OPEN`);
    }

    try {
      const result = await fn();
      await this.onSuccess();
      return result;
    } catch (err: unknown) {
      if (err instanceof CircuitOpenError) throw err;
      await this.onFailure(err);
      throw err;
    }
  }

  private async onSuccess() {
    this.failures = 0;
    if (this.state === 'HALF_OPEN') {
      this.successes++;
      if (this.successes >= this.cfg.successThreshold) {
        this.state = 'CLOSED';
        logger.info(`[CB:${this.cfg.name}] → CLOSED (recovered)`);
        await this.persistToRedis();
      }
    }
  }

  private async onFailure(err: unknown) {
    this.failures++;
    this.openedAt = Date.now();
    if (this.state === 'HALF_OPEN' || this.failures >= this.cfg.failureThreshold) {
      this.state = 'OPEN';
      logger.error(`[CB:${this.cfg.name}] → OPEN`, {
        failures:    this.failures,
        cooldownSec: this.cfg.timeout / 1000,
        error:       err instanceof Error ? err.message : String(err),
      });
      await this.persistToRedis();
    }
  }

  /**
   * Read OPEN state from Redis so all instances share circuit state.
   * Only promotes to OPEN — never demotes (local OPEN stays OPEN until timeout).
   */
  private async syncFromRedis(): Promise<void> {
    try {
      const key   = `vantrix:cb:${this.cfg.name}`;
      const raw   = await redis.get<string>(key);
      if (!raw) return;

      const stored = JSON.parse(raw) as { state: CBState; openedAt: number };
      // Promote local state to OPEN if Redis says it's open and we're currently CLOSED
      if (stored.state === 'OPEN' && this.state === 'CLOSED') {
        this.state    = 'OPEN';
        this.openedAt = stored.openedAt;
        logger.warn(`[CB:${this.cfg.name}] synced OPEN from Redis`);
      }
    } catch {
      // Non-critical — continue with local state
    }
  }

  /**
   * Persist state change to Redis so other instances pick it up.
   * TTL = circuit timeout + buffer, so stale open states auto-expire.
   */
  private async persistToRedis(): Promise<void> {
    try {
      const key = `vantrix:cb:${this.cfg.name}`;
      const ttl = Math.ceil(this.cfg.timeout / 1000) + 30;
      await redis.setex(key, ttl, JSON.stringify({
        state:    this.state,
        openedAt: this.openedAt,
        failures: this.failures,
      }));
    } catch {
      // Non-critical — local state still functions
    }
  }

  getStats() {
    return {
      state:     this.state,
      failures:  this.failures,
      successes: this.successes,
      openedAt:  this.openedAt,  // TRACE-5: include open timestamp for span lineage
    };
  }

  reset() {
    this.state = 'CLOSED'; this.failures = 0; this.successes = 0;
    redis.del(`vantrix:cb:${this.cfg.name}`).catch(bg(`circuitBreaker.${this.cfg.name}.resetCacheDel`));
  }
}

// ── Singleton registry ────────────────────────────────────────────────────────
const _registry = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(name: string, opts?: CircuitBreakerOptions): CircuitBreaker {
  if (!_registry.has(name)) _registry.set(name, new CircuitBreaker(name, opts));
  return _registry.get(name)!;
}

// Pre-configured breakers for each external service
export const breakers = {
  openrouter:  () => getCircuitBreaker('openrouter',  { failureThreshold: 5, timeout: 30_000 }),
  stripe:      () => getCircuitBreaker('stripe',      { failureThreshold: 3, timeout: 20_000 }),
  paystack:    () => getCircuitBreaker('paystack',    { failureThreshold: 3, timeout: 20_000 }),
  nowpayments: () => getCircuitBreaker('nowpayments', { failureThreshold: 3, timeout: 20_000 }),
  paddle:      () => getCircuitBreaker('paddle',      { failureThreshold: 3, timeout: 20_000 }),
  imageGen:    () => getCircuitBreaker('image-gen',   { failureThreshold: 5, timeout: 60_000 }),
  // Used only by getAuthedUser()'s fallback path (no x-verified-user-id
  // header — routes outside the middleware matcher, or local/test
  // contexts). The normal request path never touches this. Lower timeout
  // than payment breakers: an auth check that's this slow is worse than
  // one that's just unavailable, since every route using getAuthedUser()
  // blocks on it.
  supabaseAuth: () => getCircuitBreaker('supabase-auth', { failureThreshold: 3, timeout: 15_000 }),
};
