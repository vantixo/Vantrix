/**
 * GET /api/cron/daily-reset — Comprehensive Daily Reset
 *
 * Runs at 00:00 UTC daily (vercel.json cron). Steps:
 *   1. Reset daily_messages_used for all users via RPC
 *   2. Expire stale subscriptions and downgrade tier (expire_subscriptions() RPC)
 *   3. Expire ended free trials via expire_trials() RPC
 *   4. Purge expired character_initiatives rows
 *   5. Purge processed_webhooks older than 90 days (DB hygiene)
 *   6. Prune stale active_sessions (older than 30 minutes)
 *   7. Archive heavy conversations > 250 messages (keep 200 live, rest
 *      moved to messages_archive — not deleted, see step 7 comment below)
 *   8. Heartbeat ping (dead man's switch)
 *
 * Security: Vercel Cron injects Authorization: Bearer {CRON_SECRET}.
 * requireCronAuth() validates this in timing-safe fashion.
 *
 * Observability: pings heartbeat on success/failure so a missed midnight run
 * is caught by healthchecks.io before users notice empty daily limits.
 */
import { NextRequest, NextResponse }                              from 'next/server';
import { requireCronAuth }                                        from '@/lib/security';
import { supabaseAdmin }                                          from '@/lib/supabase/admin';
import { logger }                                                 from '@/lib/logger';
import { env }                                                    from '@/env';
import { heartbeatStart, heartbeatSuccess, heartbeatFail }       from '@/lib/cron/heartbeat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SESSION_STALE_MS    = 30 * 60 * 1000;   // 30 minutes
const MESSAGE_HISTORY_CAP = 250;              // prune convos with > this many messages
const MESSAGE_HISTORY_KEEP = 200;             // keep this many after pruning

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await heartbeatStart('DAILY_RESET');

  const results: Record<string, unknown> = {};
  const now       = new Date().toISOString();
  let   hasError  = false;

  // ── 1. Reset daily message counts ──────────────────────────────────────────
  try {
    const { error } = await supabaseAdmin.rpc('daily_reset_message_counts');
    if (error) throw error;
    results.messageReset = 'ok';
    logger.info('cron:daily-reset:messages-reset');
  } catch (err) {
    hasError = true;
    results.messageReset = `error: ${String(err)}`;
    logger.error('cron:daily-reset:message-reset-failed', { error: String(err) });
  }

  // ── 2. Subscription expiry ──────────────────────────────────────────────
  // BUG FIX (2026-09-02): this previously hand-rolled pagination over
  // `subscriptions` and updated `profiles`/`subscriptions` directly from
  // the request process. That's wrong for a user with more than one
  // subscription — e.g. a Paystack sub still active while a Stripe sub
  // expires — since it downgraded on ANY expired row instead of checking
  // whether another active subscription remains. The canonical algorithm
  // already existed as the expire_subscriptions() DB function (see
  // supabase/migrations/20240101_production.sql) and correctly handles
  // that case, but nothing called it. Switched to the RPC so there is
  // exactly one implementation of subscription expiry. Counts are
  // returned by the function (see
  // 20260902_expire_subscriptions_return_counts.sql) purely for logging —
  // no batching/pagination needed here, the function processes all
  // eligible rows in one statement.
  try {
    const { data, error } = await supabaseAdmin.rpc('expire_subscriptions');
    if (error) throw error;
    const counts = (data ?? { expired: 0, downgraded: 0 }) as { expired: number; downgraded: number };
    results.subscriptionExpiry = counts;
    logger.info('cron:daily-reset:subscription-expiry', counts);
  } catch (err) {
    hasError = true;
    results.subscriptionExpiry = `error: ${String(err)}`;
    logger.error('cron:daily-reset:subscription-expiry-failed', { error: String(err) });
  }

  // ── 3. Expire ended free trials ───────────────────────────────────────────
  try {
    const { data: expiredCount, error } = await supabaseAdmin.rpc('expire_trials');
    if (error) throw error;
    results.trialsExpired = expiredCount ?? 0;
    logger.info('cron:daily-reset:trials-expired', { count: expiredCount });
  } catch (err) {
    hasError = true;
    results.trialsExpired = `error: ${String(err)}`;
    logger.error('cron:daily-reset:trials-expire-failed', { error: String(err) });
  }

  // ── 4. Purge expired character initiatives ─────────────────────────────────
  try {
    const { count: deleted, error } = await supabaseAdmin
      .from('character_initiatives')
      .delete({ count: 'exact' })
      .lt('expires_at', now);
    if (error) throw error;
    results.initiativesExpired = deleted ?? 0;
  } catch (err) {
    hasError = true;
    results.initiativesExpired = `error: ${String(err)}`;
    logger.error('cron:daily-reset:initiatives-expired-failed', { error: String(err) });
  }

  // ── 5. Purge old webhook records (> 90 days) ──────────────────────────────
  try {
    const { error } = await supabaseAdmin.rpc('purge_old_webhooks');
    if (error) throw error;
    results.webhooksPurged = 'ok';
    logger.info('cron:daily-reset:webhooks-purged');
  } catch (err) {
    hasError = true;
    results.webhooksPurged = `error: ${String(err)}`;
    logger.error('cron:daily-reset:webhook-purge-failed', { error: String(err) });
  }

  // ── 6. Prune stale active sessions ────────────────────────────────────────
  try {
    const staleThreshold = new Date(Date.now() - SESSION_STALE_MS).toISOString();
    const { error } = await supabaseAdmin
      .from('active_sessions')
      .delete()
      .lt('last_seen', staleThreshold);
    results.sessionsPruned = error ? `error: ${error.message}` : 'ok';
    if (error) {
      hasError = true;
      logger.error('cron:daily-reset:session-prune-failed', { error: error.message });
    }
  } catch (err) {
    hasError = true;
    results.sessionsPruned = `error: ${String(err)}`;
    logger.error('cron:daily-reset:session-prune-failed', { error: String(err) });
  }

  // ── 7. Archive heavy conversations (> 250 messages → keep 200 live) ──────
  // BUG FIX (2026-08-12): this previously called prune_old_messages(), which
  // is a hard DELETE of everything beyond the most recent 200 messages in
  // a conversation — permanent, no archive, no recovery. Running daily,
  // that meant any actively-chatted conversation crossing 250 messages
  // (achievable in days for a heavy user, not months) lost history every
  // single night. This was flagged directly by the user as "chat messages
  // disappeared" and is likely the dominant cause alongside the duplicate-
  // conversation-row bug fixed the same day (see
  // 20260812_conversation_dedupe_and_message_retention.sql). Replaced with
  // the same archive-not-delete approach as the new dedicated
  // api/cron/message-archive route: excess messages move into
  // messages_archive (recoverable, queryable) instead of being destroyed.
  // Two crons intentionally cover two different triggers for the same
  // underlying goal — "keep recent messages fast, don't let history grow
  // unbounded in the live table" — one by age (30 days, message-archive),
  // one by per-conversation volume (250 messages, here) for the rarer case
  // of a very high-volume conversation still inside the 30-day window.
  try {
    const { data: heavyConvos, error: fetchErr } = await supabaseAdmin
      .rpc('find_heavy_conversations', { threshold: MESSAGE_HISTORY_CAP });
    if (fetchErr) throw fetchErr;

    let totalArchived = 0;
    if (heavyConvos?.length) {
      for (const c of heavyConvos as Array<{ id: string }>) {
        // Ids of the messages to KEEP live (newest MESSAGE_HISTORY_KEEP) —
        // everything else in this conversation gets archived, same
        // keep-the-newest-N semantics the old RPC had, just archive
        // instead of delete.
        const { data: keepRows, error: keepErr } = await supabaseAdmin
          .from('messages')
          .select('id')
          .eq('conversation_id', c.id)
          .order('created_at', { ascending: false })
          .limit(MESSAGE_HISTORY_KEEP);
        if (keepErr) { logger.warn('cron:daily-reset:message-archive-keep-lookup-failed', { conversationId: c.id, error: keepErr.message }); continue; }

        const keepIds = new Set((keepRows ?? []).map(r => r.id));

        const { data: toArchive, error: overflowErr } = await supabaseAdmin
          .from('messages')
          .select('id,conversation_id,role,content,image_url,tokens_used,created_at')
          .eq('conversation_id', c.id)
          .order('created_at', { ascending: false });
        if (overflowErr) { logger.warn('cron:daily-reset:message-archive-overflow-lookup-failed', { conversationId: c.id, error: overflowErr.message }); continue; }

        const overflow = (toArchive ?? []).filter(m => !keepIds.has(m.id));
        if (overflow.length === 0) continue;

        const archivedAt = new Date().toISOString();
        const { error: insertErr } = await supabaseAdmin
          .from('messages_archive')
          .upsert(
            // messages_archive.created_at is NOT NULL; messages.created_at is
            // nullable in principle, so fall back to the archive timestamp
            // for the rare row missing one rather than letting the whole
            // batch fail the upsert.
            overflow.map(m => ({ ...m, created_at: m.created_at ?? archivedAt, archived_at: archivedAt })),
            { onConflict: 'id', ignoreDuplicates: true },
          );
        if (insertErr) { logger.warn('cron:daily-reset:message-archive-insert-failed', { conversationId: c.id, error: insertErr.message }); continue; }

        const { error: deleteErr } = await supabaseAdmin
          .from('messages')
          .delete()
          .in('id', overflow.map(m => m.id));
        if (deleteErr) { logger.warn('cron:daily-reset:message-archive-delete-failed', { conversationId: c.id, error: deleteErr.message }); continue; }

        totalArchived += overflow.length;
      }
      results.messagePrune = `archived ${totalArchived} messages across ${heavyConvos.length} conversations`;
      logger.info('cron:daily-reset:message-archive', { conversations: heavyConvos.length, messagesArchived: totalArchived });
    } else {
      results.messagePrune = 'none needed';
    }
  } catch (err) {
    // Non-fatal — if RPCs don't exist yet, skip silently in early rollout
    results.messagePrune = `skipped: ${String(err)}`;
    logger.warn('cron:daily-reset:message-prune-skipped', { error: String(err) });
  }

  logger.info('cron:daily-reset:complete', results as Record<string, unknown>);

  // ── 8. Heartbeat (dead man's switch) ──────────────────────────────────────
  if (hasError) {
    await heartbeatFail('DAILY_RESET');
  } else {
    await heartbeatSuccess('DAILY_RESET');
  }

  return NextResponse.json({
    ok:        !hasError,
    timestamp: now,
    ...results,
  }, { status: hasError ? 207 : 200 });
}
