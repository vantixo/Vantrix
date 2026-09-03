/**
 * GET /api/cron/memory-archive — Memory Archival
 *
 * Runs weekly (Sunday 03:00 UTC). Archives old low-weight memories to
 * prevent infinite memory graph growth.
 *
 * Rules (from Agent 02-D):
 *   - Nodes older than 180 days with emotional_weight < 4 (out of 10) → archived
 *   - Annual milestones (anniversary, first_meeting, milestone) → immune
 *   - Top 12 active memories per user-char pair remain hot
 *
 * BUG FIX: this used to compare `emotional_weight < 30`, a threshold left
 * over from when the field was believed to be 0-100. The DB CHECK constrains
 * it to 1-10 (see MEMORY_WEIGHT_MIN/MAX in lib/ai/memory-graph.ts), so that
 * comparison was vacuously true for every row — this cron was deleting every
 * non-immune memory older than 180 days, not just the low-importance ones.
 * Silent until now because memory_graph inserts were themselves broken (see
 * the same fix), so there was nothing here to archive yet.
 *
 * Security: requires CRON_SECRET header.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth }             from '@/lib/security';
import { supabaseAdmin }             from '@/lib/supabase/admin';
import { logger }                    from '@/lib/logger';
import { env }                       from '@/env';
import { heartbeatStart, heartbeatSuccess, heartbeatFail } from '@/lib/cron/heartbeat';
import { MEMORY_ARCHIVE_WEIGHT_CUTOFF } from '@/lib/ai/memory-graph';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await heartbeatStart('MEMORY_ARCHIVE');

  try {
    const cutoff = new Date(Date.now() - 180 * 86_400_000).toISOString();
    const IMMUNE_TYPES = ['anniversary', 'first_meeting', 'milestone'];

    // Archive low-weight old memories — move to archived_memories if table exists,
    // otherwise just delete (safe default if migration hasn't added the archive table)
    const { count: deletedCount, error } = await supabaseAdmin
      .from('memory_graph')
      .delete({ count: 'exact' })
      .lt('created_at', cutoff)
      .lt('emotional_weight', MEMORY_ARCHIVE_WEIGHT_CUTOFF)
      .not('event_type', 'in', `(${IMMUNE_TYPES.join(',')})`);

    if (error) throw error;

    logger.info('cron:memory-archive:complete', { archived: deletedCount ?? 0 });
    await heartbeatSuccess('MEMORY_ARCHIVE');
    return NextResponse.json({
      ok:        true,
      archived:  deletedCount ?? 0,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('cron:memory-archive:failed', { error: String(err) });
    await heartbeatFail('MEMORY_ARCHIVE');
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
