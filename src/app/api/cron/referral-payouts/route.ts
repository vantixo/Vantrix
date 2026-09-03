import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { releaseMaturedHolds, checkAndAwardVolumeBonuses } from '@/lib/referral-engine';
import { payPartner, PaystackTransferError } from '@/lib/paystack-transfer';
import { MIN_PAYOUT_NGN } from '@/lib/referral-config';
import { requireCronAuth } from '@/lib/security';
import { env } from '@/env';
import { logger, bg } from '@/lib/logger';
import { emitNotification } from '@/lib/notifications/emit';
import { heartbeatStart, heartbeatSuccess, heartbeatFail } from '@/lib/cron/heartbeat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/referral-payouts
 *
 * Run weekly via Vercel Cron (add ONE entry to vercel.json — see this
 * package's README for the exact cron-budget note). Protect with
 * CRON_SECRET like the rest of the app's cron routes.
 *
 * Steps:
 *  1. Release any commission whose 14-day refund-hold has matured.
 *  2. Group all 'payable' commissions by partner.
 *  3. Skip partners under MIN_PAYOUT_NGN (rolls over to next run).
 *  4. Atomically claim ('payable' -> 'processing') the commissions for a
 *     payout before transferring — guards against two overlapping runs
 *     both paying the same commissions under different payout references
 *     (see RACE-FIX below).
 *  5. Create a referral_payouts row + Paystack transfer for the rest.
 *
 * NOTE: actual Paystack Transfer API call is stubbed as `initiateTransfer`
 * below — wire it to your existing src/lib/payments/paystack.ts once this
 * is dropped into the main repo (that file already has the Paystack
 * secret-key client set up).
 */
export async function GET(req: NextRequest) {
  // CRON-AUTH-FIX: this was the one cron route out of 19 not using
  // requireCronAuth() — it hand-rolled `auth !== \`Bearer ${process.env.CRON_SECRET}\``
  // instead. Two real problems with that, on the route that authorizes actual
  // Paystack money transfers:
  //   1. Plain `!==` on a secret leaks timing signal byte-by-byte, same class
  //      of bug fixed on the admin bootstrap route previously (MED-1).
  //   2. It read `process.env.CRON_SECRET` directly instead of the validated
  //      `env.CRON_SECRET` (env.ts enforces this is set and >=32 chars at
  //      boot) — if the var were ever unset, `undefined` gets template-
  //      stringified into the literal comparison target `"Bearer undefined"`,
  //      which a request literally sending that header would pass.
  // requireCronAuth() (src/lib/security.ts) is the same helper every other
  // cron route already uses — timing-safe, and checks x-cron-secret (Vercel
  // Cron's actual header) before falling back to Authorization: Bearer.
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
  );

  // MAINTENANCE-FIX: this was the one cron route (of 28) with no dead-man's-
  // switch coverage and no top-level try/catch — notably the one that moves
  // real money via Paystack transfers. An unhandled throw (e.g.
  // releaseMaturedHolds failing) previously surfaced only as a bare 500 with
  // no heartbeat signal and no structured log entry, so a broken payout run
  // would go unnoticed until a partner complained about a missed payout.
  // Wired to the same heartbeatStart/Success/Fail + logger pattern every
  // other cron route already uses (see billing-recovery/route.ts).
  await heartbeatStart('REFERRAL_PAYOUTS');

  try {
    const { released } = await releaseMaturedHolds(supabase);

    const { data: payable } = await supabase
      .from('referral_commissions')
      .select('id,partner_id,commission_ngn')
      .eq('status', 'payable');

    const byPartner = new Map<string, { commissionIds: string[]; totalNgn: number }>();
    for (const row of payable ?? []) {
      const entry = byPartner.get(row.partner_id) ?? { commissionIds: [], totalNgn: 0 };
      entry.commissionIds.push(row.id);
      entry.totalNgn += Number(row.commission_ngn);
      byPartner.set(row.partner_id, entry);
    }

    // VOLUME-BONUS-FIX: INFLUENCER_VOLUME_BONUSES_NGN was defined in
    // referral-config.ts but never actually paid — check every active
    // influencer partner for a newly-earned volume-bonus tier and fold it
    // into their payout total (as a one-time fixed amount, not a
    // commission row, so it doesn't get double-counted on a future run —
    // see the UNIQUE(partner_id, min_paying_referrals) constraint).
    const { data: influencerPartners } = await supabase
      .from('referral_partners')
      .select('id')
      .eq('class', 'influencer')
      .eq('status', 'active');

    const volumeBonusResults: { partnerId: string; bonusNgn: number; tier: number | null }[] = [];
    for (const partner of influencerPartners ?? []) {
      const { awardedNgn, tier } = await checkAndAwardVolumeBonuses(supabase, {
        partnerId: partner.id,
        partnerClass: 'influencer',
      });
      if (awardedNgn > 0) {
        const entry = byPartner.get(partner.id) ?? { commissionIds: [], totalNgn: 0 };
        entry.totalNgn += awardedNgn;
        byPartner.set(partner.id, entry);
        volumeBonusResults.push({ partnerId: partner.id, bonusNgn: awardedNgn, tier });
      }
    }

    const results: { partnerId: string; totalNgn: number; status: string }[] = [];

    for (const [partnerId, { commissionIds, totalNgn }] of byPartner) {
      if (totalNgn < MIN_PAYOUT_NGN) {
        results.push({ partnerId, totalNgn, status: 'rolled_over_below_minimum' });
        continue;
      }

      const { data: partner } = await supabase
        .from('referral_partners')
        .select('user_id,payout_bank_code,payout_account_no,payout_account_name')
        .eq('id', partnerId)
        .single();

      if (!partner?.payout_bank_code || !partner?.payout_account_no) {
        results.push({ partnerId, totalNgn, status: 'skipped_no_bank_details' });
        continue;
      }

      const { data: payoutRow, error: payoutErr } = await supabase
        .from('referral_payouts')
        .insert({ partner_id: partnerId, total_ngn: totalNgn, status: 'queued' })
        .select('id')
        .single();

      if (payoutErr || !payoutRow) {
        results.push({ partnerId, totalNgn, status: 'failed_to_queue' });
        continue;
      }

      // RACE-FIX: claim these specific commissions before initiating a
      // transfer for them. Without this, two overlapping cron runs (retry,
      // manual trigger, slow run bleeding into the next scheduled tick) could
      // both select the same 'payable' rows above, each mint its own
      // referral_payouts row (its own id/reference), and each independently
      // call payPartner — a real double-pay, since Paystack's reference-based
      // transfer dedup only protects a single reference from being reused,
      // not two different references paying the same underlying commissions.
      // Status stays 'payable' throughout (the CHECK constraint only allows
      // pending/clawed_back/payable/paid — no 'processing' value exists to
      // claim through), so payout_id IS NULL is the claim signal instead:
      // only one concurrent run can flip all of `commissionIds` from
      // payout_id=null to this run's payoutRow.id and get every row back; a
      // run that loses the race gets fewer rows than it asked for and backs
      // off rather than paying.
      const { data: claimed, error: claimErr } = await supabase
        .from('referral_commissions')
        .update({ payout_id: payoutRow.id })
        .in('id', commissionIds)
        .eq('status', 'payable')
        .is('payout_id', null)
        .select('id');

      if (claimErr || (claimed?.length ?? 0) !== commissionIds.length) {
        // Partial or failed claim — another run got there first (or is
        // concurrently claiming). Don't pay a partial amount against a
        // payout row that promised the full total; release what we did
        // claim back so it's picked up cleanly next run, and mark this
        // payout attempt aborted rather than silently disappearing.
        if (claimed?.length) {
          await supabase.from('referral_commissions')
            .update({ payout_id: null })
            .in('id', claimed.map(c => c.id))
            .eq('payout_id', payoutRow.id);
        }
        await supabase.from('referral_payouts')
          .update({ status: 'failed', failure_reason: 'commission claim race — see RACE-FIX' })
          .eq('id', payoutRow.id);
        results.push({ partnerId, totalNgn, status: 'skipped_claim_race' });
        continue;
      }

      try {
        // Cast at the boundary: SupabaseClient's generated types are too deep
        // for a structural comparison against payPartner's narrow client
        // interface (TS2589) — payPartner itself stays fully typed against
        // exactly the two calls it makes, so this is the one documented
        // pass-through cast rather than an untyped `any` inside the function.
        const transfer = await payPartner(supabase as unknown as Parameters<typeof payPartner>[0], {
          partnerId,
          amountNgn: totalNgn,
          payoutId: payoutRow.id,
        });

        await supabase.from('referral_payouts')
          .update({ status: 'sent', paystack_transfer_code: transfer.transferCode, sent_at: new Date().toISOString() })
          .eq('id', payoutRow.id);

        await supabase.from('referral_commissions')
          .update({ status: 'paid' })
          .in('id', commissionIds)
          .eq('payout_id', payoutRow.id);

        if (partner.user_id) {
          emitNotification({
            userId: partner.user_id,
            type: 'referral_reward',
            title: 'Referral payout sent',
            body: `Your referral payout of ₦${totalNgn.toLocaleString()} has been sent.`,
            ctaUrl: '/referrals',
            urgency: 'medium',
            metadata: { payoutId: payoutRow.id, totalNgn },
          }).catch(bg('emitNotification.referralPayout'));
        }

        results.push({ partnerId, totalNgn, status: 'sent' });
      } catch (err) {
        const message = err instanceof PaystackTransferError ? err.message : (err as Error).message;
        await supabase.from('referral_payouts')
          .update({ status: 'failed', failure_reason: message })
          .eq('id', payoutRow.id);
        // Release the claim so these commissions are retried next run rather
        // than stuck unpayable forever after a failed transfer.
        await supabase.from('referral_commissions')
          .update({ payout_id: null })
          .in('id', commissionIds)
          .eq('payout_id', payoutRow.id);
        results.push({ partnerId, totalNgn, status: 'transfer_failed' });
      }
    }

    logger.info('cron:referral-payouts:complete', {
      holdsReleased: released,
      volumeBonusesAwarded: volumeBonusResults.length,
      payoutCount: results.length,
      failedCount: results.filter(r => r.status === 'transfer_failed' || r.status === 'failed_to_queue' || r.status === 'skipped_claim_race').length,
    });
    await heartbeatSuccess('REFERRAL_PAYOUTS');
    return NextResponse.json({ holdsReleased: released, volumeBonusesAwarded: volumeBonusResults, payouts: results });
  } catch (err) {
    logger.error('cron:referral-payouts:failed', { error: String(err) });
    await heartbeatFail('REFERRAL_PAYOUTS');
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
