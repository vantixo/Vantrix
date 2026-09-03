/**
 * GET /api/cron/revocation-sweep
 *
 * Runs hourly (vercel.json cron). Finds every subscription_revocation_flags
 * row still 'pending' whose grace period has lapsed and downgrades the
 * affected user's tier — the actual enforcement half of the flag+grace
 * policy described in src/lib/payments/revocation.ts.
 *
 * A flag only reaches this cron if no admin cleared it first via
 * /api/admin/revocation-flags — see that route for the human-in-the-loop
 * side of this flow.
 *
 * Security: requires CRON_SECRET header (Vercel Cron injects this automatically).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth }           from '@/lib/security';
import { supabaseAdmin }             from '@/lib/supabase/admin';
import { sweepExpiredFlags }         from '@/lib/payments/revocation';
import { logger }                    from '@/lib/logger';
import { env }                       from '@/env';
import { heartbeatStart, heartbeatSuccess, heartbeatFail } from '@/lib/cron/heartbeat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await heartbeatStart('REVOCATION_SWEEP');

    const result = await sweepExpiredFlags(supabaseAdmin);

    await heartbeatSuccess('REVOCATION_SWEEP');
    logger.info('Revocation sweep complete', result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    await heartbeatFail('REVOCATION_SWEEP');
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Revocation sweep failed', { error: message });
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
