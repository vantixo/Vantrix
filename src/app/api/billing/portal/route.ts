/**
 * POST /api/billing/portal
 *
 * Creates a Stripe Billing Portal session so users can:
 *   - Cancel their subscription (instead of chargebacks)
 *   - Update payment method
 *   - View invoice history
 *   - Upgrade / downgrade plan
 *
 * WHY THIS MATTERS:
 * Users who cannot find a cancel button dispute the charge with their bank.
 * Stripe chargebacks:
 *   - Cost $15/dispute regardless of outcome
 *   - Hurt the platform's dispute ratio
 *   - Accounts above 0.75% dispute ratio risk Stripe termination
 *
 * This is the single highest-ROI billing infrastructure item.
 *
 * SETUP REQUIRED:
 * 1. Enable Customer Portal in Stripe Dashboard → Billing → Customer Portal
 * 2. Configure allowed actions (cancel, update card, etc.)
 * 3. Ensure profiles.stripe_customer_id is populated when subscriptions are created
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { supabaseAdmin }              from '@/lib/supabase/admin';
import { stripe }                     from '@/lib/payments/stripe';
import { logger }                     from '@/lib/logger';
import { env }                        from '@/env';
import { sanitizeReturnUrl }          from '@/lib/security/safe-redirect';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { user } = await getAuthedUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Look up the user's Stripe customer ID from profiles
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('stripe_customer_id, tier')
    .eq('id', user.id)
    .single();

  if (profileErr || !profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  // If no Stripe customer ID, they are on the free plan or paid via Paystack/NOWPayments
  if (!profile.stripe_customer_id) {
    return NextResponse.json({
      error: 'No Stripe subscription found',
      code:  'NO_STRIPE_CUSTOMER',
      hint:  'This account was not charged via Stripe. Contact support to manage your subscription.',
    }, { status: 404 });
  }

  try {
    // Determine return URL — after portal actions, redirect back to profile.
    // SEC FIX (Phase B, 2026-08-06): this was a raw client-supplied value
    // passed directly to Stripe's return_url with no validation — a
    // classic open redirect via a trusted third-party domain (Stripe would
    // bounce the user's browser to any attacker-supplied URL after they
    // left the portal). Now constrained to the app's own origin.
    const body = await req.json().catch(() => ({}));
    const returnUrl = sanitizeReturnUrl(
      (body as { returnUrl?: string }).returnUrl,
      env.NEXT_PUBLIC_APP_URL,
      '/profile'
    );

    const session = await stripe.billingPortal.sessions.create({
      customer:   profile.stripe_customer_id,
      return_url: returnUrl,
    });

    logger.info('[billing-portal] Session created', {
      userId:     user.id,
      customerId: profile.stripe_customer_id,
    });

    return NextResponse.json({ url: session.url });

  } catch (err: unknown) {
    logger.error('[billing-portal] Stripe error', { error: String(err), userId: user.id });

    const message = err instanceof Error ? err.message : 'Billing portal unavailable';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
