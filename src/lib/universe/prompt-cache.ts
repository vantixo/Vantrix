/**
 * Prompt-context cache wrapper — HEAVY-LOAD FIX
 *
 * assembleUniverseContext() (universe-prompt.ts) fans out to ~11 formatter
 * functions on EVERY chat message (/api/chat/stream, and /api/queue/enqueue's
 * worker for the queue-fallback path).
 * Of those, only status-legend.ts's formatters had any caching — the other
 * ten (social graph, events, stories, life, reputation, governance, economy,
 * job, attributes, assets) hit Postgres directly and uncached, every message.
 * Several of them (economy, governance, job, status) also independently
 * re-look-up the same character's companion_occupations row.
 *
 * That's invisible at low traffic and a connection-pool-exhaustion risk at
 * real concurrency — a burst of chat messages turns into 15-25 uncached DB
 * round trips apiece, competing with every other route for the same pool.
 *
 * This wraps each formatter's *entire output string* in a short-TTL Redis
 * cache, keyed per character. Same mechanism status-legend.ts already uses
 * (redis.get -> on miss, compute -> redis.set), just factored out so it can
 * be applied uniformly without duplicating the try/catch boilerplate in ten
 * different files. Caching the finished string also incidentally caches
 * away the redundant companion_occupations lookups baked inside it — after
 * the first cache population for a character, none of economy/governance/
 * job/status touch the DB again until the entry expires.
 *
 * TTL is intentionally short (45s): world/economy/governance state only
 * moves on hourly-or-slower cron ticks, so a 45s-stale read is never
 * meaningfully wrong, while still collapsing the vast majority of DB load
 * during an actual back-and-forth conversation (many messages per minute
 * per character).
 */

import { redis }  from '@/lib/redis';
import { logger } from '@/lib/logger';

const DEFAULT_TTL_SECONDS = 45;

export async function cachedPromptFormat(
  cacheKey: string,
  compute: () => Promise<string>,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<string> {
  try {
    const cached = await redis.get<string>(cacheKey);
    // Redis stores '' fine, but treat it as a legitimate cached miss result
    // too (not just non-null) so an empty section doesn't get recomputed
    // every call for the whole TTL window.
    if (cached !== null && cached !== undefined) return cached;
  } catch {
    // Redis unavailable — fall through to a live (uncached) compute rather
    // than failing the whole prompt assembly over a cache outage.
  }

  const result = await compute();

  try {
    await redis.set(cacheKey, result, { ex: ttlSeconds });
  } catch (err) {
    logger.warn('prompt-cache:set-failed', { cacheKey, error: String(err) });
  }

  return result;
}
