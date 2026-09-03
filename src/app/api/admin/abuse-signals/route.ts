/**
 * GET  /api/admin/abuse-signals — list the bot/abuse review queue
 * PATCH /api/admin/abuse-signals — mark a row reviewed
 *
 * This is the human/AI-review side of the "no CAPTCHA" decision: requests
 * that scored as bot-like (see src/lib/security/bot-shield.ts) land here
 * instead of being blocked at signup/login. Nothing in the request path
 * reads this table to deny access — it's purely for after-the-fact review.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { requirePermission }        from '@/lib/auth/permissions';
import { requireAdmin }              from '@/lib/auth/admin';
import { supabaseAdmin }             from '@/lib/supabase/admin';
import { toErrorBody, AppError }     from '@/lib/errors';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const STATUS_VALUES = ['pending', 'reviewing', 'confirmed_bot', 'confirmed_human', 'dismissed'] as const;
type AbuseSignalStatus = (typeof STATUS_VALUES)[number];

export async function GET(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    await requireAdmin(user.id);

    const rawStatus = req.nextUrl.searchParams.get('status') ?? 'pending';
    const status: AbuseSignalStatus = (STATUS_VALUES as readonly string[]).includes(rawStatus)
      ? (rawStatus as AbuseSignalStatus)
      : 'pending';
    const limit  = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 50), 200);

    const { data, error } = await supabaseAdmin
      .from('abuse_signals')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return NextResponse.json({ signals: data ?? [] });
  } catch (err) {
    const body = toErrorBody(err);
    const status = err instanceof AppError ? err.statusCode : 500;
    return NextResponse.json(body, { status });
  }
}

const patchSchema = z.object({
  id:     z.string().uuid(),
  status: z.enum(['reviewing', 'confirmed_bot', 'confirmed_human', 'dismissed']),
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
      .from('abuse_signals')
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
