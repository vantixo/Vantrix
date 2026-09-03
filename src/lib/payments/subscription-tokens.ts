/**
 * Vantrix Coin Credits
 *
 * Single source of truth for the Vantrix Coin amount credited to a user's
 * `profiles.tokens` balance when a subscription payment is confirmed
 * (initial checkout OR renewal). This is the per-MONTH amount for the base
 * 'premium' plan; callers multiply by the billing length (1/3/12 for
 * monthly/quarterly/annual — see TOKEN_MONTHS in each webhook handler) to
 * get the actual one-time credit.
 *
 * These values mirror the `tokens_per_month` column in the `tiers` table
 * (supabase/schema.sql) — kept in sync by
 * supabase/migrations/20260810_single_plan_three_billing_lengths.sql.
 *
 * Vantrix Coin is the gift-economy currency — separate from AI message
 * limits. It's spent via /api/dating/gifts and deducted atomically by
 * deduct_tokens().
 *
 * Called by every payment webhook handler (Stripe, Paystack, NowPayments) so
 * that all three providers credit identically regardless of which provider
 * processed the payment.
 */

/**
 * Vantrix Coin credited per billing cycle, keyed by tier slug. Only 'free'
 * and 'premium' are real, sellable tiers post the single-plan-three-billing-
 * lengths migration — basic/elite/enterprise no longer exist as separate
 * products and were removed from this map (any legacy profile still
 * carrying one of those slugs was collapsed to a single paid slug by that
 * migration).
 *
 * TIER-RENAME NOTE: that single paid slug was 'spark' at the time of the
 * migration; this map (and the webhook handlers, VALID_TIERS sets, etc.)
 * now use 'premium' instead, to match the rest of the app's two-tier model.
 * The 20260937_backfill_legacy_tier_slugs migration has shipped and been
 * verified live (profiles.tier, subscriptions.tier, and tiers.base_tier_slug
 * all hold only 'free'/'premium' now) — the transitional 'spark' fallback
 * that used to live in tokensForTier() below has been removed accordingly.
 */
export const SUBSCRIPTION_TOKEN_CREDITS: Record<string, number> = {
  free:    0,     // no payment — no credit
  premium: 100,
};

/**
 * Returns the Vantrix Coin amount to credit for a given tier slug.
 * Defaults to 0 for unknown/unrecognised tiers (safe: no unearned credits).
 */
export function tokensForTier(tier: string): number {
  return SUBSCRIPTION_TOKEN_CREDITS[tier] ?? 0;
}
