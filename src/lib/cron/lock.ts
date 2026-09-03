import { redis } from '@/lib/redis';

/**
 * Distributed lock for cron routes. Prevents two overlapping invocations of
 * the same tick — a platform retry after a slow response, a manual
 * re-trigger while a previous run is still in flight, or (for the
 * fan-out ticks) a second dispatcher enqueueing another full batch of
 * per-city jobs — from both proceeding.
 *
 * This closes off duplicate invocations at the cheapest possible point
 * (before any job is even enqueued). It is deliberately NOT the only
 * safeguard: some job types (economy_tick, governance_tick) have a second,
 * independent entry point (full_universe_tick can enqueue a fresh batch of
 * governance_tick jobs on its own schedule) that this lock does not cover,
 * and Redis itself can blip. The actual correctness guarantee for those two
 * lives in the conditional-write guard in runEconomyTick() / 
 * runGovernanceTick() themselves (lib/universe/economy.ts,
 * lib/universe/governance.ts) — this lock is the cheap first layer that
 * stops most duplicates before they generate any DB writes at all.
 *
 * Returns true if the lock was acquired (caller should proceed), false if
 * another instance already holds it (caller should no-op).
 */
export async function acquireCronLock(name: string, windowSeconds: number): Promise<boolean> {
  const key = `vantrix:cron-lock:${name}`;
  try {
    // SET NX with TTL — atomic acquire-or-fail in one Redis call.
    const result = await redis.set(key, Date.now().toString(), {
      nx: true,
      ex: windowSeconds,
    });
    return result === 'OK';
  } catch {
    // Redis unavailable — fail OPEN. A missed lock means at worst a
    // duplicate tick this one time (the layer-2 guard in the handler
    // itself still protects the actual data), which is a far smaller
    // problem than every cron silently no-op'ing during a Redis outage.
    return true;
  }
}
