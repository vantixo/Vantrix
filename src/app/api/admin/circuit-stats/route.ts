/**
 * GET /api/admin/circuit-stats
 *
 * Admin-only endpoint exposing circuit breaker states + queue depths.
 * Used by the admin dashboard for incident visibility.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { requireAdmin }              from '@/lib/auth/admin';
import { getCircuitBreaker }         from '@/lib/circuit-breaker';
import { getQueueDepths }            from '@/lib/queue';
import { toErrorBody }               from '@/lib/errors';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    await requireAdmin(user.id);

    const [queueDepths] = await Promise.all([getQueueDepths()]);

    return NextResponse.json({
      circuits: {
        openrouter:  getCircuitBreaker('openrouter').getStats(),
        stripe:      getCircuitBreaker('stripe').getStats(),
        paystack:    getCircuitBreaker('paystack').getStats(),
        nowpayments: getCircuitBreaker('nowpayments').getStats(),
        paddle:      getCircuitBreaker('paddle').getStats(),
      },
      queue: {
        depths: queueDepths,
        total:  queueDepths.high + queueDepths.normal + queueDepths.low,
      },
      ts: new Date().toISOString(),
    });
  } catch (err) {
    const status = err instanceof Error && 'statusCode' in err
      ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}
