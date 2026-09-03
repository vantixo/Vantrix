// src/lib/grok/video-pipeline.ts
// ─────────────────────────────────────────────────────────────────────────────
// xAI Grok Imagine video generation — second video provider alongside
// fal.ai's Kling pipeline (src/lib/fal/animate-portrait.ts).
//
// Same safety posture as image-pipeline.ts in this directory: moderation
// happens upstream and unconditionally, this module has no bypass flag, and
// this provider is only a *failover on outage*, never a route around a
// content-policy rejection from the primary provider. See the header comment
// in image-pipeline.ts for the full rationale — it applies identically here.
//
// xAI's video API is asynchronous: POST to start, then GET-poll a request id.
// Reference: https://docs.x.ai/developers/model-capabilities/video/generation
// ─────────────────────────────────────────────────────────────────────────────

import { env } from '@/env';
import { logger } from '@/lib/logger';
import { uploadToR2 } from '@/lib/fal/lora-pipeline';

const XAI_BASE_URL = 'https://api.x.ai/v1';

/** Same "living portrait" framing as fal's LIVING_PORTRAIT_MOTION_PROMPT —
 *  kept in sync deliberately; character personality should come from the
 *  image, not from per-character motion prompts. */
const LIVING_PORTRAIT_MOTION_PROMPT =
  'subtle natural breathing motion, gentle occasional blinking, very slight ' +
  'head movement, minimal camera movement, photorealistic, no distortion, ' +
  'the person otherwise stays still and looks at the camera';

export interface AnimatePortraitGrokInput {
  characterId:   string;
  characterSlug: string;
  imageUrl:      string;
}

export interface AnimatePortraitGrokResult {
  success:    boolean;
  requestId?: string;
  error?:     string;
  statusCode?: number;
}

function isConfigured(): boolean {
  return Boolean(env.GROK_API_KEY);
}

/**
 * Start a Grok Imagine video generation job animating a still portrait.
 * Returns immediately with a request id to poll — same async shape as
 * fal's queue-based animatePortrait().
 */
export async function animatePortraitGrok(input: AnimatePortraitGrokInput): Promise<AnimatePortraitGrokResult> {
  if (!isConfigured()) {
    return { success: false, error: 'Grok is not configured — set GROK_API_KEY to enable it as a video provider. See .env.example.' };
  }

  const { characterSlug, imageUrl } = input;

  try {
    const res = await fetch(`${XAI_BASE_URL}/videos/generations`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${env.GROK_API_KEY}`,
      },
      body: JSON.stringify({
        model:       'grok-imagine-video',
        prompt:      LIVING_PORTRAIT_MOTION_PROMPT,
        image_url:   imageUrl,
        duration:    5,
        aspect_ratio: '9:16',
        resolution:  '720p',
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      logger.warn('grok: video generation start failed', { characterSlug, status: res.status, body: bodyText.slice(0, 500) });
      return { success: false, error: `xai_http_${res.status}`, statusCode: res.status };
    }

    const data = (await res.json()) as { request_id?: string };
    if (!data.request_id) {
      return { success: false, error: 'no_request_id_returned' };
    }

    return { success: true, requestId: data.request_id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('grok: video generation start error', { characterSlug, error: msg });
    return { success: false, error: msg };
  }
}

export interface GrokVideoStatus {
  status:    'queued' | 'in_progress' | 'complete' | 'failed' | 'expired';
  videoUrl?: string;
  error?:    string;
}

/** Poll a previously-started Grok video job. */
export async function getGrokVideoStatus(requestId: string): Promise<GrokVideoStatus> {
  if (!isConfigured()) {
    return { status: 'failed', error: 'Grok is not configured — set GROK_API_KEY.' };
  }

  try {
    const res = await fetch(`${XAI_BASE_URL}/videos/${requestId}`, {
      headers: { 'Authorization': `Bearer ${env.GROK_API_KEY}` },
      signal:  AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      return { status: 'failed', error: `xai_http_${res.status}` };
    }

    const data = (await res.json()) as { status?: string; video?: { url?: string } };

    if (data.status === 'done') {
      return { status: 'complete', videoUrl: data.video?.url };
    }
    if (data.status === 'failed' || data.status === 'expired') {
      return { status: data.status as 'failed' | 'expired' };
    }
    return { status: 'in_progress' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'failed', error: msg };
  }
}

/**
 * Convenience helper: poll until done (or timeout), then upload the result
 * to R2 for permanent storage — same pattern as fal's uploadAnimatedVideoToR2.
 */
export async function pollAndStoreGrokVideo(
  requestId: string,
  characterId: string,
  maxWaitMs = 5 * 60 * 1000,
): Promise<{ success: boolean; r2Url?: string; error?: string }> {
  const start = Date.now();
  const pollIntervalMs = 5000;

  while (Date.now() - start < maxWaitMs) {
    const status = await getGrokVideoStatus(requestId);

    if (status.status === 'complete' && status.videoUrl) {
      const key = `character-portraits/${characterId}/${Date.now()}-grok.mp4`;
      const uploaded = await uploadToR2(status.videoUrl, key, 'video/mp4');
      if (!uploaded.success || !uploaded.r2Url) {
        return { success: false, error: 'r2_upload_failed' };
      }
      return { success: true, r2Url: uploaded.r2Url };
    }

    if (status.status === 'failed' || status.status === 'expired') {
      return { success: false, error: status.error ?? status.status };
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return { success: false, error: 'timeout' };
}
