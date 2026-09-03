import { env } from '@/env';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { NextRequest, NextResponse } from 'next/server';
import { z }                    from 'zod';
import { createStripeCheckoutSession } from '@/lib/payments/stripe';
import { getRefereeDiscountPct } from '@/lib/referral-engine';
import { assertCardPaymentAllowed, CardPaymentNotAllowedError, assertProviderEnabled, ProviderDisabledError } from '@/lib/payments/provider-gate';
import { breakers }             from '@/lib/circuit-breaker';
import { toErrorBody, errorLogFields }          from '@/lib/errors';
import { logger }               from '@/lib/logger';
import { captureEvent }         from '@/lib/analytics/server';

export const dynamic = 'force-dynamic';

// `surface` is client-supplied (see CheckoutButton) purely for analytics
// segmentation — defaults to 'premium_page' since that's the only surface
// that renders CheckoutButton today (see checkout-button.tsx's own header).
const schema = z.object({ tierId: z.string().uuid(), surface: z.string().max(64).optional() });

export async function POST(req: NextRequest) {
  try {
    // Stripe is temporarily switched off account-wide — see
    // lib/payments/provider-gate.ts's DISABLED_PROVIDERS for why and how
    // to re-enable. Checked before auth since this doesn't depend on who's
    // asking.
    try {
      assertProviderEnabled('stripe');
    } catch (err) {
      if (err instanceof ProviderDisabledError) {
        return NextResponse.json({ error: err.message, code: 'PROVIDER_DISABLED' }, { status: 503 });
      }
      throw err;
    }

    const { supabase, user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

    // Card processors prohibit payments for accounts with adult content
    // enabled — see lib/payments/provider-gate.ts. Crypto (NOWPayments)
    // remains available to this user; only the card rail is refused here.
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
      .select('id,slug,name,price_usd,base_tier_slug,billing_interval')
      .eq('id', parsed.data.tierId)
      .single();
    if (!tier) return NextResponse.json({ error: 'Tier not found', code: 'NOT_FOUND' }, { status: 404 });

    // See paystack/initialize/route.ts — annual tiers are separate `tiers`
    // rows (slug='spark_annual' etc.); the tier metadata sent to the
    // provider (and later written to profiles.tier by the webhook) must
    // stay the base slug, or feature-gating breaks for annual subscribers.
    const baseTierSlug = (tier.base_tier_slug as string | null) ?? (tier.slug as string);
    const billingInterval = ((tier.billing_interval as string | null) ?? 'monthly') as 'monthly' | 'quarterly' | 'annual';

    // REFERRAL-DISCOUNT-FIX: previously defined in referral-config.ts but
    // never applied anywhere. Referred users get their promised first-
    // month discount only once, only if it hasn't already been used.
    const refereeDiscountPct = await getRefereeDiscountPct(supabase, user.id);

    // Fired once the tier/provider/interval are resolved and validated —
    // i.e. once we know a checkout is genuinely starting — rather than at
    // the top of the handler, so a bad tierId or a blocked card payment
    // (both returned above) never counts as a started checkout.
    captureEvent(user.id, 'checkout_started', {
      tier: baseTierSlug,
      provider: 'stripe',
      billing_interval: billingInterval,
      surface: parsed.data.surface ?? 'premium_page',
    });

    const checkoutSession = await breakers.stripe().execute(() =>
      createStripeCheckoutSession({
        priceUsd:   tier.price_usd as number,
        userId:     user.id,
        tier:       baseTierSlug,
        billingInterval,
        successUrl: `${env.NEXT_PUBLIC_APP_URL}/premium/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl:  `${env.NEXT_PUBLIC_APP_URL}/premium?canceled=true`,
        refereeDiscountPct,
      })
    );

    return NextResponse.json({ url: checkoutSession.url });
  } catch (err) {
    logger.error('Stripe checkout error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}
