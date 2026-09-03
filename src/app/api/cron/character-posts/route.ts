/**
 * GET /api/cron/character-posts — Character Auto-Post Cron
 *
 * Runs every 3 hours. Gives live, approved characters a presence on the
 * feed (/community, /api/feed/posts) even between conversations — posts
 * are generated from each character's own fields (occupation, current_goal,
 * dreams, daily_routine) so they read as belonging to that character.
 *
 * See lib/ai/character-feed.ts for selection/cadence/caption logic.
 *
 * Security: requires CRON_SECRET header (see requireCronAuth).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth }           from '@/lib/security';
import { acquireCronLock }           from '@/lib/cron/lock';
import { heartbeatStart, heartbeatSuccess, heartbeatFail } from '@/lib/cron/heartbeat';
import { runCharacterFeedCron }      from '@/lib/ai/character-feed';
import { logger }                    from '@/lib/logger';
import { env }                       from '@/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LOCK_NAME           = 'character-posts';
const LOCK_WINDOW_SECONDS = 3 * 60 * 60 - 60; // just under the 3h cron interval

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const gotLock = await acquireCronLock(LOCK_NAME, LOCK_WINDOW_SECONDS);
  if (!gotLock) {
    return NextResponse.json({ ok: true, skipped: 'locked' });
  }

  await heartbeatStart('CHARACTER_POSTS');

  try {
    const result = await runCharacterFeedCron();
    logger.info('cron:character-posts:complete', result);
    await heartbeatSuccess('CHARACTER_POSTS');
    return NextResponse.json({ ok: true, ...result, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('cron:character-posts:failed', { error: String(err) });
    await heartbeatFail('CHARACTER_POSTS');
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
