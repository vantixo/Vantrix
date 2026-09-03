/**
 * GET /api/cron/character-social — Character Cross-Interaction Cron
 *
 * Runs after /api/cron/character-posts (recommend offsetting by ~15–30 min
 * in your scheduler) so there's fresh content to react to. Lets companions
 * like and comment on each other's posts using the same companion_relationships
 * graph that flavors cross-companion awareness in chat — rivals needle each
 * other, wing-siblings show up warm, enemies barely engage.
 *
 * See lib/ai/character-social-engine.ts for selection/cadence/template logic.
 *
 * Security: requires CRON_SECRET header (see requireCronAuth).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth }           from '@/lib/security';
import { acquireCronLock }           from '@/lib/cron/lock';
import { heartbeatStart, heartbeatSuccess, heartbeatFail } from '@/lib/cron/heartbeat';
import { runCharacterSocialCron }    from '@/lib/ai/character-social-engine';
import { logger }                    from '@/lib/logger';
import { env }                       from '@/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LOCK_NAME           = 'character-social';
const LOCK_WINDOW_SECONDS = 3 * 60 * 60 - 60; // just under a 3h cron interval

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const gotLock = await acquireCronLock(LOCK_NAME, LOCK_WINDOW_SECONDS);
  if (!gotLock) {
    return NextResponse.json({ ok: true, skipped: 'locked' });
  }

  await heartbeatStart('CHARACTER_SOCIAL');

  try {
    const result = await runCharacterSocialCron();
    logger.info('cron:character-social:complete', result);
    await heartbeatSuccess('CHARACTER_SOCIAL');
    return NextResponse.json({ ok: true, ...result, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('cron:character-social:failed', { error: String(err) });
    await heartbeatFail('CHARACTER_SOCIAL');
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
