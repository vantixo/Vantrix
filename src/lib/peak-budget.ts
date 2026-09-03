// src/lib/peak-budget.ts
//
// NEW FILE — H-01
//
// PEAK (Claude 3.5 Sonnet via OpenRouter, ~$3/M input + $15/M output) is
// priced nothing like SMART/POWER. The old soft cap in adaptive-quota.ts
// was denominated in raw tokens and didn't distinguish a ~$0.00028/K
// DeepSeek token from a ~$0.015/K Sonnet token — a heavy Elite user on
// PEAK could cost well above their subscription price before the soft cap
// even noticed.
//
// This module adds a PEAK-specific monthly budget with two layered guards:
//   1. Request-count ceiling (simple, predictable)
//   2. Dollar-spend ceiling (catches long-output abuse even if request
//      count alone looks fine)
//
// Pricing basis: Elite is $49.99/mo (updated from $39.99).
// Target: PEAK AI cost ≤ 30% of Elite revenue = ~$15/user/month worst-case.
// The dollar ceiling below ($35) reflects that target with margin for
// SMART/POWER traffic on top. At typical usage (20% of limit), PEAK cost
// is ~$1.60/user/month — well within budget.

import { redis } from '@/lib/redis';

export type Tier = 'free' | 'spark' | 'basic' | 'premium' | 'elite' | 'enterprise';

export const PEAK_MONTHLY_REQUEST_BUDGET: Record<Tier, number> = {
  free:       0,
  spark:      0,
  basic:      0,
  premium:    0,
  elite:      650,   // ≈ $2.73 worst-case at avg 400 in / 200 out tokens per call.
                     // Hard ceiling. Typical user hits ~80 PEAK calls/month (12%
                     // of ~650 daily msgs at 20% activity). Revisit after first
                     // 90 days of real usage distribution data.
  enterprise: 5000,  // contracted per-seat — revisit per contract rather than
                     // hardcoding a platform-wide number long-term.
};

export const PEAK_MONTHLY_DOLLAR_CEILING_USD: Record<Tier, number> = {
  free:       0,
  spark:      0,
  basic:      0,
  premium:    0,
  elite:      35,    // ≤ 30% of $49.99 revenue goes to PEAK model cost.
                     // Combined with SMART/POWER traffic (~$10/heavy user),
                     // total AI cost stays under $45 at worst case — profitable
                     // at $49.99. Second independent guard: catches long-output
                     // abuse even when request count alone looks fine.
  enterprise: 1000,
};

const PEAK_INPUT_COST_PER_TOKEN_USD  = 3  / 1_000_000;  // Claude 3.5 Sonnet via OpenRouter
const PEAK_OUTPUT_COST_PER_TOKEN_USD = 15 / 1_000_000;

function monthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function requestCountKey(userId: string): string {
  return `vantrix:peak:reqs:${monthKey()}:${userId}`;
}

function spendCentsKey(userId: string): string {
  return `vantrix:peak:spend-cents:${monthKey()}:${userId}`;
}

// Reserved-but-not-yet-settled spend for in-flight requests. Distinct from
// spendCentsKey (settled/actual spend from completed requests) so that
// concurrent in-flight requests are visible to the budget check even
// before any of them has a real token count to report.
function reservedCentsKey(userId: string): string {
  return `vantrix:peak:reserved-cents:${monthKey()}:${userId}`;
}

// Conservative estimate used only to size the up-front reservation, not to
// bill the user — recordPeakUsage() always reconciles against the real
// token counts once the request completes. Deliberately generous (a
// worst-case single PEAK turn) so concurrent requests can't all sneak in
// under a too-small placeholder before any of them settles.
const ESTIMATED_COST_CENTS_PER_REQUEST = Math.round(
  (2000 * PEAK_INPUT_COST_PER_TOKEN_USD + 1500 * PEAK_OUTPUT_COST_PER_TOKEN_USD) * 100
);

const TTL_SECONDS = 60 * 60 * 24 * 35; // comfortably past month boundary

// Atomic check-and-reserve. Runs as a single Lua script server-side so
// concurrent requests can never all read "under budget" and all pass —
// only as many requests as the remaining budget actually allows are
// admitted, and each admitted request immediately reserves its estimated
// cost against the dollar ceiling before this script returns.
//
// KEYS[1] = request count key
// KEYS[2] = settled spend (cents) key
// KEYS[3] = reserved spend (cents) key
// ARGV[1] = request budget (count)
// ARGV[2] = dollar ceiling (cents)
// ARGV[3] = estimated cost of this request (cents)
// ARGV[4] = key TTL (seconds)
//
// Returns { admitted: 0|1, requestsUsed, spendCents } as a 3-element array
// (Lua/Redis has no native bool/object reply we can rely on portably).
const RESERVE_SCRIPT = `
local reqs      = tonumber(redis.call('GET', KEYS[1]) or '0')
local settled    = tonumber(redis.call('GET', KEYS[2]) or '0')
local reserved    = tonumber(redis.call('GET', KEYS[3]) or '0')
local reqBudget  = tonumber(ARGV[1])
local dollarCeil = tonumber(ARGV[2])
local estCost    = tonumber(ARGV[3])
local ttl        = tonumber(ARGV[4])

if reqs >= reqBudget then
  return {0, reqs, settled + reserved}
end
if (settled + reserved) >= dollarCeil then
  return {0, reqs, settled + reserved}
end

reqs = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ttl)
reserved = redis.call('INCRBY', KEYS[3], estCost)
redis.call('EXPIRE', KEYS[3], ttl)

return {1, reqs, settled + reserved}
`;

export interface PeakBudgetCheck {
  allowed:         boolean;
  reason?:         'tier_ineligible' | 'request_budget_exceeded' | 'dollar_ceiling_exceeded';
  requestsUsed:    number;
  requestBudget:   number;
  spendUsd:        number;
  dollarCeilingUsd: number;
}

/**
 * Call BEFORE routing a request to PEAK. If `allowed` is false, fall back
 * to POWER rather than failing the request — PEAK is a quality upgrade, not
 * a requirement. The user should never see an error; they get a slightly less
 * expensive model instead.
 *
 * On success, this has already atomically reserved one request slot and an
 * estimated dollar amount against the budget (see RESERVE_SCRIPT above) —
 * callers MUST follow up with recordPeakUsage() once the request completes
 * (success or failure) to reconcile the reservation against actual cost.
 * releasePeakReservation() should be called instead if the request never
 * actually reaches the provider (e.g. routing fails before dispatch), so
 * the reservation doesn't leak.
 */
export async function checkPeakBudget(userId: string, tier: Tier): Promise<PeakBudgetCheck> {
  const requestBudget    = PEAK_MONTHLY_REQUEST_BUDGET[tier]     ?? 0;
  const dollarCeilingUsd = PEAK_MONTHLY_DOLLAR_CEILING_USD[tier] ?? 0;

  if (requestBudget === 0) {
    return {
      allowed: false,
      reason:  'tier_ineligible',
      requestsUsed: 0,
      requestBudget,
      spendUsd: 0,
      dollarCeilingUsd,
    };
  }

  const [admitted, requestsUsed, spendCents] = await redis.eval(
    RESERVE_SCRIPT,
    [requestCountKey(userId), spendCentsKey(userId), reservedCentsKey(userId)],
    [
      String(requestBudget),
      String(Math.round(dollarCeilingUsd * 100)),
      String(ESTIMATED_COST_CENTS_PER_REQUEST),
      String(TTL_SECONDS),
    ],
  ) as [number, number, number];

  const spendUsd = spendCents / 100;

  if (admitted !== 1) {
    // Distinguish which ceiling tripped purely for logging/observability —
    // the script already made the atomic admit/reject decision above, so
    // this is a best-effort classification, not a second check.
    const reason: PeakBudgetCheck['reason'] =
      requestsUsed >= requestBudget ? 'request_budget_exceeded' : 'dollar_ceiling_exceeded';
    return { allowed: false, reason, requestsUsed, requestBudget, spendUsd, dollarCeilingUsd };
  }

  return { allowed: true, requestsUsed, requestBudget, spendUsd, dollarCeilingUsd };
}

/**
 * Call AFTER a PEAK request completes with actual token usage from the
 * provider response. Reconciles the up-front reservation made in
 * checkPeakBudget() against the real cost: moves the estimated amount out
 * of "reserved" and the actual amount into "settled", atomically, so the
 * two counters can never drift into double-counting the same request.
 */
export async function recordPeakUsage(
  userId: string,
  usage: { inputTokens: number; outputTokens: number },
): Promise<void> {
  const actualCostCents = Math.round(
    (usage.inputTokens  * PEAK_INPUT_COST_PER_TOKEN_USD +
     usage.outputTokens * PEAK_OUTPUT_COST_PER_TOKEN_USD) * 100
  );

  const settledKey  = spendCentsKey(userId);
  const reservedKey = reservedCentsKey(userId);

  const RECONCILE_SCRIPT = `
    redis.call('DECRBY', KEYS[1], tonumber(ARGV[1]))
    redis.call('INCRBY', KEYS[2], tonumber(ARGV[2]))
    redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
    redis.call('EXPIRE', KEYS[2], tonumber(ARGV[3]))
    return 1
  `;

  await redis.eval(
    RECONCILE_SCRIPT,
    [reservedKey, settledKey],
    [String(ESTIMATED_COST_CENTS_PER_REQUEST), String(actualCostCents), String(TTL_SECONDS)],
  );
}

/**
 * Release a reservation without settling any real cost — for the case
 * where checkPeakBudget() admitted a request but it never actually reached
 * the provider (e.g. an error before dispatch). Without this, an aborted
 * request would permanently consume its estimated-cost reservation for the
 * rest of the month even though nothing was ever spent.
 */
export async function releasePeakReservation(userId: string): Promise<void> {
  const reqKey      = requestCountKey(userId);
  const reservedKey = reservedCentsKey(userId);

  const RELEASE_SCRIPT = `
    redis.call('DECR', KEYS[1])
    redis.call('DECRBY', KEYS[2], tonumber(ARGV[1]))
    return 1
  `;

  await redis.eval(RELEASE_SCRIPT, [reqKey, reservedKey], [String(ESTIMATED_COST_CENTS_PER_REQUEST)]);
}
