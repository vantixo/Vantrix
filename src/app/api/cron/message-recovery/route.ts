/**
 * GET /api/cron/message-recovery — DLQ Message Recovery
 *
 * Runs every 5 minutes, mirroring /api/cron/billing-recovery. Pops items
 * from the message dead letter queue (src/lib/ai/message-dlq.ts) and
 * re-attempts the insert via supabaseAdmin. Ensures a transient outage that
 * defeats both the in-request retry and the admin-client fallback in
 * chat/stream/route.ts doesn't mean a paid-for assistant reply (or, more
 * rarely, a user message) is gone for good.
 *
 * Security: requires CRON_SECRET header.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth }             from '@/lib/security';
import { runMessageRecovery }        from '@/lib/ai/message-dlq';
import { logger }                    from '@/lib/logger';
import { env }                       from '@/env';
import { heartbeatStart, heartbeatSuccess, heartbeatFail } from '@/lib/cron/heartbeat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await heartbeatStart('MESSAGE_RECOVERY');

  try {
    const result = await runMessageRecovery();
    logger.info('cron:message-recovery:complete', result);
    await heartbeatSuccess('MESSAGE_RECOVERY');
    return NextResponse.json({ ok: true, ...result, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('cron:message-recovery:failed', { error: String(err) });
    await heartbeatFail('MESSAGE_RECOVERY');
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
