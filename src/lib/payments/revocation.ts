/**
 * Automatic Premium revocation on refund/dispute — flag + grace period.
 *
 * Prior behavior (AUDIT_FINDINGS_LOG.md, flagged item #1): all 3 payment
 * providers clawed back the *referrer's* commission on a refund/dispute but
 * never touched the *paying user's* own tier — a successful dispute could
 * keep full paid access indefinitely.
 *
 * This module implements the follow-up product decision: flag the user
 * immediately (so it's visible), give them a grace period to resolve it or
 * for an admin to review it, then auto-downgrade if the flag is still
 * pending once the grace period lapses. Mirrors the codebase's existing
 * "otherActive" convention — a user holding more than one active
 * subscription grant is never blindly set to free.
 *
 * Call sites:
 *   - flagForRevocation()  — from each provider's refund/dispute webhook
 *     handler, alongside the existing clawBackCommission() call.
 *   - sweepExpiredFlags()  — from the revocation-sweep cron.
 *   - clearRevocationFlag() — from the admin review route
 *     (/api/admin/revocation-flags), when a human determines the
 *     refund/dispute doesn't warrant losing access.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger, bg } from '@/lib/logger';
import { emitNotification } from '@/lib/notifications/emit';

/** Days a flagged user keeps access before auto-downgrade, absent admin action. */
export const REVOCATION_GRACE_PERIOD_DAYS = 3;

export type RevocationProvider = 'stripe' | 'paystack' | 'nowpayments' | 'paddle';
export type RevocationReason = 'refund' | 'dispute';

export interface RevocationFlagRow {
  id: string;
  user_id: string;
  provider: string;
  source_payment_id: string;
  event_type: string;
  reason: string;
  status: 'pending' | 'cleared' | 'executed';
  grace_period_ends_at: string;
  created_at: string;
}

/**
 * Flags a user's subscription for automatic revocation once the grace
 * period lapses. Idempotent per (provider, source_payment_id) — a webhook
 * retry or a provider re-sending the same event just no-ops rather than
 * resetting the grace-period clock.
 *
 * Deliberately does NOT touch profiles.tier or subscriptions — that only
 * happens in sweepExpiredFlags(), after the grace period, so a user always
 * gets the full grace window regardless of when within it they read this.
 */
export async function flagForRevocation(
  supabase: SupabaseClient,
  params: {
    userId: string;
    provider: RevocationProvider;
    sourcePaymentId: string;
    eventType: string;
    reason: RevocationReason;
  }
): Promise<{ flagged: boolean; alreadyFlagged: boolean }> {
  const { userId, provider, sourcePaymentId, eventType, reason } = params;
  const graceEndsAt = new Date(Date.now() + REVOCATION_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('subscription_revocation_flags')
    .insert({
      user_id: userId,
      provider,
      source_payment_id: sourcePaymentId,
      event_type: eventType,
      reason,
      grace_period_ends_at: graceEndsAt,
    })
    .select('id')
    .maybeSingle();

  if (error) {
    // Unique violation on (provider, source_payment_id) means this exact
    // payment event was already flagged — expected on webhook retries, not
    // an error condition.
    if (error.code === '23505') {
      return { flagged: false, alreadyFlagged: true };
    }
    throw new Error(`flagForRevocation insert failed: ${error.message}`);
  }

  logger.info('Subscription flagged for revocation', {
    userId, provider, sourcePaymentId, reason, graceEndsAt,
  });

  emitNotification({
    userId,
    type: 'security_alert',
    title: reason === 'dispute' ? 'Payment dispute received' : 'Refund received',
    body: `We received a ${reason} on your subscription payment. If this wasn't intentional, contact support within ${REVOCATION_GRACE_PERIOD_DAYS} days to keep your access — otherwise your plan will revert to Free.`,
    ctaUrl: '/premium',
    urgency: 'high',
    metadata: { provider, sourcePaymentId, reason, graceEndsAt },
  }).catch(bg('emitNotification.revocationFlagged'));

  return { flagged: !!data, alreadyFlagged: false };
}

/**
 * Admin action: clears a pending flag before it executes (dispute resolved
 * in the user's favor, provider error, duplicate charge, etc). No-ops
 * (returns cleared: false) if the flag is already cleared or has already
 * executed — an executed flag needs a manual tier restore, not a clear.
 */
export async function clearRevocationFlag(
  supabase: SupabaseClient,
  params: { flagId: string; adminId: string; reason?: string }
): Promise<{ cleared: boolean; flag: RevocationFlagRow | null }> {
  const { data, error } = await supabase
    .from('subscription_revocation_flags')
    .update({
      status: 'cleared',
      cleared_at: new Date().toISOString(),
      cleared_by: params.adminId,
      clear_reason: params.reason ?? null,
    })
    .eq('id', params.flagId)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();

  if (error) throw new Error(`clearRevocationFlag update failed: ${error.message}`);
  if (!data) return { cleared: false, flag: null };

  logger.info('Revocation flag cleared by admin', { flagId: params.flagId, adminId: params.adminId });
  return { cleared: true, flag: data as RevocationFlagRow };
}

/**
 * Sweep entry point for the revocation-sweep cron. Finds every 'pending'
 * flag whose grace period has lapsed and downgrades the affected user —
 * unless another active subscription still covers them (same "otherActive"
 * check used by every explicit-cancellation handler in this codebase).
 */
export async function sweepExpiredFlags(
  supabase: SupabaseClient
): Promise<{ processed: number; downgraded: number; retained: number; errors: number }> {
  const { data: dueFlags, error } = await supabase
    .from('subscription_revocation_flags')
    .select('id, user_id, provider, source_payment_id, reason')
    .eq('status', 'pending')
    .lte('grace_period_ends_at', new Date().toISOString());

  if (error) throw new Error(`sweepExpiredFlags select failed: ${error.message}`);
  if (!dueFlags || dueFlags.length === 0) {
    return { processed: 0, downgraded: 0, retained: 0, errors: 0 };
  }

  let downgraded = 0;
  let retained = 0;
  let errors = 0;

  for (const flag of dueFlags) {
    try {
      const result = await executeRevocation(supabase, flag as RevocationFlagRow);
      if (result === 'downgraded') downgraded++;
      else retained++;
    } catch (err: unknown) {
      errors++;
      logger.error('Revocation sweep: failed to execute flag', {
        flagId: (flag as RevocationFlagRow).id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { processed: dueFlags.length, downgraded, retained, errors };
}

/**
 * Executes a single lapsed flag via the atomic `execute_subscription_revocation`
 * Postgres function (see supabase/migrations/20261217_atomic_subscription_revocation.sql).
 *
 * BUG FIX (this revision): this used to perform the cancel-subscription,
 * downgrade-profile, and mark-flag-executed writes as three separate,
 * unchecked calls from application code — if the profile downgrade failed
 * but the flag still got marked 'executed' (e.g. a transient DB error
 * between the two calls), the system would believe revocation completed
 * while the user silently kept paid access. Delegating to one Postgres
 * function makes all three writes succeed or fail together; if the RPC
 * throws, the flag stays 'pending' and is retried on the next sweep run
 * instead of being incorrectly marked done.
 */
async function executeRevocation(
  supabase: SupabaseClient,
  flag: Pick<RevocationFlagRow, 'id' | 'user_id' | 'provider' | 'source_payment_id' | 'reason'>
): Promise<'downgraded' | 'retained'> {
  const { data, error } = await supabase
    .rpc('execute_subscription_revocation', { p_flag_id: flag.id })
    .single();

  if (error) {
    throw new Error(`execute_subscription_revocation RPC failed: ${error.message}`);
  }

  const row = data as { outcome: string; out_user_id: string; out_provider: string; out_reason: string; previous_tier: string | null };

  if (row.outcome === 'already_executed' || row.outcome === 'not_pending') {
    logger.info('Revocation sweep: flag no longer pending, skipped', {
      flagId: flag.id, outcome: row.outcome, userId: flag.user_id,
    });
    // Treat as retained for the sweep's own counters — it wasn't a fresh
    // downgrade this run either way.
    return 'retained';
  }

  const outcome = row.outcome as 'downgraded' | 'retained';

  logger.info(
    outcome === 'downgraded'
      ? 'Revocation executed — tier downgraded to free'
      : 'Revocation flag lapsed — other active subscription retained, no downgrade',
    { userId: flag.user_id, provider: flag.provider, reason: flag.reason },
  );

  emitNotification({
    userId: flag.user_id,
    type: 'security_alert',
    title: outcome === 'downgraded' ? 'Subscription downgraded' : 'Refund/dispute processed',
    body: outcome === 'downgraded'
      ? "Your grace period on a refunded/disputed payment has ended and your plan reverted to Free. Contact support if you believe this is a mistake."
      : "A refunded/disputed payment's grace period ended, but another active subscription is keeping your access.",
    ctaUrl: '/premium',
    urgency: 'high',
    metadata: { provider: flag.provider, reason: flag.reason, outcome },
  }).catch(bg('emitNotification.revocationExecuted'));

  return outcome;
}
