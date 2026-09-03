// src/lib/media/primary-image.ts
// ─────────────────────────────────────────────────────────────────────────────
// REROUTE: HotAPI is now the primary image/video generator app-wide (Atlas is
// the backup — see lib/image/image-router.ts). fal.ai is kept wired for two
// things only, unchanged from before:
//   1. trainCharacterLoRA() — LoRA training itself (fal is the only provider
//      with this capability at all).
//   2. generateScene() call sites — LoRA-*identity-locked* scene generation.
//      Neither HotAPI nor Atlas has an equivalent to "render this exact
//      trained face in a new scene," so those call sites intentionally still
//      hit fal directly and are NOT routed through this helper. Swapping
//      those would silently break character face consistency, which is why
//      they're left alone rather than folded in here.
//
// Every other image generation path (previews, batch scenes without a
// trained LoRA yet, chat inline images, admin portrait generation) goes
// through this helper: HotAPI first, Atlas only as an outage fallback.
//
// Moderation is unchanged: it still runs in the calling route BEFORE this
// helper is invoked, for every call site, regardless of provider. This file
// has no moderation logic and no bypass path — provider choice only ever
// happens for prompts that already passed the app's own moderation check.
//
// grok/image-pipeline.ts and its GROK_API_KEY usage for images are retired
// by this change — nothing else in the app imports the image half of that
// module. lib/grok/video-pipeline.ts (unrelated capability) is untouched.
// ─────────────────────────────────────────────────────────────────────────────

import { generateImage } from '@/lib/image/image-router';
import { generateBaseImage } from '@/lib/fal/lora-pipeline';
import { logger } from '@/lib/logger';

export interface PrimaryImageInput {
  prompt:          string;
  negativePrompt?: string;
  imageSize?:      'portrait_4_3' | 'square' | 'landscape_16_9' | 'portrait_16_9';
  seed?:           number;
  allowMature?:    boolean;
}

export interface PrimaryImageResult {
  success:   boolean;
  imageUrl?: string;
  error?:    string;
  provider:  'hotapi' | 'atlas' | 'fal';
}

/**
 * Generate an image via the HotAPI/Atlas image router (see
 * lib/image/image-router.ts for the primary/backup failover policy). fal.ai
 * is kept as a final safety-net fallback only if BOTH HotAPI and Atlas fail
 * on an outage-shaped error — this preserves the "never leave the user with
 * no photo" guarantee the app had under the old Grok/fal setup, without fal
 * ever being tried first.
 */
export async function generatePrimaryImage(input: PrimaryImageInput): Promise<PrimaryImageResult> {
  const routed = await generateImage({
    prompt:          input.prompt,
    negativePrompt:  input.negativePrompt,
    imageSize:       input.imageSize,
    seed:            input.seed,
    allowMature:     input.allowMature,
  });

  if (routed.success && routed.imageUrl) {
    return { success: true, imageUrl: routed.imageUrl, provider: routed.provider };
  }

  // Only fall through to fal on an outage-shaped failure from BOTH HotAPI
  // and Atlas — a content-policy rejection stops here, same rule as before.
  const isOutage = !routed.statusCode || routed.statusCode >= 500;
  if (!isOutage) {
    logger.warn('Image router rejected prompt; not falling back to fal', {
      provider: routed.provider, statusCode: routed.statusCode,
    });
    return { success: false, error: routed.error, provider: routed.provider };
  }

  logger.warn('HotAPI + Atlas both unavailable, falling back to fal', { error: routed.error });
  const falResult = await generateBaseImage({
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    imageSize: input.imageSize,
    seed: input.seed,
    allowMature: input.allowMature,
  });

  if (falResult.success && falResult.imageUrl) {
    return { success: true, imageUrl: falResult.imageUrl, provider: 'fal' };
  }

  return { success: false, error: falResult.error ?? routed.error, provider: 'fal' };
}
