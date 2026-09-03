/**
 * GET /api/characters/mine
 *
 * Lets a creator see the activation/moderation status of the characters they
 * created — the other half of the ACTIVATION-FIX: staff get
 * PATCH /api/admin/characters/:id to approve/reject; creators get this route
 * to see where their pending character stands, instead of it just silently
 * never appearing anywhere.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { toErrorBody, errorLogFields }   from '@/lib/errors';
import { logger }        from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

    // Guard against non-numeric ?limit= producing NaN (parseInt('abc') is
    // NaN, which Math.min/.limit() would then propagate into a raw
    // Postgrest error instead of falling back to the default).
    const rawLimit = parseInt(new URL(req.url).searchParams.get('limit') ?? '50', 10);
    const limit = Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 50, 100);

    const { data, error } = await supabaseAdmin
      .from('characters')
      .select('id,name,image_url,category,active,is_public,moderation_status,moderation_note,created_at')
      .eq('creator_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return NextResponse.json({ characters: data ?? [] }, {
      headers: { 'Cache-Control': 'private, max-age=20, stale-while-revalidate=60' },
    });
  } catch (err) {
    logger.error('Characters/mine GET error', errorLogFields(err));
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}
