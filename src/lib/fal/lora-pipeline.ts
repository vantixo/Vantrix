// src/lib/fal/lora-pipeline.ts
// ─────────────────────────────────────────────────────────────────────────────
// Fal.ai FLUX LoRA training pipeline + scene generation.
//
// Pipeline:
//   1. Upload reference images to Fal.ai storage
//   2. Trigger FLUX LoRA training with locked face prompt
//   3. Poll until complete, store model ID in DB
//   4. Generate scenes: character identity from LoRA, scene from prompt
//   5. Upload output to Cloudflare R2 for permanent storage
//
// KEY PRINCIPLE: Never regenerate the character. Only regenerate the scene.
// The LoRA model IS the character. The scene prompt changes the environment.
//
// DEPENDENCY NOTE: migrated from @fal-ai/serverless-client to @fal-ai/client
// (Phase 3, see AUDIT_FINDINGS_LOG.md) — different import style (`import
// { fal } from "@fal-ai/client"`) and results now come back as
// `Result<Output>` with `.data`/`.requestId` instead of flat properties.
// Every call site in this file (queue.result, subscribe x2) was updated
// accordingly; queue.submit/queue.status/storage.upload return shapes were
// unchanged by the migration.
// ─────────────────────────────────────────────────────────────────────────────

import { fal } from '@fal-ai/client';
import { env } from '@/env';
import { logger } from '@/lib/logger';
import { breakers } from '@/lib/circuit-breaker';
// `export { uploadUrlToR2 as uploadToR2 } from '@/lib/storage/r2'` further
// down only creates an export binding — it does NOT import a local name
// usable inside this file's own functions. generateCanonImageSet() needs
// to call it directly, so it's imported here too under its real name.
import { uploadUrlToR2 } from '@/lib/storage/r2';

// Configure Fal client (credentials from env)
fal.config({
  credentials: env.FAL_KEY,
});

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LoRATrainingInput {
  characterId:     string;
  characterSlug:   string;
  referenceImages: string[];   // public URLs of reference images
  facePrompt:      string;     // canonical face description
  triggerWord:     string;     // e.g. "vtx_elara_voss"
}

export interface LoRATrainingResult {
  success:        boolean;
  falRequestId?:  string;
  loraModelId?:   string;
  error?:         string;
  estimatedCost?: number;
}

export interface SceneGenerationInput {
  characterSlug:  string;
  loraModelId:    string;
  facePrompt:     string;     // locked canonical prompt
  scenePrompt:    string;     // scene/environment to generate
  negativePrompt?: string;
  imageSize?:     'portrait_4_3' | 'square' | 'landscape_16_9' | 'portrait_16_9';
  steps?:         number;
  guidance?:      number;
  seed?:          number;
  /**
   * Relaxes Fal's own blanket NSFW safety checker for this generation.
   * Defaults to false (checker ON) everywhere. Fal's checker is a blunt,
   * context-blind classifier that blocks essentially all nudity/sexual
   * content regardless of who's asking — appropriate as a default, but it
   * would also block Vantrix's own legitimate, properly-gated adult content
   * feature for verified users who've opted in.
   *
   * Callers must independently confirm BOTH of the following before ever
   * passing true — this function does not check either itself:
   *   1. The generation is for a real, authenticated user (age is only
   *      ever collected once, at signup — see auth/callback/page.tsx).
   *   2. The user has explicitly opted into NSFW content
   *      (profiles.nsfw_enabled — see checkMatureContentAccess() in
   *      lib/access/character-gate.ts).
   *
   * Setting this to true NEVER bypasses moderateCharacter() — every prompt
   * still passes through the platform's own moderation (which explicitly,
   * unconditionally blocks minors/non-consent/exploitation regardless of
   * this flag) before it ever reaches this function. This flag only
   * controls Fal's blanket filter; it is not a substitute for that check
   * and must never be set based on account status alone.
   */
  allowMature?:   boolean;
}

export interface SceneGenerationResult {
  success:       boolean;
  imageUrl?:     string;
  falRequestId?: string;
  seed?:         number;
  costUsd?:      number;
  error?:        string;
}

export interface CanonImageSetInput {
  characterSlug:  string;
  loraModelId:    string;
  facePrompt:     string;
}

// ── Training ──────────────────────────────────────────────────────────────────

/**
 * Train a FLUX LoRA model for a character.
 * Uses fal-ai/flux-lora-fast-training for cost efficiency.
 * Returns immediately with a request ID for polling.
 */
export async function trainCharacterLoRA(
  input: LoRATrainingInput,
): Promise<LoRATrainingResult> {
  if (!env.FAL_KEY) {
    return { success: false, error: 'Fal.ai is not configured — set FAL_KEY to enable LoRA training. See .env.example.' };
  }

  const {
    characterId,
    characterSlug,
    referenceImages,
    facePrompt,
    triggerWord,
  } = input;

  if (referenceImages.length < 5) {
    return { success: false, error: 'minimum_5_reference_images' };
  }

  try {
    // Step 1: Create image dataset from reference URLs
    const imagesDataUrl = await createFalImageDataset(referenceImages);

    // Step 2: Submit training job
    const { request_id } = await fal.queue.submit('fal-ai/flux-lora-fast-training', {
      input: {
        images_data_url:     imagesDataUrl,
        trigger_word:        triggerWord,
        is_style:            false,       // face/identity LoRA
        create_masks:        true,        // auto-mask non-subject elements
        steps:               1000,        // fast training preset
        multiresolution:     true,
        train_text_encoder:  true,
        caption_dropout_rate: 0.1,
        optimizer:           'adamw8bit',
        rank:                16,          // balance quality vs size
        // Captions generated from face_prompt
        captions: referenceImages.map(() => facePrompt),
        // NOTE: `multiresolution` is a valid fal-ai/flux-lora-fast-training
        // input param but is missing from @fal-ai/client's generated
        // FluxKreaTrainerInput type for this SDK version — cast to keep
        // the runtime param while satisfying the (stale) type.
      } as never,
      webhookUrl: `${env.NEXT_PUBLIC_APP_URL}/api/webhooks/fal-lora?characterId=${characterId}`,
    });

    return {
      success:       true,
      falRequestId:  request_id,
      estimatedCost: estimateTrainingCost(referenceImages.length),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('fal: training error', { characterSlug, error: msg });
    return { success: false, error: msg };
  }
}

/**
 * Poll training status and retrieve the model URL when complete.
 */
export async function getTrainingStatus(falRequestId: string): Promise<{
  status:      'queued' | 'in_progress' | 'complete' | 'failed';
  loraModelId?: string;
  error?:      string;
}> {
  try {
    const status = await fal.queue.status('fal-ai/flux-lora-fast-training', {
      requestId: falRequestId,
      logs:      false,
    });

    if (status.status === 'COMPLETED') {
      // MIGRATION (Phase 3, @fal-ai/client 1.x): queue.result() now returns
      // { data, requestId } instead of the output directly — see
      // fal.ai/docs/clients/javascript's migration guide.
      const result = await fal.queue.result(
        'fal-ai/flux-lora-fast-training',
        { requestId: falRequestId },
      ) as { data: { diffusers_lora_file: { url: string } } };
      return {
        status:      'complete',
        loraModelId: result?.data?.diffusers_lora_file?.url,
      };
    }

    // Note: this SDK's QueueStatus union is IN_PROGRESS | COMPLETED | IN_QUEUE —
    // there is no FAILED member. A failed job surfaces by throwing when we
    // call fal.queue.result() once it's no longer queued/in-progress, which
    // is caught below, not via a distinct status string here.

    return { status: status.status === 'IN_QUEUE' ? 'queued' : 'in_progress' };
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : 'unknown' };
  }
}

// ── Scene Generation ──────────────────────────────────────────────────────────

const NEGATIVE_PROMPT_DEFAULT = [
  'ugly, deformed, disfigured, bad anatomy, bad hands,',
  'blurry, out of focus, watermark, signature, text,',
  'multiple people, extra faces, inconsistent identity,',
  'low quality, noise, grain, artifacts,',
  'overexposed, underexposed',
].join(' ');

/**
 * Generate a scene image using the character's locked LoRA.
 *
 * The face_prompt ensures the character stays identical.
 * The scene_prompt only changes the environment.
 * Result: same face, new world.
 */
export async function generateScene(
  input: SceneGenerationInput,
): Promise<SceneGenerationResult> {
  const {
    loraModelId,
    facePrompt,
    scenePrompt,
    negativePrompt = NEGATIVE_PROMPT_DEFAULT,
    imageSize = 'portrait_4_3',
    steps = 40,
    guidance = 4.0,
    seed,
    allowMature = false,
  } = input;

  // Full prompt: locked character identity + scene context
  const fullPrompt = `${facePrompt} ${scenePrompt}`;

  try {
    // RESILIENCE-FIX: fal.ai calls in this file had no circuit breaker,
    // despite breakers.imageGen() already existing in circuit-breaker.ts
    // with tuned thresholds (5 failures / 60s timeout) — it was defined but
    // never actually wired to any call site. Unlike generateBaseImage()'s
    // caller (primary-image.ts), which has an app-level Grok-primary
    // fallback, generateScene() is the LoRA identity-locked path that
    // intentionally always hits fal directly (see primary-image.ts's
    // top-of-file comment) — there's no other provider to fail over to, so
    // a real outage previously meant every caller (chat inline images,
    // batch scene generation, content-engine) independently retried the
    // full ~10-60s fal.subscribe() call before failing, instead of
    // short-circuiting fast once the breaker trips.
    const result = await breakers.imageGen().execute(() => fal.subscribe('fal-ai/flux-lora', {
      input: {
        prompt:          fullPrompt,
        negative_prompt: negativePrompt,
        loras:           [{ path: loraModelId, scale: 1.0 }],
        image_size:      imageSize,
        num_inference_steps: steps,
        guidance_scale:  guidance,
        seed:            seed ?? Math.floor(Math.random() * 2147483647),
        num_images:      1,
        enable_safety_checker: !allowMature,
        output_format:   'png',
      } as never, // NOTE: negative_prompt missing from FluxLoraInput type in this SDK version
    }));

    // MIGRATION (Phase 3, @fal-ai/client 1.x): subscribe() now returns
    // { data, requestId } instead of the output directly.
    const data = (result as { data: { images: Array<{ url: string }>; seed?: number } }).data;
    const image = data?.images?.[0];

    if (!image?.url) {
      return { success: false, error: 'no_image_returned' };
    }

    return {
      success:       true,
      imageUrl:      image.url,
      falRequestId:  undefined,
      seed:          data?.seed,
      costUsd:       estimateGenerationCost(steps),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('fal: scene error', { characterSlug: input.characterSlug, error: msg });
    return { success: false, error: msg };
  }
}

export interface BaseImageGenerationInput {
  prompt:          string;
  negativePrompt?: string;
  imageSize?:      'portrait_4_3' | 'square' | 'landscape_16_9' | 'portrait_16_9';
  steps?:          number;
  guidance?:       number;
  seed?:           number;
  /** See SceneGenerationInput.allowMature above — identical contract and caveats. */
  allowMature?:    boolean;
}

/**
 * Generate an image via Fal.ai with no character LoRA — used when a
 * character hasn't completed LoRA training yet. Same model family and call
 * shape as generateScene() above, just without `loras`, so callers can treat
 * "has a trained LoRA" as a pure branch rather than two different generation
 * backends entirely.
 */
export async function generateBaseImage(
  input: BaseImageGenerationInput,
): Promise<SceneGenerationResult> {
  const {
    prompt,
    negativePrompt = NEGATIVE_PROMPT_DEFAULT,
    imageSize = 'portrait_4_3',
    steps = 40,
    guidance = 4.0,
    seed,
    allowMature = false,
  } = input;

  try {
    const result = await breakers.imageGen().execute(() => fal.subscribe('fal-ai/flux/dev', {
      input: {
        prompt,
        negative_prompt: negativePrompt,
        image_size:      imageSize,
        num_inference_steps: steps,
        guidance_scale:  guidance,
        seed:            seed ?? Math.floor(Math.random() * 2147483647),
        num_images:      1,
        enable_safety_checker: !allowMature,
        output_format:   'png',
      } as never, // NOTE: negative_prompt missing from FluxDevInput type in this SDK version
    }));

    // MIGRATION (Phase 3, @fal-ai/client 1.x): subscribe() now returns
    // { data, requestId } instead of the output directly.
    const data = (result as { data: { images: Array<{ url: string }>; seed?: number } }).data;
    const image = data?.images?.[0];

    if (!image?.url) {
      return { success: false, error: 'no_image_returned' };
    }

    return {
      success:  true,
      imageUrl: image.url,
      seed:     data?.seed,
      costUsd:  estimateGenerationCost(steps),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('fal: base image error', { error: msg });
    return { success: false, error: msg };
  }
}

/**
 * Generate the full canon image set for a new character.
 * 50 images across all angles, expressions, and lighting scenarios.
 * These form the visual identity library for the character.
 *
 * WIRE-FIX (production audit, 2026-07-23): this used to return
 * generateScene()'s raw imageUrls straight through — Fal's own hosted
 * URLs, which are not guaranteed permanent (see uploadToR2()'s docstring
 * and animate-portrait.ts's persistAnimatedVideoToR2() for the same
 * reasoning applied to video). Every other caller of generateScene() in
 * this codebase individually re-uploads to R2 right after; this function
 * looped generateScene() internally and skipped that step, so the 50 URLs
 * it handed back would 404 once Fal expired them — a real trap for
 * whoever wired this up, since nothing about the return type signaled
 * "these are still ephemeral." Now uploads each result to R2 as part of
 * the same batch, same as scene-generator.ts's single-image path, so the
 * URLs this function returns are actually permanent by the time callers
 * see them.
 */
export async function generateCanonImageSet(
  input: CanonImageSetInput,
): Promise<{ success: boolean; imageUrls: string[]; error?: string }> {
  const { loraModelId, facePrompt, characterSlug } = input;

  const canonScenes = [
    // — Angles (10 images) —
    'front-facing portrait, neutral expression, soft studio lighting, white seamless background',
    'three-quarter left angle portrait, neutral expression, warm studio lighting',
    'three-quarter right angle portrait, neutral expression, warm studio lighting',
    'side profile left, neutral expression, dramatic rim lighting',
    'side profile right, neutral expression, dramatic rim lighting',
    'slight upward angle, neutral expression, cinematic lighting',
    'slight downward angle, neutral expression, editorial lighting',
    'close-up face portrait, neutral expression, beauty lighting',
    'full body front view, standing relaxed pose, neutral expression',
    'full body three-quarter view, standing natural pose',

    // — Expressions (6 images) —
    'front-facing portrait, warm genuine smile, soft natural lighting',
    'front-facing portrait, subtle sad expression, eyes slightly downcast, soft lighting',
    'front-facing portrait, surprised expression, eyebrows raised, natural lighting',
    'front-facing portrait, laughing, eyes crinkling, warm golden lighting',
    'front-facing portrait, thoughtful expression, looking slightly off-camera',
    'front-facing portrait, intense focused expression, dramatic lighting',

    // — Lighting Scenarios (8 images) —
    'portrait in golden hour sunlight, warm rim light, outdoor, bokeh background',
    'portrait in cool blue moonlight, night exterior, cinematic',
    'portrait in warm candlelight, soft shadows, intimate atmosphere',
    'portrait in studio with dramatic side lighting, high contrast',
    'portrait in diffused natural window light, bright airy',
    'portrait in neon light ambiance, pink and blue tones, night',
    'portrait in overcast daylight, flat soft diffused light',
    'portrait in firelight, warm amber glow, dramatic shadows',

    // — Scene Contexts (12 images) —
    'seated at a cafe table, relaxed, lifestyle photography',
    'standing in an urban street, editorial style',
    'outdoors in nature, golden light filtering through trees',
    'in a minimalist modern interior, architectural photography',
    'reading a book, focused, soft library light',
    'looking out a rain-streaked window, contemplative',
    'walking, motion blur in background, confident stride',
    'standing by a window, backlist silhouette, moody',
    'in a crowd but isolated in focus, candid editorial',
    'close-up hands and face detail, jewelry/accessories visible',
    'overhead environmental shot, bird\'s eye lifestyle',
    'mirror reflection, double portrait effect',

    // — Mood / Atmosphere (8 images) —
    'romantic soft focus, pastel morning light, dreamy',
    'editorial sharp fashion portrait, bold styling',
    'cinematic widescreen crop, movie still quality',
    'documentary naturalistic portrait, authentic moment',
    'luxury aspirational portrait, aspirational magazine quality',
    'intimate close-up, personal and quiet',
    'powerful commanding portrait, strong presence',
    'vulnerable soft portrait, gentle and open',

    // — Final 6: Character-specific signature scenes —
    'in signature environment 1, full character context',
    'in signature environment 2, full character context',
    'interaction scene — hands visible, gesture, emotional',
    'back-of-shoulder shot, looking away romantically',
    'environmental portrait: character in their natural world',
    'final hero shot: best of everything combined',
  ];

  const imageUrls: string[] = [];
  const batchSize = 5; // process in parallel batches to stay within rate limits

  for (let i = 0; i < canonScenes.length; i += batchSize) {
    const batchStart = i; // for stable, collision-free R2 keys across batches
    const batch = canonScenes.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(scene => generateScene({
        characterSlug,
        loraModelId,
        facePrompt,
        scenePrompt: scene,
        steps: 28,
      }))
    );

    // Upload this batch to R2 in parallel too — same reasoning as the
    // generation step above (bounded concurrency, not one-request-at-a-time),
    // and keeps a slow/failed R2 upload from blocking images that already
    // succeeded from ever reaching a permanent URL.
    const uploads = await Promise.allSettled(
      results.map((r, j) => {
        if (r.status !== 'fulfilled' || !r.value.imageUrl) return Promise.resolve(null);
        const index = batchStart + j;
        const key = `characters/${characterSlug}/canon/${index.toString().padStart(2, '0')}-${Date.now()}.jpg`;
        return uploadUrlToR2(r.value.imageUrl, key);
      })
    );

    for (const u of uploads) {
      if (u.status === 'fulfilled' && u.value?.success && u.value.r2Url) {
        imageUrls.push(u.value.r2Url);
      }
    }

    // Brief pause between batches to respect Fal rate limits
    if (i + batchSize < canonScenes.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  return {
    success:   imageUrls.length >= 40,  // 80% success threshold
    imageUrls,
    error:     imageUrls.length < 40 ? `only_${imageUrls.length}_of_50_generated` : undefined,
  };
}

// ── Orchestration: run + persist ─────────────────────────────────────────

/**
 * Run the canon set end-to-end for a character and persist the result —
 * the single call site webhooks/fal-lora/route.ts uses once training
 * completes. Split from generateCanonImageSet() itself so that function
 * stays a pure generate-and-return-URLs unit (testable without a DB), same
 * separation discovery-engine.ts keeps between the deterministic hooks and
 * the underlying chain.
 *
 * Deliberately swallows its own errors into the DB row (canon_set_status
 * = 'failed', canon_set_error set) rather than throwing — callers run this
 * from a fire-and-forget background task (see after() in the webhook) with
 * nothing left to catch a rejection.
 */
export async function runCanonImageSetForCharacter(
  characterId: string,
  input: CanonImageSetInput,
): Promise<void> {
  const { supabaseAdmin } = await import('@/lib/supabase/admin');

  await supabaseAdmin
    .from('characters')
    .update({ canon_set_status: 'generating', canon_set_error: null })
    .eq('id', characterId);

  try {
    const result = await generateCanonImageSet(input);

    await supabaseAdmin
      .from('characters')
      .update({
        canon_image_urls:      result.imageUrls,
        canon_set_status:      result.success ? 'complete' : 'failed',
        canon_set_error:       result.success ? null : (result.error ?? 'unknown_error'),
        canon_set_generated_at: new Date().toISOString(),
      })
      .eq('id', characterId);

    if (!result.success) {
      logger.warn('[lora-pipeline] canon set below success threshold', {
        characterId, characterSlug: input.characterSlug, count: result.imageUrls.length, error: result.error,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[lora-pipeline] canon set generation threw', { characterId, error: msg });
    await supabaseAdmin
      .from('characters')
      .update({ canon_set_status: 'failed', canon_set_error: msg })
      .eq('id', characterId);
  }
}

// ── Cloudflare R2 Upload ──────────────────────────────────────────────────────

// Client + upload logic now live in lib/storage/r2.ts (shared with the admin
// character-media upload route). uploadToR2 kept as a re-export under its
// original name so no other call site in the codebase needs to change.
export { uploadUrlToR2 as uploadToR2 } from '@/lib/storage/r2';

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Upload reference images to Fal.ai storage, return dataset URL */
async function createFalImageDataset(imageUrls: string[]): Promise<string> {
  // For production: use fal.storage.upload for each image
  // For MVP: pass direct URLs if they're publicly accessible
  // This creates a zip-compatible dataset URL for training
  const uploadedUrls = await Promise.all(
    imageUrls.map(async url => {
      const response = await fetch(url);
      const blob = await response.blob();
      const file = new File([blob], `ref_${Date.now()}.jpg`, { type: 'image/jpeg' });
      return fal.storage.upload(file);
    })
  );

  // Create a simple manifest JSON that Fal.ai can consume
  const manifest = { images: uploadedUrls.map((url: string, i: number) => ({ url, name: `ref_${i}.jpg` })) };
  const manifestBlob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  const manifestFile = new File([manifestBlob], 'manifest.json', { type: 'application/json' });
  return fal.storage.upload(manifestFile);
}

function estimateTrainingCost(imageCount: number): number {
  // Approximate cost based on Fal.ai pricing for flux-lora-fast-training
  // ~$0.05 per training minute, ~10 minutes for 10-30 images
  const minutes = Math.max(8, Math.min(20, imageCount * 0.5));
  return parseFloat((minutes * 0.05).toFixed(3));
}

function estimateGenerationCost(steps: number): number {
  // ~$0.003 per image at standard quality
  return parseFloat((0.003 * (steps / 28)).toFixed(4));
}
