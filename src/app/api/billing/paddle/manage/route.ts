/**
 * POST /api/billing/paddle/manage
 *
 * Paddle's equivalent of Stripe's Billing Portal (see
 * api/billing/portal/route.ts): fetches the user's Paddle subscription and
 * returns its `management_urls` — Paddle-hosted deep links for updating a
 * payment method and for cancelling. Unlike Stripe, there's no single
 * "portal session" endpoint that bundles both; Paddle exposes them
 * per-subscription instead, so this route just resolves the subscription
 * id and passes both links straight through.
 */
import { NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { getPaddleSubscription } from '@/lib/payments/paddle';
import { breakers } from '@/lib/circuit-breaker';
import { toErrorBody, errorLogFields } from '@/lib/errors';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const { supabase, user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

    const { data: sub } = await supabase
      .from('subscriptions')
      .select('paddle_subscription_id')
      .eq('user_id', user.id)
      .eq('provider', 'paddle')
      .eq('status', 'active')
      .maybeSingle();

    if (!sub?.paddle_subscription_id) {
      return NextResponse.json({ error: 'No active Paddle subscription found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const subscription = await breakers.paddle().execute(() =>
      getPaddleSubscription(sub.paddle_subscription_id as string)
    );

    if (!subscription.management_urls) {
      // Paddle only populates management_urls when the API key used has
      // "Customer portal session (Write)" permission — surfacing this as
      // a clear config error rather than a silent empty response.
      logger.error('Paddle subscription has no management_urls — check API key permissions', {
        subscriptionId: sub.paddle_subscription_id,
      });
      return NextResponse.json({ error: 'Billing management is not available right now' }, { status: 502 });
    }

    return NextResponse.json({
      manageUrl: subscription.management_urls.update_payment_method,
      cancelUrl: subscription.management_urls.cancel,
    });
  } catch (err) {
    logger.error('Paddle manage route error', errorLogFields(err));
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}
