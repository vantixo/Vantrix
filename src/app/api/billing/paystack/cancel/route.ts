/**
 * POST /api/billing/paystack/cancel
 *
 * Self-serve cancellation for Paystack-managed subscriptions.
 *
 * WHY THIS EXISTS:
 * Stripe subscribers get a full self-serve Billing Portal
 * (/api/billing/portal). Paystack subscribers previously had no
 * equivalent — /profile just told them to "contact support to cancel."
 * Same rationale as the Stripe portal: a user who can't find a cancel
 * button disputes the charge with their bank instead, which costs more
 * than the churn itself.
 *
 * FLOW:
 * 1. Look up the user's stored `paystack_subscription_code` (captured at
 *    payment time — see api/payments/paystack/verify/route.ts).
 * 2. Fetch the subscription from Paystack to get its `email_token` —
 *    Paystack requires both the code and this token to authorize a
 *    disable, and we don't persist the token ourselves (see
 *    fetchPaystackSubscription's doc comment in lib/payments/paystack.ts).
 * 3. Call Paystack's disable endpoint.
 *
 * IMPORTANT: this route does NOT downgrade the user's tier itself.
 * Paystack's `subscription.disable` webhook
 * (api/payments/paystack/verify/route.ts) is the single place that
 * happens, so every cancellation path — self-serve here, the Paystack
 * dashboard, a failed-renewal exhaustion — converges on the same
 * already-correct, idempotent downgrade logic instead of this route
 * racing it with a second copy.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser }             from '@/lib/auth/get-authed-user';
import { supabaseAdmin }             from '@/lib/supabase/admin';
import { fetchPaystackSubscription, disablePaystackSubscription } from '@/lib/payments/paystack';
import { logger }                    from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest) {
  const { user } = await getAuthedUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // AUDIT FIX (2026-07-19): this previously selected `paystack_subscription_code`
  // from `profiles`, but that column has only ever existed on `subscriptions`
  // (see the 20260630 migration and the upsert in payments/paystack/verify/
  // route.ts, which writes it there keyed on user_id+provider) — `profiles`
  // never had this column. TypeScript's generated Supabase types actually
  // caught this (SelectQueryError on the invalid column), which surfaced it
  // during this audit; at runtime against a real database this would have
  // failed on every single call with a Postgres "column does not exist"
  // error, making self-serve Paystack cancellation completely non-functional.
  const { data: subscription, error: subErr } = await supabaseAdmin
    .from('subscriptions')
    .select('paystack_subscription_code, tier')
    .eq('user_id', user.id)
    .eq('provider', 'paystack')
    .single();

  if (subErr || !subscription) {
    return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
  }

  if (!subscription.paystack_subscription_code) {
    return NextResponse.json({
      error: 'No Paystack subscription found',
      code:  'NO_PAYSTACK_SUBSCRIPTION',
      hint:  'This account has no active Paystack-managed subscription to cancel.',
    }, { status: 404 });
  }

  try {
    const sub = await fetchPaystackSubscription(subscription.paystack_subscription_code);
    const emailToken: string | undefined = sub?.data?.email_token;

    if (!emailToken) {
      logger.error('[paystack-cancel] Missing email_token on subscription lookup', {
        userId: user.id,
        subscriptionCode: subscription.paystack_subscription_code,
      });
      return NextResponse.json({
        error: 'Could not verify subscription with Paystack. Please contact support.',
        code:  'PAYSTACK_TOKEN_UNAVAILABLE',
      }, { status: 502 });
    }

    await disablePaystackSubscription({
      subscriptionCode: subscription.paystack_subscription_code,
      emailToken,
    });

    logger.info('[paystack-cancel] Cancellation requested', {
      userId: user.id,
      subscriptionCode: subscription.paystack_subscription_code,
    });

    // The tier downgrade + subscriptions.status update happens via the
    // subscription.disable webhook Paystack fires as a result of this call
    // — intentionally not duplicated here (see file header).
    return NextResponse.json({
      ok: true,
      message: 'Cancellation requested. Your plan will remain active until the end of the current billing period.',
    });

  } catch (err: unknown) {
    logger.error('[paystack-cancel] Paystack error', { error: String(err), userId: user.id });
    const message = err instanceof Error ? err.message : 'Could not cancel subscription';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
