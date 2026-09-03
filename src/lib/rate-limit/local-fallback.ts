/**
 * In-process rate limit fallback — activates when Upstash Redis is unreachable.
 *
 * WHY: When Redis is down, every safety net (AI shield, chat limit, image limit)
 * simultaneously fails open. This local fallback prevents total exposure during
 * Redis outages by maintaining per-key sliding windows in process memory.
 *
 * Limitations:
 *   - Single-process only (no cross-instance coordination)
 *   - State lost on cold start / process restart
 *   - Memory bounded — old windows are pruned every 5 minutes
 *
 * These limitations are acceptable: the fallback is a bridge, not a replacement.
 * It prevents catastrophic open exposure while Redis recovers.
 */

import { logger } from '@/lib/logger';

interface WindowEntry {
  hits:      number[];  // timestamps in ms
  lastPrune: number;
}

const windows = new Map<string, WindowEntry>();

// Prune stale windows every 5 minutes to prevent unbounded memory growth
let lastGlobalPrune = Date.now();
const GLOBAL_PRUNE_INTERVAL = 5 * 60 * 1000;

function maybePruneGlobal(): void {
  const now = Date.now();
  if (now - lastGlobalPrune < GLOBAL_PRUNE_INTERVAL) return;
  lastGlobalPrune = now;
  for (const [key, entry] of windows.entries()) {
    // Drop any key that hasn't been touched in the last 10 minutes
    if (now - entry.lastPrune > 10 * 60 * 1000) {
      windows.delete(key);
    }
  }
}

/**
 * Local sliding-window rate check.
 * Returns true if request is ALLOWED (under limit).
 * Returns false if request should be BLOCKED (over limit).
 *
 * @param key       Unique rate limit key (e.g. `local:user:${userId}:chat`)
 * @param max       Maximum requests allowed in the window
 * @param windowMs  Window size in milliseconds
 */
export function localRateCheck(key: string, max: number, windowMs: number): boolean {
  maybePruneGlobal();

  const now    = Date.now();
  const cutoff = now - windowMs;

  const entry = windows.get(key) ?? { hits: [], lastPrune: now };

  // Prune hits outside the window
  entry.hits = entry.hits.filter(t => t > cutoff);
  entry.lastPrune = now;

  if (entry.hits.length >= max) {
    windows.set(key, entry);
    return false; // blocked
  }

  entry.hits.push(now);
  windows.set(key, entry);
  return true; // allowed
}

/**
 * Wrap a Redis rate limit call with local fallback.
 * If the Redis call throws, the local fallback kicks in.
 *
 * @param redisCheck   Async function that performs the Redis rate check
 * @param fallbackKey  Key for the local fallback window
 * @param max          Max requests in window
 * @param windowMs     Window size in ms
 */
export async function withLocalFallback(
  redisCheck: () => Promise<boolean>,
  fallbackKey: string,
  max: number,
  windowMs: number,
): Promise<boolean> {
  try {
    return await redisCheck();
  } catch (err) {
    // Redis is down — use local fallback and log at error level
    logger.error('rate-limit: Redis unavailable, using local fallback', { error: err instanceof Error ? err.message : String(err) });
    return localRateCheck(fallbackKey, max, windowMs);
  }
}
