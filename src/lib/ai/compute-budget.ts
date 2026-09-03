/**
 * Compute Budget — Cognition Engine Throttling
 *
 * cost-guard.ts/adaptive-quota.ts govern $ spend and prompt/completion
 * TOKEN budget. Nothing upstream of them governs how much CPU/IO work
 * this turn does BEFORE a single token is generated — specifically, how
 * many of the ~25 cognition engines in lib/ai/ actually run.
 *
 * Most of those engines are cheap, synchronous, pure functions over
 * already-loaded state (compute*State(...)) and are not worth gating —
 * skipping them would save microseconds and risk breaking downstream
 * prompt assembly that reads their output unconditionally. This module
 * does NOT touch those.
 *
 * It targets the small number of engines that do real IO (extra DB/Redis
 * round trips) for a payoff that is decorative/optional rather than
 * load-bearing, and that already fail open with a documented "no
 * fragment this turn" fallback in route.ts. Those are exactly the
 * engines that are safe to skip outright under load:
 *
 *   - legacy-engine.ts       (4 extra reads: social-status, legend,
 *                             character-attributes, character-assets)
 *   - memory-test-engine.ts  (getDueMemoryTest Redis read + the recall
 *                             test flow it can trigger)
 *
 * Gate check runs ONCE per turn, early (right after `tier` is known —
 * before cost-guard.ts, which only runs later once the full message
 * list is assembled). It is a pure, synchronous function over the
 * platform-hourly-usage number the route handler already fetched via
 * adaptive-quota.ts's getPlatformHourlyUsage() for the load shedder —
 * NOT a second Redis round trip. Same real signal drives both "shed
 * the request entirely" and "shed some of its optional engine work",
 * so the two can't drift apart the way two independently-fetched
 * counters could.
 *
 * Levels:
 *   full    — run every optional engine (default; all paid tiers, and
 *             free tier while the platform is under budget)
 *   reduced — skip memory-test-engine.ts only (its recall-test flow
 *             costs an extra round trip on the reply side too, not just
 *             the read)
 *   minimal — skip both legacy-engine.ts and memory-test-engine.ts
 *
 * Enterprise/elite are never throttled here, matching adaptive-quota.ts's
 * IMMUNE_TIERS / soft-cap posture — same contractual reasoning applies
 * to compute as to tokens.
 */

import type { Tier } from '@/lib/rate-limit';
import { env } from '@/env';
import { logger } from '@/lib/logger';

export type ComputeLevel = 'full' | 'reduced' | 'minimal';

export interface ComputeBudget {
  level:              ComputeLevel;
  allowLegacyEngine:  boolean;
  allowMemoryTest:    boolean;
}

const NEVER_THROTTLED: Set<string> = new Set(['enterprise', 'elite']);

const FULL_BUDGET: ComputeBudget    = { level: 'full',    allowLegacyEngine: true,  allowMemoryTest: true  };
const REDUCED_BUDGET: ComputeBudget = { level: 'reduced',  allowLegacyEngine: true,  allowMemoryTest: false };
const MINIMAL_BUDGET: ComputeBudget = { level: 'minimal',  allowLegacyEngine: false, allowMemoryTest: false };

/**
 * Decide this turn's compute budget from the platform-hourly-usage figure
 * the caller already fetched (route.ts fetches it once, in parallel, for
 * the load shedder — see stream/route.ts's pre-flight block). Pure and
 * synchronous: no new IO, can't itself fail, so there's no try/catch here —
 * a bad `platformUsage` input (e.g. the caller's own fetch already failed
 * open to 0) just resolves to FULL_BUDGET via the threshold checks below,
 * which is the correct fail-open behavior anyway.
 */
export function getComputeBudget(params: { tier: Tier; platformUsage: number }): ComputeBudget {
  if (NEVER_THROTTLED.has(params.tier)) return FULL_BUDGET;

  const budgetCeiling = env.PLATFORM_HOURLY_TOKEN_BUDGET;
  if (!(budgetCeiling > 0)) return FULL_BUDGET;

  // Same two-stage posture as adaptive-quota.ts's own multiplier (over
  // budget → reduced; well over → minimal) rather than inventing new
  // thresholds that could disagree with the token-side signal.
  if (params.platformUsage > budgetCeiling * 1.5) return MINIMAL_BUDGET;
  if (params.platformUsage > budgetCeiling)       return REDUCED_BUDGET;
  return FULL_BUDGET;
}

// Kept for callers that don't already have platformUsage in scope (none
// currently — stream/route.ts fetches it for the load shedder and passes
// it in). Logs and fails open to FULL_BUDGET rather than ever blocking a
// turn on a throttling feature.
export async function getComputeBudgetFresh(params: { userId: string; tier: Tier }): Promise<ComputeBudget> {
  try {
    const { getPlatformHourlyUsage } = await import('./adaptive-quota');
    const platformUsage = await getPlatformHourlyUsage();
    return getComputeBudget({ tier: params.tier, platformUsage });
  } catch (err) {
    logger.warn('[compute-budget] getComputeBudgetFresh failed, defaulting to full', {
      userId: params.userId, tier: params.tier, error: String(err),
    });
    return FULL_BUDGET;
  }
}
