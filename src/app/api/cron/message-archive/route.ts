/**
 * GET /api/cron/message-archive — Chat Message Retention
 *
 * "Keep all recent messages in chat, and a 1-month save library that
 * clears old messages after one month."
 *
 * Runs daily. Moves `messages` rows older than 30 days into
 * `messages_archive` (same shape, plus `archived_at`) and deletes them
 * from the live table. This is a MOVE, not a delete — history isn't
 * destroyed, it's relocated out of the hot path so:
 *   - The live `messages` table (read on every chat page load, every
 *     stream request's history fetch) stays small and fast regardless of
 *     how long an account has existed.
 *   - Nothing currently reads messages_archive on the normal chat path
 *     (chat/[id]/page.tsx only queries `messages`), matching "recent
 *     messages stay in chat" — archived history exists but isn't part of
 *     the live conversation view by default.
 *
 * Batched (1000 rows/iteration) rather than one giant statement — some
 * conversations on this platform are old and high-volume (see the
 * historyLimitForTier / trimHistoryForPlan machinery elsewhere), so an
 * unbounded DELETE...RETURNING across the whole table risks a long lock /
 * timeout on first run. Loops until a batch comes back empty.
 *
 * See 20260812_conversation_dedupe_and_message_retention.sql for the
 * messages_archive table definition, indexes, and RLS policy (owner can
 * SELECT their own archived rows directly if a future feature wants to
 * surface them; only service-role, i.e. this cron, can write).
 *
 * Security: requires CRON_SECRET header, same as every other cron here.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/security';
import { supabaseAdmin }   from '@/lib/supabase/admin';
import { logger }          from '@/lib/logger';
import { env }             from '@/env';
import { heartbeatStart, heartbeatSuccess, heartbeatFail } from '@/lib/cron/heartbeat';

export const runtime  = 'nodejs';
export const dynamic  = 'force-dynamic';
export const maxDuration = 60;

const RETENTION_DAYS  = 30;
const BATCH_SIZE      = 1000;
// Hard safety cap on total rows moved in one invocation — if there's ever
// a genuinely huge backlog (e.g. first run after enabling this on an old
// database), this stops the cron well inside its own timeout and picks up
// the rest on the next scheduled run instead of risking a timeout mid-batch.
const MAX_BATCHES_PER_RUN = 20;

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await heartbeatStart('MESSAGE_ARCHIVE');

  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
    let totalArchived = 0;

    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
      // Select a batch of old message ids first — Postgres doesn't support
      // ORDER BY + LIMIT directly inside DELETE, and we want oldest-first
      // so a partial run (hitting MAX_BATCHES_PER_RUN) still always makes
      // forward progress on the true oldest backlog rather than an
      // arbitrary slice.
      const { data: toArchive, error: selectErr } = await supabaseAdmin
        .from('messages')
        .select('id,conversation_id,role,content,image_url,tokens_used,created_at')
        .lt('created_at', cutoff)
        .order('created_at', { ascending: true })
        .limit(BATCH_SIZE);

      if (selectErr) throw selectErr;
      if (!toArchive || toArchive.length === 0) break;

      const archivedAt = new Date().toISOString();
      const { error: insertErr } = await supabaseAdmin
        .from('messages_archive')
        .upsert(
          // messages_archive.created_at is NOT NULL; fall back to the
          // archive timestamp for the rare row missing one instead of
          // letting a null poison the whole batch upsert.
          toArchive.map(m => ({ ...m, created_at: m.created_at ?? archivedAt, archived_at: archivedAt })),
          { onConflict: 'id', ignoreDuplicates: true },
        );
      if (insertErr) throw insertErr;

      const ids = toArchive.map(m => m.id);
      const { error: deleteErr } = await supabaseAdmin
        .from('messages')
        .delete()
        .in('id', ids);
      if (deleteErr) throw deleteErr;

      totalArchived += toArchive.length;

      // Batch came back smaller than BATCH_SIZE — that was the last one.
      if (toArchive.length < BATCH_SIZE) break;
    }

    logger.info('cron:message-archive:complete', { archived: totalArchived, cutoffDays: RETENTION_DAYS });
    await heartbeatSuccess('MESSAGE_ARCHIVE');
    return NextResponse.json({
      ok:        true,
      archived:  totalArchived,
      cutoff,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('cron:message-archive:failed', { error: String(err) });
    await heartbeatFail('MESSAGE_ARCHIVE');
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
