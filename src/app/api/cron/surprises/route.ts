/**
 * GET /api/cron/surprises — Surprise & Promise-Keeping Cron
 *
 * Schedule: once daily, 14:00 UTC (see vercel.json) — daytime in
 * several supported regional timezones, same consideration as the daily-reset cron.
 * Anniversaries and due promises are both date-boundary checks, not
 * something that benefits from running more often than that — running
 * this hourly would just mean the exact same "today is the day" pairs get
 * re-evaluated 24x with no new signal.
 *
 * Monitored via HEARTBEAT_SURPRISE_ENGINE (see lib/cron/heartbeat.ts) —
 * same dead-man's-switch pattern as every other cron in this codebase.
 *
 * Security: requires CRON_SECRET header, same as every other cron route.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth }           from '@/lib/security';
import { supabaseAdmin }             from '@/lib/supabase/admin';
import { logger }                    from '@/lib/logger';
import { env }                       from '@/env';
import { heartbeatStart, heartbeatSuccess, heartbeatFail } from '@/lib/cron/heartbeat';
import {
  getDuePromise, markPromiseSurfaced, formatPromiseSurprise,
  checkAnniversary, getFoundingMemory, formatAnniversarySurprise,
  canSendSurprise, recordSurprise,
} from '@/lib/ai/surprise-engine';
import { reserveProactiveSlot } from '@/lib/notifications/proactive-arbitrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let generated = 0, skipped = 0;

  await heartbeatStart('SURPRISE_ENGINE');

  try {
    // Active relationships only — same bound as character-initiative.ts's
    // own cron (30-day window on last_interaction) to avoid sweeping every
    // relationship ever created on every run.
    const { data: relationships, error } = await supabaseAdmin
      .from('character_relationships')
      .select('user_id,character_id,created_at')
      .gte('updated_at', new Date(Date.now() - 30 * 86_400_000).toISOString());

    if (error || !relationships) {
      logger.error('cron:surprises:fetch-failed', { error: error?.message });
      await heartbeatFail('SURPRISE_ENGINE');
      return NextResponse.json({ ok: false }, { status: 500 });
    }

    for (const rel of relationships) {
      try {
        if (!(await canSendSurprise(rel.user_id, rel.character_id))) { skipped++; continue; }

        // Priority 1: a promise that's come due — more personal than a
        // date-based anniversary, so it wins if both are true on the same day.
        const due = await getDuePromise(rel.user_id, rel.character_id);
        if (due) {
          // Cross-source arbitration, claimed only now that there's an
          // actual surprise to send — canSendSurprise above is just this
          // pair's own cooldown; it has no idea whether nudge.ts or
          // character-initiative.ts already used up this user's attention
          // today. See proactive-arbitrator.ts's header. Checking after
          // getDuePromise (not before) avoids spending a shared daily
          // slot on a pair that turns out to have nothing due.
          if (!(await reserveProactiveSlot({ userId: rel.user_id, source: 'surprise' }))) { skipped++; continue; }
          const message = formatPromiseSurprise(due);
          const result  = await recordSurprise(rel.user_id, rel.character_id, 'promise_followup', message);
          if (result.ok) {
            await markPromiseSurfaced(due.id);
            generated++;
          } else {
            skipped++;
          }
          continue;
        }

        // Priority 2: anniversary boundary.
        const anniversary = checkAnniversary(rel.created_at);
        if (anniversary.isAnniversary) {
          if (!(await reserveProactiveSlot({ userId: rel.user_id, source: 'surprise' }))) { skipped++; continue; }
          const founding = await getFoundingMemory(rel.user_id, rel.character_id, rel.created_at);
          const message  = formatAnniversarySurprise(anniversary, founding);
          const result   = await recordSurprise(rel.user_id, rel.character_id, 'anniversary', message);
          result.ok ? generated++ : skipped++;
          continue;
        }

        skipped++;
      } catch (pairErr) {
        logger.warn('cron:surprises:pair-error', { error: String(pairErr) });
        skipped++;
      }
    }

    logger.info('cron:surprises:complete', { generated, skipped });
    await heartbeatSuccess('SURPRISE_ENGINE');
    return NextResponse.json({ ok: true, generated, skipped, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('cron:surprises:failed', { error: String(err) });
    await heartbeatFail('SURPRISE_ENGINE');
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
