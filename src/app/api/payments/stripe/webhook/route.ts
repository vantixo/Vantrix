/**
 * POST /api/payments/stripe/webhook
 *
 * Handles Stripe payment lifecycle events.
 *
 * Handlers:
 *   checkout.session.completed       — initial subscription purchase OR free trial start
 *   invoice.payment_succeeded        — monthly renewal (BUG-E fix from prior audit);
 *                                      also fires when a trial converts to paid
 *   customer.subscription.deleted    — explicit cancellation / payment failure;
 *                                      immediately downgrades tier rather than waiting
 *                                      for the nightly expire_subscriptions() cron.
 *   customer.subscription.trial_will_end — fires 3 days before trial ends;
 *                                          logs the event so the nudge cron can
 *                                          send a retention email.
 *
 * CRIT-6 fix: All successful payment handlers now credit subscription tokens via
 *   credit_subscription_tokens(). Previously profiles.tier was updated but tokens
 *   were never credited — gift-shop balance stayed at 0 for all paying users.
 *
 * Free Trial flow:
 *   • checkout.session.completed with metadata.is_trial = 'true'
 *     → calls activate_trial() RPC (sets tier = 'premium', trial_ends_at = +3d)
 *   • invoice.payment_succeeded after trial ends
 *     → same activateSubscription() path as a normal purchase (no extra code)
 *   • customer.subscription.deleted while trial_ends_at is in the future
 *     → downgrades to free (trial cancelled before it expired)
 */
import { NextRequest, NextResponse } from 'next/server';
import { stripe }        from '@/lib/payments/stripe';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger, bg }    from '@/lib/logger';
import { tokensForTier } from '@/lib/payments/subscription-tokens';
import { emitNotification } from '@/lib/notifications/emit';
import { recordCommissionForPayment, clawBackCommission, markRefereeDiscountUsed } from '@/lib/referral-engine';
import { USD_TO_NGN_APPROX } from '@/lib/referral-config';
import { captureEvent } from '@/lib/analytics/server';
import { flagForRevocation } from '@/lib/payments/revocation';
import { claimWebhookEvent, releaseWebhookEvent } from '@/lib/payments/webhook-claim';
import Stripe            from 'stripe';

import { env } from '@/env';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';
const webhookSecret = env.STRIPE_WEBHOOK_SECRET;

// TIER-RENAME FIX: the actual tier string in these webhook events comes
// from the live `tiers` DB table's base_tier_slug column (set at checkout
// time, round-tripped through Stripe/Paystack/NOWPayments metadata) — NOT
// a hardcoded literal in this file. The 20260937 backfill migration has
// shipped and been verified live — base_tier_slug now only ever holds
// 'free'/'premium' — so the transitional 'spark' acceptance that used to
// live in this set has been removed.
const VALID_TIERS = new Set(['premium']);

function normaliseTierSlug(raw: string | undefined): string {
  if (!raw) return 'premium';
  return VALID_TIERS.has(raw) ? raw : 'premium';
}

/** Days to add to expires_at per billing interval. Mirrors paystack/verify/route.ts's
 * EXPIRY_DAYS — annual subscribers must not be downgraded after 30 days. */
const EXPIRY_DAYS: Record<'monthly' | 'quarterly' | 'annual', number> = { monthly: 30, quarterly: 90, annual: 365 };
const TOKEN_MONTHS: Record<'monthly' | 'quarterly' | 'annual', number> = { monthly: 1, quarterly: 3, annual: 12 };

/**
 * Referral commission is month-indexed (decays to 0 after month 3). We
 * don't have a dedicated payment-ledger table, so month number is derived
 * from how many commission rows already exist for this user's referral
 * conversion — recordCommissionForPayment is idempotent per
 * source_payment_id, so this only advances once per genuinely new payment.
 * Users with no referral attribution never hit this (no conversion row).
 */
async function nextReferralMonthNumber(userId: string): Promise<number> {
  const { data: conversion } = await supabaseAdmin
    .from('referral_conversions')
    .select('id')
    .eq('referred_user_id', userId)
    .maybeSingle();
  if (!conversion) return 1;

  const { count } = await supabaseAdmin
    .from('referral_commissions')
    .select('id', { count: 'exact', head: true })
    .eq('conversion_id', conversion.id);

  return (count ?? 0) + 1;
}

/** Credit tokens + update tier atomically after a confirmed payment. */
async function activateSubscription(params: {
  userId:           string;
  tier:             string;
  provider:         string;
  amount:           number;
  currency:         string;
  eventId:          string;
  billingInterval?: 'monthly' | 'quarterly' | 'annual';
  stripeCustomerId?: string;
  stripeSubId?:      string;
  /** Stable Stripe id (payment_intent or invoice id) — used as the referral
   *  commission's source_payment_id so a later charge.refunded/dispute event
   *  (which only carries payment_intent/invoice, never the original webhook
   *  event id) can look the commission back up to claw it back. Falls back
   *  to eventId if not provided (e.g. trial activation, no charge yet). */
  referralPaymentRef?: string;
  /** True when called from invoice.payment_succeeded (recurring renewal)
   *  rather than checkout.session.completed (first paid charge) — purely
   *  for analytics segmentation, doesn't affect the DB writes below. */
  isRenewal?: boolean;
}): Promise<void> {
  const { userId, tier, provider, amount, currency, eventId, stripeCustomerId, stripeSubId, referralPaymentRef, isRenewal } = params;
  const billingInterval = params.billingInterval ?? 'monthly';
  const safeTier = normaliseTierSlug(tier);
  // BILLING-FIX: an annual Stripe subscription pays for 12 months up front
  // in a single invoice.payment_succeeded event — crediting only the
  // monthly token amount and setting expires_at 30 days out (as this used
  // to do unconditionally) meant annual subscribers got 1/12th the tokens
  // they paid for and were silently downgraded to free a month after
  // paying for a full year, since Stripe won't fire another invoice event
  // for 11 more months. Mirrors activatePaystackSubscription's fix.
  const tokenCredit = tokensForTier(safeTier) * TOKEN_MONTHS[billingInterval];
  const expiryDays  = EXPIRY_DAYS[billingInterval];

  // Business logic runs after the event has already been atomically
  // claimed in processed_webhooks (see POST()). If any of these fail, the
  // thrown error propagates to the outer catch, which deletes the claim
  // row so a legitimate Stripe retry re-enters and reprocesses the event.
  const [subResult, profileResult, tokenResult] = await Promise.all([
    // Update subscription record
    supabaseAdmin.from('subscriptions').upsert({
      user_id:    userId,
      tier:       safeTier,
      provider,
      status:     'active',
      amount,
      currency,
      billing_interval: billingInterval,
      expires_at: new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString(),
    }, { onConflict: 'user_id,provider' }),

    // Activate tier on profile. stripeCustomerId/stripeSubId are only ever
    // present for the Stripe provider — undefined fields are omitted below
    // so this never clobbers an existing value with null on a renewal event
    // that happens not to carry them (it always should, but defensively).
    supabaseAdmin.from('profiles').update({
      tier: safeTier,
      ...(stripeCustomerId ? { stripe_customer_id: stripeCustomerId } : {}),
      ...(stripeSubId      ? { stripe_sub_id:      stripeSubId      } : {}),
    }).eq('id', userId),

    // CRIT-6: Credit subscription tokens — atomic increment via DB function
    ...(tokenCredit > 0
      ? [supabaseAdmin.rpc('credit_subscription_tokens', {
          p_user_id: userId,
          p_amount:  tokenCredit,
        })]
      : [Promise.resolve({ error: null })]
    ),
  ]);

  // Supabase-js never throws on a failed write — it resolves with
  // { data, error }. Without checking .error here, a failed DB write looks
  // identical to a success: the event gets marked processed below, the
  // provider stops retrying, and the subscription/tokens are silently lost.
  if (subResult.error)     throw new Error(`subscriptions upsert failed: ${subResult.error.message}`);
  if (profileResult.error) throw new Error(`profiles update failed: ${profileResult.error.message}`);
  if (tokenResult.error)   throw new Error(`credit_subscription_tokens failed: ${tokenResult.error.message}`);

  // The event was already claimed atomically in processed_webhooks at the
  // top of POST(), before any business logic ran (see the idempotency
  // guard there) — no additional insert is needed here. If any of the
  // writes above had failed, the throw would propagate to the outer catch,
  // which deletes the claim so a retry can reprocess this event.
  logger.info('Subscription activated', { userId, tier: safeTier, provider, tokenCredit, eventId });

  if (isRenewal) {
    emitNotification({
      userId,
      type: 'subscription_renewal',
      title: 'Subscription renewed',
      body: `Your ${safeTier} subscription renewed successfully.`,
      ctaUrl: '/premium',
      urgency: 'low',
      metadata: { tier: safeTier, provider, amount, tokenCredit },
    }).catch(bg('emitNotification.subscriptionRenewal'));
  }

  // Analytics — fire-and-forget-safe (captureEvent never throws), and kept
  // outside the referral try/catch below so a referral-recording failure
  // (which is expected to happen occasionally and is already handled) never
  // suppresses the revenue event.
  captureEvent(userId, 'subscription_activated', {
    tier: safeTier,
    provider: provider as 'stripe' | 'paystack',
    billing_interval: billingInterval,
    amount,
    currency,
    is_trial: false, // trial starts go through activate_trial(), not this function — see checkout.session.completed handler
    is_renewal: !!isRenewal,
  });

  // Referral commission — fire-and-forget-safe: idempotent on eventId, and a
  // failure here must never roll back or retry a successful subscription
  // activation, so it's isolated in its own try/catch.
  try {
    const monthNumber = await nextReferralMonthNumber(userId);
    const paymentAmountNgn = currency.toUpperCase() === 'NGN' ? amount : amount * USD_TO_NGN_APPROX;
    const result = await recordCommissionForPayment(supabaseAdmin, {
      payerId: userId,
      sourcePaymentId: referralPaymentRef ?? eventId,
      paymentAmountNgn,
      monthNumber,
    });
    if (result.status === 'commission_recorded' || result.status === 'token_bonus') {
      logger.info('Referral commission recorded', { userId, provider, monthNumber, status: result.status });
    }
    // REFERRAL-DISCOUNT-FIX: burn the one-time referee discount only once
    // the first paid month's payment has actually cleared (not at
    // checkout-session-creation time, so an abandoned checkout doesn't
    // waste it). Safe as a no-op for users who were never referred or
    // already used it — markRefereeDiscountUsed() just sets a flag.
    if (monthNumber === 1) {
      await markRefereeDiscountUsed(supabaseAdmin, userId);
    }
  } catch (referralErr: unknown) {
    logger.error('Referral commission recording failed (non-fatal)', {
      userId, eventId, error: referralErr instanceof Error ? referralErr.message : String(referralErr),
    });
  }
}

export async function POST(req: NextRequest) {
  const payload   = await req.text();
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Signature verification failed';
    logger.error('Stripe webhook signature error', { message });
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Idempotency guard — atomic claim, not select-then-insert. See
  // src/lib/payments/webhook-claim.ts for the full rationale.
  const claim = await claimWebhookEvent(event.id, 'stripe');
  if (claim.error) {
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
  if (!claim.claimed) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    // ── Initial checkout — normal purchase OR free trial start ────────────────
    if (event.type === 'checkout.session.completed') {
      const session  = event.data.object as Stripe.Checkout.Session;
      const userId   = session.metadata?.userId;
      const tier     = session.metadata?.tier;
      const isTrial  = session.metadata?.is_trial === 'true';

      // ── Token pack purchase (one-time payment, mode: "payment") ──────────
      // Distinguished from a subscription checkout by metadata.type, set in
      // createTokenPackCheckoutSession(). No `tier`/subscription id on these
      // sessions, so this must be handled before the tier branch below.
      if (session.metadata?.type === 'token_pack' && userId) {
        const tokens = parseInt(session.metadata?.tokens ?? '0', 10);
        if (tokens > 0) {
          // Check .error explicitly (supabase-js never throws on a failed
          // write). The event is already claimed in processed_webhooks
          // (see POST()); if this RPC fails, the throw propagates to the
          // outer catch, which releases the claim so a retry can re-credit.
          const { error: creditErr } = await supabaseAdmin.rpc('credit_subscription_tokens', {
            p_user_id: userId,
            p_amount:  tokens,
          });
          if (creditErr) throw new Error(`credit_subscription_tokens failed: ${creditErr.message}`);
        }

        logger.info('Token pack credited', {
          userId,
          packId: session.metadata?.packId,
          tokens,
          amount: session.amount_total ? session.amount_total / 100 : 0,
        });

        emitNotification({
          userId,
          type: 'token_purchase',
          title: 'Tokens purchased',
          body: `${tokens.toLocaleString()} tokens have been added to your balance.`,
          ctaUrl: '/premium',
          urgency: 'low',
          metadata: { tokens, packId: session.metadata?.packId },
        }).catch(bg('emitNotification.tokenPurchase'));

        return NextResponse.json({ received: true });
      }

      if (userId && tier) {
        if (isTrial) {
          // ── Trial start — activate via DB function (atomic) ──────────────
          // amount_total is 0 for trials; no token credit on trial activation
          // (tokens are credited when the trial converts to a paid invoice).
          const stripeCustomerId =
            typeof session.customer === 'string' ? session.customer : undefined;
          const stripeSubId =
            typeof session.subscription === 'string' ? session.subscription : undefined;

          await supabaseAdmin.rpc('activate_trial', {
            p_user_id:            userId,
            p_stripe_customer_id: stripeCustomerId,
            p_stripe_sub_id:      stripeSubId,
          });

          logger.info('Free trial activated', {
            userId,
            stripeCustomerId,
            trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          });
        } else {
          // ── Normal paid checkout ────────────────────────────────────────
          const stripeCustomerId =
            typeof session.customer === 'string' ? session.customer : undefined;
          const stripeSubId =
            typeof session.subscription === 'string' ? session.subscription : undefined;

          const paymentIntentId =
            typeof session.payment_intent === 'string' ? session.payment_intent : undefined;

          await activateSubscription({
            userId, tier,
            provider: 'stripe',
            amount:   session.amount_total ? session.amount_total / 100 : 0,
            currency: 'USD',
            eventId:  event.id,
            billingInterval: (['quarterly', 'annual'].includes(session.metadata?.billingInterval ?? '') ? session.metadata?.billingInterval : 'monthly') as 'monthly' | 'quarterly' | 'annual',
            stripeCustomerId,
            stripeSubId,
            referralPaymentRef: paymentIntentId,
          });
        }
      }
    }

    // ── Trial ending in 3 days — log for nudge cron ───────────────────────────
    // Stripe fires this automatically when trial_settings.end_behavior is set.
    // We don't send email here; the nudge cron reads profiles WHERE
    //   trial_ends_at BETWEEN NOW() AND NOW() + 3 days AND tier = 'premium'.
    if (event.type === 'customer.subscription.trial_will_end') {
      const sub    = event.data.object as Stripe.Subscription;
      const userId = sub.metadata?.userId;
      if (userId) {
        logger.info('Trial ending soon — nudge queued', {
          userId,
          trialEnd: new Date((sub.trial_end ?? 0) * 1000).toISOString(),
        });
      }
    }

    // ── Monthly renewal ───────────────────────────────────────────────────────
    // BUG-E fix (prior audit): checkout.session.completed only fires on initial
    // checkout. Renewals fire invoice.payment_succeeded — without this handler,
    // expires_at is never refreshed and the nightly cron eventually downgrades.
    if (event.type === 'invoice.payment_succeeded') {
      const invoice      = event.data.object as Stripe.Invoice;
      const subscription = invoice.subscription
        ? await stripe.subscriptions.retrieve(invoice.subscription as string)
        : null;

      const userId = subscription?.metadata?.userId ?? invoice.subscription_details?.metadata?.userId;
      const tier   = subscription?.metadata?.tier   ?? invoice.subscription_details?.metadata?.tier;
      const billingIntervalRaw =
        subscription?.metadata?.billingInterval ?? invoice.subscription_details?.metadata?.billingInterval;

      if (userId && tier) {
        const stripeCustomerId =
          typeof subscription?.customer === 'string' ? subscription.customer : undefined;
        const stripeSubId = subscription?.id;

        await activateSubscription({
          userId, tier,
          provider: 'stripe',
          amount:   invoice.amount_paid ? invoice.amount_paid / 100 : 0,
          currency: 'USD',
          eventId:  event.id,
          billingInterval: (['quarterly', 'annual'].includes(billingIntervalRaw ?? '') ? billingIntervalRaw : 'monthly') as 'monthly' | 'quarterly' | 'annual',
          stripeCustomerId,
          stripeSubId,
          referralPaymentRef: invoice.id,
          isRenewal: true,
        });
      }
    }

    // ── Cancellation / payment failure ────────────────────────────────────────
    // customer.subscription.deleted fires when:
    //   - User explicitly cancels their subscription in Stripe portal
    //   - Stripe exhausts retries on a failed payment (dunning)
    // The nightly expire_subscriptions() cron handles passive expiry; this
    // handler covers immediate/explicit cancellation so the tier reverts now.
    if (event.type === 'customer.subscription.deleted') {
      const sub    = event.data.object as Stripe.Subscription;
      const userId = sub.metadata?.userId;

      if (userId) {
        // NOTE: the event is already atomically claimed in
        // processed_webhooks before this handler runs (see the idempotency
        // guard in POST()), so a per-block re-check here is unnecessary —
        // and would now be actively wrong, since the claim row already
        // exists by the time we reach this code and would make this block
        // always report "duplicate". If this cancellation logic throws
        // partway through, the outer catch releases the claim so a real
        // Stripe retry can safely re-enter and finish the job.
        await supabaseAdmin.from('subscriptions')
          .update({ status: 'cancelled' })
          .eq('user_id', userId)
          .eq('provider', 'stripe');

        // Only downgrade if no other active subscription covers this user
        const { data: otherActive } = await supabaseAdmin
          .from('subscriptions')
          .select('id')
          .eq('user_id', userId)
          .eq('status', 'active')
          .gt('expires_at', new Date().toISOString())
          .limit(1);

        if (!otherActive?.length) {
          await supabaseAdmin.from('profiles').update({ tier: 'free' }).eq('id', userId);
          logger.info('Subscription cancelled — tier downgraded to free', { userId });
        }
      }
    }

    // ── Refund / chargeback — claw back commission + flag the payer's tier ───
    // Stripe fires charge.refunded for both full/partial refunds and
    // charge.dispute.created for chargebacks.
    //
    // UPDATED DECISION (see AUDIT_FINDINGS_LOG.md #1 and revocation.ts):
    // the prior "manual admin review only" policy left disputed/refunded
    // users with paid access indefinitely. Now, in addition to the
    // referral-commission clawback below, the paying user's own tier is
    // flagged via flagForRevocation() — which starts a grace period rather
    // than downgrading immediately, so a legitimate dispute that resolves
    // in the user's favor (or an admin clearing the flag) never costs them
    // access. See revocation-sweep cron for the actual downgrade.
    if (event.type === 'charge.refunded' || event.type === 'charge.dispute.created') {
      const charge = event.data.object as Stripe.Charge;
      const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : undefined;

      // Commissions are recorded with the Stripe *event* id (checkout.session.completed
      // or invoice.payment_succeeded) as source_payment_id, not the charge id — a refund
      // doesn't tell us that event id directly, so fall back to invoice lookup.
      const invoiceId = typeof charge.invoice === 'string' ? charge.invoice : undefined;
      const candidateIds = [paymentIntentId, invoiceId].filter((v): v is string => !!v);

      for (const id of candidateIds) {
        try {
          const { reversed } = await clawBackCommission(supabaseAdmin, id);
          if (reversed) logger.info('Referral commission clawed back', { eventType: event.type, sourcePaymentId: id });
        } catch (clawErr: unknown) {
          logger.error('Referral clawback failed (non-fatal)', {
            sourcePaymentId: id, error: clawErr instanceof Error ? clawErr.message : String(clawErr),
          });
        }
      }

      // Resolve which user this charge belongs to: metadata first (present
      // on the original checkout-driven charge), falling back to the
      // stored Stripe customer id (covers subscription-driven renewal
      // charges, which don't carry our metadata).
      try {
        let userId: string | undefined = charge.metadata?.userId;
        const stripeCustomerId = typeof charge.customer === 'string' ? charge.customer : undefined;
        if (!userId && stripeCustomerId) {
          const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('stripe_customer_id', stripeCustomerId)
            .maybeSingle();
          userId = profile?.id ?? undefined;
        }

        if (userId) {
          const sourcePaymentId = paymentIntentId ?? invoiceId ?? charge.id;
          await flagForRevocation(supabaseAdmin, {
            userId,
            provider: 'stripe',
            sourcePaymentId,
            eventType: event.type,
            reason: event.type === 'charge.dispute.created' ? 'dispute' : 'refund',
          });
        } else {
          logger.error('Revocation flag skipped — could not resolve userId for charge', {
            eventType: event.type, chargeId: charge.id,
          });
        }
      } catch (flagErr: unknown) {
        logger.error('flagForRevocation failed (non-fatal)', {
          eventType: event.type, chargeId: charge.id,
          error: flagErr instanceof Error ? flagErr.message : String(flagErr),
        });
      }
    }

  } catch (err: unknown) {
    logger.error('Stripe webhook processing error', {
      error: err instanceof Error ? err.message : String(err),
      eventType: event.type,
    });
    // Release the claim so a legitimate Stripe retry can re-process this
    // event instead of being silently swallowed as a "duplicate" of a
    // delivery that never actually completed.
    await releaseWebhookEvent(event.id);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
