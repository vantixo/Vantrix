/**
 * PATCH /api/characters/:id/visibility
 * Body: { visibility: 'public' | 'private' }
 *
 * Lets a creator flip their own character between private and public.
 * Going public requires the character to have already passed moderation
 * (see canSetVisibility in @/lib/characters/ownership) — prevents an
 * unreviewed or rejected character from being shared publicly.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { canSetVisibility, type Visibility } from '@/lib/characters/ownership';
import { toErrorBody, errorLogFields } from '@/lib/errors';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

    const body = await req.json().catch(() => null);
    const visibility: Visibility | undefined = body?.visibility;
    if (visibility !== 'public' && visibility !== 'private') {
      return NextResponse.json({ error: "visibility must be 'public' or 'private'", code: 'INVALID_BODY' }, { status: 400 });
    }

    const { data: character, error: fetchError } = await supabaseAdmin
      .from('characters')
      .select('id,creator_id,moderation_status,is_public')
      .eq('id', id)
      .single();

    if (fetchError || !character) {
      return NextResponse.json({ error: 'Character not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const check = canSetVisibility(character, user.id, visibility);
    if (!check.allowed) {
      return NextResponse.json({ error: check.reason ?? 'Not allowed', code: 'FORBIDDEN' }, { status: 403 });
    }

    const { error: updateError } = await supabaseAdmin
      .from('characters')
      .update({ is_public: visibility === 'public' })
      .eq('id', id);

    if (updateError) throw updateError;

    return NextResponse.json({ id, visibility });
  } catch (err) {
    logger.error('Character visibility PATCH error', errorLogFields(err));
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}
