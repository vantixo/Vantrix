/**
 * POST /api/payments/paddle/webhook
 *
 * Handles Paddle Billing lifecycle events. Mirrors the Stripe webhook
 * handler's structure and, specifically, its idempotency guard — uses the
 * shared claimWebhookEvent()/releaseWebhookEvent() atomic claim (see
 * lib/payments/webhook-claim.ts) rather than a select-then-insert check,
 * for the same race-condition reason documented there: two concurrent
 * deliveries of the same event must not both pass a duplicate check before
 * either has recorded it.
 *
 * Handlers:
 *   transaction.completed  — fires for EVERY successful payment: initial
 *                             subscription checkout, every subsequent
 *                             renewal, AND one-time token-pack purchases
 *                             (see checkout-tokens/route.ts). This is
 *                             Paddle's equivalent of Stripe's
 *                             checkout.session.completed +
 *                             invoice.payment_succeeded combined — there
 *                             is no separate "first payment" event to
 *                             branch on, so isRenewal is inferred from the
 *                             transaction's `origin` field instead (see
 *                             comment at the handler below). Token-pack
 *                             transactions are distinguished up front by
 *                             custom_data.type === 'token_pack' (mirrors
 *                             the Stripe webhook's identical
 *                             session.metadata?.type check) and credited
 *                             directly — they have no tier/subscription to
 *                             resolve, so this branch runs before, and
 *                             returns ahead of, the subscription logic
 *                             below.
 *   subscription.canceled  — explicit cancellation (self-serve via
 *                             management_urls.cancel, dashboard, or
 *                             Paddle's own dunning exhaustion — Paddle
 *                             auto-cancels after repeated failed renewal
 *                             attempts, configurable in the Paddle
 *                             dashboard). Downgrades the tier immediately,
 *                             same rationale as Stripe's
 *                             customer.subscription.deleted handler.
 *   transaction.payment_failed / subscription.past_due — logged only.
 *                             Unlike Paystack, Paddle retries failed
 *                             renewal charges automatically over several
 *                             days (dunning) — no cron safety net needed.
 *   adjustment.created      — refund/chargeback. Claws back referral
 *                             commission and flags the payer's tier for
 *                             revocation, same as Stripe's
 *                             charge.refunded/charge.dispute.created.
 *
 * NOT implemented on this rail (flagged rather than silently skipped):
 * the one-time referee discount (markRefereeDiscountUsed) applied on
 * Stripe/Paystack checkout has no Paddle equivalent yet — see
 * app/api/payments/paddle/checkout/route.ts's comment. A referred user
 * checking out via Paddle pays full price for now.
 *
 * FIELD-SHAPE CAVEAT: the exact nested shape of `data.items[]`,
 * `data.details.totals`, and `data.origin` on Paddle's transaction webhook
 * payload is written from Paddle's public API reference and third-party
 * integration examples, not a live payload captured from this specific
 * Paddle account. Verify against a real sandbox webhook delivery (Paddle
 * Dashboard -> Developer Tools -> Notifications -> a delivered event's
 * raw payload) before relying on this in production.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  verifyPaddleWebhookSignature,
  getPaddleSubscription,
} from '@/lib/payments/paddle';
import { tierForPriceId } from '@/lib/payments/paddle-plans';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger, bg }    from '@/lib/logger';
import { tokensForTier } from '@/lib/payments/subscription-tokens';
import { emitNotification } from '@/lib/notifications/emit';
import { recordCommissionForPayment, clawBackCommission } from '@/lib/referral-engine';
import { USD_TO_NGN_APPROX } from '@/lib/referral-config';
import { captureEvent } from '@/lib/analytics/server';
import { flagForRevocation } from '@/lib/payments/revocation';
import { claimWebhookEvent, releaseWebhookEvent } from '@/lib/payments/webhook-claim';
import { env } from '@/env';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

const EXPIRY_DAYS: Record<'monthly' | 'quarterly' | 'annual', number> = { monthly: 30, quarterly: 90, annual: 365 };
const TOKEN_MONTHS: Record<'monthly' | 'quarterly' | 'annual', number> = { monthly: 1, quarterly: 3, annual: 12 };

// ── Payload types (partial — only fields this handler reads) ──────────────
interface PaddleWebhookEvent {
  event_id: string;
  event_type: string;
  occurred_at: string;
  data: {
    id: string; // txn_xxx / sub_xxx / adj_xxx depending on event
    status?: string;
    customer_id?: string | null;
    subscription_id?: string | null;
    currency_code?: string;
    origin?: string; // 'web' | 'subscription_recurring' | 'subscription_charge' | 'api' | ...
    custom_data?: Record<string, string> | null;
    items?: Array<{ price?: { id?: string } }>;
    details?: { totals?: { grand_total?: string } };
    // adjustment.created shape
    action?: string; // 'refund' | 'credit' | 'chargeback' | ...
    transaction_id?: string;
  };
}

/** Mirrors the Stripe webhook's identical helper — see that file for the
 *  full rationale (referral commission decays after month 3, month number
 *  derived from existing commission-row count, idempotent per
 *  source_payment_id). */
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

/**
 * Resolves the Vantrix user id for a webhook payload. custom_data (set at
 * checkout — see createPaddleCheckoutTransaction) is tried first since
 * it's guaranteed present on the transaction it was set on; falls back to
 * a paddle_customer_id lookup for events where custom_data may not have
 * round-tripped (primarily renewal transactions — see this file's header
 * and the migration's comment on why customer_id is captured eagerly at
 * checkout time).
 */
async function resolveUserId(data: PaddleWebhookEvent['data']): Promise<string | undefined> {
  if (data.custom_data?.userId) return data.custom_data.userId;
  if (!data.customer_id) return undefined;

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('paddle_customer_id', data.customer_id)
    .maybeSingle();
  return profile?.id;
}

function resolveTierAndInterval(
  data: PaddleWebhookEvent['data'],
): { tier: string; interval: 'monthly' | 'quarterly' | 'annual' } | null {
  if (data.custom_data?.tier) {
    const interval = (['quarterly', 'annual'].includes(data.custom_data.billingInterval ?? '')
      ? data.custom_data.billingInterval
      : 'monthly') as 'monthly' | 'quarterly' | 'annual';
    return { tier: data.custom_data.tier, interval };
  }
  // Fallback: resolve via the price id on the transaction's line items —
  // covers renewal transactions where custom_data may not have survived.
  const priceId = data.items?.[0]?.price?.id;
  return tierForPriceId(priceId);
}

/**
 * Credit tokens + update tier atomically after a confirmed Paddle payment.
 * Mirrors the Stripe webhook's activateSubscription() — see that file for
 * the full write-ordering rationale (business logic runs after the event
 * is already atomically claimed; any failure here throws and propagates to
 * the outer catch, which releases the claim so a legitimate Paddle retry
 * can re-enter and reprocess).
 */
async function activatePaddleSubscription(params: {
  userId: string;
  tier: string;
  billingInterval: 'monthly' | 'quarterly' | 'annual';
  amount: number;
  currency: string;
  eventId: string;
  paddleCustomerId?: string;
  paddleSubId?: string;
  referralPaymentRef?: string;
  isRenewal?: boolean;
}): Promise<void> {
  const { userId, tier, billingInterval, amount, currency, eventId, paddleCustomerId, paddleSubId, referralPaymentRef, isRenewal } = params;
  const tokenCredit = tokensForTier(tier) * TOKEN_MONTHS[billingInterval];
  const expiryDays  = EXPIRY_DAYS[billingInterval];

  const [subResult, profileResult, tokenResult] = await Promise.all([
    supabaseAdmin.from('subscriptions').upsert({
      user_id: userId,
      tier,
      provider: 'paddle',
      status: 'active',
      amount,
      currency,
      billing_interval: billingInterval,
      expires_at: new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString(),
      ...(paddleSubId ? { paddle_subscription_id: paddleSubId } : {}),
    }, { onConflict: 'user_id,provider' }),

    supabaseAdmin.from('profiles').update({
      tier,
      ...(paddleCustomerId ? { paddle_customer_id: paddleCustomerId } : {}),
    }).eq('id', userId),

    ...(tokenCredit > 0
      ? [supabaseAdmin.rpc('credit_subscription_tokens', { p_user_id: userId, p_amount: tokenCredit })]
      : [Promise.resolve({ error: null })]
    ),
  ]);

  if (subResult.error)     throw new Error(`subscriptions upsert failed: ${subResult.error.message}`);
  if (profileResult.error) throw new Error(`profiles update failed: ${profileResult.error.message}`);
  if (tokenResult.error)   throw new Error(`credit_subscription_tokens failed: ${tokenResult.error.message}`);

  // Event was already claimed atomically in processed_webhooks at the top
  // of POST() — no additional insert needed here (same as Stripe's
  // activateSubscription()).
  logger.info('Paddle subscription activated', { userId, tier, tokenCredit, isRenewal: !!isRenewal, eventId });

  if (isRenewal) {
    emitNotification({
      userId,
      type: 'subscription_renewal',
      title: 'Subscription renewed',
      body: `Your ${tier} subscription renewed successfully.`,
      ctaUrl: '/premium',
      urgency: 'low',
      metadata: { tier, provider: 'paddle', amount, tokenCredit },
    }).catch(bg('emitNotification.subscriptionRenewal.paddle'));
  }

  captureEvent(userId, 'subscription_activated', {
    tier,
    provider: 'paddle',
    billing_interval: billingInterval,
    amount,
    currency,
    is_trial: false,
    is_renewal: !!isRenewal,
  });

  // Referral commission — fire-and-forget-safe, isolated so a failure here
  // never rolls back a successful activation. See checkout route's
  // comment on why the referee discount itself isn't applied for Paddle
  // yet (markRefereeDiscountUsed intentionally not called here).
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
      logger.info('Referral commission recorded (paddle)', { userId, monthNumber, status: result.status });
    }
  } catch (referralErr: unknown) {
    logger.error('Referral commission recording failed (non-fatal, paddle)', {
      userId, eventId, error: referralErr instanceof Error ? referralErr.message : String(referralErr),
    });
  }
}

export async function POST(req: NextRequest) {
  const rawBody   = await req.text();
  const signature = req.headers.get('paddle-signature');

  if (!verifyPaddleWebhookSignature(rawBody, signature, env.PADDLE_WEBHOOK_SECRET)) {
    logger.error('Paddle webhook signature verification failed');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let event: PaddleWebhookEvent;
  try {
    event = JSON.parse(rawBody) as PaddleWebhookEvent;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  // Idempotency guard — atomic claim, not select-then-insert. See
  // lib/payments/webhook-claim.ts for the full rationale.
  const claim = await claimWebhookEvent(event.event_id, 'paddle');
  if (claim.error) {
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
  if (!claim.claimed) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  const { data, event_type: eventType } = event;

  try {
    // ── Payment succeeded (initial checkout OR renewal) ─────────────────
    if (eventType === 'transaction.completed') {
      const userId = await resolveUserId(data);

      // ── Token pack purchase (one-time, no subscription) ────────────────
      // Distinguished from a subscription transaction by custom_data.type,
      // set in createPaddleTokenPackCheckoutTransaction(). Must be handled
      // before resolveTierAndInterval() below — a token-pack transaction
      // has no tier/billing-interval to resolve, so falling through to that
      // branch would just fail to match and silently drop the credit.
      if (data.custom_data?.type === 'token_pack') {
        if (!userId) {
          logger.error('Paddle transaction.completed (token_pack): could not resolve userId — releasing claim', {
            transactionId: data.id,
            customerId: data.customer_id,
          });
          await releaseWebhookEvent(event.event_id);
          return NextResponse.json({ received: true, resolved: false });
        }

        const tokens = parseInt(data.custom_data?.tokens ?? '0', 10);
        if (tokens > 0) {
          // Event is already claimed atomically in processed_webhooks (see
          // POST() below); if this RPC fails, the throw propagates to the
          // outer catch, which releases the claim so a legitimate Paddle
          // retry can re-credit.
          const { error: creditErr } = await supabaseAdmin.rpc('credit_subscription_tokens', {
            p_user_id: userId,
            p_amount:  tokens,
          });
          if (creditErr) throw new Error(`credit_subscription_tokens failed: ${creditErr.message}`);
        }

        logger.info('Paddle token pack credited', {
          userId,
          packId: data.custom_data?.packId,
          tokens,
          amount: Number(data.details?.totals?.grand_total ?? '0') / 100,
        });

        emitNotification({
          userId,
          type: 'token_purchase',
          title: 'Tokens purchased',
          body: `${tokens.toLocaleString()} tokens have been added to your balance.`,
          ctaUrl: '/profile/tokens',
          urgency: 'low',
          metadata: { tokens, packId: data.custom_data?.packId, provider: 'paddle' },
        }).catch(bg('emitNotification.tokenPurchase.paddle'));

        return NextResponse.json({ received: true });
      }

      const resolved = resolveTierAndInterval(data);

      if (userId && resolved) {
        // `origin === 'subscription_recurring'` marks a renewal-driven
        // transaction rather than the initial checkout ('web'/'api') —
        // see this file's header FIELD-SHAPE CAVEAT.
        const isRenewal = data.origin === 'subscription_recurring';
        const amount = Number(data.details?.totals?.grand_total ?? '0') / 100;
        const currency = data.currency_code ?? 'USD';

        await activatePaddleSubscription({
          userId,
          tier: resolved.tier,
          billingInterval: resolved.interval,
          amount,
          currency,
          eventId: event.event_id,
          paddleCustomerId: data.customer_id ?? undefined,
          paddleSubId: data.subscription_id ?? undefined,
          referralPaymentRef: data.id,
          isRenewal,
        });
      } else {
        logger.error('Paddle transaction.completed: could not resolve userId/tier — releasing claim', {
          transactionId: data.id,
          hasCustomData: !!data.custom_data,
          customerId: data.customer_id,
        });
        // Release rather than leave "claimed": an unresolvable event
        // should surface in logs/monitoring and be eligible for a manual
        // reprocess, not be silently marked handled forever.
        await releaseWebhookEvent(event.event_id);
        return NextResponse.json({ received: true, resolved: false });
      }
    }

    // ── Explicit cancellation ────────────────────────────────────────────
    if (eventType === 'subscription.canceled') {
      const userId = await resolveUserId(data);
      if (userId) {
        await supabaseAdmin.from('subscriptions')
          .update({ status: 'cancelled' })
          .eq('user_id', userId)
          .eq('provider', 'paddle');

        // Only downgrade if no other active subscription (any provider)
        // covers this user — same guard as the Stripe handler.
        const { data: otherActive } = await supabaseAdmin
          .from('subscriptions')
          .select('id')
          .eq('user_id', userId)
          .eq('status', 'active')
          .gt('expires_at', new Date().toISOString())
          .limit(1);

        if (!otherActive?.length) {
          await supabaseAdmin.from('profiles').update({ tier: 'free' }).eq('id', userId);
          logger.info('Paddle subscription cancelled — tier downgraded to free', { userId });
        }
      }
    }

    // ── Failed renewal / past-due — logged only, Paddle retries natively ─
    if (eventType === 'transaction.payment_failed' || eventType === 'subscription.past_due') {
      const userId = await resolveUserId(data);
      logger.info('Paddle payment issue (Paddle will retry automatically)', { eventType, userId, subscriptionId: data.subscription_id });
    }

    // ── Refund / chargeback — claw back commission + flag for revocation ─
    if (eventType === 'adjustment.created') {
      const userId = await resolveUserId(data);
      const isChargeback = data.action === 'chargeback';
      const isRefund = data.action === 'refund' || data.action === 'credit';

      if (isRefund || isChargeback) {
        const sourcePaymentId = data.transaction_id ?? data.id;
        try {
          const { reversed } = await clawBackCommission(supabaseAdmin, sourcePaymentId);
          if (reversed) logger.info('Referral commission clawed back (paddle)', { sourcePaymentId });
        } catch (clawErr: unknown) {
          logger.error('Referral clawback failed (non-fatal, paddle)', {
            sourcePaymentId, error: clawErr instanceof Error ? clawErr.message : String(clawErr),
          });
        }

        if (userId) {
          try {
            await flagForRevocation(supabaseAdmin, {
              userId,
              provider: 'paddle',
              sourcePaymentId,
              eventType,
              reason: isChargeback ? 'dispute' : 'refund',
            });
          } catch (flagErr: unknown) {
            logger.error('flagForRevocation failed (non-fatal, paddle)', {
              error: flagErr instanceof Error ? flagErr.message : String(flagErr),
            });
          }
        } else {
          logger.error('Paddle revocation flag skipped — could not resolve userId for adjustment', { adjustmentId: data.id });
        }
      }
    }

    // Optionally fetch subscription management_urls / status here for
    // 'subscription.activated' or 'subscription.updated' if a richer
    // subscription-state mirror is ever needed — not required for the
    // activation/cancellation flows above, so left unhandled.
    void getPaddleSubscription; // referenced for future use — see comment above

  } catch (err: unknown) {
    logger.error('Paddle webhook processing error', {
      error: err instanceof Error ? err.message : String(err),
      eventType,
    });
    // Release the claim so a legitimate Paddle retry can re-process this
    // event instead of being silently swallowed as a "duplicate" of a
    // delivery that never actually completed.
    await releaseWebhookEvent(event.event_id);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
