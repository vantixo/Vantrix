/**
 * GET /api/admin/bg-ledger
 *
 * Admin-only, read-only endpoint exposing bg_task_ledger — aggregate
 * success/fail counts per fire-and-forget background task label, written by
 * BgLedgerGroup.flush() (see src/lib/observability/bg-ledger.ts). Currently
 * only the queue worker's W3 post-job enrichment block is wired to the
 * ledger; the sync chat route's fire-and-forget calls are not yet tracked
 * (see the follow-up note in bg-ledger.ts).
 *
 * Sorted by fail_count desc so the noisiest-failing task is always first —
 * same "worst offender at the top" shape as circuit-stats.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { requireAdmin }              from '@/lib/auth/admin';
import { supabaseAdmin }             from '@/lib/supabase/admin';
import { toErrorBody }               from '@/lib/errors';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    await requireAdmin(user.id);

    const { data, error } = await supabaseAdmin
      .from('bg_task_ledger')
      .select('label, success_count, fail_count, last_success_at, last_failure_at, last_error, last_user_id, updated_at')
      .order('fail_count', { ascending: false })
      .limit(200);

    if (error) throw error;

    const tasks = data ?? [];
    const totals = tasks.reduce(
      (acc, t) => ({
        success: acc.success + Number(t.success_count),
        fail:    acc.fail    + Number(t.fail_count),
      }),
      { success: 0, fail: 0 },
    );

    return NextResponse.json({
      tasks,
      totals,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    const status = err instanceof Error && 'statusCode' in err
      ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}
