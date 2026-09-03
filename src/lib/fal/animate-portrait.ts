// src/lib/fal/animate-portrait.ts
// ─────────────────────────────────────────────────────────────────────────────
// "Living portrait" animation: turns a character's static image_url into a
// short (~3-5s) looping video with subtle motion (blink, breathe, slight
// head sway) — no driving video/audio required, just the still + a motion
// prompt. Delivered async via fal.ai's queue + webhook, same pattern as the
// LoRA training pipeline in lora-pipeline.ts.
//
// MODEL CHOICE — verified against fal's live API docs (schema for
// fal-ai/kling-video/v1.6/pro/image-to-video, checked 2026-08-30):
// fal-ai/live-portrait is NOT the right model for this — it transfers
// expression FROM a driving video onto a photo, it does not generate
// independent subtle motion from a still image alone. Kling's
// image-to-video family (text-motion-prompt driven, no driving video
// required) is the right category, and the specific slug/params below are
// confirmed against the current schema: `image_url` + `prompt` required,
// `duration` is a "5" | "10" enum (default "5"), `aspect_ratio` is a
// "16:9" | "9:16" | "1:1" enum (default "16:9" — see the PROVIDER-CONSTRAINT
// FIX comment on the submit call below for why that default was wrong for
// this app and is now set explicitly). If fal's catalog changes again,
// FAL_ANIMATE_MODEL is isolated to one constant for a one-line swap.
// ─────────────────────────────────────────────────────────────────────────────

import { fal } from '@fal-ai/client';
import { env } from '@/env';
import { uploadToR2 } from './lora-pipeline';
import { logger } from '@/lib/logger';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { redis } from '@/lib/redis';

fal.config({ credentials: env.FAL_KEY });

/** Verified against fal.ai's current model catalog — see note above. */
const FAL_ANIMATE_MODEL = 'fal-ai/kling-video/v1.6/pro/image-to-video'; // pro tier — higher quality than 'standard'

// ── Platform-wide daily budget guard ────────────────────────────────────────
// Modeled on checkDailyVideoCap (rate-limit/index.ts) but scoped to the whole
// platform instead of one user, since triggerAnimationAsync's other four call
// sites (creation, import, admin backfill, cron backfill) have no userId-based
// limiter of their own. Same COST-HARDENING rationale as checkDailyVideoCap:
// fails CLOSED (denies) on Redis outage rather than open — Kling is a real,
// metered charge per call, and an unmetered submission path during a Redis
// blip is a worse outcome than a temporarily-paused animation queue.
function videoBudgetKey(): string {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  return `vantrix:daily:vid:platform:${day}`;
}

async function checkPlatformVideoBudget(): Promise<{ allowed: boolean; used: number; limit: number }> {
  const limit = env.PLATFORM_DAILY_VIDEO_BUDGET;
  const key = videoBudgetKey();

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
    logger.error('animate-portrait: platform video budget check failed, denying (fail-closed)', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { allowed: false, used: 0, limit };
  }
}

/**
 * A short, deliberately narrow motion prompt — subtle "living portrait"
 * motion, not a dynamic scene. Keeping this fixed (not per-character) is
 * intentional: character personality/expression should come from the
 * generated image itself, not from prompt-driven video motion, which is
 * far less controllable per-character at this stage.
 */
const LIVING_PORTRAIT_MOTION_PROMPT =
  'subtle natural breathing motion, gentle occasional blinking, very slight ' +
  'head movement, minimal camera movement, photorealistic, no distortion, ' +
  'the person otherwise stays still and looks at the camera';

export interface AnimatePortraitInput {
  characterId:   string;
  characterSlug: string;
  imageUrl:      string; // the character's current static image_url
}

export interface AnimatePortraitResult {
  success:       boolean;
  falRequestId?: string;
  error?:        string;
}

/**
 * Submit an animation job for a character's existing portrait. Async —
 * returns immediately with the fal request id; the actual video arrives via
 * the /api/webhooks/fal-animate callback, which updates
 * characters.video_url / video_status.
 *
 * Call sites: auto-triggered (fire-and-forget, via triggerAnimationAsync
 * below) from every call site that writes a character's image_url —
 * character creation (api/characters POST) and admin portrait backfill
 * (api/admin/generate-character-portraits). Every successful generation,
 * including regenerates, is intentional per product decision — see
 * triggerAnimationAsync for cost/failure handling.
 */
export async function animateCharacterPortrait(
  input: AnimatePortraitInput,
): Promise<AnimatePortraitResult> {
  const { characterId, imageUrl } = input;

  try {
    const result = await fal.queue.submit(FAL_ANIMATE_MODEL, {
      input: {
        image_url:    imageUrl,
        prompt:       LIVING_PORTRAIT_MOTION_PROMPT,
        duration:     '5', // verified against fal's schema: DurationEnum, "5" | "10"
        // PROVIDER-CONSTRAINT FIX: Kling's aspect_ratio is a hard enum
        // ("16:9" | "9:16" | "1:1") controlling the OUTPUT FRAME, and this
        // call was omitting it entirely — which silently falls back to
        // Kling's own default of "16:9" landscape. Every consumer of
        // characters.video_url (chat-header-avatar, character-gallery,
        // message-bubble, feed-stories-rail) renders it in a square or
        // circular aspect-square/rounded-full frame with object-cover, and
        // the source portraits are generated at imageSize 'portrait_4_3'
        // (see lora-pipeline.ts) — never landscape. Requesting "16:9" here
        // meant every living-portrait video came back in a frame shape none
        // of its actual display contexts use, forcing a heavier center-crop
        // than necessary (or visible letterboxing depending on how Kling
        // pads a portrait source into a wider canvas). "1:1" is the closest
        // enum value to both the source image's orientation and, more
        // importantly, matches 100% of the frames this video actually
        // renders inside.
        aspect_ratio: '1:1',
      },
      webhookUrl: `${env.NEXT_PUBLIC_APP_URL}/api/webhooks/fal-animate?characterId=${characterId}`,
    });

    return { success: true, falRequestId: result.request_id };
  } catch (err) {
    return {
      success: false,
      error:   err instanceof Error ? err.message : 'unknown error submitting animation job',
    };
  }
}

/**
 * Called by the webhook handler once fal.ai reports the video is ready.
 * Downloads the result from fal's CDN and re-uploads to R2 for permanent
 * storage — same reasoning as uploadToR2() in lora-pipeline.ts: fal's URLs
 * are not guaranteed permanent, and we want the asset under our own control
 * (CDN, retention, cost) rather than depending on a third party indefinitely.
 */
export async function persistAnimatedVideoToR2(
  characterSlug: string,
  falVideoUrl:   string,
): Promise<{ success: boolean; r2Url?: string; error?: string }> {
  const key = `characters/${characterSlug}/living-portrait-${Date.now()}.mp4`;
  return uploadToR2(falVideoUrl, key, 'video/mp4');
}

/**
 * Fire-and-forget auto-trigger for every image_url write (creation +
 * regenerate, per product decision). Deliberately not awaited by callers —
 * animation is a nice-to-have layered on top of the static image, and a
 * transient fal.ai failure or slow queue submit must never block or fail
 * the request that just successfully created/updated the character's
 * image. Errors are swallowed to a log line only; the character keeps
 * working with its static image_url if the animate call never lands
 * (video_status stays whatever it was, AnimatedPortrait falls back cleanly).
 *
 * NOTE: this calls fal.ai's queue on every regenerate, not just first save
 * — each call is a billable video-generation job on top of the image job.
 * Confirm this is still the desired cost tradeoff before high regenerate
 * volume ships; see the model-choice warning at the top of this file too.
 */
export function triggerAnimationAsync(input: AnimatePortraitInput): void {
  runPrimaryAnimation(input).catch((err) => {
    logger.warn('animate-portrait.auto-trigger.threw', {
      characterId: input.characterId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/**
 * fal.ai is the sole portrait-animation provider (Grok's video pipeline is
 * no longer used here — this now matches the general video pipeline's
 * decision to standardize on a single provider per capability rather than
 * splitting portrait animation onto a different one). Submission is
 * fire-and-forget from the caller's perspective; fal's queue+webhook flow
 * completes the DB update asynchronously via /api/webhooks/fal-animate —
 * this function only needs to mark the row 'processing' on a successful
 * submit, or 'failed' if the submit call itself errors.
 */
async function runPrimaryAnimation(input: AnimatePortraitInput): Promise<void> {
  const { characterId } = input;

  const budget = await checkPlatformVideoBudget();
  if (!budget.allowed) {
    logger.warn('animate-portrait.platform-budget-exceeded', {
      characterId, used: budget.used, limit: budget.limit,
    });
    await supabaseAdmin
      .from('characters')
      .update({
        video_status: 'failed',
        video_error: `platform daily video budget reached (${budget.used}/${budget.limit}) — will retry via animate-backfill cron tomorrow`,
      })
      .eq('id', characterId);
    return;
  }

  const falResult = await animateCharacterPortrait(input);

  if (!falResult.success || !falResult.falRequestId) {
    logger.warn('animate-portrait.auto-trigger.failed', { characterId, error: falResult.error });
    await supabaseAdmin
      .from('characters')
      .update({ video_status: 'failed', video_error: falResult.error ?? 'fal animation submit failed' })
      .eq('id', characterId);
    return;
  }

  await supabaseAdmin
    .from('characters')
    .update({ video_status: 'processing', video_fal_request_id: falResult.falRequestId, video_error: null })
    .eq('id', characterId);

  // fal's webhook (/api/webhooks/fal-animate) completes the DB update from here.
}
