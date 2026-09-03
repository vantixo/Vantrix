import { env } from '@/env';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { NextRequest, NextResponse } from 'next/server';
import { createFreeTrialSession } from '@/lib/payments/stripe';
import { assertCardPaymentAllowed, CardPaymentNotAllowedError, assertProviderEnabled, ProviderDisabledError } from '@/lib/payments/provider-gate';
import { breakers }    from '@/lib/circuit-breaker';
import { toErrorBody, errorLogFields } from '@/lib/errors';
import { logger }      from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Starts the PREMIUM_TRIAL_DAYS-day Premium free trial (see lib/payments/stripe.ts's
 * createFreeTrialSession). No request body — the trial is a single fixed
 * offer, not tier-selectable.
 *
 * BUG FIX (SEC-09): this route previously didn't exist at all in a form
 * that used the shared fail-closed gate — an earlier draft used an inline
 * nsfw_enabled equality check that failed OPEN if the profiles lookup
 * itself errored (silently letting an NSFW-enabled account through to a
 * card-collecting Stripe session). assertCardPaymentAllowed() is the same
 * fail-closed helper every other card rail (stripe/checkout,
 * paystack/initialize) uses — see lib/payments/provider-gate.ts.
 */
export async function POST(req: NextRequest) {
  try {
    // This trial is a Stripe Checkout session under the hood with no
    // Paystack/NOWPayments equivalent, so it's gated off the same
    // account-wide switch as stripe/checkout — see
    // lib/payments/provider-gate.ts's DISABLED_PROVIDERS.
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

    // Card processors prohibit payments (including $0-today trial signups
    // that collect a card) for accounts with adult content enabled — see
    // lib/payments/provider-gate.ts. Fails closed on a lookup error.
    try {
      await assertCardPaymentAllowed(user.id);
    } catch (err) {
      if (err instanceof CardPaymentNotAllowedError) {
        return NextResponse.json({ error: err.message, code: 'CARD_PAYMENT_NOT_ALLOWED' }, { status: 403 });
      }
      throw err;
    }

    // One trial per account, ever — profiles.trial_used is flipped by the
    // Stripe webhook the first time a trial subscription activates (see
    // activate_trial()). Checked here too (not just enforced at signup)
    // so a user who already used their trial gets a clear 409 instead of
    // silently starting a second Stripe session that the webhook would
    // just re-process as a no-op.
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('trial_used')
      .eq('id', user.id)
      .single();
    if (profileErr) {
      logger.error('stripe/trial: profile lookup failed', { error: profileErr.message });
      return NextResponse.json({ error: 'Could not verify trial eligibility', code: 'PROFILE_LOOKUP_FAILED' }, { status: 500 });
    }
    if (profile?.trial_used) {
      return NextResponse.json({ error: 'Free trial already used on this account', code: 'TRIAL_ALREADY_USED' }, { status: 409 });
    }

    const session = await breakers.stripe().execute(() =>
      createFreeTrialSession({
        userId:     user.id,
        successUrl: `${env.NEXT_PUBLIC_APP_URL}/premium/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl:  `${env.NEXT_PUBLIC_APP_URL}/premium?canceled=true`,
      })
    );

    return NextResponse.json({ url: session.url });
  } catch (err) {
    logger.error('Stripe trial checkout error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}
