/**
 * POST /api/payments/stripe/checkout-tokens
 *
 * Creates a one-time Stripe Checkout session for a token top-up pack
 * (see @/lib/economy/token-packs). Mirrors the pattern in
 * /api/payments/stripe/checkout/route.ts (subscription purchase), but
 * mode: "payment" instead of "subscription" — the pack is a single charge,
 * not a recurring plan. Crediting happens in stripe/webhook/route.ts once
 * Stripe confirms the payment (checkout.session.completed,
 * metadata.type === 'token_pack'), not here — this route only starts the
 * checkout.
 */
import { env } from '@/env';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createTokenPackCheckoutSession } from '@/lib/payments/stripe';
import { assertCardPaymentAllowed, CardPaymentNotAllowedError, assertProviderEnabled, ProviderDisabledError } from '@/lib/payments/provider-gate';
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

    // TOKEN-PACK FIX: this route previously had no provider-gate check at
    // all, unlike stripe/checkout/route.ts (the subscription equivalent) —
    // so while subscriptions correctly 503'd with a clear message while
    // Stripe is disabled (see provider-gate.ts's DISABLED_PROVIDERS,
    // 2026-08-28), this route kept calling the live Stripe API directly,
    // which failed and surfaced only as a generic sanitized error (see
    // lib/errors.ts's toErrorBody()). The frontend (token-pack-card.tsx) no
    // longer calls this route at all — it uses paystack/checkout-tokens and
    // nowpayments/create-tokens instead — but this check is added anyway so
    // the route degrades the same clear way as its subscription sibling if
    // ever hit directly (or re-enabled later by flipping DISABLED_PROVIDERS).
    try {
      assertProviderEnabled('stripe');
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

    const checkoutSession = await breakers.stripe().execute(() =>
      createTokenPackCheckoutSession({
        packId:     pack.id,
        priceUsd:   pack.priceUsd,
        tokens:     pack.tokens,
        label:      pack.label,
        userId:     user.id,
        // Frontend rebuild note: this used to point at /store, a route
        // that no longer exists (see docs/vantrix-frontend-directive.pdf
        // and token-packs.ts's own comment referencing the old
        // src/app/(main)/store/page.tsx). The purchase UI now lives at
        // /profile/tokens (linked from the account menu), so both
        // redirect targets were repointed there instead of reviving a
        // second route for the same feature.
        successUrl: `${env.NEXT_PUBLIC_APP_URL}/profile/tokens?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl:  `${env.NEXT_PUBLIC_APP_URL}/profile/tokens?purchase=canceled`,
      })
    );

    return NextResponse.json({ url: checkoutSession.url });
  } catch (err) {
    logger.error('Stripe token-pack checkout error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}
