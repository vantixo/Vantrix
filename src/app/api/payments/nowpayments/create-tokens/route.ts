/**
 * POST /api/payments/nowpayments/create-tokens
 *
 * NOWPayments (crypto) equivalent of paystack/checkout-tokens — creates a
 * hosted crypto invoice for a one-time token top-up pack (see
 * @/lib/economy/token-packs) instead of a subscription invoice. No
 * assertCardPaymentAllowed / provider-gate check here, matching
 * nowpayments/create/route.ts for tiers: crypto is never gated by
 * DISABLED_PROVIDERS or the NSFW card-processor restriction (see
 * lib/payments/provider-gate.ts's module comment — NOWPayments is
 * available to every account regardless of NSFW status, in both
 * directions).
 *
 * order_id encodes `{userId}|token_pack|{timestamp}|{packId}|{tokens}` —
 * same pipe-delimited convention as the tier route's
 * `{userId}|{tierSlug}|{timestamp}|{billingInterval}`, with `token_pack` in
 * the tier-slug position so the webhook (nowpayments/webhook/route.ts) can
 * branch on it before attempting tier validation. Crediting happens there,
 * not here — this route only starts the checkout.
 */
import { env } from '@/env';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { createNowPaymentInvoice } from '@/lib/payments/nowpayments';
import { breakers } from '@/lib/circuit-breaker';
import { getTokenPack } from '@/lib/economy/token-packs';
import { toErrorBody, errorLogFields } from '@/lib/errors';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const schema = z.object({ packId: z.string() });

export async function POST(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const pack = getTokenPack(parsed.data.packId);
    if (!pack) return NextResponse.json({ error: 'Pack not found', code: 'NOT_FOUND' }, { status: 404 });

    const orderId = `${user.id}|token_pack|${Date.now()}|${pack.id}|${pack.tokens}`;

    const invoice = await breakers.nowpayments().execute(() =>
      createNowPaymentInvoice({
        priceUsd:   pack.priceUsd,
        orderId,
        orderDescription: `Vantrix ${pack.label} (${pack.tokens.toLocaleString()} tokens)`,
        successUrl: `${env.NEXT_PUBLIC_APP_URL}/profile/tokens?purchase=success&provider=nowpayments`,
        cancelUrl:  `${env.NEXT_PUBLIC_APP_URL}/profile/tokens?purchase=canceled`,
      })
    );

    return NextResponse.json({ url: invoice.invoice_url });
  } catch (err) {
    logger.error('NOWPayments token-pack create error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err
      ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}
