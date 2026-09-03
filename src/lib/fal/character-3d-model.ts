// src/lib/fal/character-3d-model.ts
// ─────────────────────────────────────────────────────────────────────────────
// Image-to-3D character model generation: turns a character's existing
// static image_url into a real .glb 3D mesh (character.model_url — see the
// 20261213_character_model_url.sql / 20261214_character_3d_model_generation_
// status.sql migrations and character-3d.tsx, the viewer this feeds).
// Delivered async via fal.ai's queue + webhook, same pattern as
// animate-portrait.ts's living-portrait video pipeline.
//
// MODEL CHOICE — verified against fal's live API docs (schema for
// fal-ai/hunyuan3d/v2, checked 2026-08-31): single required input
// `input_image_url`, optional `textured_mesh` (true = full-color textured
// mesh at 3x the white-mesh price), output `model_mesh: { url,
// content_type, file_name, file_size }` as a GLB. If fal's catalog changes
// again, FAL_3D_MODEL is isolated to one constant for a one-line swap.
//
// HONEST LIMITATION, worth stating plainly rather than discovering later:
// this is single-image-to-3D reconstruction, not a multi-view capture or a
// rigged/animated character build. Fed one front-facing portrait (all
// Vantrix character images are), it infers geometry for the whole mesh —
// the back and sides of the head/body are a plausible extrapolation, not
// photographed fact, and there is no skeleton or "Idle" animation clip.
// character-3d.tsx already degrades gracefully for an unrigged mesh (no
// animation clip found → it just skips the animation and still auto-
// rotates on interaction), so this is safe to ship as-is, but the result
// is closer to "a real 3D object built from this character's likeness"
// than "a fully faithful, rigged 3D character" — set expectations
// accordingly before spending the $0.48/generation budget across the
// character roster.
// ─────────────────────────────────────────────────────────────────────────────

import { fal } from '@fal-ai/client';
import { env } from '@/env';
import { uploadUrlToR2 } from '@/lib/storage/r2';
import { logger } from '@/lib/logger';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { redis } from '@/lib/redis';

fal.config({ credentials: env.FAL_KEY });

/** Verified against fal.ai's current model catalog — see note above. */
const FAL_3D_MODEL = 'fal-ai/hunyuan3d/v2';

// ── Platform-wide daily budget guard ────────────────────────────────────────
// Same fail-closed reasoning as animate-portrait.ts's checkPlatformVideoBudget
// — this pipeline has no per-user caller (it's admin/cron-triggered batch
// work, not something an end user's action can invoke), so there's no
// existing per-request limiter that would otherwise cap runaway spend if
// this function were ever called in a loop without one.
function modelBudgetKey(): string {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  return `vantrix:daily:3dmodel:platform:${day}`;
}

async function checkPlatformModelBudget(): Promise<{ allowed: boolean; used: number; limit: number }> {
  const limit = env.PLATFORM_DAILY_3D_MODEL_BUDGET;
  const key = modelBudgetKey();

  try {
    const pipe = redis.pipeline();
    pipe.incr(key);

    const now = new Date();
    const midnight = new Date(now);
    midnight.setUTCHours(24, 0, 0, 0);
    const ttlSeconds = Math.ceil((midnight.getTime() - now.getTime()) / 1000);
    pipe.expire(key, ttlSeconds);

    const [count] = await pipe.exec() as [number, unknown];

    if (count > limit) return { allowed: false, used: count, limit };
    return { allowed: true, used: count, limit };
  } catch (err) {
    logger.error('character-3d-model: platform budget check failed, denying (fail-closed)', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { allowed: false, used: 0, limit };
  }
}

export interface Generate3DModelInput {
  characterId: string;
  imageUrl:    string; // the character's current static image_url
}

export interface Generate3DModelResult {
  success:       boolean;
  falRequestId?: string;
  error?:        string;
}

/**
 * Submit an image-to-3D job for a character's existing portrait. Async —
 * returns immediately with the fal request id; the actual .glb arrives via
 * the /api/webhooks/fal-3d-model callback, which updates
 * characters.model_url / model_status.
 */
export async function generateCharacter3DModel(
  input: Generate3DModelInput,
): Promise<Generate3DModelResult> {
  const { imageUrl } = input;

  if (!env.FAL_KEY) {
    return { success: false, error: 'Fal.ai is not configured — set FAL_KEY to enable 3D model generation. See .env.example.' };
  }

  try {
    const result = await fal.queue.submit(FAL_3D_MODEL, {
      input: {
        input_image_url: imageUrl,
        textured_mesh:    true, // full-color mesh — a white/untextured mesh would lose the character's whole look
      },
      webhookUrl: `${env.NEXT_PUBLIC_APP_URL}/api/webhooks/fal-3d-model?characterId=${input.characterId}`,
    });

    return { success: true, falRequestId: result.request_id };
  } catch (err) {
    return {
      success: false,
      error:   err instanceof Error ? err.message : 'unknown error submitting 3D model generation job',
    };
  }
}

/**
 * Called by the webhook handler once fal.ai reports the mesh is ready.
 * Downloads the .glb from fal's CDN and re-uploads to R2 for permanent
 * storage — same reasoning as persistAnimatedVideoToR2(): fal's URLs are
 * not guaranteed permanent, and we want the asset under our own control.
 */
export async function persist3DModelToR2(
  characterId: string,
  falModelUrl: string,
): Promise<{ success: boolean; r2Url?: string; error?: string }> {
  const key = `characters/${characterId}/model-${Date.now()}.glb`;
  return uploadUrlToR2(falModelUrl, key, 'model/gltf-binary');
}

/**
 * Fire-and-forget wrapper around generateAndPersistModelStatus, for call
 * sites (e.g. a future auto-trigger on character creation) where 3D model
 * generation is a side effect of some other primary action that must not
 * be blocked or failed by a slow/failing fal.ai submit. The admin batch
 * route below awaits generateAndPersistModelStatus directly instead, since
 * generation *is* that route's primary action.
 */
export function triggerModelGenerationAsync(input: Generate3DModelInput): void {
  generateAndPersistModelStatus(input).catch((err) => {
    logger.warn('character-3d-model.auto-trigger.threw', {
      characterId: input.characterId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/**
 * Budget-checks, submits the fal.ai job, and writes the resulting
 * model_status ('processing' | 'failed') back to the character row.
 * Awaitable — the admin backfill route (api/admin/generate-character-
 * models) calls this directly per character so its response accurately
 * reflects what was actually submitted vs. rejected, rather than firing
 * everything blind. The actual .glb only arrives later via the
 * /api/webhooks/fal-3d-model callback regardless of how this is called.
 */
export async function generateAndPersistModelStatus(input: Generate3DModelInput): Promise<void> {
  const { characterId } = input;

  const budget = await checkPlatformModelBudget();
  if (!budget.allowed) {
    logger.warn('character-3d-model.platform-budget-exceeded', {
      characterId, used: budget.used, limit: budget.limit,
    });
    await supabaseAdmin
      .from('characters')
      .update({
        model_status: 'failed',
        model_error: `platform daily 3D-model budget reached (${budget.used}/${budget.limit}) — re-run the admin backfill route tomorrow`,
      })
      .eq('id', characterId);
    return;
  }

  const falResult = await generateCharacter3DModel(input);

  if (!falResult.success || !falResult.falRequestId) {
    logger.warn('character-3d-model.auto-trigger.failed', { characterId, error: falResult.error });
    await supabaseAdmin
      .from('characters')
      .update({ model_status: 'failed', model_error: falResult.error ?? 'fal 3D model submit failed' })
      .eq('id', characterId);
    return;
  }

  await supabaseAdmin
    .from('characters')
    .update({ model_status: 'processing', model_fal_request_id: falResult.falRequestId, model_error: null })
    .eq('id', characterId);

  // fal's webhook (/api/webhooks/fal-3d-model) completes the DB update from here.
}
