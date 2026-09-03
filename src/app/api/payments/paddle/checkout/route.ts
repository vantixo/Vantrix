import { env } from '@/env';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { NextRequest, NextResponse } from 'next/server';
import { z }                    from 'zod';
import { getOrCreatePaddleCustomer, createPaddleCheckoutTransaction } from '@/lib/payments/paddle';
import { priceIdForTier }       from '@/lib/payments/paddle-plans';
import { assertCardPaymentAllowed, CardPaymentNotAllowedError, assertProviderEnabled, ProviderDisabledError } from '@/lib/payments/provider-gate';
import { supabaseAdmin }        from '@/lib/supabase/admin';
import { breakers }             from '@/lib/circuit-breaker';
import { toErrorBody, errorLogFields }          from '@/lib/errors';
import { logger }               from '@/lib/logger';
import { captureEvent }         from '@/lib/analytics/server';

export const dynamic = 'force-dynamic';

// Mirrors stripe/checkout's identical schema — `surface` is client-supplied
// purely for analytics segmentation, see checkout-button.tsx.
const schema = z.object({ tierId: z.string().uuid(), surface: z.string().max(64).optional() });

export async function POST(req: NextRequest) {
  try {
    // Paddle is temporarily switched off account-wide — see
    // lib/payments/provider-gate.ts's DISABLED_PROVIDERS for why and how
    // to re-enable.
    try {
      assertProviderEnabled('paddle');
    } catch (err) {
      if (err instanceof ProviderDisabledError) {
        return NextResponse.json({ error: err.message, code: 'PROVIDER_DISABLED' }, { status: 503 });
      }
      throw err;
    }

    const { supabase, user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

    // Card/MoR processors prohibit payments for accounts with adult content
    // enabled — see lib/payments/provider-gate.ts (updated header explains
    // why Paddle is treated as a card rail here, same as Stripe/Paystack).
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

    const { data: tier } = await supabase
      .from('tiers')
      .select('id,slug,base_tier_slug,billing_interval')
      .eq('id', parsed.data.tierId)
      .single();
    if (!tier) return NextResponse.json({ error: 'Tier not found', code: 'NOT_FOUND' }, { status: 404 });

    // See stripe/checkout's identical comment — annual/quarterly tiers are
    // separate `tiers` rows; metadata sent to the provider (and later
    // written to profiles.tier by the webhook) must stay the base slug.
    const baseTierSlug = (tier.base_tier_slug as string | null) ?? (tier.slug as string);
    const billingInterval = ((tier.billing_interval as string | null) ?? 'monthly') as 'monthly' | 'quarterly' | 'annual';

    const priceId = priceIdForTier(baseTierSlug, billingInterval);
    if (!priceId) {
      logger.error('Paddle checkout: no price id configured for tier/interval', { baseTierSlug, billingInterval });
      return NextResponse.json({
        error: 'Paddle billing is not yet configured for this plan.',
        code:  'PADDLE_PRICE_NOT_CONFIGURED',
      }, { status: 400 });
    }

    // Paddle requires an email on the customer object — same guard as
    // paystack/initialize for the same reason (Discord OAuth users may
    // have no email on file).
    if (!user.email) {
      return NextResponse.json({
        error: 'Email address required for Paddle payment. Please add an email to your account.',
        code: 'EMAIL_REQUIRED',
      }, { status: 400 });
    }

    // NOTE: referral first-month discounts (see getRefereeDiscountPct(),
    // applied on both Stripe and Paystack checkout) are NOT yet wired for
    // Paddle — flagging this rather than guessing at Paddle's Discounts
    // API shape without verifying it against a live account first. A
    // referred user checking out via Paddle simply pays full price for
    // now; the discount is not silently lost elsewhere, it just isn't
    // implemented on this rail yet.

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

    // Persist eagerly (before the transaction/checkout redirect) so a
    // renewal webhook arriving before the checkout.session-equivalent
    // event can still resolve this user via paddle_customer_id — see
    // the webhook route's resolveUserId() fallback.
    if (!profile?.paddle_customer_id) {
      await supabaseAdmin.from('profiles').update({ paddle_customer_id: customerId }).eq('id', user.id);
    }

    captureEvent(user.id, 'checkout_started', {
      tier: baseTierSlug,
      provider: 'paddle',
      billing_interval: billingInterval,
      surface: parsed.data.surface ?? 'premium_page',
    });

    const transaction = await breakers.paddle().execute(() =>
      createPaddleCheckoutTransaction({
        customerId,
        priceId,
        userId: user.id,
        tier: baseTierSlug,
        billingInterval,
        successUrl: `${env.NEXT_PUBLIC_APP_URL}/premium/success?provider=paddle`,
      })
    );

    if (!transaction.checkout?.url) {
      logger.error('Paddle checkout: transaction created with no checkout.url', { transactionId: transaction.id });
      return NextResponse.json({ error: 'Could not start checkout' }, { status: 502 });
    }

    return NextResponse.json({ url: transaction.checkout.url });
  } catch (err) {
    logger.error('Paddle checkout error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}
