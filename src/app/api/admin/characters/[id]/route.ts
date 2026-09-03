/**
 * /api/admin/characters/[id] — staff activation/approval route
 *
 * ACTIVATION-FIX (P0): user-created characters were always inserted with
 * active: false after passing moderation, but no route existed to ever flip
 * that back to true — every user-created character was a permanent dead end,
 * unable to enter discovery or the dating pool, with no way for staff to
 * approve it short of a direct DB write.
 *
 * GET  — staff review: fetch one character with its moderation state and
 *        creator's username, for a review queue / detail view.
 * PATCH — staff decision: approve (active: true), reject, or otherwise adjust
 *        active / is_public / moderation_status for a single character.
 *
 * `active` and `is_public` are intentionally separate (see the migration in
 * this change set): `active` means "approved, usable at all"; `is_public`
 * means "appears in the public discover/dating feed". Approving a character
 * (active: true) defaults is_public to the same value unless the caller
 * specifies it explicitly — so the common case ("approve and list it") is a
 * single field, while staff can still approve-but-keep-private if they want to.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z }               from 'zod';
import { getAuthedUser }   from '@/lib/auth/get-authed-user';
import { supabaseAdmin }   from '@/lib/supabase/admin';
import { requirePermission }        from '@/lib/auth/permissions';
import { requireAdmin }    from '@/lib/auth/admin';
import { toErrorBody, errorLogFields }     from '@/lib/errors';
import { logger }          from '@/lib/logger';
import { recordAdminAction } from '@/lib/admin/audit';
import type { Database }   from '@/types/supabase';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  active:            z.boolean().optional(),
  is_public:         z.boolean().optional(),
  moderation_status: z.enum(['pending', 'approved', 'rejected', 'flagged']).optional(),
  moderation_note:   z.string().max(500).optional(),
}).refine(
  (body) => body.active !== undefined || body.is_public !== undefined || body.moderation_status !== undefined,
  { message: 'Provide at least one of active, is_public, moderation_status' },
);

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    await requireAdmin(user.id);

    const idCheck = z.string().uuid().safeParse(params.id);
    if (!idCheck.success) {
      return NextResponse.json({ error: 'Invalid character id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('characters')
      .select(`
        id,name,description,category,age,gender,image_url,tags,is_nsfw,
        creator_id,active,is_public,moderation_status,moderation_note,
        like_count,total_swipes,created_at,
        profiles:creator_id ( username )
      `)
      .eq('id', params.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Character not found', code: 'NOT_FOUND' }, { status: 404 });

    return NextResponse.json({ character: data });
  } catch (err) {
    logger.error('Admin character GET error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    await requireAdmin(user.id);
    await requirePermission(user.id, 'characters.moderate');

    const idCheck = z.string().uuid().safeParse(params.id);
    if (!idCheck.success) {
      return NextResponse.json({ error: 'Invalid character id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const raw    = await req.json().catch(() => null);
    const parsed = patchSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({
        error: 'Invalid request', code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      }, { status: 400 });
    }

    const body = parsed.data;

    const update: Database['public']['Tables']['characters']['Update'] = {};
    if (body.active !== undefined) {
      update.active = body.active;
      // Default is_public to follow the creator's own request from
      // creation time (visibility_requested — see migration
      // 20260812_character_visibility_requested.sql) unless the caller
      // specifies it explicitly. Rejections never default to public.
      if (body.is_public === undefined) {
        if (!body.active) {
          update.is_public = false;
        } else {
          const { data: existing } = await supabaseAdmin
            .from('characters')
            .select('visibility_requested')
            .eq('id', params.id)
            .maybeSingle();
          update.is_public = existing?.visibility_requested === 'public';
        }
      }
      // Default moderation_status to a sensible value tied to the decision,
      // unless the caller specifies it explicitly.
      if (body.moderation_status === undefined) {
        update.moderation_status = body.active ? 'approved' : 'rejected';
      }
    }
    if (body.is_public !== undefined) update.is_public = body.is_public;
    if (body.moderation_status !== undefined) update.moderation_status = body.moderation_status;
    if (body.moderation_note !== undefined) update.moderation_note = body.moderation_note;

    // DB-level invariant (see migration: characters_public_requires_active)
    // also enforces this; checked here too for a clean 400 instead of a
    // raw Postgres constraint-violation error.
    const wouldBePublic = update.is_public ?? null;
    const wouldBeActive = update.active ?? null;
    if (wouldBePublic === true && wouldBeActive === false) {
      return NextResponse.json({
        error: 'A character cannot be is_public while active is false',
        code: 'VALIDATION_ERROR',
      }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('characters')
      .update(update)
      .eq('id', params.id)
      .select('id,name,active,is_public,moderation_status,moderation_note,creator_id')
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Character not found', code: 'NOT_FOUND' }, { status: 404 });

    logger.info('Admin: character activation updated', {
      characterId: data.id, by: user.id, update,
    });

    // Only log a moderation-decision row when this PATCH actually was one
    // (i.e. it touched `active`) — plain visibility/note tweaks aren't
    // approve/reject decisions and would misrepresent the audit trail.
    if (body.active !== undefined) {
      await recordAdminAction({
        adminId: user.id,
        action: body.active ? 'character.approved' : 'character.rejected',
        targetType: 'character',
        targetId: data.id,
        targetLabel: data.name,
        metadata: { is_public: data.is_public, moderation_status: data.moderation_status },
      });
    }

    return NextResponse.json({ character: data });
  } catch (err) {
    logger.error('Admin character PATCH error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}
