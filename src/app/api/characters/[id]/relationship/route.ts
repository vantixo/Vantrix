/**
 * GET/PATCH /api/characters/[id]/relationship
 *
 * PATCH lets the user set what their companion calls them and/or what they
 * call their companion, stored per (user, character) on
 * character_relationships. Genuinely user-facing — user_nickname_for_character
 * is meant to replace the character's given name in chat headers/message
 * lists client-side.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import type { Database } from '@/types/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  nicknameForUser:          z.string().trim().max(40).nullable().optional(),
  userNicknameForCharacter: z.string().trim().max(40).nullable().optional(),
}).refine((v) => v.nicknameForUser !== undefined || v.userNicknameForCharacter !== undefined, {
  message: 'At least one of nicknameForUser or userNicknameForCharacter is required',
});

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { user, error: authError } = await getAuthedUser();
  if (!user || authError) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('character_relationships')
    .select('nickname_for_user, user_nickname_for_character, customized_at')
    .eq('user_id', user.id)
    .eq('character_id', params.id)
    .maybeSingle();

  if (error) {
    logger.error('characters:relationship-get-error', { error: error.message, characterId: params.id });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({
    nicknameForUser:          data?.nickname_for_user ?? null,
    userNicknameForCharacter: data?.user_nickname_for_character ?? null,
    customizedAt:             data?.customized_at ?? null,
  });
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { user, error: authError } = await getAuthedUser();
  if (!user || authError) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  // Ownership check: character_relationships has no user-writable RLS
  // policy (service-role only — see 20240101_production.sql's rel_service),
  // so the row-scoping that would normally come from RLS has to happen
  // here explicitly via the .eq('user_id', user.id) below rather than
  // being implicit in the client used.
  const { data: character } = await supabaseAdmin
    .from('characters').select('id').eq('id', params.id).maybeSingle();
  if (!character) return NextResponse.json({ error: 'Character not found' }, { status: 404 });

  const update: Database['public']['Tables']['character_relationships']['Update'] = { customized_at: new Date().toISOString() };
  if (parsed.data.nicknameForUser !== undefined) update.nickname_for_user = parsed.data.nicknameForUser || null;
  if (parsed.data.userNicknameForCharacter !== undefined) update.user_nickname_for_character = parsed.data.userNicknameForCharacter || null;

  // Update-then-insert, NOT upsert with hardcoded stage/xp defaults: a
  // straight upsert would need those columns in the payload for the
  // insert branch, and Supabase's upsert applies the SAME payload on
  // conflict — which would silently reset an existing relationship's real
  // stage/XP back to 'stranger'/0 on every nickname edit. Mirrors
  // ensureRelationship()'s existing get-then-insert pattern
  // (relationship-engine.ts) instead.
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('character_relationships')
    .update(update)
    .eq('user_id', user.id)
    .eq('character_id', params.id)
    .select('user_id')
    .maybeSingle();

  if (updateError) {
    logger.error('characters:relationship-patch-error', { error: updateError.message, characterId: params.id });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  if (!updated) {
    // No relationship row yet (customizing before ever sending a message)
    // — create one with the same defaults ensureRelationship() uses.
    const { error: insertError } = await supabaseAdmin
      .from('character_relationships')
      .insert({
        user_id: user.id, character_id: params.id,
        stage: 'stranger', stage_xp: 0, stage_xp_cap: 100,
        ...update,
      });
    if (insertError) {
      logger.error('characters:relationship-patch-insert-error', { error: insertError.message, characterId: params.id });
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
