import { env } from '@/env';

/**
 * Tier slug -> Paystack Plan code (PLN_xxx), and the reverse lookup.
 *
 * Sourced from env vars (see env.ts) rather than hardcoded — plan codes are
 * created per-Paystack-account via the Dashboard and are not something this
 * codebase can know in advance or safely assume are stable across
 * deployments/environments (test vs live mode each have their own set).
 *
 * A tier with no configured plan code simply has no recurring-billing
 * support yet (initializePaystackTransaction falls back to a one-off
 * charge for it) — this is a soft degradation, not a hard failure, so
 * partial rollout (e.g. only Basic and Premium configured) works fine.
 *
 * Annual billing: Paystack plans are interval-specific (a plan is created
 * as either monthly or annual in the Dashboard, never both), so each tier
 * needs a SEPARATE plan code for its annual cadence. These must be created
 * in the Paystack Dashboard first (Plans → New Plan → Interval: Annually)
 * — this file cannot invent plan codes, only reference ones that exist.
 */
/**
 * TIER-RENAME NOTE: `tier` here is the live `tiers.base_tier_slug` DB column
 * value, passed straight through from checkout. The 20260937 backfill
 * migration has shipped and been verified live — base_tier_slug now only
 * ever holds 'free'/'premium', so the transitional 'spark' input-acceptance
 * branch has been removed. The PAYSTACK_PLAN_CODE_SPARK* env var names are
 * unrelated (they reference actual Paystack Dashboard plan codes, which
 * keep their own naming regardless of the DB tier-slug rename) and stay
 * as-is.
 */
export function planCodeForTier(tier: string, interval: 'monthly' | 'quarterly' | 'annual' = 'monthly'): string | undefined {
  if (tier !== 'premium') return undefined; // single-plan model — nothing else is sellable
  switch (interval) {
    case 'annual':    return env.PAYSTACK_PLAN_CODE_SPARK_ANNUAL;
    case 'quarterly': return env.PAYSTACK_PLAN_CODE_SPARK_QUARTERLY;
    default:          return env.PAYSTACK_PLAN_CODE_SPARK;
  }
}

/**
 * Resolves a Paystack plan_code (as received in a charge.success webhook's
 * data.plan.plan_code) back to our internal tier slug + billing interval.
 * Returns null for an unrecognized code — callers must treat that as "not a
 * subscription charge we manage" rather than guessing a tier.
 *
 * Deliberately returns the BASE tier slug (e.g. 'premium', never
 * 'premium_annual') for both monthly and annual matches — profiles.tier
 * must always be a base slug so every feature gate (TIER_LIMITS,
 * SUBSCRIPTION_TOKEN_CREDITS, VALID_TIERS) keeps working unchanged. The
 * interval is returned separately for callers that need it (expires_at
 * calculation, token crediting amount).
 *
 * TIER-RENAME NOTE: the OUTPUT tier slug here is 'premium' — this is a
 * webhook-received Paystack plan_code being resolved back to our side, so
 * unlike planCodeForTier() above there's no live-DB input value to stay
 * compatible with; it's safe to emit the target slug directly.
 */
export function tierForPlanCode(planCode: string | undefined | null): { tier: string; interval: 'monthly' | 'quarterly' | 'annual' } | null {
  if (!planCode) return null;
  const entries: Array<[string, string | undefined, 'monthly' | 'quarterly' | 'annual']> = [
    ['premium', env.PAYSTACK_PLAN_CODE_SPARK,           'monthly'],
    ['premium', env.PAYSTACK_PLAN_CODE_SPARK_QUARTERLY, 'quarterly'],
    ['premium', env.PAYSTACK_PLAN_CODE_SPARK_ANNUAL,    'annual'],
  ];
  const match = entries.find(([, code]) => code && code === planCode);
  return match ? { tier: match[0], interval: match[2] } : null;
}
