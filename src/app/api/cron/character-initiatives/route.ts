/**
 * GET /api/cron/character-initiatives — Character Initiative Cron
 *
 * Runs every 2 hours. Evaluates user-character pairs and generates
 * proactive initiative messages for qualifying relationships.
 *
 * This is the system that makes characters feel alive:
 * they reach out first, they notice absences, they share life updates.
 *
 * Security: requires CRON_SECRET header.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth }             from '@/lib/security';
import { runInitiativeCron }         from '@/lib/ai/character-initiative';
import { logger }                    from '@/lib/logger';
import { env }                       from '@/env';
import { heartbeatStart, heartbeatSuccess, heartbeatFail } from '@/lib/cron/heartbeat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await heartbeatStart('CHARACTER_INITIATIVES');

  try {
    const result = await runInitiativeCron();
    logger.info('cron:character-initiatives:complete', result);
    await heartbeatSuccess('CHARACTER_INITIATIVES');
    return NextResponse.json({ ok: true, ...result, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('cron:character-initiatives:failed', { error: String(err) });
    await heartbeatFail('CHARACTER_INITIATIVES');
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
