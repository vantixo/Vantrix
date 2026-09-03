/**
 * GET   /api/admin/user-reports — list the user-submitted content report queue
 * PATCH /api/admin/user-reports — mark a report reviewed/actioned/dismissed
 *
 * Front door for user_reports (POST /api/report writes rows here, from
 * conversation/character reports and — as of 20260821_community_moderation —
 * community post/reply reports too). Doesn't gate anything in real time;
 * this is purely where a human decides what, if anything, to do about a
 * flagged piece of content. Modeled directly on
 * src/app/api/admin/crisis-events/route.ts's GET/PATCH shape so it slots
 * into the same generic ReviewQueue frontend component.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser }         from '@/lib/auth/get-authed-user';
import { requirePermission }        from '@/lib/auth/permissions';
import { requireAdmin }          from '@/lib/auth/admin';
import { supabaseAdmin }         from '@/lib/supabase/admin';
import { toErrorBody, AppError } from '@/lib/errors';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const STATUS_VALUES = ['pending', 'reviewed', 'actioned', 'dismissed'] as const;
type UserReportStatus = (typeof STATUS_VALUES)[number];

export async function GET(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    await requireAdmin(user.id);

    const rawStatus = req.nextUrl.searchParams.get('status') ?? 'pending';
    const status: UserReportStatus = (STATUS_VALUES as readonly string[]).includes(rawStatus)
      ? (rawStatus as UserReportStatus)
      : 'pending';
    const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 50), 200);

    const { data, error } = await supabaseAdmin
      .from('user_reports')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return NextResponse.json({ reports: data ?? [] });
  } catch (err) {
    const body = toErrorBody(err);
    const status = err instanceof AppError ? err.statusCode : 500;
    return NextResponse.json(body, { status });
  }
}

const patchSchema = z.object({
  id:     z.string().uuid(),
  status: z.enum(['reviewed', 'actioned', 'dismissed']),
  // user_reports has no reviewer_notes column (unlike crisis_events) — notes
  // isn't accepted here, and the frontend panel doesn't render withNotes.
});

export async function PATCH(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    await requireAdmin(user.id);
    await requirePermission(user.id, 'reports.review');

    const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const { id, status } = parsed.data;
    const { error } = await supabaseAdmin
      .from('user_reports')
      .update({
        status,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
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
