/**
 * POST /api/characters/:id/train-lora
 *
 * Kicks off FLUX LoRA training for a character from Creator Studio's
 * Appearance tab ("Train Character" button). Owner-only.
 *
 * Reference images come from `gallery_image_urls` (the character's saved
 * portrait gallery) plus the current `image_url` — whatever the creator has
 * already generated/saved. We don't introduce a separate upload flow here;
 * trainCharacterLoRA() itself enforces the 5-image minimum.
 *
 * This route only *submits* the job (mirrors trainCharacterLoRA's
 * fire-and-poll design) and records the pending state on the character row.
 * Completion is handled asynchronously by the existing
 * /api/webhooks/fal-lora route, which flips lora_training_status to
 * 'completed'/'failed' once Fal calls back. The client polls
 * GET /api/characters/:id (already used by Creator Studio) to observe that
 * transition — no new polling endpoint needed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { canEdit } from '@/lib/characters/ownership';
import { requirePlan } from '@/lib/auth/plan';
import { toErrorBody, errorLogFields } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { trainCharacterLoRA } from '@/lib/fal/lora-pipeline';

export const dynamic = 'force-dynamic';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'character';
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

    // Training is a Premium+ feature — see the "Character LoRA training"
    // line item on the Premium tier (config.ts) and canTrainLoRA(). TIER-GATE
    // FIX: this previously gated at 'basic', which the pricing config lists
    // as explicitly NOT including LoRA training ({ label: 'LoRA training',
    // included: false }) — Basic subscribers could train LoRAs for free
    // relative to what they were sold, undercutting the Premium upsell.
    await requirePlan(user.id, 'premium', 'Character LoRA training');

    const { data: character, error: fetchError } = await supabaseAdmin
      .from('characters')
      .select('id, creator_id, name, image_url, gallery_image_urls, face_prompt, lora_training_status')
      .eq('id', id)
      .single();

    if (fetchError || !character) {
      return NextResponse.json({ error: 'Character not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    if (!canEdit(character, user.id)) {
      return NextResponse.json({ error: 'Only the creator can train this character', code: 'FORBIDDEN' }, { status: 403 });
    }
    if (character.lora_training_status === 'queued' || character.lora_training_status === 'in_progress') {
      return NextResponse.json({ error: 'Training is already in progress for this character', code: 'ALREADY_TRAINING' }, { status: 409 });
    }
    if (!character.face_prompt) {
      return NextResponse.json({
        error: 'Add a face reference prompt in the Appearance tab before training',
        code: 'MISSING_FACE_PROMPT',
      }, { status: 400 });
    }

    const referenceImages = Array.from(new Set([
      ...(character.gallery_image_urls ?? []),
      ...(character.image_url ? [character.image_url] : []),
    ]));

    if (referenceImages.length < 5) {
      return NextResponse.json({
        error: `Training needs at least 5 reference images — this character has ${referenceImages.length}. Generate/save a few more portraits in the Appearance tab first.`,
        code: 'INSUFFICIENT_REFERENCE_IMAGES',
        count: referenceImages.length,
      }, { status: 400 });
    }

    const triggerWord = `vtx_${slugify(character.name)}`;

    const result = await trainCharacterLoRA({
      characterId: character.id,
      characterSlug: slugify(character.name),
      referenceImages,
      facePrompt: character.face_prompt,
      triggerWord,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error ?? 'Failed to start training', code: 'TRAINING_START_FAILED' }, { status: 502 });
    }

    const { error: updateError } = await supabaseAdmin
      .from('characters')
      .update({
        lora_request_id: result.falRequestId ?? null,
        lora_training_status: 'queued',
        lora_training_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) {
      logger.error('train-lora: submitted to Fal but failed to persist request id', { error: updateError.message, characterId: id });
    }

    return NextResponse.json({
      status: 'queued',
      falRequestId: result.falRequestId,
      estimatedCost: result.estimatedCost,
      referenceImageCount: referenceImages.length,
    });
  } catch (err) {
    logger.error('train-lora POST error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err
      ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}
