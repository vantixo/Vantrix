import { env } from '@/env';
import { NextRequest, NextResponse } from 'next/server';
import { z }                 from 'zod';
import { getAuthedUser }      from '@/lib/auth/get-authed-user';
import { createNowPaymentInvoice } from '@/lib/payments/nowpayments';
import { breakers }          from '@/lib/circuit-breaker';
import { toErrorBody, errorLogFields }       from '@/lib/errors';
import { logger }            from '@/lib/logger';
import { captureEvent }      from '@/lib/analytics/server';

export const dynamic = 'force-dynamic';

const schema = z.object({
  tierId: z.string().uuid(),
  // See stripe/checkout/route.ts's identical field — client-supplied,
  // analytics-only, defaults to 'premium_page'.
  surface: z.string().max(64).optional(),
});

export async function POST(req: NextRequest) {
  try {
    // CRIT-3: middleware already validated the JWT server-side via
    // auth.getUser() and forwards the verified id below — getSession()
    // alone would be insecure here, but trusting middleware's verified
    // header is equivalent, not a downgrade.
    const { supabase, user } = await getAuthedUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const { data: tier } = await supabase
      .from('tiers')
      .select('id,slug,price_usd,base_tier_slug,billing_interval')
      .eq('id', parsed.data.tierId)
      .single();
    if (!tier) {
      return NextResponse.json({ error: 'Tier not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // base_tier_slug is the feature-gating slug ('free' or 'premium' on
    // this project — see paystack/initialize/route.ts for the fuller explanation. The
    // order_id must carry the base slug (never '_annual' suffixed) since
    // the webhook writes it straight to profiles.tier; billing interval is
    // encoded as a separate segment instead.
    const baseTierSlug = (tier.base_tier_slug as string | null) ?? (tier.slug as string);
    const billingInterval = ((tier.billing_interval as string | null) ?? 'monthly') as 'monthly' | 'quarterly' | 'annual';
    const orderId = `${user.id}|${baseTierSlug}|${Date.now()}|${billingInterval}`;

    // See stripe/checkout/route.ts's identical placement — fired once
    // tier/provider/interval are resolved and validated.
    captureEvent(user.id, 'checkout_started', {
      tier: baseTierSlug,
      provider: 'nowpayments',
      billing_interval: billingInterval,
      surface: parsed.data.surface ?? 'premium_page',
    });

    const invoice = await breakers.nowpayments().execute(() =>
      createNowPaymentInvoice({
        priceUsd:   tier.price_usd as number,
        orderId,
        successUrl: `${env.NEXT_PUBLIC_APP_URL}/premium/success`,
        cancelUrl:  `${env.NEXT_PUBLIC_APP_URL}/premium?canceled=true`,
      })
    );

    // Same { url } shape as Stripe/Paystack — the frontend redirects the
    // browser to it either way, regardless of which provider was chosen.
    return NextResponse.json({ url: invoice.invoice_url });
  } catch (err) {
    logger.error('NOWPayments create error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err
      ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}
