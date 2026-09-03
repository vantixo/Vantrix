/**
 * GET   /api/admin/crisis-events — list the crisis-signal review queue
 * PATCH /api/admin/crisis-events — mark a row reviewed
 *
 * Front door for crisis_events (src/lib/safety/crisis-detection.ts writes
 * rows here). By the time a row exists, the fixed crisis-response reply has
 * already been sent to the user in place of the normal AI reply — nothing
 * here gates anything in real time. This route exists purely so a human can
 * see what fired and decide whether follow-up (e.g. account-level outreach,
 * escalation) is warranted. See migration 20260829_crisis_events_admin_access
 * for why this was previously unreachable by anyone.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser }         from '@/lib/auth/get-authed-user';
import { requirePermission }        from '@/lib/auth/permissions';
import { requireAdmin }          from '@/lib/auth/admin';
import { supabaseAdmin }         from '@/lib/supabase/admin';
import { toErrorBody, AppError } from '@/lib/errors';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const STATUS_VALUES = ['pending', 'reviewed_no_action', 'reviewed_followed_up', 'false_positive'] as const;
type CrisisEventStatus = (typeof STATUS_VALUES)[number];

export async function GET(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    await requireAdmin(user.id);

    const rawStatus = req.nextUrl.searchParams.get('status') ?? 'pending';
    const status: CrisisEventStatus = (STATUS_VALUES as readonly string[]).includes(rawStatus)
      ? (rawStatus as CrisisEventStatus)
      : 'pending';
    const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 50), 200);

    const { data, error } = await supabaseAdmin
      .from('crisis_events')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return NextResponse.json({ events: data ?? [] });
  } catch (err) {
    const body = toErrorBody(err);
    const status = err instanceof AppError ? err.statusCode : 500;
    return NextResponse.json(body, { status });
  }
}

const patchSchema = z.object({
  id:     z.string().uuid(),
  status: z.enum(['reviewed_no_action', 'reviewed_followed_up', 'false_positive']),
  notes:  z.string().max(2000).optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    await requireAdmin(user.id);
    await requirePermission(user.id, 'crisis.review');

    const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const { id, status, notes } = parsed.data;
    const { error } = await supabaseAdmin
      .from('crisis_events')
      .update({
        status,
        reviewer_notes: notes,
        reviewed_by:    user.id,
        reviewed_at:    new Date().toISOString(),
      })
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    const body = toErrorBody(err);
    const status = err instanceof AppError ? err.statusCode : 500;
    return NextResponse.json(body, { status });
  }
}
