/**
 * GET   /api/admin/keyword-watch-hits — list logged keyword matches
 * PATCH /api/admin/keyword-watch-hits — mark a hit reviewed/dismissed
 *
 * Same non-blocking-review pattern as reply-guard-flags. Every row here
 * is purely observational — src/lib/moderation/keyword-watch.ts never
 * blocked or altered the message that produced it. Whatever action an
 * admin decides to take (warn a user, disable a character, escalate) is
 * done by hand, outside this system.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser }         from '@/lib/auth/get-authed-user';
import { requirePermission }        from '@/lib/auth/permissions';
import { requireAdmin }          from '@/lib/auth/admin';
import { supabaseAdmin }         from '@/lib/supabase/admin';
import { toErrorBody, AppError } from '@/lib/errors';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const STATUS_VALUES = ['pending', 'reviewed', 'dismissed'] as const;
type HitStatus = (typeof STATUS_VALUES)[number];

export async function GET(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    await requireAdmin(user.id);

    const rawStatus = req.nextUrl.searchParams.get('status') ?? 'pending';
    const status: HitStatus = (STATUS_VALUES as readonly string[]).includes(rawStatus)
      ? (rawStatus as HitStatus)
      : 'pending';
    const keywordId = req.nextUrl.searchParams.get('keywordId');
    const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 50), 200);

    let query = supabaseAdmin
      .from('keyword_watch_hits')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (keywordId) query = query.eq('keyword_id', keywordId);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ hits: data ?? [] });
  } catch (err) {
    const body = toErrorBody(err);
    const status = err instanceof AppError ? err.statusCode : 500;
    return NextResponse.json(body, { status });
  }
}

const patchSchema = z.object({
  id:     z.string().uuid(),
  status: z.enum(['reviewed', 'dismissed']),
  notes:  z.string().max(2000).optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    await requireAdmin(user.id);
    await requirePermission(user.id, 'abuse.review');

    const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const { id, status, notes } = parsed.data;
    const { error } = await supabaseAdmin
      .from('keyword_watch_hits')
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
