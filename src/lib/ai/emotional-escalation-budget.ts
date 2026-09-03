/**
 * Emotional Escalation Budget — Vantrix
 *
 * peak-budget.ts solved margin protection for PEAK (elite/enterprise only).
 * This module solves the gap on the other side of the table: every tier
 * BELOW plan-cap-PEAK currently has zero path to a better model, no matter
 * how emotionally significant the moment is. A free or basic user having a
 * genuinely heavy conversation beat gets the same capped model as their
 * most throwaway message — which is backwards for a companion product,
 * since the emotional beats are exactly the moments that decide whether
 * someone converts or churns.
 *
 * Design stance, same as peak-budget.ts: budget-capped, not plan-capped.
 * Every tier gets ONE step up from their normal plan cap, gated by a small
 * monthly request budget + dollar ceiling (same double-guard pattern), so
 * a rare emotionally-intense message can reach a better model without
 * changing the cost profile of ordinary traffic at all. This is
 * deliberately NOT a blanket floor raise — it only spends budget on
 * messages classifyComplexity already flags as emotionally significant,
 * so typical free-tier cost stays exactly what it is today.
 *
 * TWO-TIER MODEL: 'premium' already caps at PEAK via PLAN_MODEL_CAP in
 * model-router.ts, so it has no escalation step left to take — this module
 * now only meaningfully covers 'free', escalating one step above its
 * existing PLAN_MODEL_CAP for emotionally significant moments.
 */

import { redis } from '@/lib/redis';
import type { Tier } from '@/lib/rate-limit';
import type { ModelTier } from './model-router';

// ── Escalation targets ──────────────────────────────────────────────────
// One step above each tier's current PLAN_MODEL_CAP in model-router.ts.
// Kept as an explicit map (not derived via TIER_RANK+1) so the mapping is
// a deliberate product decision visible in one place, not implicit math.

export const ESCALATION_TARGET: Partial<Record<Tier, ModelTier>> = {
  free: 'SMART',  // from FAST
  // premium: not handled here — already at PEAK via PLAN_MODEL_CAP
};

// ── Budgets ───────────────────────────────────────────────────────────────
// Deliberately small — this is a "your worst/best moment gets a better
// model" allowance, not a second tier of regular service. Free's budget is
// tiny on purpose: it exists so a genuinely heavy free-tier conversation
// doesn't read as robotic at the exact moment that decides conversion,
// without meaningfully changing free-tier cost economics overall.

export const ESCALATION_MONTHLY_REQUEST_BUDGET: Partial<Record<Tier, number>> = {
  free: 6,    // ~1-2 genuinely heavy moments a month — enough to not miss the one that matters
};

export const ESCALATION_MONTHLY_DOLLAR_CEILING_USD: Partial<Record<Tier, number>> = {
  free: 0.50,
};

// Same per-model cost basis as peak-budget.ts / model-router.ts's
// MODEL_COST_PER_M, expressed per-token for the dollar-ceiling check.
const ESCALATION_COST_PER_TOKEN_USD: Record<ModelTier, { input: number; output: number }> = {
  NANO:  { input: 0,          output: 0 },
  FAST:  { input: 0,          output: 0 },
  SMART: { input: 0.14 / 1_000_000, output: 0.28 / 1_000_000 },
  POWER: { input: 0.25 / 1_000_000, output: 1.25 / 1_000_000 },
  PEAK:  { input: 3    / 1_000_000, output: 15   / 1_000_000 },
};

function monthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function requestCountKey(userId: string): string {
  return `vantrix:escalation:reqs:${monthKey()}:${userId}`;
}

function spendCentsKey(userId: string): string {
  return `vantrix:escalation:spend-cents:${monthKey()}:${userId}`;
}

export interface EscalationCheck {
  allowed:          boolean;
  targetTier:        ModelTier | null;
  reason?:          'no_escalation_for_tier' | 'request_budget_exceeded' | 'dollar_ceiling_exceeded';
  requestsUsed:      number;
  requestBudget:     number;
  spendUsd:          number;
  dollarCeilingUsd:  number;
}

/**
 * Call when classifyComplexity has flagged a message as emotionally
 * significant but the user's plan cap would otherwise block the better
 * model. If `allowed` is false, the caller simply stays at the plan cap —
 * same fail-safe shape as checkPeakBudget: no user-visible error, just no
 * escalation this time.
 */
export async function checkEscalationBudget(userId: string, tier: Tier): Promise<EscalationCheck> {
  const targetTier       = ESCALATION_TARGET[tier] ?? null;
  const requestBudget    = ESCALATION_MONTHLY_REQUEST_BUDGET[tier] ?? 0;
  const dollarCeilingUsd = ESCALATION_MONTHLY_DOLLAR_CEILING_USD[tier] ?? 0;

  if (!targetTier || requestBudget === 0) {
    return {
      allowed: false, targetTier: null, reason: 'no_escalation_for_tier',
      requestsUsed: 0, requestBudget: 0, spendUsd: 0, dollarCeilingUsd: 0,
    };
  }

  const [requestsUsedRaw, spendCentsRaw] = await Promise.all([
    redis.get<number>(requestCountKey(userId)),
    redis.get<number>(spendCentsKey(userId)),
  ]);

  const requestsUsed = requestsUsedRaw ?? 0;
  const spendUsd      = (spendCentsRaw ?? 0) / 100;

  if (requestsUsed >= requestBudget) {
    return { allowed: false, targetTier, reason: 'request_budget_exceeded', requestsUsed, requestBudget, spendUsd, dollarCeilingUsd };
  }
  if (spendUsd >= dollarCeilingUsd) {
    return { allowed: false, targetTier, reason: 'dollar_ceiling_exceeded', requestsUsed, requestBudget, spendUsd, dollarCeilingUsd };
  }

  return { allowed: true, targetTier, requestsUsed, requestBudget, spendUsd, dollarCeilingUsd };
}

/** Call AFTER an escalated request completes with actual token usage. */
export async function recordEscalationUsage(
  userId: string,
  targetTier: ModelTier,
  usage: { inputTokens: number; outputTokens: number },
): Promise<void> {
  const cost = ESCALATION_COST_PER_TOKEN_USD[targetTier];
  const costCents = Math.round((usage.inputTokens * cost.input + usage.outputTokens * cost.output) * 100);

  const reqKey   = requestCountKey(userId);
  const spendKey = spendCentsKey(userId);
  const ttlSeconds = 60 * 60 * 24 * 35;

  await Promise.all([
    redis.incr(reqKey).then(()   => redis.expire(reqKey,   ttlSeconds)),
    redis.incrby(spendKey, costCents).then(() => redis.expire(spendKey, ttlSeconds)),
  ]);
}
