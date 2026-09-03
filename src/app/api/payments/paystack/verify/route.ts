/**
 * GET  /api/payments/paystack/verify — redirect verify after checkout
 * POST /api/payments/paystack/verify — webhook (charge.success, subscription.disable)
 *
 * HIGH-2 fix (prior audit):
 *   profiles.tier is updated after successful Paystack payment.
 *
 * CRIT-6 fix: Token crediting — subscribers' gift-economy balance is now
 *   credited via credit_subscription_tokens() on every confirmed payment.
 *   Previously profiles.tier changed but tokens never incremented.
 *
 * Recurring billing fix: previously initializePaystackTransaction() never
 * passed a `plan` code, so every payment was a one-off charge with a
 * hand-set expires_at — there was no actual Paystack-managed Subscription
 * and therefore no automatic renewal mechanism at all. Now that
 * paystack/initialize/route.ts passes a real plan code, Paystack creates a
 * genuine Subscription and fires charge.success again on every renewal.
 *
 * The renewal charge.success payload is NOT safe to resolve via metadata —
 * Paystack does not document/guarantee that the original transaction's
 * metadata survives onto subscription-driven renewal charges. Instead:
 *   - data.customer.customer_code is Paystack's own stable identifier,
 *     always present, and is what every renewal is resolved through.
 *   - data.plan.plan_code identifies which tier this renewal is for.
 * customer_code is captured and stored on profiles the first time we see
 * it (whichever of GET-redirect or POST-webhook arrives first for the
 * initial payment), so every subsequent renewal resolves cleanly even
 * though it never carries our metadata.
 *
 * Tier whitelist applied to prevent metadata injection (mirrors Stripe webhook).
 *
 * TOKEN-PACK FIX: this route previously only ever handled subscription
 * (tier) purchases. paystack/checkout-tokens/route.ts now also routes
 * one-off token-pack purchases through here, marked with
 * metadata.type === 'token_pack' — same discriminator the Stripe webhook
 * already uses (see stripe/webhook/route.ts). That branch is checked FIRST
 * in both GET and POST below, before any tier/subscription resolution,
 * since a token-pack transaction carries no tier at all.
 */
import { env } from '@/env';
import { NextRequest, NextResponse } from 'next/server';
import crypto                        from 'crypto';
import { verifyPaystackTransaction } from '@/lib/payments/paystack';
import { tierForPlanCode }           from '@/lib/payments/paystack-plans';
import { supabaseAdmin }             from '@/lib/supabase/admin';
import { logger, bg }                from '@/lib/logger';
import { tokensForTier }             from '@/lib/payments/subscription-tokens';
import { timingSafeEqual }           from '@/lib/security';
import { recordCommissionForPayment, clawBackCommission, markRefereeDiscountUsed } from '@/lib/referral-engine';
import { emitNotification } from '@/lib/notifications/emit';
import { captureEvent } from '@/lib/analytics/server';
import { flagForRevocation } from '@/lib/payments/revocation';
import { claimWebhookEvent, releaseWebhookEvent } from '@/lib/payments/webhook-claim';

export const dynamic = 'force-dynamic';

const REFERENCE_RE = /^[a-zA-Z0-9_-]{8,100}$/;
// TIER-RENAME FIX: see stripe/webhook/route.ts's identical fix — the
// incoming tier string is DB-driven (tiers.base_tier_slug). The 20260937
// backfill migration has shipped and been verified live — base_tier_slug
// now only ever holds 'free'/'premium' — so the transitional 'spark'
// acceptance that used to live here has been removed.
const VALID_TIERS  = new Set(['premium']);

function safeTierFrom(raw: string | undefined): string {
  return raw && VALID_TIERS.has(raw) ? raw : 'premium';
}

/**
 * Days to add to expires_at per billing interval. Annual subscriptions
 * previously got the same hardcoded +30 days as monthly ones — meaning an
 * annual subscriber would be silently downgraded to 'free' by the nightly
 * expiry cron a month after paying for a full year. This map is the fix.
 */
const EXPIRY_DAYS: Record<'monthly' | 'quarterly' | 'annual', number> = { monthly: 30, quarterly: 90, annual: 365 };
const TOKEN_MONTHS: Record<'monthly' | 'quarterly' | 'annual', number> = { monthly: 1, quarterly: 3, annual: 12 };

/** Credit tokens + upsert subscription + update profile tier atomically. */
async function activatePaystackSubscription(params: {
  userId:             string;
  tier:               string;
  amount:             number;
  idempKey:           string;
  customerCode?:      string;
  subscriptionCode?:  string;
  authorizationCode?: string;
  billingInterval?:   'monthly' | 'quarterly' | 'annual';
  /** For analytics segmentation only — doesn't affect the DB writes below. */
  isRenewal?:         boolean;
}): Promise<void> {
  const { userId, tier, amount, idempKey, customerCode, subscriptionCode, authorizationCode, isRenewal } = params;
  const billingInterval = params.billingInterval ?? 'monthly';
  const safeTier    = safeTierFrom(tier);
  // Annual subscribers are credited a full year of tokens up front on
  // activation (tokensForTier already returns the per-cycle amount; the
  // annual tiers table row stores tokens_per_month * 12, but token credits
  // here are driven by the base tier slug, so multiply explicitly).
  const tokenCredit = tokensForTier(safeTier) * TOKEN_MONTHS[billingInterval];
  const now         = new Date().toISOString();
  const expiryDays   = EXPIRY_DAYS[billingInterval];

  // Business logic first — idempotency record written after.
  // This prevents a silent failure where processed_webhooks is marked done
  // but the profile/subscription was never actually updated.
  const [subResult, profileResult, tokenResult] = await Promise.all([
    supabaseAdmin.from('subscriptions').upsert({
      user_id:    userId,
      tier:       safeTier,
      provider:   'paystack',
      status:     'active',
      amount,
      currency:   'NGN',
      billing_interval: billingInterval,
      expires_at: new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString(),
      last_charged_at: now,
      // Recurring-billing identifiers — only updated when this charge
      // actually carried them (renewal events on an existing subscription
      // typically repeat the same subscription_code; undefined fields are
      // simply omitted from the upsert payload below rather than
      // clobbering a previously-stored value with null).
      ...(subscriptionCode  ? { paystack_subscription_code:  subscriptionCode  } : {}),
      ...(authorizationCode ? { paystack_authorization_code: authorizationCode } : {}),
    }, { onConflict: 'user_id,provider' }),

    // HIGH-2: activate the paid tier. Also captures customer_code on the
    // profile the first time we see it, so every future renewal — which
    // does NOT reliably carry our metadata — can still be resolved back to
    // this user via Paystack's own stable identifier.
    supabaseAdmin.from('profiles').update({
      tier: safeTier,
      ...(customerCode ? { paystack_customer_code: customerCode } : {}),
    }).eq('id', userId),

    // CRIT-6: credit subscription tokens
    ...(tokenCredit > 0
      ? [supabaseAdmin.rpc('credit_subscription_tokens', {
          p_user_id: userId,
          p_amount:  tokenCredit,
        })]
      : [Promise.resolve({ error: null })]
    ),
  ]);

  // Supabase-js never throws on a failed write — it resolves { data, error }.
  // Without checking .error, a failed DB write is indistinguishable from a
  // success: the event gets marked processed below and Paystack stops
  // retrying, silently losing the subscription/tokens.
  if (subResult.error)     throw new Error(`subscriptions upsert failed: ${subResult.error.message}`);
  if (profileResult.error) throw new Error(`profiles update failed: ${profileResult.error.message}`);
  if (tokenResult.error)   throw new Error(`credit_subscription_tokens failed: ${tokenResult.error.message}`);

  // The event is already claimed atomically in processed_webhooks by the
  // caller (see claimWebhookEvent() in GET/POST below) before this
  // function runs — no additional insert needed here. If any of the
  // writes above had failed, the throw propagates to the caller, which
  // releases the claim so a retry can reprocess this event.
  logger.info('Paystack subscription activated', { userId, tier: safeTier, tokenCredit, isRenewal: !!customerCode === false });

  if (isRenewal) {
    emitNotification({
      userId,
      type: 'subscription_renewal',
      title: 'Subscription renewed',
      body: `Your ${safeTier} subscription renewed successfully.`,
      ctaUrl: '/premium',
      urgency: 'low',
      metadata: { tier: safeTier, provider: 'paystack', amount, tokenCredit },
    }).catch(bg('emitNotification.subscriptionRenewal'));
  }

  captureEvent(userId, 'subscription_activated', {
    tier: safeTier,
    provider: 'paystack',
    billing_interval: billingInterval,
    amount,
    currency: 'NGN',
    is_trial: false, // Paystack has no separate trial-checkout path — every activation here is a real charge
    is_renewal: !!isRenewal,
  });

  // Referral commission (NGN already — no conversion needed). Isolated
  // try/catch: must never affect the already-successful subscription
  // activation above.
  try {
    const { data: conversion } = await supabaseAdmin
      .from('referral_conversions')
      .select('id')
      .eq('referred_user_id', userId)
      .maybeSingle();

    const monthNumber = conversion
      ? ((await supabaseAdmin
          .from('referral_commissions')
          .select('id', { count: 'exact', head: true })
          .eq('conversion_id', conversion.id)).count ?? 0) + 1
      : 1;

    const result = await recordCommissionForPayment(supabaseAdmin, {
      payerId: userId,
      sourcePaymentId: idempKey,
      paymentAmountNgn: amount,
      monthNumber,
    });
    if (result.status === 'commission_recorded' || result.status === 'token_bonus') {
      logger.info('Referral commission recorded', { userId, provider: 'paystack', monthNumber, status: result.status });
    }
    // REFERRAL-DISCOUNT-FIX: see stripe/webhook/route.ts for the full
    // rationale — burn the one-time discount only once payment clears.
    if (monthNumber === 1) {
      await markRefereeDiscountUsed(supabaseAdmin, userId);
    }
  } catch (referralErr: unknown) {
    logger.error('Referral commission recording failed (non-fatal)', {
      userId, idempKey, error: referralErr instanceof Error ? referralErr.message : String(referralErr),
    });
  }
}

/**
 * Credits a one-off token-pack purchase. Mirrors the token-credit slice of
 * activatePaystackSubscription() above but does nothing else — no tier
 * change, no subscriptions row, no referral commission (token packs aren't
 * part of the recurring-revenue referral program). Mirrors the Stripe
 * webhook's identical `metadata?.type === 'token_pack'` branch.
 */
async function creditPaystackTokenPack(params: {
  userId:  string;
  tokens:  number;
  packId?: string;
}): Promise<void> {
  const { userId, tokens, packId } = params;
  if (tokens > 0) {
    const { error } = await supabaseAdmin.rpc('credit_subscription_tokens', {
      p_user_id: userId,
      p_amount:  tokens,
    });
    if (error) throw new Error(`credit_subscription_tokens failed: ${error.message}`);
  }

  logger.info('Paystack token pack credited', { userId, packId, tokens });

  emitNotification({
    userId,
    type: 'token_purchase',
    title: 'Tokens purchased',
    body: `${tokens.toLocaleString()} tokens have been added to your balance.`,
    ctaUrl: '/premium',
    urgency: 'low',
    metadata: { tokens, packId },
  }).catch(bg('emitNotification.tokenPurchase'));
}

/**
 * Resolves which user a charge belongs to. Initial payments carry our
 * metadata directly; renewal charges resolve through the stored
 * customer_code instead (see module header for why metadata isn't trusted
 * for renewals). Returns null if neither path resolves — caller must no-op
 * rather than guess.
 */
async function resolveUserId(
  metadata: { userId?: string; tier?: string } | undefined,
  customerCode: string | undefined,
): Promise<{ userId: string; tier: string } | null> {
  if (metadata?.userId && metadata?.tier) {
    return { userId: metadata.userId, tier: metadata.tier };
  }
  if (customerCode) {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, tier')
      .eq('paystack_customer_code', customerCode)
      .maybeSingle();
    if (profile) return { userId: profile.id, tier: profile.tier };
  }
  return null;
}



/**
 * Extracts a plan code and subscription code from a Paystack transaction
 * payload, defensively checking multiple possible field shapes.
 *
 * Honest caveat: Paystack's docs confirm `plan_object` appears on the
 * VERIFY TRANSACTION response (shown populated as `{}` in their sample —
 * i.e. the field exists, format unconfirmed when non-empty), but no
 * documented sample payload shows these fields populated on a renewal
 * charge.success WEBHOOK specifically. Rather than assume one exact shape
 * I cannot verify against a live event, this checks several plausible
 * variants and returns undefined if none match — callers must treat that
 * as "couldn't identify this as a subscription renewal via the fast path"
 * and rely on the cron safety net (api/cron/paystack-renewal) instead of
 * silently misbehaving on an unexpected shape.
 */
function extractPlanAndSubscriptionCodes(data: {
  plan?: unknown;
  plan_object?: { plan_code?: string };
  subscription_code?: string;
  subscription?: { subscription_code?: string };
}): { planCode: string | undefined; subscriptionCode: string | undefined } {
  let planCode: string | undefined;
  if (typeof data.plan === 'string') planCode = data.plan;
  else if (data.plan && typeof data.plan === 'object' && 'plan_code' in data.plan) {
    planCode = (data.plan as { plan_code?: string }).plan_code;
  } else if (data.plan_object?.plan_code) {
    planCode = data.plan_object.plan_code;
  }

  const subscriptionCode = data.subscription_code ?? data.subscription?.subscription_code;

  return { planCode, subscriptionCode };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const reference = searchParams.get('reference');

  if (!reference || !REFERENCE_RE.test(reference)) {
    return NextResponse.json({ error: 'Invalid reference format', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const claim = await claimWebhookEvent(`paystack-${reference}`, 'paystack');
  if (claim.error) {
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
  if (!claim.claimed) {
    return NextResponse.redirect(`${env.NEXT_PUBLIC_APP_URL}/premium/success`);
  }

  try {
    const verification = await verifyPaystackTransaction(reference);

    if (verification.data?.status === 'success') {
      const rawMetadata = verification.data.metadata as
        { type?: string; userId?: string; tier?: string; billingInterval?: string; packId?: string; tokens?: string } | undefined;

      // ── Token pack purchase (one-off charge, no tier) ─────────────────────
      // Checked first — a token-pack transaction has no tier at all, so it
      // must never fall into the subscription-resolution path below.
      if (rawMetadata?.type === 'token_pack' && rawMetadata.userId) {
        const tokens = parseInt(rawMetadata.tokens ?? '0', 10);
        await creditPaystackTokenPack({ userId: rawMetadata.userId, tokens, packId: rawMetadata.packId });
        return NextResponse.redirect(`${env.NEXT_PUBLIC_APP_URL}/profile/tokens?purchase=success&provider=paystack`);
      }

      const metadata = rawMetadata as { userId?: string; tier?: string; billingInterval?: string } | undefined;
      const customerCode = verification.data.customer?.customer_code as string | undefined;
      const { planCode, subscriptionCode } = extractPlanAndSubscriptionCodes(verification.data);
      const authorizationCode = verification.data.authorization?.authorization_code as string | undefined;
      void planCode; // resolved tier comes from metadata here — verify-redirect always has it (same browser session as the original payment)

      const resolved = await resolveUserId(metadata, customerCode);
      if (!resolved) {
        logger.error('Paystack verify: could not resolve user', { reference });
        // RACE FIX: this request already won the idempotency claim above
        // (before verification ran) but isn't going to activate anything —
        // leaving the claim held would permanently block the real POST
        // webhook for this same reference from ever processing it (it would
        // see claim.claimed === false and silently no-op forever). Release
        // so a retry — this GET again, or the webhook — can still claim it.
        await releaseWebhookEvent(`paystack-${reference}`);
        return NextResponse.json({ error: 'Invalid metadata' }, { status: 400 });
      }
      const billingInterval = (['quarterly', 'annual'].includes(metadata?.billingInterval ?? '') ? metadata?.billingInterval : 'monthly') as 'monthly' | 'quarterly' | 'annual';

      await activatePaystackSubscription({
        userId:   resolved.userId,
        tier:     resolved.tier,
        amount:   (verification.data.amount as number) / 100,
        idempKey: `paystack-${reference}`,
        customerCode,
        subscriptionCode,
        authorizationCode,
        billingInterval,
        isRenewal: false, // this route only runs immediately after the user's own checkout redirect
      });
    } else {
      // RACE FIX: same reasoning as above — this GET won the claim before
      // knowing the transaction's real status. A non-'success' status here
      // (pending, abandoned, failed, etc.) means nothing was activated, so
      // the claim must be released. Without this, a user whose browser
      // redirects back before Paystack's own side has finalized the charge
      // would have this GET silently swallow the idempotency slot, and the
      // legitimate charge.success webhook that arrives moments later would
      // find the reference already "claimed" and skip activation entirely
      // — the user would have paid and never be upgraded.
      await releaseWebhookEvent(`paystack-${reference}`);
      logger.warn('Paystack verify: transaction not successful, claim released for retry/webhook', {
        reference, status: verification.data?.status,
      });
    }
  } catch (err: unknown) {
    logger.error('Paystack verify error', {
      error: err instanceof Error ? err.message : String(err),
    });
    await releaseWebhookEvent(`paystack-${reference}`);
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }

  return NextResponse.redirect(`${env.NEXT_PUBLIC_APP_URL}/premium/success`);
}

export async function POST(req: NextRequest) {
  const payload = await req.text();
  const hash    = req.headers.get('x-paystack-signature');
  const secret  = env.PAYSTACK_SECRET_KEY;

  const expected = crypto.createHmac('sha512', secret).update(payload).digest('hex');

  if (!timingSafeEqual(hash ?? '', expected)) {
    logger.error('Paystack webhook: invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const event = JSON.parse(payload) as {
    event: string;
    data?: {
      reference?: string;
      metadata?: { type?: string; userId?: string; tier?: string; packId?: string; tokens?: string };
      amount?: number;
      customer?: { customer_code?: string };
      plan?: unknown;
      plan_object?: { plan_code?: string };
      subscription_code?: string;
      subscription?: { subscription_code?: string };
      authorization?: { authorization_code?: string };
    };
  };

  // ── charge.success — fires for BOTH the initial payment and every
  // subscription renewal (Paystack does not send a separate "renewal"
  // event). A populated plan/subscription field means this is a
  // subscription-driven charge; its absence means a genuine one-off charge.
  if (event.event === 'charge.success' && event.data) {
    const { reference, metadata, amount, customer, authorization } = event.data;
    if (!reference) return NextResponse.json({ received: true });

    // ── Token pack purchase (one-off charge, no tier/subscription) ─────────
    // Checked first, same as the GET handler above — a token-pack charge
    // always carries our metadata (it's never a renewal, so there's no
    // customer_code-fallback path to worry about the way subscriptions
    // have). Distinguished by metadata.type, mirroring the Stripe webhook.
    if (metadata?.type === 'token_pack' && metadata.userId) {
      const idempKey = `paystack-${reference}`;
      const claim = await claimWebhookEvent(idempKey, 'paystack');
      if (claim.claimed) {
        try {
          const tokens = parseInt(metadata.tokens ?? '0', 10);
          await creditPaystackTokenPack({ userId: metadata.userId, tokens, packId: metadata.packId });
        } catch (err: unknown) {
          logger.error('Paystack webhook: token_pack charge.success processing failed', {
            reference, error: err instanceof Error ? err.message : String(err),
          });
          await releaseWebhookEvent(idempKey);
          return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
        }
      }
      return NextResponse.json({ received: true });
    }

    const customerCode = customer?.customer_code;
    const { planCode, subscriptionCode } = extractPlanAndSubscriptionCodes(event.data);
    const planMatch      = tierForPlanCode(planCode);
    const effectiveMeta = planMatch ? { userId: metadata?.userId, tier: planMatch.tier } : metadata;

    const resolved = await resolveUserId(effectiveMeta, customerCode);
    if (!resolved) {
      // Genuinely unresolvable (e.g. a charge for something this webhook
      // doesn't manage) — no-op rather than guess.
      return NextResponse.json({ received: true });
    }

    // planMatch is the authoritative source for billing interval on
    // renewals (metadata isn't trusted here — see module header). Falls
    // back to 'monthly' only when the plan code couldn't be matched at all,
    // which the existing comments already treat as "rely on the cron
    // safety net" territory rather than a case worth guessing annual for.
    const billingInterval = planMatch?.interval ?? 'monthly';

    const idempKey = `paystack-${reference}`;
    const claim = await claimWebhookEvent(idempKey, 'paystack');

    if (claim.claimed) {
      try {
        await activatePaystackSubscription({
          userId:   resolved.userId,
          tier:     resolved.tier,
          amount:   (amount ?? 0) / 100,
          idempKey,
          customerCode,
          subscriptionCode,
          authorizationCode: authorization?.authorization_code,
          billingInterval,
          isRenewal: !!customerCode === false, // mirrors the heuristic already used in the log line above — Paystack sends no explicit renewal flag
        });
      } catch (err: unknown) {
        logger.error('Paystack webhook: charge.success processing failed', {
          reference, error: err instanceof Error ? err.message : String(err),
        });
        await releaseWebhookEvent(idempKey);
        return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
      }
    }
  }

  // ── invoice.payment_failed — Paystack's documented event for a failed
  // subscription renewal attempt. Per Paystack's own docs: "Subscriptions
  // are not retried. When a payment attempt fails, it will not be
  // attempted again." This is exactly the gap the cron safety net
  // (api/cron/paystack-renewal) exists for — logged prominently here so
  // it's visible immediately rather than only discovered when expires_at
  // silently lapses and the nightly downgrade cron catches it days later.
  if (event.event === 'invoice.payment_failed' && event.data) {
    const customerCode = event.data.customer?.customer_code;
    logger.error('Paystack subscription renewal failed', {
      customerCode,
      reference: event.data.reference,
      // The renewal-safety-net cron will attempt a manual retry via
      // charge_authorization before expires_at; no immediate action is
      // taken here beyond visibility, since Paystack itself won't retry.
    });
  }

  // ── subscription.disable — fires when a subscription is cancelled (either
  // explicitly, or automatically after exhausting its invoice_limit). The
  // nightly expiry cron handles passive lapse at expires_at; this covers
  // immediate/explicit cancellation so the tier reverts right away, mirroring
  // the Stripe webhook's customer.subscription.deleted handling.
  if (event.event === 'subscription.disable' && event.data) {
    const customerCode = event.data.customer?.customer_code;
    if (customerCode) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('paystack_customer_code', customerCode)
        .maybeSingle();

      if (profile) {
        const idempKey = `paystack-disable-${event.data.subscription_code ?? customerCode}`;
        const claim = await claimWebhookEvent(idempKey, 'paystack');

        if (claim.claimed) {
          try {
            await supabaseAdmin.from('subscriptions')
              .update({ status: 'cancelled' })
              .eq('user_id', profile.id)
              .eq('provider', 'paystack');

            // Only downgrade if no other active subscription covers this user
            // — mirrors the Stripe customer.subscription.deleted handler.
            // Without this, a user with (say) an active Stripe subscription
            // and a separately-lapsed Paystack one gets incorrectly bumped to
            // free the moment Paystack's side disables.
            const { data: otherActive } = await supabaseAdmin
              .from('subscriptions')
              .select('id')
              .eq('user_id', profile.id)
              .eq('status', 'active')
              .gt('expires_at', new Date().toISOString())
              .limit(1);

            if (!otherActive?.length) {
              await supabaseAdmin.from('profiles').update({ tier: 'free' }).eq('id', profile.id);
              logger.info('Paystack subscription cancelled — tier downgraded to free', { userId: profile.id });
            } else {
              logger.info('Paystack subscription cancelled — other active subscription retained, no downgrade', { userId: profile.id });
            }
          } catch (err: unknown) {
            logger.error('Paystack webhook: subscription.disable processing failed', {
              customerCode, error: err instanceof Error ? err.message : String(err),
            });
            await releaseWebhookEvent(idempKey);
            return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
          }
        }
      }
    }
  }

  // ── Refund / chargeback — claw back commission + flag the payer's tier ────
  // Paystack fires 'refund.processed' for refunds and 'charge.dispute.create'
  // for chargebacks. Both carry the original transaction reference, which is
  // exactly the sourcePaymentId (idempKey) recordCommissionForPayment used.
  //
  // UPDATED DECISION (see AUDIT_FINDINGS_LOG.md #1 and revocation.ts):
  // in addition to the commission clawback, flagForRevocation() starts a
  // grace period on the paying user's own tier — see stripe/webhook/route.ts
  // for the full rationale (identical policy across all 3 providers).
  if ((event.event === 'refund.processed' || event.event === 'charge.dispute.create') && event.data) {
    const eventData = event.data as {
      transaction_reference?: string;
      reference?: string;
      customer?: { customer_code?: string };
      metadata?: { userId?: string; tier?: string };
    };
    const reference = eventData.transaction_reference ?? eventData.reference;

    if (reference) {
      try {
        const { reversed } = await clawBackCommission(supabaseAdmin, reference);
        if (reversed) logger.info('Referral commission clawed back', { eventType: event.event, reference });
      } catch (clawErr: unknown) {
        logger.error('Referral clawback failed (non-fatal)', {
          reference, error: clawErr instanceof Error ? clawErr.message : String(clawErr),
        });
      }

      try {
        const resolved = await resolveUserId(eventData.metadata, eventData.customer?.customer_code);
        if (resolved) {
          await flagForRevocation(supabaseAdmin, {
            userId: resolved.userId,
            provider: 'paystack',
            sourcePaymentId: reference,
            eventType: event.event,
            reason: event.event === 'charge.dispute.create' ? 'dispute' : 'refund',
          });
        } else {
          logger.error('Revocation flag skipped — could not resolve userId for reference', {
            eventType: event.event, reference,
          });
        }
      } catch (flagErr: unknown) {
        logger.error('flagForRevocation failed (non-fatal)', {
          eventType: event.event, reference,
          error: flagErr instanceof Error ? flagErr.message : String(flagErr),
        });
      }
    }
  }

  return NextResponse.json({ received: true });
}
