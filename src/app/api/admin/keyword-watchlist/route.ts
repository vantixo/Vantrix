/**
 * GET    /api/admin/keyword-watchlist — list watched keywords
 * POST   /api/admin/keyword-watchlist — add a keyword
 * PATCH  /api/admin/keyword-watchlist — edit/toggle a keyword
 * DELETE /api/admin/keyword-watchlist — remove a keyword
 *
 * Admin-only CRUD over keyword_watchlist — see
 * src/lib/moderation/keyword-watch.ts's header. This list is watch-only:
 * nothing here causes any message to be blocked or altered. Adding a
 * keyword here means "log it when it shows up," nothing more — the admin
 * decides what to do with hits in /api/admin/keyword-watch-hits.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser }             from '@/lib/auth/get-authed-user';
import { requirePermission }        from '@/lib/auth/permissions';
import { requireAdmin }              from '@/lib/auth/admin';
import type { Database }             from '@/types/supabase';
import { supabaseAdmin }             from '@/lib/supabase/admin';
import { toErrorBody, AppError }     from '@/lib/errors';
import { invalidateKeywordCache }    from '@/lib/moderation/keyword-watch';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    await requireAdmin(user.id);

    const { data, error } = await supabaseAdmin
      .from('keyword_watchlist')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ keywords: data ?? [] });
  } catch (err) {
    const body = toErrorBody(err);
    const status = err instanceof AppError ? err.statusCode : 500;
    return NextResponse.json(body, { status });
  }
}

const postSchema = z.object({
  keyword: z.string().min(1).max(200),
  isRegex: z.boolean().optional().default(false),
  notes:   z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    await requireAdmin(user.id);
    await requirePermission(user.id, 'abuse.review');

    const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // Fail closed on the admin's own input if it's a malformed regex —
    // better to reject at add-time than silently skip it forever at
    // check-time (keyword-watch.ts's buildMatcher() already guards that
    // path too, but this gives the admin an immediate, clear error).
    if (parsed.data.isRegex) {
      try { new RegExp(parsed.data.keyword); }
      catch {
        return NextResponse.json({ error: 'Invalid regex', code: 'INVALID_REGEX' }, { status: 400 });
      }
    }

    const { data, error } = await supabaseAdmin
      .from('keyword_watchlist')
      .insert({
        keyword:    parsed.data.keyword,
        is_regex:   parsed.data.isRegex,
        notes:      parsed.data.notes ?? null,
        created_by: user.id,
      })
      .select('*')
      .single();

    if (error) throw error;

    invalidateKeywordCache();

    return NextResponse.json({ keyword: data }, { status: 201 });
  } catch (err) {
    const body = toErrorBody(err);
    const status = err instanceof AppError ? err.statusCode : 500;
    return NextResponse.json(body, { status });
  }
}

const patchSchema = z.object({
  id:      z.string().uuid(),
  keyword: z.string().min(1).max(200).optional(),
  isRegex: z.boolean().optional(),
  active:  z.boolean().optional(),
  notes:   z.string().max(2000).optional(),
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
    const { id, ...rest } = parsed.data;

    if (rest.isRegex && rest.keyword) {
      try { new RegExp(rest.keyword); }
      catch {
        return NextResponse.json({ error: 'Invalid regex', code: 'INVALID_REGEX' }, { status: 400 });
      }
    }

    const update: Database['public']['Tables']['keyword_watchlist']['Update'] = { updated_at: new Date().toISOString() };
    if (rest.keyword !== undefined) update.keyword  = rest.keyword;
    if (rest.isRegex !== undefined) update.is_regex = rest.isRegex;
    if (rest.active  !== undefined) update.active   = rest.active;
    if (rest.notes   !== undefined) update.notes    = rest.notes;

    const { error } = await supabaseAdmin
      .from('keyword_watchlist')
      .update(update)
      .eq('id', id);

    if (error) throw error;

    invalidateKeywordCache();

    return NextResponse.json({ ok: true });
  } catch (err) {
    const body = toErrorBody(err);
    const status = err instanceof AppError ? err.statusCode : 500;
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    await requireAdmin(user.id);
    await requirePermission(user.id, 'abuse.review');

    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id', code: 'VALIDATION_ERROR' }, { status: 400 });

    const { error } = await supabaseAdmin
      .from('keyword_watchlist')
      .delete()
      .eq('id', id);

    if (error) throw error;

    invalidateKeywordCache();

    return NextResponse.json({ ok: true });
  } catch (err) {
    const body = toErrorBody(err);
    const status = err instanceof AppError ? err.statusCode : 500;
    return NextResponse.json(body, { status });
  }
}
