/**
 * GET    /api/characters/:id/memories        — list this character's seed memories (owner only)
 * POST   /api/characters/:id/memories        — add a seed memory
 * PATCH  /api/characters/:id/memories        — update one (body: { memoryId, ...fields })
 * DELETE /api/characters/:id/memories?memoryId=... — remove one
 *
 * Backs the Memory Builder in Creator Studio. Distinct from
 * /api/memories/priority, which is per-end-user runtime memory — these rows
 * are authored once by the creator and apply to every conversation with the
 * character (see character_seed_memories migration for the full rationale).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { canEdit } from '@/lib/characters/ownership';
import { toErrorBody, errorLogFields } from '@/lib/errors';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  category: z.string().max(50).default('general'),
  headline: z.string().min(1).max(120),
  content: z.string().min(1).max(2000),
  importance: z.number().min(0).max(100).default(50),
  position: z.number().int().default(0),
});

const updateSchema = z.object({
  memoryId: z.string().uuid(),
  category: z.string().max(50).optional(),
  headline: z.string().min(1).max(120).optional(),
  content: z.string().min(1).max(2000).optional(),
  importance: z.number().min(0).max(100).optional(),
  position: z.number().int().optional(),
});

async function loadCharacterForEdit(id: string, userId: string) {
  const { data: character, error } = await supabaseAdmin
    .from('characters')
    .select('id,creator_id')
    .eq('id', id)
    .single();
  if (error || !character) return { character: null, allowed: false };
  return { character, allowed: canEdit(character, userId) };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

    const { character, allowed } = await loadCharacterForEdit(id, user.id);
    if (!character) return NextResponse.json({ error: 'Character not found', code: 'NOT_FOUND' }, { status: 404 });
    if (!allowed) return NextResponse.json({ error: 'Only the creator can view this', code: 'FORBIDDEN' }, { status: 403 });

    const { data, error } = await supabaseAdmin
      .from('character_seed_memories')
      .select('*')
      .eq('character_id', id)
      .order('position', { ascending: true })
      .order('importance', { ascending: false });

    if (error) throw error;
    return NextResponse.json({ memories: data ?? [] });
  } catch (err) {
    logger.error('Character memories GET error', errorLogFields(err));
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

    const { character, allowed } = await loadCharacterForEdit(id, user.id);
    if (!character) return NextResponse.json({ error: 'Character not found', code: 'NOT_FOUND' }, { status: 404 });
    if (!allowed) return NextResponse.json({ error: 'Only the creator can edit this', code: 'FORBIDDEN' }, { status: 403 });

    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid fields', code: 'INVALID_BODY', details: parsed.error.flatten() }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('character_seed_memories')
      .insert({ ...parsed.data, character_id: id, creator_id: user.id })
      .select('*')
      .single();

    if (error) throw error;
    return NextResponse.json({ memory: data }, { status: 201 });
  } catch (err) {
    logger.error('Character memories POST error', errorLogFields(err));
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

    const { character, allowed } = await loadCharacterForEdit(id, user.id);
    if (!character) return NextResponse.json({ error: 'Character not found', code: 'NOT_FOUND' }, { status: 404 });
    if (!allowed) return NextResponse.json({ error: 'Only the creator can edit this', code: 'FORBIDDEN' }, { status: 403 });

    const parsed = updateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid fields', code: 'INVALID_BODY', details: parsed.error.flatten() }, { status: 400 });
    }
    const { memoryId, ...fields } = parsed.data;

    const { data, error } = await supabaseAdmin
      .from('character_seed_memories')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', memoryId)
      .eq('character_id', id)
      .select('*')
      .single();

    if (error) throw error;
    return NextResponse.json({ memory: data });
  } catch (err) {
    logger.error('Character memories PATCH error', errorLogFields(err));
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

    const { character, allowed } = await loadCharacterForEdit(id, user.id);
    if (!character) return NextResponse.json({ error: 'Character not found', code: 'NOT_FOUND' }, { status: 404 });
    if (!allowed) return NextResponse.json({ error: 'Only the creator can edit this', code: 'FORBIDDEN' }, { status: 403 });

    const memoryId = new URL(req.url).searchParams.get('memoryId');
    if (!memoryId) return NextResponse.json({ error: 'memoryId is required', code: 'INVALID_QUERY' }, { status: 400 });

    const { error } = await supabaseAdmin
      .from('character_seed_memories')
      .delete()
      .eq('id', memoryId)
      .eq('character_id', id);

    if (error) throw error;
    return NextResponse.json({ deleted: memoryId });
  } catch (err) {
    logger.error('Character memories DELETE error', errorLogFields(err));
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}
