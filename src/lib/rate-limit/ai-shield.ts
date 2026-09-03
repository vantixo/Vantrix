/**
 * AI Shield — Pre-Auth Request Rate Limiter
 *
 * Problem: The anomaly detector in cost-guard.ts runs *after* auth, profile
 * load, context assembly, and 14 other I/O operations. By then we've already
 * spent 20-40ms of compute on a request we should have rejected in 2ms.
 *
 * This module provides a lightweight Redis counter that fires at the absolute
 * top of the chat route — before auth, before DB — to shed abusive traffic.
 *
 * Two layers:
 *   IP-level:   hard cap at 60 req/min per IP (unauthenticated traffic)
 *   Global:     shed requests when platform is overloaded (circuit-breaker pattern)
 *
 * This is intentionally coarser than the per-user limits in rate-limit/index.ts.
 * Its job is to protect infrastructure, not enforce business rules.
 *
 * Atomicity:
 *   INCR and EXPIRE are pipelined in a single round-trip so there is no
 *   window where a key exists without a TTL — even if the process crashes
 *   between the two operations. The previous two-call pattern could leave
 *   a key alive forever, permanently blocking the IP.
 */

import { createHash } from 'crypto';
import { logger } from '@/lib/logger';
import { redis }              from '@/lib/redis';


const IP_WINDOW_SECS  = 60;
const IP_MAX_REQUESTS = 60;   // per minute per IP

function ipKey(ip: string): string {
  // SHA-256 truncated to 16 hex chars (64-bit space).
  // Replaces djb2 (32-bit, ~50% collision at 77k IPs) with a collision-safe hash.
  // Raw IPs are never stored in Redis.
  const hash = createHash('sha256').update(ip).digest('hex').slice(0, 16);
  return `shield:ip:${hash}`;
}

/**
 * Check if this IP is over the pre-auth request budget.
 * Returns true if the request should be shed immediately.
 *
 * Uses a single pipelined INCR + EXPIRE — atomic enough for a rate-limiter
 * (both ops land in the same TCP frame; Redis processes commands in order).
 * ~0.5ms latency over Upstash REST.
 */
export async function checkAIShield(ip: string | null): Promise<boolean> {
  if (!ip) return false;  // no IP = internal / trusted

  try {
    const key = ipKey(ip);

    // Pipeline INCR and EXPIRE together — single round-trip, no TTL-leak risk.
    const pipe            = redis.pipeline();
    pipe.incr(key);
    pipe.expire(key, IP_WINDOW_SECS);
    const [count]         = await pipe.exec() as [number, number];

    if (count > IP_MAX_REQUESTS) {
      logger.warn('ai-shield:ip-blocked', { ipHash: key.replace('shield:ip:', ''), count });
      return true;
    }

    return false;
  } catch {
    // Shield down → fail open (prefer availability over protection at the margin)
    return false;
  }
}

/**
 * Global platform load shedder.
 * When platform tokens/hour > SHED_THRESHOLD, randomly shed a percentage
 * of free-tier requests to protect paid users during spikes.
 * Returns true if this request should be shed.
 */
export async function checkLoadShedder(
  tier: string,
  platformUsagePct: number,
): Promise<boolean> {
  // Only shed free-tier requests, to protect premium users during spikes.
  // TWO-TIER MODEL FIX: this used to also shed 'spark' — a legacy paid
  // tier under the old multi-tier model. Under the current free/premium
  // model there's no non-free tier that should ever be shed, so the check
  // simplifies to a straight 'free' comparison (normalised, so legacy DB
  // rows still awaiting the backfill migration are still treated as
  // premium and protected, consistent with lib/auth/plan.ts).
  const isFree = !tier || tier.toLowerCase() === 'free';
  if (!isFree) return false;

  // Below 80% — no shedding
  if (platformUsagePct < 80) return false;

  // 80-90%: shed 25% of free requests
  if (platformUsagePct < 90) return Math.random() < 0.25;

  // 90-100%: shed 60% of free requests
  if (platformUsagePct < 100) return Math.random() < 0.60;

  // >100%: shed 90% of free requests
  return Math.random() < 0.90;
}
