/**
 * Background-Enrichment Concurrency Gate — Vantrix
 *
 * AUDIT FINDING (2026-07-23): the identity-core / backstory-engine
 * "fire-and-forget" paths (`after(() => maybeDeepenSelfModel(...).catch(bg(...)))`
 * in chat/stream/route.ts, fanning out into direct OpenRouter fetch() calls
 * in identity-core.ts, core-beliefs.ts, self-esteem.ts, purpose-engine.ts)
 * have no backpressure at all. Each is throttled per-(user,character) pair
 * by an interaction-count boundary (ACTIVATION_THRESHOLD / REFRESH_INTERVAL
 * in identity-core.ts), but nothing caps how many of those boundaries can be
 * crossed *at the same time* across the whole fleet. A traffic burst (a push
 * notification, a viral moment, a marketing send) clusters users' turn
 * counts together, so many (user, character) pairs can cross their refresh
 * boundary in the same few seconds — each spawning up to 4 concurrent
 * uncapped OpenRouter calls with no queue, no circuit breaker, no ceiling.
 * That's a real pileup risk: unbounded concurrent outbound LLM calls competing
 * with the user-facing chat completion for the same OpenRouter capacity/
 * rate limit, plus unbounded Redis/DB writes landing at once.
 *
 * This is a *slot*, not a queue: work that can't get a slot is skipped for
 * this turn, not queued to run later. That's intentional — enrichment is
 * "would be nice, isn't a dependency" (see identity-core.ts's own comment on
 * generateEnrichment: "Fails silently ... this is enrichment, never a
 * dependency"). Queueing it would just move the pileup from "too many
 * concurrent calls" to "an ever-growing backlog of stale enrichment work";
 * skipping is the correct backpressure response for best-effort background
 * work, matching the fail-open posture the rest of this layer already uses.
 *
 * Redis INCR/EXPIRE gives an approximate distributed semaphore — good enough
 * here since going slightly over the cap under a race is harmless (a few
 * extra concurrent OpenRouter calls), not a correctness issue. Fails open
 * (permits the call) if Redis itself is unavailable, consistent with every
 * other fail-open path in this layer — losing the concurrency cap during a
 * Redis outage is preferable to losing enrichment entirely.
 */

import { redis }  from '@/lib/redis';
import { logger } from '@/lib/logger';

/** Per-pool caps — deliberately conservative; enrichment competes with the
 *  user-facing completion for the same OpenRouter capacity. */
const POOL_LIMITS: Record<string, number> = {
  'identity-enrichment':  8,
  'backstory-enrichment': 3,
};

const SLOT_TTL_SECONDS = 90; // hard upper bound on any single enrichment call; guards against a leaked slot if release is never reached (crash/timeout)
const poolKey = (pool: string) => `vantrix:bg:concurrency:${pool}`;

/**
 * Attempt to acquire a slot in `pool`. Returns true if acquired (caller must
 * call releaseBgSlot when done), false if the pool is at capacity (caller
 * should skip the work for this turn) or Redis is unreachable (fail open —
 * treated as acquired so a Redis blip doesn't kill enrichment outright).
 */
export async function acquireBgSlot(pool: string): Promise<boolean> {
  const limit = POOL_LIMITS[pool] ?? 5;
  const key   = poolKey(pool);
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, SLOT_TTL_SECONDS);
    if (count > limit) {
      await redis.decr(key); // give back the slot we just took but won't use
      return false;
    }
    return true;
  } catch (err) {
    logger.warn('[bg-concurrency] acquire failed, failing open', { pool, error: String(err) });
    return true;
  }
}

export async function releaseBgSlot(pool: string): Promise<void> {
  try {
    const count = await redis.decr(poolKey(pool));
    if (count < 0) await redis.set(poolKey(pool), 0); // clamp against double-release/race drift
  } catch (err) {
    logger.warn('[bg-concurrency] release failed', { pool, error: String(err) });
  }
}

/**
 * Run `fn` only if a slot is available in `pool`; otherwise skip and log at
 * debug volume (this is expected, routine backpressure, not an error).
 * Always releases the slot it acquired, even on throw.
 */
export async function withBgSlot<T>(pool: string, fn: () => Promise<T>): Promise<T | null> {
  const acquired = await acquireBgSlot(pool);
  if (!acquired) {
    logger.info('bg-concurrency.skipped', { pool, reason: 'pool at capacity' });
    return null;
  }
  try {
    return await fn();
  } finally {
    await releaseBgSlot(pool);
  }
}
