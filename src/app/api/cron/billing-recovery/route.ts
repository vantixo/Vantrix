/**
 * GET /api/cron/billing-recovery — DLQ Billing Recovery
 *
 * Runs every 5 minutes. Pops items from the billing dead letter queue
 * and re-attempts the token deduction in Supabase.
 *
 * This ensures zero silent token loss — every billable event eventually
 * reaches the DB or is escalated for human review.
 *
 * Security: requires CRON_SECRET header.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth }             from '@/lib/security';
import { runBillingRecovery }        from '@/lib/ai/billing-dlq';
import { logger }                    from '@/lib/logger';
import { env }                       from '@/env';
import { heartbeatStart, heartbeatSuccess, heartbeatFail } from '@/lib/cron/heartbeat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await heartbeatStart('BILLING_RECOVERY');

  try {
    const result = await runBillingRecovery();
    logger.info('cron:billing-recovery:complete', result);
    await heartbeatSuccess('BILLING_RECOVERY');
    return NextResponse.json({ ok: true, ...result, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('cron:billing-recovery:failed', { error: String(err) });
    await heartbeatFail('BILLING_RECOVERY');
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
