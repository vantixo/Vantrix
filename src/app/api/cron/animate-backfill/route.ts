/**
 * GET /api/cron/animate-backfill — Living Portrait Backfill
 *
 * Runs periodically (recommend every 6h). Finds every character that
 * should have a living-portrait video but doesn't, and (re)submits an
 * animation job for it.
 *
 * Why this exists: triggerAnimationAsync() is only ever called from two
 * places — character creation (POST /api/characters) and the manual admin
 * portrait-regenerate route. Every character created before the animation
 * feature shipped (including the canon cast — Aruna, Lylia, Fawrest, Agon,
 * Crixux, Tamara, Elara Voss — and any seed/import data) has
 * video_status = 'pending' by column default and nothing ever revisits it.
 * Same for any character whose one-shot animate submit failed (fal.ai
 * outage, transient network error) — triggerAnimationAsync swallows that
 * to a log line and nothing retries it. Without this cron, "pending" and
 * "failed" are both permanent end states in practice, not transient ones.
 *
 * Batched and rate-limited: each run submits at most BATCH_SIZE jobs so a
 * large backlog animates gradually across multiple runs instead of firing
 * hundreds of billable fal.ai jobs at once.
 *
 * Security: requires CRON_SECRET header.
 */
import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { requireCronAuth }           from '@/lib/security';
import { supabaseAdmin }             from '@/lib/supabase/admin';
import { triggerAnimationAsync }     from '@/lib/fal/animate-portrait';
import { logger }                    from '@/lib/logger';
import { env }                       from '@/env';
import { heartbeatStart, heartbeatSuccess, heartbeatFail } from '@/lib/cron/heartbeat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Cap per run — keeps a large backlog from firing a burst of simultaneous
// billable fal.ai jobs; the backlog drains gradually across subsequent runs.
const BATCH_SIZE = 25;

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await heartbeatStart('ANIMATE_BACKFILL');

  try {
    // 'pending': never submitted (default for every pre-existing character).
    // 'failed':  submitted once and fal.ai reported/timed out with an error
    //            (see video_error) — safe to retry, submitting is idempotent
    //            from the DB's perspective since the webhook always writes
    //            the latest result keyed by characterId.
    // 'processing' older than STALE_PROCESSING_HOURS: the submit call itself
    //            likely died before ever reaching fal.ai's queue (e.g. a
    //            thrown/rejected fal.queue.submit that this cron's own prior
    //            run marked 'processing' but never got a webhook callback
    //            for) — otherwise 'processing' rows are correctly left alone
    //            for the live webhook to resolve.
    const STALE_PROCESSING_HOURS = 2;
    const staleCutoff = new Date(Date.now() - STALE_PROCESSING_HOURS * 60 * 60 * 1000).toISOString();

    const [{ data: freshCandidates, error: freshErr }, { data: staleCandidates, error: staleErr }] = await Promise.all([
      supabaseAdmin
        .from('characters')
        .select('id, image_url, video_status')
        .in('video_status', ['pending', 'failed'])
        .not('image_url', 'is', null)
        .eq('active', true)
        .order('video_status', { ascending: true }) // 'failed' retries after fresh 'pending' backlog drains
        .limit(BATCH_SIZE),
      supabaseAdmin
        .from('characters')
        .select('id, image_url, video_status')
        .eq('video_status', 'processing')
        .not('image_url', 'is', null)
        .eq('active', true)
        .lt('updated_at', staleCutoff)
        .limit(BATCH_SIZE),
    ]);

    if (freshErr) throw new Error(`candidate query failed: ${freshErr.message}`);
    if (staleErr) throw new Error(`stale-processing query failed: ${staleErr.message}`);

    // Combine, cap at BATCH_SIZE total so a run never exceeds the intended
    // per-invocation ceiling even when both queries return full pages.
    // HARDENING: .not('image_url', 'is', null) filters out NULL but not an
    // empty string — a character with image_url = '' would otherwise pass
    // the DB filter, get submitted to fal.ai with an empty URL, fail,
    // land back at video_status='failed', and get picked up again next
    // run forever — a permanent, silently self-perpetuating loop burning
    // a billable job every 6h. Filtered here in-memory instead of trying
    // to express "not null and not empty" cleanly in the query builder.
    const rows = [...(freshCandidates ?? []), ...(staleCandidates ?? [])]
      .filter(r => typeof r.image_url === 'string' && r.image_url.trim().length > 0)
      .slice(0, BATCH_SIZE);

    // Mark 'processing' up front so a second overlapping cron run (or a
    // slow batch that outlives one invocation) doesn't double-submit the
    // same character — mirrors the state the fal.ai webhook itself expects
    // to transition out of on completion.
    if (rows.length > 0) {
      await supabaseAdmin
        .from('characters')
        .update({ video_status: 'processing' })
        .in('id', rows.map(r => r.id));
    }

    // RELIABILITY-FIX: this loop fires every job and then immediately logs
    // and returns — zero buffer for any of these fire-and-forget calls to
    // actually reach fal.ai before the platform can freeze the function on
    // response. Wrapped in after() so the whole submission loop is
    // guaranteed to run to completion; matches the fix applied to every
    // other triggerAnimationAsync call site.
    after(() => {
      for (const c of rows) {
        triggerAnimationAsync({
          characterId:   c.id,
          characterSlug: c.id,
          imageUrl:      c.image_url as string,
        });
      }
    });

    logger.info('cron:animate-backfill:complete', { submitted: rows.length });
    await heartbeatSuccess('ANIMATE_BACKFILL');
    return NextResponse.json({ ok: true, submitted: rows.length, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('cron:animate-backfill:failed', { error: String(err) });
    await heartbeatFail('ANIMATE_BACKFILL');
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
