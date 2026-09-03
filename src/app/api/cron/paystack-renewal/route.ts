/**
 * GET /api/cron/paystack-renewal — Paystack Recurring Billing Safety Net
 *
 * Runs every 6 hours (vercel.json cron). Finds active Paystack subscriptions
 * expiring within the next 24 hours and manually retries the charge via the
 * stored card authorization, extending expires_at on success.
 *
 * WHY THIS EXISTS AS A CRON, NOT JUST A WEBHOOK HANDLER:
 *
 * 1. Paystack's own docs state subscription charges are NEVER automatically
 *    retried on failure ("Subscriptions are not retried. When a payment
 *    attempt fails, it will not be attempted again.") — unlike Stripe's
 *    built-in dunning. A single failed renewal (expired card, insufficient
 *    funds) permanently lapses the subscription unless something retries it.
 *
 * 2. The real-time webhook fast path (verify/route.ts handling
 *    charge.success) depends on correctly parsing which fields Paystack
 *    populates on a subscription-driven renewal payload — a shape that
 *    could not be confirmed against a documented sample payload at the time
 *    this was built (see extractPlanAndSubscriptionCodes() in that file for
 *    the full caveat). This cron does not depend on that parsing being
 *    correct at all: it works directly off subscriptions.expires_at and
 *    paystack_authorization_code, both of which are populated deterministically
 *    by THIS codebase's own webhook handler, not by guessing Paystack's
 *    event shape.
 *
 * This is therefore the authoritative mechanism for keeping Paystack
 * subscriptions current — the webhook fast path is a (likely-correct,
 * but unverified) optimization on top of it, not a replacement for it.
 *
 * Security: requires CRON_SECRET header (Vercel Cron injects this automatically).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth }           from '@/lib/security';
import { supabaseAdmin }             from '@/lib/supabase/admin';
import { chargeAuthorization }       from '@/lib/payments/paystack';
import { tokensForTier }             from '@/lib/payments/subscription-tokens';
import { logger }                    from '@/lib/logger';
import { env }                       from '@/env';
import { heartbeatStart, heartbeatSuccess, heartbeatFail } from '@/lib/cron/heartbeat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RENEWAL_LOOKAHEAD_MS = 24 * 60 * 60 * 1000; // renew anything expiring in the next 24h
const BATCH_SIZE = 100;

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await heartbeatStart('PAYSTACK_RENEWAL');

  const cutoff = new Date(Date.now() + RENEWAL_LOOKAHEAD_MS).toISOString();
  let renewed = 0;
  let failed  = 0;
  let skipped = 0;

  try {
    const { data: dueSubs, error: fetchErr } = await supabaseAdmin
      .from('subscriptions')
      .select('id, user_id, tier, paystack_authorization_code, billing_interval, expires_at')
      .eq('provider', 'paystack')
      .eq('status', 'active')
      .lt('expires_at', cutoff)
      .limit(BATCH_SIZE);

    if (fetchErr) throw fetchErr;

    for (const sub of dueSubs ?? []) {
      if (!sub.paystack_authorization_code) {
        // No stored authorization — nothing this cron can do. The
        // subscription will lapse naturally at expires_at and the daily
        // downgrade cron will handle it; logged so it's visible rather
        // than silently dropped.
        logger.warn('cron:paystack-renewal:no-authorization', { userId: sub.user_id, tier: sub.tier });
        skipped++;
        continue;
      }

      // profiles has no email column — it lives on auth.users. A cron has no
      // user session to read it from (unlike initialize/route.ts, which gets
      // it from the authenticated request), so it's fetched via the admin
      // Auth API instead.
      const { data: userResult, error: userErr } = await supabaseAdmin.auth.admin.getUserById(sub.user_id);
      const email = userResult?.user?.email;

      if (userErr || !email) {
        logger.warn('cron:paystack-renewal:no-email', { userId: sub.user_id, error: userErr?.message });
        skipped++;
        continue;
      }

      // billing_interval may be null on rows written before this column
      // existed — treat that as 'monthly', same default used everywhere
      // else in this billing flow.
      const interval  = (sub.billing_interval as 'monthly' | 'quarterly' | 'annual' | null) ?? 'monthly';
      // Manual renewal retries must charge (and later set expires_at) for
      // whatever cadence the subscriber actually purchased. Previously this
      // always read the monthly row (`sub.tier` with no suffix), which for
      // an annual subscriber would silently retry-charge them the monthly
      // price and reset expires_at to only 30 days out — a real
      // undercharge and a surprise downgrade a month into a paid year.
      const priceSlug = interval === 'annual' ? `${sub.tier}_annual` : interval === 'quarterly' ? `${sub.tier}_quarterly` : sub.tier;

      const { data: tierRow } = await supabaseAdmin
        .from('tiers')
        .select('price_ngn')
        .eq('slug', priceSlug)
        .maybeSingle();

      if (!tierRow?.price_ngn) {
        logger.warn('cron:paystack-renewal:no-tier-price', { userId: sub.user_id, tier: sub.tier, interval });
        skipped++;
        continue;
      }

      // DOUBLE-CHARGE FIX: chargeAuthorization is the actual money movement.
      // Previously, if the charge succeeded but the subsequent expires_at
      // update or token credit failed (network blip, DB hiccup), expires_at
      // was never advanced — so this subscription was still under `cutoff`
      // and the NEXT cron run (6h later) would charge the card again for
      // the same renewal period, with nothing on either side to catch it
      // (chargeAuthorization was never given a reference for Paystack to
      // dedupe on, unlike initiateTransfer's payout reference elsewhere in
      // this codebase). Guard this the same way the webhook handlers guard
      // theirs: a stable per-attempt key checked BEFORE charging, recorded
      // AFTER the DB writes succeed. Keyed on the subscription id + the
      // expires_at value being renewed FROM, so a genuinely new renewal
      // window (once expires_at has moved forward) always gets a fresh key.
      const renewalAttemptKey = `paystack-renewal-${sub.id}-${sub.expires_at}`;

      try {
        const { data: existingAttempt } = await supabaseAdmin
          .from('processed_webhooks')
          .select('id')
          .eq('id', renewalAttemptKey)
          .maybeSingle();

        if (existingAttempt) {
          // A prior run already charged this exact renewal window; whatever
          // failed after that (DB write) needs manual reconciliation, not a
          // second charge. Log loudly and move on.
          logger.error('cron:paystack-renewal:already-charged-skip', {
            userId: sub.user_id, tier: sub.tier, subscriptionId: sub.id,
          });
          skipped++;
          continue;
        }

        const result = await chargeAuthorization({
          email,
          amountNgn:         tierRow.price_ngn,
          authorizationCode: sub.paystack_authorization_code,
        });

        if (result.data?.status !== 'success') {
          throw new Error(result.data?.gateway_response ?? 'charge not successful');
        }

        // Mark the charge landed BEFORE the follow-up DB writes — if those
        // fail below, the catch block logs a clear "charged but not
        // recorded" error instead of silently allowing a retry to re-charge.
        const { error: markErr } = await supabaseAdmin
          .from('processed_webhooks')
          .insert({ id: renewalAttemptKey, provider: 'paystack' });
        if (markErr) {
          logger.error('cron:paystack-renewal:charged-but-mark-failed — needs manual reconciliation', {
            userId: sub.user_id, tier: sub.tier, subscriptionId: sub.id, error: markErr.message,
          });
        }

        const now           = new Date();
        const renewalDays   = interval === 'annual' ? 365 : interval === 'quarterly' ? 90 : 30;
        const newExpiresAt  = new Date(now.getTime() + renewalDays * 24 * 60 * 60 * 1000).toISOString();
        const tokenCredit   = tokensForTier(sub.tier) * (interval === 'annual' ? 12 : interval === 'quarterly' ? 3 : 1);

        const [subUpdate, tokenUpdate] = await Promise.all([
          supabaseAdmin.from('subscriptions').update({
            expires_at:       newExpiresAt,
            last_charged_at:  now.toISOString(),
          }).eq('id', sub.id),
          tokenCredit > 0
            ? supabaseAdmin.rpc('credit_subscription_tokens', { p_user_id: sub.user_id, p_amount: tokenCredit })
            : Promise.resolve({ error: null }),
        ]);

        // These are logged (not thrown) once the charge is already marked
        // above — throwing here would just repeat the "charged but not
        // fully recorded" case that renewalAttemptKey exists to prevent
        // retrying via a second charge. Manual reconciliation picks up from
        // the error log; expires_at may lag until fixed, which is safe
        // (worst case the daily downgrade cron fires a bit early), unlike
        // a duplicate charge which is a real refund/support burden.
        if (subUpdate.error) {
          logger.error('cron:paystack-renewal:charged-but-expiry-update-failed', {
            userId: sub.user_id, subscriptionId: sub.id, error: subUpdate.error.message,
          });
        }
        if (tokenUpdate.error) {
          logger.error('cron:paystack-renewal:charged-but-token-credit-failed', {
            userId: sub.user_id, subscriptionId: sub.id, error: tokenUpdate.error.message,
          });
        }

        logger.info('cron:paystack-renewal:success', { userId: sub.user_id, tier: sub.tier });
        renewed++;
      } catch (chargeErr) {
        // Per Paystack's own docs, the FIRST automatic attempt is never
        // retried by Paystack itself — this cron's retry IS the retry.
        // If this also fails, log clearly and let the subscription lapse
        // naturally; the daily-reset cron will downgrade it at expires_at
        // exactly as it would for a subscriber who simply didn't renew.
        logger.error('cron:paystack-renewal:charge-failed', {
          userId: sub.user_id,
          tier:   sub.tier,
          error:  chargeErr instanceof Error ? chargeErr.message : String(chargeErr),
        });
        failed++;
      }
    }

    const result = { renewed, failed, skipped, checked: dueSubs?.length ?? 0 };
    logger.info('cron:paystack-renewal:complete', result);
    await heartbeatSuccess('PAYSTACK_RENEWAL');
    return NextResponse.json({ ok: true, ...result, timestamp: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message
      : (typeof err === 'object' && err !== null && 'message' in err)
        ? String((err as { message: unknown }).message)
        : String(err);
    logger.error('cron:paystack-renewal:failed', { error: message });
    await heartbeatFail('PAYSTACK_RENEWAL');
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
