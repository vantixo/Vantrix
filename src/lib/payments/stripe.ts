/**
 * Stripe client initialisation.
 *
 * ENV-1 fix: uses env.STRIPE_SECRET_KEY (Zod-validated at startup) instead of
 * process.env.STRIPE_SECRET_KEY! (non-null assertion that bypasses validation).
 * A missing key now produces a clear startup error rather than a cryptic runtime
 * failure on the first payment request.
 *
 * API version pinned to "2024-04-10" — the version supported by the
 * installed Stripe SDK's TypeScript types (stripe@^15).
 */
import Stripe from "stripe";
import { env } from "@/env";
import { PREMIUM_TRIAL_DAYS } from "@/lib/tiers/limits";

export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-04-10",
  typescript: true,
});

export async function createStripeCheckoutSession({
  priceUsd,
  userId,
  tier,
  billingInterval = 'monthly',
  successUrl,
  cancelUrl,
  refereeDiscountPct = 0,
}: {
  priceUsd: number;
  userId: string;
  tier: string;
  billingInterval?: 'monthly' | 'quarterly' | 'annual';
  successUrl: string;
  cancelUrl: string;
  /**
   * REFERRAL-DISCOUNT-FIX: was defined in referral-config.ts
   * (REFEREE_FIRST_MONTH_DISCOUNT_PCT) but never actually applied at
   * checkout. Caller (checkout/route.ts) resolves this via
   * getRefereeDiscountPct() before calling in. A one-time Stripe coupon
   * (duration: 'once') is created so the discount hits only the first
   * invoice of the subscription, never recurring ones.
   */
  refereeDiscountPct?: number;
}) {
  // BILLING-FIX: this used to hardcode `recurring: { interval: 'month' }`
  // unconditionally — an annual tier row (base_tier_slug='premium',
  // billing_interval='annual', price_usd=~47.90) would create a Stripe
  // subscription that charged the FULL ANNUAL PRICE every single month,
  // since recurring.interval never reflected what was actually purchased.
  // billingInterval now drives Stripe's own interval so an annual purchase
  // is billed once a year, matching the price actually charged.
  // Stripe has no native "quarterly" interval — a 3-month cadence is
  // expressed as interval: 'month', interval_count: 3 (Stripe API supports
  // interval_count up to 3 for 'month'). Monthly stays interval_count: 1
  // (the default omitted below); annual maps straight to 'year'.
  const stripeInterval: 'month' | 'year' =
    billingInterval === 'annual' ? 'year' : 'month';
  const stripeIntervalCount = billingInterval === 'quarterly' ? 3 : 1;

  // Referral discount only ever applies to the FIRST invoice — a
  // duration:'once' coupon does exactly that on a subscription, then
  // stops applying automatically from the second invoice on. Created
  // fresh per checkout rather than reused, since percent_off is baked
  // into the coupon itself and callers can pass any pct.
  let discountCouponId: string | undefined;
  if (refereeDiscountPct > 0) {
    const coupon = await stripe.coupons.create({
      percent_off: Math.round(refereeDiscountPct * 100 * 100) / 100, // e.g. 0.10 -> 10
      duration: 'once',
      name: `Referral first-month discount (${tier})`,
      metadata: { userId, tier, reason: 'referee_first_month' },
    });
    discountCouponId = coupon.id;
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: `Vantrix ${tier} Subscription${billingInterval === 'annual' ? ' (Annual)' : billingInterval === 'quarterly' ? ' (3 Months)' : ''}` },
          // Math.round() guards against float drift — e.g. 19.99 * 100 in JS
          // is 1998.9999999999998, not 1999. Stripe requires unit_amount to
          // be an integer number of cents; a raw non-integer float either
          // gets rejected outright by the API or silently truncated down by
          // a cent depending on SDK version, which is exactly the kind of
          // per-transaction undercharge that's easy to miss until reconciled
          // against Stripe's own ledger.
          unit_amount: Math.round(priceUsd * 100),
          recurring: { interval: stripeInterval, interval_count: stripeIntervalCount },
        },
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { userId, tier, billingInterval, referralDiscountApplied: String(!!discountCouponId) },
    subscription_data: { metadata: { userId, tier, billingInterval } },
    ...(discountCouponId ? { discounts: [{ coupon: discountCouponId }] } : {}),
  });

  return session;
}

/**
 * Create a Stripe Checkout session for a one-time token pack purchase.
 *
 * Deliberately `mode: "payment"` (not "subscription") — token packs are a
 * single à la carte charge, credited once via the webhook's
 * checkout.session.completed handler (see stripe/webhook/route.ts, which
 * branches on metadata.type === 'token_pack' before falling through to the
 * subscription activation path).
 */
export async function createTokenPackCheckoutSession({
  packId,
  priceUsd,
  tokens,
  label,
  userId,
  successUrl,
  cancelUrl,
}: {
  packId: string;
  priceUsd: number;
  tokens: number;
  label: string;
  userId: string;
  successUrl: string;
  cancelUrl: string;
}) {
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: `Vantrix ${label} (${tokens.toLocaleString()} tokens)` },
          unit_amount: Math.round(priceUsd * 100),
        },
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { type: "token_pack", userId, packId, tokens: String(tokens) },
  });

  return session;
}

/**
 * Create a Stripe Checkout session for the PREMIUM_TRIAL_DAYS-day Premium free trial.
 *
 * Key decisions:
 *   - payment_method_collection: 'always' — card is collected up-front even
 *     though nothing is charged today. This is the single highest-conversion
 *     configuration (vs. 'if_required') because the user has already
 *     committed by the time the trial ends.
 *   - trial_period_days: PREMIUM_TRIAL_DAYS (3) — short trial for a $9.99/mo
 *     monthly subscription.
 *   - metadata.is_trial: 'true' — webhook uses this flag to call
 *     activate_trial() instead of activateSubscription().
 *   - After trial end Stripe automatically converts to the paid plan and fires
 *     invoice.payment_succeeded — the existing activateSubscription handler
 *     picks this up with no extra code needed.
 */
export async function createFreeTrialSession({
  userId,
  successUrl,
  cancelUrl,
}: {
  userId:     string;
  successUrl: string;
  cancelUrl:  string;
}) {
  const session = await stripe.checkout.sessions.create({
    mode:                       'subscription',
    payment_method_types:       ['card'],
    payment_method_collection:  'always',   // capture card even for $0 trial
    line_items: [
      {
        price_data: {
          currency:     'usd',
          product_data: { name: `Vantrix Premium — ${PREMIUM_TRIAL_DAYS}-day Free Trial` },
          unit_amount:  999,                 // $9.99 billed after trial — must match BASE_MONTHLY_PRICE in @/lib/tiers/config
          recurring:    { interval: 'month' },
        },
        quantity: 1,
      },
    ],
    subscription_data: {
      trial_period_days: PREMIUM_TRIAL_DAYS,
      metadata:          { userId, tier: 'premium', is_trial: 'true' },
      // trial_settings lets Stripe send an automatic reminder email 3 days before
      // trial ends — removes the need for a custom cron nudge.
      trial_settings: {
        end_behavior: { missing_payment_method: 'cancel' },
      },
    },
    success_url: successUrl,
    cancel_url:  cancelUrl,
    metadata:    { userId, tier: 'premium', is_trial: 'true' },
  });

  return session;
}

/**
 * Create a Stripe Billing Portal session.
 *
 * CRITICAL: Must be called server-side only. The returned URL is a
 * short-lived Stripe-hosted session — redirect the user to it immediately.
 *
 * @param stripeCustomerId  The customer's stripe_customer_id from profiles table
 * @param returnUrl         URL to redirect back to after portal actions
 */
export async function createBillingPortalSession(
  stripeCustomerId: string,
  returnUrl: string,
): Promise<{ url: string }> {
  const session = await stripe.billingPortal.sessions.create({
    customer:   stripeCustomerId,
    return_url: returnUrl,
  });
  return { url: session.url };
}
