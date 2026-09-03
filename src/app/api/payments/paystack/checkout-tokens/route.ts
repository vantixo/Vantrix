/**
 * POST /api/payments/paystack/checkout-tokens
 *
 * Paystack equivalent of stripe/paddle's checkout-tokens routes — initializes
 * a one-off NGN transaction for a token top-up pack (see
 * @/lib/economy/token-packs) instead of a Stripe Checkout session / Paddle
 * Transaction. This is the ONLY token-pack rail that currently works end to
 * end: Stripe and Paddle are both globally switched off right now (see
 * lib/payments/provider-gate.ts's DISABLED_PROVIDERS, 2026-08-28 product
 * decision) and token packs have no plan-code/price-id concept to route
 * around that the way subscriptions do — so before this route existed, the
 * token-pack purchase UI had no working checkout option at all. See
 * nowpayments/create-tokens/route.ts for the crypto-rail sibling.
 *
 * No `plan` code is passed to initializePaystackTransaction() — token packs
 * are a single one-off charge, never a recurring Subscription, so this
 * always takes the one-off-charge path that function already supports.
 *
 * amountNgn is derived from the pack's USD price via USD_TO_NGN_APPROX
 * (@/lib/referral-config) — token packs have no stored NGN price the way
 * `tiers.price_ngn` does, so this reuses the same approximate rate the
 * referral-commission conversion already relies on elsewhere in this
 * codebase, rather than inventing a second one.
 *
 * Crediting happens in paystack/verify/route.ts (both the GET redirect and
 * the POST charge.success webhook) once Paystack confirms the payment —
 * this route only starts the checkout. Distinguished from a tier purchase
 * there by metadata.type === 'token_pack', mirroring the Stripe webhook's
 * identical branch.
 */
import { env } from '@/env';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { initializePaystackTransaction } from '@/lib/payments/paystack';
import { assertCardPaymentAllowed, CardPaymentNotAllowedError, assertProviderEnabled, ProviderDisabledError } from '@/lib/payments/provider-gate';
import { USD_TO_NGN_APPROX } from '@/lib/referral-config';
import { breakers } from '@/lib/circuit-breaker';
import { getTokenPack } from '@/lib/economy/token-packs';
import { toErrorBody, errorLogFields } from '@/lib/errors';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const schema = z.object({ packId: z.string() });

export async function POST(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

    // Paystack is NOT in DISABLED_PROVIDERS (only stripe/paddle are) — this
    // call is a no-op today, but it's here for the same reason the tier
    // checkout routes call it: if Paystack itself is ever added to the
    // gate, every route that touches it degrades the same clear way
    // instead of this one being the exception that 500s.
    try {
      assertProviderEnabled('paystack');
    } catch (err) {
      if (err instanceof ProviderDisabledError) {
        return NextResponse.json({ error: err.message, code: 'PROVIDER_DISABLED' }, { status: 503 });
      }
      throw err;
    }

    // Same card-processor restriction as tier checkout — NSFW-enabled
    // accounts are refused on the card rail. Token packs have no crypto
    // (NOWPayments) equivalent yet, so this is a hard stop for those users
    // rather than a fallback option.
    try {
      await assertCardPaymentAllowed(user.id);
    } catch (err) {
      if (err instanceof CardPaymentNotAllowedError) {
        return NextResponse.json({ error: err.message, code: 'CARD_PAYMENT_NOT_ALLOWED' }, { status: 403 });
      }
      throw err;
    }

    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request', code: 'VALIDATION_ERROR' }, { status: 400 });

    const pack = getTokenPack(parsed.data.packId);
    if (!pack) return NextResponse.json({ error: 'Pack not found', code: 'NOT_FOUND' }, { status: 404 });

    // HIGH-2 parity: Discord OAuth users may have no email on file.
    if (!user.email) {
      return NextResponse.json({
        error: 'Email address required for Paystack payment. Please add an email to your account.',
        code: 'EMAIL_REQUIRED',
      }, { status: 400 });
    }

    const amountNgn = Math.round(pack.priceUsd * USD_TO_NGN_APPROX);

    // No captureEvent('checkout_started', ...) here — that event's typed
    // shape (AnalyticsEventMap, @/lib/analytics/events) is subscription-
    // specific (tier + billing_interval, no packId field), unlike token
    // packs. Not worth widening a shared analytics type for one event;
    // 'token_pack_purchased'-style analytics can be added at the webhook
    // credit point instead if this is ever needed.
    const transaction = await breakers.paystack().execute(() =>
      initializePaystackTransaction({
        email: user.email as string,
        amountNgn,
        metadata: {
          type: 'token_pack',
          userId: user.id,
          packId: pack.id,
          tokens: String(pack.tokens),
        },
        callback_url: `${env.NEXT_PUBLIC_APP_URL}/api/payments/paystack/verify`,
        // No plan code — token packs are always a one-off charge.
      })
    );

    const authorizationUrl = transaction?.data?.authorization_url;
    if (!authorizationUrl) {
      logger.error('Paystack token-pack checkout: no authorization_url in response', { transaction });
      return NextResponse.json({ error: 'Could not start checkout' }, { status: 502 });
    }

    return NextResponse.json({ url: authorizationUrl, reference: transaction?.data?.reference });
  } catch (err) {
    logger.error('Paystack token-pack checkout error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}
