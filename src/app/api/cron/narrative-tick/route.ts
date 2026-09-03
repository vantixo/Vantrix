/**
 * GET /api/cron/narrative-tick
 *
 * Scheduled every 2 hours via vercel.json. This is "the cheap filler"
 * that lib/universe/deep-tick.ts (the daily LLM orchestrator) layers on
 * top of — event_generate and story_advance existed in the dispatcher
 * but had no cron actually triggering either before this route, so the
 * world's ambient events and story chapters were never actually advancing.
 *
 * Both jobs are self-limiting and safe to run this often:
 *   - event_generate tops active world_events up to a target of 5 — it's
 *     a no-op once that target is met, never overproduces.
 *   - story_advance only flips a chapter counter / seeds replacements for
 *     concluded stories — cheap, deterministic, no LLM involved. The
 *     deep tick is what gives a chapter real narrative content; this just
 *     keeps the counter and the active-story pool moving underneath it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth }           from '@/lib/security';
import { logger }                    from '@/lib/logger';
import { env }                       from '@/env';
import { enqueueJob }                from '@/lib/workers';
import { heartbeatStart, heartbeatSuccess, heartbeatFail } from '@/lib/cron/heartbeat';
import { acquireCronLock } from '@/lib/cron/lock';
import { advanceUniverseTick } from '@/lib/universe/world-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Lock for slightly less than the tick interval (2h = 7200s). See
  // lib/cron/lock.ts. Both jobs here are self-limiting (see header comment)
  // so a duplicate is low-stakes, but skipping it outright avoids doubling
  // queue churn for no benefit.
  const gotLock = await acquireCronLock('narrative-tick', 6900);
  if (!gotLock) {
    logger.warn('cron:narrative-tick:skipped-duplicate');
    return NextResponse.json({ ok: true, skipped: 'duplicate-invocation' });
  }

  const startedAt = Date.now();

  try {
    await heartbeatStart('NARRATIVE_TICK');

    const jobs = await Promise.all([
      enqueueJob('event_generate', {}, 5),
      enqueueJob('story_advance', {}, 5),
    ]);

    // DEAD-CODE-FIX: advanceUniverseTick() existed fully implemented
    // (season rotation, world-mood drift) but nothing ever called it — the
    // "world atmosphere" every character's prompt references was frozen at
    // its bootstrap defaults. Runs directly here (not queued) since it's a
    // single cheap guarded UPDATE on one singleton row, not worth a job
    // type of its own.
    const nextState = await advanceUniverseTick().catch((err) => {
      logger.error('cron:narrative-tick:advance-universe-tick-failed', { error: String(err) });
      return null;
    });

    const enqueued = jobs.filter((j) => j.enqueued).length;

    void fetch(`${env.NEXT_PUBLIC_APP_URL}/api/workers/run`, {
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    }).catch(() => { /* fire and forget */ });

    await heartbeatSuccess('NARRATIVE_TICK');
    logger.info('cron:narrative-tick:complete', {
      enqueued, duration_ms: Date.now() - startedAt,
      universeTick: nextState ? { tick_count: nextState.tick_count, season: nextState.season, world_mood: nextState.world_mood } : 'skipped',
    });
    return NextResponse.json({
      ok: true, enqueued, duration_ms: Date.now() - startedAt,
      universeTick: nextState ? { tick_count: nextState.tick_count, season: nextState.season } : null,
    });

  } catch (err) {
    await heartbeatFail('NARRATIVE_TICK');
    logger.error('cron:narrative-tick:failed', { error: String(err) });
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
