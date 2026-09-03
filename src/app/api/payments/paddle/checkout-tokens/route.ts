/**
 * POST /api/payments/paddle/checkout-tokens
 *
 * Paddle equivalent of /api/payments/stripe/checkout-tokens — creates a
 * one-time Paddle Transaction for a token top-up pack (see
 * @/lib/economy/token-packs) instead of a Stripe Checkout session. Mirrors
 * /api/payments/paddle/checkout/route.ts's customer-resolution flow (reuse
 * profiles.paddle_customer_id, same email requirement, same
 * assertCardPaymentAllowed gate — Paddle is a card/MoR rail, see
 * lib/payments/provider-gate.ts), but items[].price_id comes from
 * priceIdForTokenPack() rather than priceIdForTier(), and custom_data marks
 * `type: 'token_pack'` so the webhook credits tokens instead of activating a
 * subscription. Crediting happens in paddle/webhook/route.ts once Paddle
 * confirms the payment (transaction.completed, custom_data.type ===
 * 'token_pack') — this route only starts the checkout.
 */
import { env } from '@/env';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getOrCreatePaddleCustomer, createPaddleTokenPackCheckoutTransaction } from '@/lib/payments/paddle';
import { priceIdForTokenPack } from '@/lib/payments/paddle-plans';
import { assertCardPaymentAllowed, CardPaymentNotAllowedError, assertProviderEnabled, ProviderDisabledError } from '@/lib/payments/provider-gate';
import { supabaseAdmin } from '@/lib/supabase/admin';
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

    // TOKEN-PACK FIX: see stripe/checkout-tokens' identical comment — this
    // route had no provider-gate check at all, so it kept hitting the live
    // (disabled-in-product-terms) Paddle API directly instead of degrading
    // cleanly like paddle/checkout/route.ts (the subscription equivalent)
    // already does. The frontend no longer calls this route.
    try {
      assertProviderEnabled('paddle');
    } catch (err) {
      if (err instanceof ProviderDisabledError) {
        return NextResponse.json({ error: err.message, code: 'PROVIDER_DISABLED' }, { status: 503 });
      }
      throw err;
    }

    // Same card-processor restriction as tier checkout — see
    // stripe/checkout-tokens' identical comment. No crypto (NOWPayments)
    // equivalent for token packs yet, so this is a hard stop for
    // NSFW-enabled accounts rather than a fallback option.
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

    const priceId = priceIdForTokenPack(pack.id);
    if (!priceId) {
      logger.error('Paddle token-pack checkout: no price id configured for pack', { packId: pack.id });
      return NextResponse.json({
        error: 'Paddle payment is not yet configured for this pack.',
        code:  'PADDLE_PRICE_NOT_CONFIGURED',
      }, { status: 400 });
    }

    // Paddle requires an email on the customer object — same guard as
    // paddle/checkout for the same reason (Discord OAuth users may have no
    // email on file).
    if (!user.email) {
      return NextResponse.json({
        error: 'Email address required for Paddle payment. Please add an email to your account.',
        code: 'EMAIL_REQUIRED',
      }, { status: 400 });
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('paddle_customer_id')
      .eq('id', user.id)
      .maybeSingle();

    const customerId = await breakers.paddle().execute(() =>
      getOrCreatePaddleCustomer({
        email: user.email as string,
        existingCustomerId: profile?.paddle_customer_id ?? null,
      })
    );

    // Persist eagerly, same rationale as paddle/checkout — lets a webhook
    // that arrives with only a customer_id (no round-tripped custom_data)
    // still resolve this user.
    if (!profile?.paddle_customer_id) {
      await supabaseAdmin.from('profiles').update({ paddle_customer_id: customerId }).eq('id', user.id);
    }

    const transaction = await breakers.paddle().execute(() =>
      createPaddleTokenPackCheckoutTransaction({
        customerId,
        priceId,
        userId: user.id,
        packId: pack.id,
        tokens: pack.tokens,
        // Same purchase surface as Stripe's token-pack checkout — see that
        // route's identical comment on why /profile/tokens and not /store.
        successUrl: `${env.NEXT_PUBLIC_APP_URL}/profile/tokens?purchase=success&provider=paddle`,
      })
    );

    if (!transaction.checkout?.url) {
      logger.error('Paddle token-pack checkout: transaction created with no checkout.url', { transactionId: transaction.id });
      return NextResponse.json({ error: 'Could not start checkout' }, { status: 502 });
    }

    return NextResponse.json({ url: transaction.checkout.url });
  } catch (err) {
    logger.error('Paddle token-pack checkout error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}
