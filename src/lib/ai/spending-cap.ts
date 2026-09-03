/**
 * AI Spending Cap
 *
 * Tracks daily token usage per user in Redis using atomic INCRBY.
 * When the daily limit is reached, requests are blocked with a 429.
 *
 * PLAN_LIMITS is exported so orchestrator.ts and any future callers
 * import from a single source of truth — no duplicate constant declarations.
 */
import { AiLimitError } from '@/lib/errors';
import type { Tier } from '@/lib/rate-limit';
import { redis }              from '@/lib/redis';
import { TIER_LIMITS }        from '@/lib/tiers/limits';


export interface TokenLimits { daily: number; perRequest: number; }

// TOKEN-CAP-VS-MESSAGE-CAP-FIX: `daily` here used to be a flat, independently
// -chosen number (free: 10_000, spark: 50_000, etc.) that had no relationship
// to TIER_LIMITS.dailyMessages (tiers/limits.ts) — the actual promised
// message count shown in the UI and enforced by checkDailyMessageCap.
//
// Doing the math: free's old 10_000 daily budget divided by its own
// 2_000-token perRequest cap allows at most 5 worst-case messages before
// this cap throws — against a promised 30/day. Every tier below elite had
// the same problem (spark: ~17 of 150 promised, basic: ~25 of 150, premium:
// ~83 of 300). Whichever cap a user hit first depended on how token-heavy
// their conversation was, so free users would get a generic "Daily AI usage
// limit reached" 429 at an unpredictable point well before their 30-message
// allowance ran out — indistinguishable from a bug, and undermining the
// "use what you're promised, then hit the upgrade wall" funnel this limit
// is supposed to create.
//
// Fixed the same way tiers/limits.ts already keeps perMinuteBurst from
// accidentally binding before dailyMessages: derive `daily` here from
// dailyMessages × perRequest (the worst-case token cost of every message
// maxing out the per-request ceiling), so this cap is mathematically
// guaranteed to never fire before a user has used their full promised
// message count — it now exists purely as a hard ceiling against
// pathological per-message token cost, not as a second, tighter limit.
// TWO-TIER MODEL: 'premium' is a VIP tier marketed and enforced elsewhere
// as "unlimited" — its TIER_LIMITS.dailyMessages value (2_000) is a
// large-but-finite practical ceiling, not a promised cap. Multiplying a
// finite number here would derive a large-but-finite token budget that
// could still throw a spending-cap 429 against a tier that's supposed to
// never see one. Treat it as always-uncapped here, matching PLAN_LIMITS'
// documented contract.
const UNCAPPED_TIERS: ReadonlySet<Tier> = new Set(['premium']);

function deriveDailyTokenBudget(tier: Tier, perRequest: number): number {
  if (UNCAPPED_TIERS.has(tier)) return Infinity;
  const dailyMessages = TIER_LIMITS[tier]?.dailyMessages ?? TIER_LIMITS.free.dailyMessages;
  if (!Number.isFinite(dailyMessages)) return Infinity;
  return dailyMessages * perRequest;
}

const PER_REQUEST_TOKENS: Record<Tier, number> = {
  free:    2_000,
  premium: 10_000,
};

export const PLAN_LIMITS: Record<Tier, TokenLimits> = Object.fromEntries(
  (Object.keys(PER_REQUEST_TOKENS) as Tier[]).map((tier) => {
    const perRequest = PER_REQUEST_TOKENS[tier];
    return [tier, { daily: deriveDailyTokenBudget(tier, perRequest), perRequest }];
  }),
) as Record<Tier, TokenLimits>;

/**
 * Per-plan daily token limits — derived from PLAN_LIMITS.
 * Imported by orchestrator.ts to eliminate the duplicate constant that
 * previously lived there with a false "single source of truth" comment.
 */
export const PLAN_DAILY_LIMITS: Record<Tier, number> = Object.fromEntries(
  Object.entries(PLAN_LIMITS).map(([k, v]) => [k, v.daily]),
) as Record<Tier, number>;

function todayKey(): string { return new Date().toISOString().slice(0, 10); }

function secondsUntilMidnightUTC(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setUTCDate(now.getUTCDate() + 1);
  midnight.setUTCHours(0, 0, 0, 0);
  return Math.ceil((midnight.getTime() - now.getTime()) / 1000);
}

function tomorrowMidnightISO(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function checkSpendingCap(userId: string, tier: Tier): Promise<{ perRequestLimit: number; currentUsage: number }> {
  const limits = PLAN_LIMITS[tier] ?? PLAN_LIMITS.free;

  let currentUsage = 0;
  try {
    const raw = await redis.get<string>(`ai:tokens:${userId}:${todayKey()}`);
    currentUsage = raw ? parseInt(raw, 10) : 0;
  } catch {
    return { perRequestLimit: limits.perRequest, currentUsage: 0 };
  }

  if (Number.isFinite(limits.daily) && currentUsage >= limits.daily) {
    throw new AiLimitError(currentUsage, limits.daily, tomorrowMidnightISO());
  }

  return { perRequestLimit: limits.perRequest, currentUsage };
}

/**
 * Atomically record tokens used after a successful AI response.
 * Key auto-expires at midnight UTC.
 */
export async function recordTokensUsed(userId: string, tokens: number): Promise<void> {
  if (!userId || tokens <= 0) return;
  const key = `ai:tokens:${userId}:${todayKey()}`;
  const ttl = secondsUntilMidnightUTC();
  const pipe = redis.pipeline();
  pipe.incrby(key, tokens);
  pipe.expire(key, ttl);
  await pipe.exec();
  // Throws on Redis failure — callers that need billing safety should retry.
}

export async function getDailyTokenUsage(userId: string): Promise<number> {
  try {
    const raw = await redis.get<string>(`ai:tokens:${userId}:${todayKey()}`);
    return raw ? parseInt(raw, 10) : 0;
  } catch { return 0; }
}

export async function isApproachingLimit(userId: string, tier: Tier): Promise<boolean> {
  const limits = PLAN_LIMITS[tier] ?? PLAN_LIMITS.free;
  if (!Number.isFinite(limits.daily)) return false;
  const usage = await getDailyTokenUsage(userId);
  return usage >= limits.daily * 0.8;
}
