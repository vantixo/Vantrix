/**
 * GET  /api/characters/:id        — fetch full row (owner only; public viewers use /discover queries elsewhere)
 * PATCH /api/characters/:id       — edit an existing character's builder fields
 *
 * Backs the 6 Creator Studio builders (Brain / Knowledge / Voice /
 * Appearance / Gallery — Memory has its own route, see ./memories/route.ts).
 * Each builder PATCHes only the slice of fields it owns; this route
 * allowlists every editable column so a malformed body can't touch
 * id/creator_id/moderation/monetization fields.
 *
 * GALLERY-FIX (studio audit): gallery_image_urls was in EditableCharacter's
 * type and returned by GET's '*' select, but had no field group here at
 * all — patchSchema.strict() meant the one write path the (until-now
 * unbuilt) Gallery tab needed, saving the creator's picks from a batch
 * image-gen run (POST /api/images/generate-batch) into the character's
 * public gallery, rejected with INVALID_BODY on the very first field.
 * Added below as its own group, gated by the same isAllowedImageHost()
 * check next/image itself enforces on read (lib/utils.ts) — the batch
 * route always returns R2-hosted URLs, but nothing else on this route
 * stops a creator from PATCHing an arbitrary external URL into a public,
 * unmoderated gallery otherwise.
 */

import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { z } from 'zod';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { canEdit } from '@/lib/characters/ownership';
import { toErrorBody, errorLogFields } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { isAllowedImageHost } from '@/lib/utils';
import { embedAndStoreCharacter } from '@/lib/ai/character-embeddings';
import type { Database } from '@/types/supabase';

export const dynamic = 'force-dynamic';

// ── Editable field groups (mirrors the 5 builders) ─────────────────────────
const brainFields = z.object({
  personality: z.string().max(2000).optional(),
  archetype: z.string().max(200).optional(),
  attachment_style: z.string().max(200).optional(),
  love_language: z.string().max(200).optional(),
  char_openness: z.number().min(0).max(100).optional(),
  char_warmth: z.number().min(0).max(100).optional(),
  char_adventure: z.number().min(0).max(100).optional(),
  char_depth: z.number().min(0).max(100).optional(),
  values_list: z.array(z.string()).max(20).optional(),
  fears: z.array(z.string()).max(20).optional(),
  flaws: z.array(z.string()).max(20).optional(),
  dreams: z.array(z.string()).max(20).optional(),
  current_goal: z.string().max(500).optional(),
  daily_routine: z.array(z.string()).max(20).optional(),
});

const knowledgeFields = z.object({
  backstory: z.string().max(5000).optional(),
  scenario: z.string().max(2000).optional(),
  origin: z.string().max(500).optional(),
  occupation: z.string().max(200).optional(),
  family_bg: z.string().max(2000).optional(),
  childhood_bg: z.string().max(2000).optional(),
  secrets: z.array(z.string()).max(20).optional(),
  friends_list: z.array(z.string()).max(20).optional(),
  opening_line: z.string().max(500).optional(),
});

const voiceFields = z.object({
  speech_style: z.string().max(200).optional(),
  voice_profile: z.record(z.unknown()).optional(),
  writing_style: z.record(z.unknown()).optional(),
  // ElevenLabs voice_id — see voice-library.ts's VOICE_LIBRARY for the
  // curated set the Studio picker offers. Not constrained to that list
  // server-side (a nullable free-form ElevenLabs id, same open-ended
  // stance as preferred_language) so the picker can grow without a
  // matching schema change here; empty string clears back to the
  // gender-bucket default in /api/voice/tts.
  elevenlabs_voice_id: z.union([z.literal(''), z.string().max(100)]).optional(),
});

const appearanceFields = z.object({
  hair_color: z.string().max(100).optional(),
  eye_color: z.string().max(100).optional(),
  body_type: z.string().max(100).optional(),
  skin_tone: z.string().max(100).optional(),
  art_style: z.string().max(100).optional(),
  clothing: z.string().max(500).optional(),
  face_prompt: z.string().max(1000).optional(),
  generation_style: z.string().max(200).optional(),
  // CREATION-STUDIO: real Visual Identity Lock flag — see
  // 20260825_character_creation_studio.sql's column comment. Advisory only;
  // this route doesn't reject subsequent appearance edits once true, the
  // Creator Studio UI is what warns before allowing them.
  identity_locked: z.boolean().optional(),
});

// The Gallery tab always PATCHes the *whole* array (add or remove a shot,
// send the resulting full list back) rather than a single-URL append/
// remove, since — unlike the admin private-gallery routes — there's no
// concurrent-writer race to guard against here: only the one creator who
// owns this character can ever reach this route for it (see canEdit()
// below), so a fetch-then-write-the-full-array round trip from a single
// client is safe. 120 is a generous ceiling (a full 64-image batch, saved
// twice over) meant only to stop an unbounded array from bloating the row.
const galleryFields = z.object({
  gallery_image_urls: z.array(
    z.string().url().max(500).refine(
      (url) => {
        try {
          return isAllowedImageHost(new URL(url).hostname);
        } catch {
          return false;
        }
      },
      { message: 'gallery_image_urls entries must be from an approved image host' }
    )
  ).max(120).optional(),
});

const patchSchema = brainFields.merge(knowledgeFields).merge(voiceFields).merge(appearanceFields).merge(galleryFields).strict();

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

    const { data: character, error } = await supabaseAdmin.from('characters').select('*').eq('id', id).single();
    if (error || !character) return NextResponse.json({ error: 'Character not found', code: 'NOT_FOUND' }, { status: 404 });
    if (!canEdit(character, user.id)) {
      return NextResponse.json({ error: 'Only the creator can view builder data', code: 'FORBIDDEN' }, { status: 403 });
    }

    // private_gallery_image_urls / private_gallery_video_urls are an
    // admin-only stash (20260720c_private_character_gallery.sql) — this
    // route serves the character's creator, who is not necessarily an
    // admin, so those fields must never ride along on the '*' select
    // above. Only /api/admin/characters/[id]/media is allowed to expose them.
    const { private_gallery_image_urls, private_gallery_video_urls, ...safeCharacter } =
      character as typeof character & { private_gallery_image_urls?: string[]; private_gallery_video_urls?: string[] };
    void private_gallery_image_urls;
    void private_gallery_video_urls;

    return NextResponse.json({ character: safeCharacter });
  } catch (err) {
    logger.error('Character GET error', errorLogFields(err));
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

    const { data: character, error: fetchError } = await supabaseAdmin
      .from('characters')
      .select('id,creator_id')
      .eq('id', id)
      .single();
    if (fetchError || !character) return NextResponse.json({ error: 'Character not found', code: 'NOT_FOUND' }, { status: 404 });
    if (!canEdit(character, user.id)) {
      return NextResponse.json({ error: 'Only the creator can edit this character', code: 'FORBIDDEN' }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid fields', code: 'INVALID_BODY', details: parsed.error.flatten() }, { status: 400 });
    }
    if (Object.keys(parsed.data).length === 0) {
      return NextResponse.json({ error: 'No fields to update', code: 'EMPTY_BODY' }, { status: 400 });
    }

    // Empty string means "clear the override, fall back to the
    // gender-bucket default" (see voiceFields comment above) — normalize
    // to null so /api/voice/tts's `?? DEFAULT_ELEVENLABS_VOICE_IDS[...]`
    // fallback chain actually triggers instead of trying to call
    // ElevenLabs with an empty voice id.
    const updates: Record<string, unknown> = { ...parsed.data };
    if (updates.elevenlabs_voice_id === '') {
      updates.elevenlabs_voice_id = null;
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('characters')
      .update({ ...updates, updated_at: new Date().toISOString() } as Database['public']['Tables']['characters']['Update'])
      .eq('id', id)
      .select('*')
      .single();

    if (updateError) throw updateError;

    // PGVECTOR: re-embed on any edit that touches `personality` — the only
    // field this route can change that character-embeddings.ts's
    // characterText() actually incorporates (name/description/tags aren't
    // editable via this route today; see the field-group comments above).
    // Fire-and-forget, same posture as the create-path call in
    // POST /api/characters. Skipped entirely when personality wasn't part
    // of this PATCH, so routine edits (voice/appearance/gallery tabs) don't
    // trigger a needless re-embed.
    if (parsed.data.personality !== undefined) {
      const embedSource = updated as unknown as {
        name: string; description: string; personality: string | null; tags: string[] | null;
      };
      after(() => {
        embedAndStoreCharacter(id, {
          name: embedSource.name,
          description: embedSource.description,
          personality: embedSource.personality,
          tags: embedSource.tags,
        }).catch((err) => {
          logger.error('character-embeddings: fire-and-forget re-embed threw', {
            characterId: id, error: String(err),
          });
        });
      });
    }

    // SEC FIX (Phase B audit, 2026-08-06): GET above deliberately strips
    // private_gallery_image_urls/private_gallery_video_urls (admin-only,
    // see the comment on GET) before returning the character, but this
    // PATCH response used a raw '*' select and returned them unfiltered —
    // any creator editing their own character got the admin-only private
    // gallery back in the response body. Same strip applied here for
    // consistency with GET.
    const { private_gallery_image_urls, private_gallery_video_urls, ...safeUpdated } =
      updated as typeof updated & { private_gallery_image_urls?: string[]; private_gallery_video_urls?: string[] };
    void private_gallery_image_urls;
    void private_gallery_video_urls;

    return NextResponse.json({ character: safeUpdated });
  } catch (err) {
    logger.error('Character PATCH error', errorLogFields(err));
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}
