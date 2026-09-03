/**
 * GET /api/cron/registration-reminders — Post-signup Re-engagement Emails
 *
 * Runs hourly. Sends real emails (via Resend) to users who registered but
 * never meaningfully came back, at three stages: 6h, 48h, and 7 days after
 * signup. See src/lib/notifications/registration-reminder.ts for the copy,
 * eligibility rules, and per-user/per-stage dedup.
 *
 * Security: requires CRON_SECRET header (same as every other cron route).
 *
 * Setup: schedule this hourly with your cron provider (Vercel Cron,
 * healthchecks.io + curl, etc.) — the 3 stage windows below are wide enough
 * (6h–24h, 48h–72h, 168h–192h) that hourly is safely frequent without being
 * wasteful; a slower schedule (e.g. every 3h) also works fine given the
 * window sizes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth }           from '@/lib/security';
import { runRegistrationReminders }  from '@/lib/notifications/registration-reminder';
import { logger }                    from '@/lib/logger';
import { env }                       from '@/env';
import { heartbeatStart, heartbeatSuccess, heartbeatFail } from '@/lib/cron/heartbeat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await heartbeatStart('REGISTRATION_REMINDERS');

  try {
    const result = await runRegistrationReminders();
    logger.info('cron:registration-reminders:complete', result);
    await heartbeatSuccess('REGISTRATION_REMINDERS');
    return NextResponse.json({ ok: true, ...result, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('cron:registration-reminders:failed', { error: String(err) });
    await heartbeatFail('REGISTRATION_REMINDERS');
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
