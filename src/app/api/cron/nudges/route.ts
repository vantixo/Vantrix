/**
 * GET /api/cron/nudges — Bond Nudge Delivery
 *
 * Runs every 6 hours. Generates and queues nudge payloads for users
 * whose bond with a character is at risk (24–72h no interaction).
 * The nudges are delivered via in-app SSE or email.
 *
 * Per-user frequency cap: users receive at most 2 nudges/day regardless
 * of how many matches trigger simultaneously (see nudge.ts).
 *
 * Security: requires CRON_SECRET header.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth }             from '@/lib/security';
import { generateAllPendingNudges }  from '@/lib/notifications/nudge';
import { logger }                    from '@/lib/logger';
import { env }                       from '@/env';
import { heartbeatStart, heartbeatSuccess, heartbeatFail } from '@/lib/cron/heartbeat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await heartbeatStart('NUDGES');

  try {
    const result = await generateAllPendingNudges();
    logger.info('cron:nudges:complete', result);
    await heartbeatSuccess('NUDGES');
    return NextResponse.json({ ok: true, ...result, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('cron:nudges:failed', { error: String(err) });
    await heartbeatFail('NUDGES');
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
