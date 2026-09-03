/**
 * referral-config.ts
 *
 * ECONOMICS PHILOSOPHY (per Alphonsus's brief: "pricing more to my end,
 * less to advertisers"):
 *
 * Industry norm for SaaS affiliate programs is 20-30% LIFETIME recurring
 * commission. That's generous to the affiliate and expensive to the
 * business — every referred user becomes a permanent margin tax. This
 * config deliberately does NOT do that. Instead:
 *
 *   - 'user' class (everyday users): NO CASH at all. Token bonus only,
 *     paid once, on first conversion. Zero ongoing cost, zero payout
 *     infrastructure risk (no bank transfers to randoms).
 *
 *   - 'dev' class (apply, manually verified): cash, but DECAYING and
 *     CAPPED at 3 months. After month 3 the referred user's revenue is
 *     100% yours. Rate starts moderate, drops fast.
 *
 *   - 'influencer' class (invite/apply-only, exclusive): highest cash
 *     rate but FRONT-LOADED and even shorter — most of the reward lands
 *     in month 1 (which is what actually motivates a promo push), then
 *     decays to nothing by month 3. Plus one-time volume bonuses (a
 *     fixed cost you control, not a recurring % you don't).
 *
 * All three cash tiers stop paying commission entirely after
 * COMMISSION_WINDOW_MONTHS — there is no "lifetime" tier by design.
 */

export type ReferralClass = 'user' | 'dev' | 'influencer';

/**
 * Approximate USD→NGN rate used ONLY to convert Stripe (USD) and
 * NOWPayments (crypto, settled in USD) payment amounts into the NGN
 * figure the commission math below is denominated in. Paystack payments
 * are already NGN and skip this conversion entirely.
 *
 * WIRING NOTE: this is a static approximation, not a live FX feed — swap
 * in a real rate source (Paystack's own FX endpoint, or a forex API)
 * before relying on this for actual partner payouts. Under/over-shooting
 * this rate only affects commission size, never the payer's own charge.
 */
export const USD_TO_NGN_APPROX = 1600;

export const COMMISSION_WINDOW_MONTHS = 3;

/**
 * Percent of the referred user's payment paid as commission, indexed by
 * [class][monthNumber] (1-indexed). Any month beyond what's listed here
 * pays 0 — this IS the cap.
 */
export const COMMISSION_DECAY_TABLE: Record<Exclude<ReferralClass, 'user'>, number[]> = {
  //            month 1  month 2  month 3
  dev:        [   0.12,    0.06,    0.03 ],   // starts moderate, decays fast, gone after 3 months
  influencer: [   0.18,    0.05,    0.02 ],   // front-loaded — most of the payout is the launch push
};

/** One-time token bonus for the free 'user' class, paid on first conversion only. */
export const USER_CLASS_TOKEN_BONUS = 150;

/** Discount the REFERRED user gets on their first paid month, any class. Keeps CAC visible/simple. */
export const REFEREE_FIRST_MONTH_DISCOUNT_PCT = 0.10;

/**
 * One-time volume bonuses for influencer-class partners — a fixed cost,
 * not a recurring % — so pushing for volume doesn't compound your payout
 * liability the way an uncapped recurring rate would.
 */
export const INFLUENCER_VOLUME_BONUSES_NGN: { minPayingReferrals: number; windowDays: number; bonusNgn: number }[] = [
  { minPayingReferrals: 10, windowDays: 30, bonusNgn: 25000 },
  { minPayingReferrals: 25, windowDays: 30, bonusNgn: 75000 },
  { minPayingReferrals: 50, windowDays: 30, bonusNgn: 175000 },
];

/** Minimum accumulated payable commission before a payout run will transfer it. Keeps transfer fees sane. */
export const MIN_PAYOUT_NGN = 10000;

/**
 * Days a commission sits in 'pending' before becoming 'payable'. If the
 * referred user refunds/chargebacks within this window, the commission is
 * clawed back instead of paid — protects against refund-farming schemes
 * where someone refers themselves, buys, refunds, keeps the commission.
 */
export const COMMISSION_HOLD_DAYS = 14;

/** Attribution model: which click wins when a user clicked multiple referral links before signing up. */
export const ATTRIBUTION_MODEL: 'first-touch' | 'last-touch' = 'last-touch';

/** How long a click stays eligible to attribute a later signup. */
export const ATTRIBUTION_WINDOW_DAYS = 30;

/**
 * Application requirements for the gated classes — enforced in
 * lib/referral-engine.ts `applyForClass()`, not just documentation.
 */
export const CLASS_REQUIREMENTS: Record<Exclude<ReferralClass, 'user'>, { minFollowers?: number; requiresManualApproval: boolean }> = {
  dev:        { requiresManualApproval: true },                     // portfolio/GitHub review, no follower minimum
  influencer: { minFollowers: 5000, requiresManualApproval: true }, // exclusivity is the point
};

export function getCommissionPct(cls: ReferralClass, monthNumber: number): number {
  if (cls === 'user') return 0; // user class never gets cash commission, only the token bonus
  const table = COMMISSION_DECAY_TABLE[cls];
  if (monthNumber < 1 || monthNumber > table.length) return 0;
  return table[monthNumber - 1];
}
