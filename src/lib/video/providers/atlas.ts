// src/lib/video/providers/atlas.ts
// ─────────────────────────────────────────────────────────────────────────────
// Atlas video-generation adapter — BACKUP video provider for Vantrix. Only
// invoked by video-router.ts when HotAPI is unconfigured, times out, or
// fails with an outage-shaped (5xx/network) error — never on a 4xx
// content-policy rejection from HotAPI. Same moderation note as hotapi.ts:
// moderateCharacter() already ran upstream before this is ever called.
// Atlas does advanced video/model routing on its end — this adapter just
// speaks its video-generation endpoint through the shared VideoProvider
// contract.
// ─────────────────────────────────────────────────────────────────────────────

import { env } from '@/env';
import { logger } from '@/lib/logger';
import { sanitizeProviderError } from '@/lib/security';
import type { VideoProvider, VideoGenerationInput, VideoSubmitResult, VideoTaskStatus } from './types';

const SUBMIT_TIMEOUT_MS = 30_000;
const STATUS_TIMEOUT_MS = 15_000;
const RESPONSE_SIZE_LIMIT = 8 * 1024 * 1024;

function isConfigured(): boolean {
  return Boolean(env.ATLAS_API_KEY);
}

async function readWithLimit(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return res.text();
  const decoder = new TextDecoder();
  let out = '';
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > RESPONSE_SIZE_LIMIT) throw new Error('atlas: response exceeded size limit');
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

async function submit(input: VideoGenerationInput): Promise<VideoSubmitResult> {
  if (!isConfigured()) {
    return { success: false, error: 'atlas: ATLAS_API_KEY not configured', statusCode: undefined };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);

  try {
    const res = await fetch(`${env.ATLAS_API_URL.replace(/\/$/, '')}/v1/videos/generations`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${env.ATLAS_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        image:           input.imageUrl,
        prompt:          input.prompt,
        negative_prompt: input.negativePrompt,
        duration:        input.durationSeconds ?? '5',
        mode:            input.mode ?? 'std',
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        success: false,
        error:   `atlas ${res.status}: ${sanitizeProviderError(text)}`,
        statusCode: res.status,
      };
    }

    const raw  = await readWithLimit(res);
    const data = JSON.parse(raw) as { task_id?: string; id?: string; error?: string };
    const taskId = data.task_id ?? data.id;

    if (!taskId) {
      return { success: false, error: data.error ?? 'atlas: no task_id in response', statusCode: res.status };
    }

    return { success: true, taskId, statusCode: res.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('[atlas] video submit failed', { error: sanitizeProviderError(message) });
    return { success: false, error: `atlas: ${sanitizeProviderError(message)}` };
  } finally {
    clearTimeout(timer);
  }
}

async function getStatus(taskId: string): Promise<VideoTaskStatus> {
  if (!isConfigured()) {
    return { status: 'failed', error: 'atlas: ATLAS_API_KEY not configured' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);

  try {
    const res = await fetch(`${env.ATLAS_API_URL.replace(/\/$/, '')}/v1/videos/generations/${taskId}`, {
      headers: { 'Authorization': `Bearer ${env.ATLAS_API_KEY}` },
      signal: controller.signal,
    });

    if (!res.ok) {
      logger.warn('[atlas] video status check http error — treating as transient', { taskId, status: res.status });
      return { status: 'check_error', error: `atlas_http_${res.status}` };
    }

    const raw = await readWithLimit(res);
    const data = JSON.parse(raw) as { status?: string; video_url?: string; url?: string; error?: string };

    if (data.status === 'succeeded' || data.status === 'succeed' || data.status === 'completed') {
      const videoUrl = data.video_url ?? data.url;
      if (!videoUrl) {
        return { status: 'failed', error: 'atlas: succeeded status missing video url' };
      }
      return { status: 'succeed', videoUrl };
    }
    if (data.status === 'failed' || data.status === 'error') {
      return { status: 'failed', error: data.error ?? 'atlas_task_failed' };
    }
    if (data.status === 'processing' || data.status === 'running') {
      return { status: 'processing' };
    }
    return { status: 'submitted' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('[atlas] video status check threw — treating as transient', { taskId, error: sanitizeProviderError(message) });
    return { status: 'check_error', error: sanitizeProviderError(message) };
  } finally {
    clearTimeout(timer);
  }
}

export const atlasVideoProvider: VideoProvider = {
  name: 'atlas',
  submit,
  getStatus,
};
