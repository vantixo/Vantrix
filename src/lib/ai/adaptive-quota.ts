/**
 * Adaptive AI Cost Governance
 *
 * Problem this solves:
 *   Static per-user daily limits (10k/50k/etc tokens) don't account for:
 *   - Platform-wide cost spikes during viral events or marketing campaigns
 *   - Enterprise clients with bursty but predictable usage patterns
 *   - Free-tier abuse that drives unexpected infrastructure bills
 *   - Model price changes that affect all tiers simultaneously
 *
 * Solution — three-layer adaptive governance:
 *
 *   Layer 1 — Per-user soft quota:  plan limits from spending-cap.ts (unchanged)
 *   Layer 2 — Platform hourly budget: if the platform burns >X tokens/hour across
 *              all users, new requests get a reduced per-request ceiling
 *   Layer 3 — Per-user adaptive multiplier: users who are within 20% of their daily
 *              limit get throttled progressively (90% → 75% → 50% → 25% of ceiling)
 *
 * Result:
 *   - Normal traffic: no change to behavior
 *   - Viral spike: request token budgets shrink automatically, responses stay fast
 *   - Free-tier abuse: heavy users get increasingly small token windows
 *   - Enterprise clients: multiplier is 1.0 always (never throttled by platform budget)
 *
 * Config (env vars):
 *   PLATFORM_HOURLY_TOKEN_BUDGET   default: 10_000_000 (10M tokens/hour)
 *   PLATFORM_BUDGET_REDUCTION_PCT  default: 50 (reduce to 50% when over budget)
 */

import type { Tier } from '@/lib/rate-limit';
import { env } from '@/env';
import { redis }              from '@/lib/redis';


// LOW-2: Use env.* (Zod-validated at startup) instead of raw process.env.
// A missing PLATFORM_HOURLY_TOKEN_BUDGET would previously silently coerce to NaN,
// disabling throttling entirely with no startup warning.
const PLATFORM_HOURLY_BUDGET = env.PLATFORM_HOURLY_TOKEN_BUDGET;
const BUDGET_REDUCTION_PCT   = env.PLATFORM_BUDGET_REDUCTION_PCT / 100;

// Tiers that are immune to platform-level throttling
const IMMUNE_TIERS: Set<string> = new Set(['enterprise']) as unknown as Set<string>;

// Soft daily token caps for elite/enterprise — feels unlimited but protects unit economics.
// At ~$0.001/1k tokens, 2M tokens = $2/day/user on elite ($60/mo plan).
// 5M tokens = $5/day on enterprise. Both still profitable at those rates.
const ELITE_SOFT_DAILY_CAP      = 2_000_000;
const ENTERPRISE_SOFT_DAILY_CAP = 5_000_000;
const SOFT_CAPS: Partial<Record<string, number>> = {
  elite:      ELITE_SOFT_DAILY_CAP,
  enterprise: ENTERPRISE_SOFT_DAILY_CAP,
};

function currentHourKey(): string {
  return `vantrix:platform:tokens:${new Date().toISOString().slice(0, 13)}`; // YYYY-MM-DDTHH
}

/**
 * Record platform-wide token usage for adaptive throttling.
 * Called alongside per-user recordTokensUsed().
 */
export async function recordPlatformTokens(tokens: number): Promise<void> {
  try {
    const key  = currentHourKey();
    const pipe = redis.pipeline();
    pipe.incrby(key, tokens);
    pipe.expire(key, 7200); // 2h TTL (covers current + previous hour)
    await pipe.exec();
  } catch { /* non-critical */ }
}

/**
 * Get platform token usage for the current hour.
 */
export async function getPlatformHourlyUsage(): Promise<number> {
  try {
    const raw = await redis.get<string>(currentHourKey());
    return raw ? parseInt(raw, 10) : 0;
  } catch { return 0; }
}

/**
 * Adaptive quota multiplier:
 *   1.0  — normal (platform under budget, user well under daily limit)
 *   0.75 — user at 80-90% of daily limit
 *   0.5  — user at 90-95% of daily limit OR platform over hourly budget
 *   0.25 — user at 95%+ of daily limit AND platform over budget
 *
 * Enterprise users always get 1.0 (contractual guarantees).
 */
export async function getAdaptiveMultiplier(params: {
  userId:       string;
  tier:         Tier;
  currentUsage: number;
  dailyLimit:   number;
}): Promise<number> {
  if (IMMUNE_TIERS.has(params.tier)) return 1.0;

  // Soft cap for elite/enterprise — protects unit economics without feeling punitive
  const softCap = SOFT_CAPS[params.tier];
  if (softCap) {
    if (params.currentUsage > softCap * 0.9) return 0.25;  // 90%+ of soft cap
    if (params.currentUsage > softCap * 0.8) return 0.5;   // 80%+ of soft cap
  }

  const platformUsage   = await getPlatformHourlyUsage();
  const platformOver    = platformUsage > PLATFORM_HOURLY_BUDGET;
  const usagePct        = params.dailyLimit > 0
    ? params.currentUsage / params.dailyLimit
    : 0;

  if (usagePct >= 0.95 && platformOver) return 0.25;
  if (usagePct >= 0.90)                 return 0.5;
  if (usagePct >= 0.80)                 return 0.75;
  if (platformOver)                     return BUDGET_REDUCTION_PCT;
  return 1.0;
}

/**
 * Usage forecasting — predict whether a user will exceed their daily limit
 * based on their burn rate in the last 2 hours.
 *
 * Returns: { willExceed, forecastedUsage, hoursRemaining }
 */
export async function forecastDailyUsage(params: {
  userId:       string;
  currentUsage: number;
  dailyLimit:   number;
}): Promise<{ willExceed: boolean; forecastedUsage: number; hoursRemaining: number }> {
  if (!Number.isFinite(params.dailyLimit) || params.dailyLimit === 0) {
    return { willExceed: false, forecastedUsage: 0, hoursRemaining: 0 };
  }

  const now   = new Date();
  const hourOfDay      = now.getUTCHours();
  const hoursRemaining = 24 - hourOfDay;

  // MED-2 fix: use fractional hours (minutes) to avoid zero burn rate at UTC midnight.
  // hourOfDay = 0 at 00:00–00:59 UTC, making burnRate = 0 and forecasting zero spend
  // for the entire day even if the user just burned thousands of tokens at 00:01.
  const minuteOfDay    = hourOfDay * 60 + now.getUTCMinutes();
  const fractionalHours = minuteOfDay / 60;
  const burnRate       = fractionalHours > 0 ? params.currentUsage / fractionalHours : 0;
  const forecastedUsage = burnRate * 24;
  const willExceed      = forecastedUsage > params.dailyLimit;

  return { willExceed, forecastedUsage: Math.round(forecastedUsage), hoursRemaining };
}

/**
 * Stream governance: apply adaptive multiplier to a token budget.
 * This is the single call sites should make to get the final token ceiling.
 */
export async function getGovernedTokenBudget(params: {
  userId:         string;
  tier:           Tier;
  baseLimit:      number;  // from spending-cap.ts perRequestLimit
  currentUsage:   number;
  dailyLimit:     number;
}): Promise<{ tokenBudget: number; multiplier: number; throttled: boolean }> {
  const multiplier  = await getAdaptiveMultiplier(params);
  const tokenBudget = Math.max(256, Math.floor(params.baseLimit * multiplier));
  const throttled   = multiplier < 1.0;

  return { tokenBudget, multiplier, throttled };
}
