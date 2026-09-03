/**
 * POST /api/payments/nowpayments/webhook
 *
 * Handles NOWPayments IPN (Instant Payment Notification) callbacks.
 *
 * CRIT-6 fix: Token crediting — on confirmed payment, gift-economy tokens are
 *   now credited via credit_subscription_tokens(). Previously profiles.tier
 *   changed but tokens never incremented.
 *
 * CRIT-5 (prior audit): profiles.tier is updated so crypto subscribers are not
 *   stuck on free tier.
 *
 * HIGH-3 (prior audit): upsert avoids duplicate subscription rows on renewal.
 */
import { NextRequest, NextResponse } from 'next/server';
import crypto                        from 'crypto';
import { supabaseAdmin }             from '@/lib/supabase/admin';
import { logger }                    from '@/lib/logger';
import { env }                       from '@/env';
import { tokensForTier }             from '@/lib/payments/subscription-tokens';
import { timingSafeEqual }           from '@/lib/security';
import { recordCommissionForPayment, clawBackCommission } from '@/lib/referral-engine';
import { USD_TO_NGN_APPROX }         from '@/lib/referral-config';
import { flagForRevocation }         from '@/lib/payments/revocation';
import { claimWebhookEvent, releaseWebhookEvent } from '@/lib/payments/webhook-claim';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// TIER-RENAME FIX: order_id's tier segment comes from the live `tiers` DB
// table (base_tier_slug) at checkout time. The 20260937 backfill migration
// has shipped and been verified live — base_tier_slug now only ever holds
// 'free'/'premium' — so the transitional 'spark' acceptance that used to
// live here has been removed.
const VALID_TIERS = new Set(['premium']);

interface NowPaymentsPayload {
  payment_id:     string;
  payment_status: string;
  order_id:       string;
  price_amount:   number;
  [key: string]:  unknown;
}

export async function POST(req: NextRequest) {
  const payload     = await req.text();
  const receivedSig = req.headers.get('x-nowpayments-sig');
  const secret      = env.NOWPAYMENTS_IPN_SECRET;

  if (!receivedSig) {
    logger.error('NOWPayments webhook: missing signature header');
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let body: NowPaymentsPayload;
  try {
    body = JSON.parse(payload) as NowPaymentsPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // NOWPayments signs the sorted JSON body
  const sortedPayload = JSON.stringify(Object.fromEntries(Object.entries(body).sort()));
  const expected      = crypto.createHmac('sha512', secret).update(sortedPayload).digest('hex');

  if (!timingSafeEqual(receivedSig, expected)) {
    logger.error('NOWPayments webhook: signature mismatch');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (body.payment_status === 'finished') {
    const idempotencyKey = `nowpayments-${body.payment_id}`;

    // Atomic claim — see src/lib/payments/webhook-claim.ts. Replaces the
    // old select-then-insert-at-the-end pattern, which let two concurrent
    // IPN deliveries for the same payment both pass the "not yet
    // processed" check and both credit tokens before either finished
    // writing the idempotency row.
    const claim = await claimWebhookEvent(idempotencyKey, 'nowpayments');
    if (claim.error) {
      return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
    }
    if (!claim.claimed) {
      return NextResponse.json({ received: true, duplicate: true });
    }

    // order_id format: `{userId}|{tierSlug}|{timestamp}` for pre-existing
    // orders, or `{userId}|{tierSlug}|{timestamp}|{billingInterval}` after
    // annual billing support was added — the 4th segment is optional so an
    // order created just before this deploy (already sitting in a NOWPayments
    // invoice, not yet paid) still resolves correctly as monthly rather than
    // failing validation on a shape it was never given.
    const parts           = String(body.order_id).split('|');
    const userId          = parts[0];
    const tier            = parts[1];
    const billingInterval = ((['quarterly', 'annual'].includes(parts[3]) ? parts[3] : 'monthly')) as 'monthly' | 'quarterly' | 'annual';

    if (!userId || !UUID_RE.test(userId)) {
      logger.error('NOWPayments webhook: invalid userId in order_id', { order_id: body.order_id });
      await releaseWebhookEvent(idempotencyKey);
      return NextResponse.json({ error: 'Invalid order_id format' }, { status: 400 });
    }

    // ── Token pack purchase (one-off, no tier) ──────────────────────────────
    // order_id: `{userId}|token_pack|{timestamp}|{packId}|{tokens}` — see
    // create-tokens/route.ts. Checked before the VALID_TIERS check below,
    // since 'token_pack' in the tier-slug position would otherwise fail it.
    if (parts[1] === 'token_pack') {
      const packId = parts[3];
      const tokens = parseInt(parts[4] ?? '0', 10);

      try {
        if (tokens > 0) {
          const { error } = await supabaseAdmin.rpc('credit_subscription_tokens', {
            p_user_id: userId,
            p_amount:  tokens,
          });
          if (error) throw new Error(`credit_subscription_tokens failed: ${error.message}`);
        }
        logger.info('NOWPayments token pack credited', { userId, packId, tokens });
      } catch (err: unknown) {
        logger.error('NOWPayments webhook: token_pack processing failed', {
          order_id: body.order_id, error: err instanceof Error ? err.message : String(err),
        });
        await releaseWebhookEvent(idempotencyKey);
        return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
      }

      return NextResponse.json({ received: true });
    }

    if (!parts[1] || !VALID_TIERS.has(parts[1])) {
      logger.error('NOWPayments webhook: invalid tier in order_id', { tier: parts[1] });
      await releaseWebhookEvent(idempotencyKey);
      return NextResponse.json({ error: 'Invalid tier in order_id' }, { status: 400 });
    }

    // Annual subscribers get 12 months of tokens credited up front, and an
    // expires_at 365 days out instead of the default 30 — same fix applied
    // to the Paystack/Stripe paths (see verify/route.ts EXPIRY_DAYS).
    const tokenCredit = tokensForTier(tier) * ({ monthly: 1, quarterly: 3, annual: 12 } as const)[billingInterval];
    const expiryDays  = ({ monthly: 30, quarterly: 90, annual: 365 } as const)[billingInterval];

    // Business logic first; idempotency record written after.
    // This prevents a silent failure where the event is marked processed
    // but the profile/subscription was never actually updated.
    try {
      const [subResult, profileResult, tokenResult] = await Promise.all([
        // HIGH-3: upsert avoids duplicate subscription rows on renewal
        supabaseAdmin.from('subscriptions').upsert({
          user_id:    userId,
          tier,
          provider:   'nowpayments',
          status:     'active',
          amount:     body.price_amount,
          currency:   'USD',
          billing_interval: billingInterval,
          expires_at: new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString(),
        }, { onConflict: 'user_id,provider' }),

        // CRIT-5: activate tier — crypto subscribers no longer stuck on free
        supabaseAdmin.from('profiles').update({ tier }).eq('id', userId),

        // CRIT-6: credit subscription tokens
        ...(tokenCredit > 0
          ? [supabaseAdmin.rpc('credit_subscription_tokens', {
              p_user_id: userId,
              p_amount:  tokenCredit,
            })]
          : [Promise.resolve({ error: null })]
        ),
      ]);

      // Supabase-js never throws on a failed write — it resolves
      // { data, error }. Without checking .error, a failed DB write is
      // indistinguishable from a success: the event gets marked processed
      // below and NOWPayments stops retrying, silently losing the
      // subscription/tokens.
      if (subResult.error)     throw new Error(`subscriptions upsert failed: ${subResult.error.message}`);
      if (profileResult.error) throw new Error(`profiles update failed: ${profileResult.error.message}`);
      if (tokenResult.error)   throw new Error(`credit_subscription_tokens failed: ${tokenResult.error.message}`);

      // The event is already claimed atomically in processed_webhooks
      // (see claimWebhookEvent() above) — no additional insert needed
      // here. If any of the writes above had failed, the throw below
      // propagates to the outer catch, which releases the claim so a
      // retry can reprocess this event.
      logger.info('NowPayments subscription activated', { userId, tier, tokenCredit });

      // Referral commission (crypto settles in USD — convert to NGN same as
      // Stripe). Isolated try/catch: must never affect the already-successful
      // subscription activation above.
      try {
        const { data: conversion } = await supabaseAdmin
          .from('referral_conversions')
          .select('id')
          .eq('referred_user_id', userId)
          .maybeSingle();

        const monthNumber = conversion
          ? ((await supabaseAdmin
              .from('referral_commissions')
              .select('id', { count: 'exact', head: true })
              .eq('conversion_id', conversion.id)).count ?? 0) + 1
          : 1;

        const result = await recordCommissionForPayment(supabaseAdmin, {
          payerId: userId,
          sourcePaymentId: idempotencyKey,
          paymentAmountNgn: body.price_amount * USD_TO_NGN_APPROX,
          monthNumber,
        });
        if (result.status === 'commission_recorded' || result.status === 'token_bonus') {
          logger.info('Referral commission recorded', { userId, provider: 'nowpayments', monthNumber, status: result.status });
        }
      } catch (referralErr: unknown) {
        logger.error('Referral commission recording failed (non-fatal)', {
          userId, idempotencyKey, error: referralErr instanceof Error ? referralErr.message : String(referralErr),
        });
      }
    } catch (err: unknown) {
      logger.error('NOWPayments webhook processing error', {
        error: err instanceof Error ? err.message : String(err),
      });
      await releaseWebhookEvent(idempotencyKey);
      return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
    }
  }

  // ── Refund / expired-then-refunded — claw back commission + flag tier ─────
  // NOWPayments reuses the same IPN endpoint with payment_status values like
  // 'refunded' or 'expired' after a prior 'finished' state (rare, but the API
  // allows partner-initiated refunds). The payment_id-derived idempotency key
  // is exactly the sourcePaymentId recordCommissionForPayment used above.
  //
  // UPDATED DECISION (see AUDIT_FINDINGS_LOG.md #1 and revocation.ts):
  // in addition to the commission clawback, flagForRevocation() starts a
  // grace period on the paying user's own tier — identical policy to the
  // Stripe/Paystack handlers. Crypto has no chargeback mechanism, so
  // 'refunded' is the only reason NOWPayments ever routes through this block.
  if (body.payment_status === 'refunded') {
    const idempotencyKey = `nowpayments-${body.payment_id}`;
    try {
      const { reversed } = await clawBackCommission(supabaseAdmin, idempotencyKey);
      if (reversed) logger.info('Referral commission clawed back', { provider: 'nowpayments', paymentId: body.payment_id });
    } catch (clawErr: unknown) {
      logger.error('Referral clawback failed (non-fatal)', {
        paymentId: body.payment_id, error: clawErr instanceof Error ? clawErr.message : String(clawErr),
      });
    }

    // order_id carries the userId directly (see 'finished' handling above)
    // — no customer-code lookup needed for this provider.
    try {
      const userId = String(body.order_id).split('|')[0];
      if (userId && UUID_RE.test(userId)) {
        await flagForRevocation(supabaseAdmin, {
          userId,
          provider: 'nowpayments',
          sourcePaymentId: idempotencyKey,
          eventType: 'refunded',
          reason: 'refund',
        });
      } else {
        logger.error('Revocation flag skipped — invalid userId in order_id', { order_id: body.order_id });
      }
    } catch (flagErr: unknown) {
      logger.error('flagForRevocation failed (non-fatal)', {
        paymentId: body.payment_id, error: flagErr instanceof Error ? flagErr.message : String(flagErr),
      });
    }
  }

  return NextResponse.json({ received: true });
}
