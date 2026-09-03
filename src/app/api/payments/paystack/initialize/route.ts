import { env } from '@/env';
import { NextRequest, NextResponse } from 'next/server';
import { z }                         from 'zod';
import { createClient }              from '@/lib/supabase/server';
import { initializePaystackTransaction } from '@/lib/payments/paystack';
import { planCodeForTier } from '@/lib/payments/paystack-plans';
import { assertCardPaymentAllowed, CardPaymentNotAllowedError } from '@/lib/payments/provider-gate';
import { getRefereeDiscountPct } from '@/lib/referral-engine';
import { breakers }                  from '@/lib/circuit-breaker';
import { toErrorBody, errorLogFields }               from '@/lib/errors';
import { logger }                    from '@/lib/logger';
import { captureEvent }              from '@/lib/analytics/server';

export const dynamic = 'force-dynamic';

const schema = z.object({
  tierId:   z.string().uuid(),
  currency: z.string().length(3).optional().default('NGN'),
  billingInterval: z.enum(['monthly', 'quarterly', 'annual']).optional().default('monthly'),
  // See stripe/checkout/route.ts's identical field — client-supplied,
  // analytics-only, defaults to 'premium_page'.
  surface: z.string().max(64).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    // CRIT-3: getUser() validates the JWT server-side. getSession() is insecure
    // for payment routes — it can be bypassed by a tampered session cookie.
    const { data: { user } } = await supabase.auth.getUser();
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
      .select('id,slug,price_ngn,base_tier_slug,billing_interval')
      .eq('id', parsed.data.tierId)
      .single();
    if (!tier) return NextResponse.json({ error: 'Tier not found', code: 'NOT_FOUND' }, { status: 404 });

    // base_tier_slug is the feature-gating slug ('free' or 'premium' on
    // this project) — for a monthly row this equals slug itself; for an
    // annual row (slug='spark_annual') it points back at 'premium', not
    // 'spark' (slug is just this row's internal name/product label).
    // profiles.tier and Paystack metadata.tier must always carry this base
    // slug, never the '_annual' suffixed one, so every existing feature
    // gate keeps working.
    const baseTierSlug = (tier.base_tier_slug as string | null) ?? (tier.slug as string);
    const resolvedInterval = ((tier.billing_interval as string | null) ?? parsed.data.billingInterval) as 'monthly' | 'quarterly' | 'annual';

    // HIGH-2: Discord OAuth users may have no email — guard before passing to Paystack.
    if (!user.email) {
      return NextResponse.json({
        error: 'Email address required for Paystack payment. Please add an email to your account.',
        code: 'EMAIL_REQUIRED',
      }, { status: 400 });
    }

    const planCode = planCodeForTier(baseTierSlug, resolvedInterval);

    // REFERRAL-DISCOUNT-FIX: previously defined in referral-config.ts but
    // never applied anywhere. IMPORTANT LIMITATION: when `plan` is set,
    // Paystack subscriptions bill the plan's own fixed amount, not the
    // amount passed to initialize — so discounting `amountNgn` here would
    // silently do nothing for plan-based (recurring) tiers. We only apply
    // it on the one-off-charge path (no plan code), where the initialize
    // amount is what's actually charged. A discounted first month for
    // plan-based tiers would need a short-lived discounted plan variant,
    // which isn't wired up — flagging rather than pretending this works.
    const refereeDiscountPct = planCode ? 0 : await getRefereeDiscountPct(supabase, user.id);
    const amountNgn = Math.round((tier.price_ngn as number) * (1 - refereeDiscountPct));

    // See stripe/checkout/route.ts's identical placement — fired once
    // tier/provider/interval are resolved and validated, not at the top
    // of the handler.
    captureEvent(user.id, 'checkout_started', {
      tier: baseTierSlug,
      provider: 'paystack',
      billing_interval: resolvedInterval,
      surface: parsed.data.surface ?? 'premium_page',
    });

    const transaction = await breakers.paystack().execute(() =>
      initializePaystackTransaction({
        email:       user.email as string,
        amountNgn,
        metadata:    { userId: user.id, tier: baseTierSlug, billingInterval: resolvedInterval, referralDiscountApplied: String(refereeDiscountPct > 0) },
        callback_url: `${env.NEXT_PUBLIC_APP_URL}/api/payments/paystack/verify`,
        // Recurring billing fix: passing `plan` makes Paystack create an
        // actual Subscription that auto-renews, instead of a one-off
        // charge with a hand-set expires_at that nothing ever extends.
        // Tiers without a configured plan code (see paystack-plans.ts)
        // fall back to the previous one-off-charge behavior.
        plan: planCodeForTier(baseTierSlug, resolvedInterval),
      })
    );

    const authorizationUrl = transaction?.data?.authorization_url;
    if (!authorizationUrl) {
      logger.error('Paystack init: no authorization_url in response', { transaction });
      return NextResponse.json({ error: 'Could not start checkout' }, { status: 502 });
    }

    // Normalized to { url }, matching Stripe/NOWPayments, so the frontend
    // handles all three providers identically. Paystack's raw response
    // nests the real redirect URL at data.authorization_url — returning
    // the raw transaction object (as this route used to) left the
    // frontend with no consistent field to redirect the browser to.
    return NextResponse.json({ url: authorizationUrl, reference: transaction?.data?.reference });
  } catch (err) {
    logger.error('Paystack init error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}
