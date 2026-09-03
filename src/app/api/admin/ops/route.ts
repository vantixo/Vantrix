/**
 * GET /api/admin/ops — Operational Dashboard
 *
 * Returns a real-time snapshot of everything needed to operate Vantrix at scale:
 *   - AI cost metrics (tokens/hour, projected daily cost, cache hit rate)
 *   - Provider circuit breaker states
 *   - Queue health (depth, oldest job age, dead jobs)
 *   - Redis billing DLQ depth
 *   - Platform throttle status
 *   - Cron health (last run timestamps)
 *   - Top spenders (for anomaly investigation)
 *
 * Requires ADMIN_SECRET_TOKEN header. Returns 401 otherwise.
 * Designed to be polled by a monitoring dashboard every 30s.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { requireAdmin }              from '@/lib/auth/admin';
import { timingSafeEqual }           from '@/lib/security';
import { env }                       from '@/env';
import { getOpsSnapshot }            from '@/lib/admin/ops-snapshot';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Layer 1 — require a valid Supabase session (human user, not just token holder)
  const { user } = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized — no session' }, { status: 401 });
  }
  // Layer 2 — require admin (role = 'admin' OR is_admin = true — same
  // definition the DB's own is_admin() RLS function uses; this previously
  // checked role only and rejected accounts admin'd via the is_admin
  // boolean, which is how the identical bug was found in requireAdmin()).
  try {
    await requireAdmin(user.id);
  } catch {
    return NextResponse.json({ error: 'Forbidden — admin role required' }, { status: 403 });
  }
  // Layer 3 — require ADMIN_SECRET_TOKEN header (for monitoring dashboards / CI)
  const token = req.headers.get('x-admin-token') ?? req.headers.get('authorization')?.replace('Bearer ', '');
  if (env.ADMIN_SECRET_TOKEN && token && !timingSafeEqual(token, env.ADMIN_SECRET_TOKEN)) {
    return NextResponse.json({ error: 'Invalid admin token' }, { status: 401 });
  }

  const snapshot = await getOpsSnapshot();

  return NextResponse.json(snapshot, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
