// src/lib/video/providers/hotapi.ts
// ─────────────────────────────────────────────────────────────────────────────
// HotAPI video-generation adapter — PRIMARY video provider for Vantrix.
// Same gateway as lib/image/providers/hotapi.ts, different endpoint family.
// Implements the shared VideoProvider interface (types.ts) so the router
// (video-router.ts) and every call site never touch HotAPI's own request/
// response shape directly.
//
// Async model — submit() returns a task id immediately; actual generation
// takes anywhere from ~30s to a few minutes. Callers poll getStatus().
//
// Moderation note (same rule as every other provider in this app):
// moderateCharacter() runs upstream in the calling route BEFORE this module
// is ever invoked. This file has no moderation logic and no bypass path.
// ─────────────────────────────────────────────────────────────────────────────

import { env } from '@/env';
import { logger } from '@/lib/logger';
import { sanitizeProviderError } from '@/lib/security';
import type { VideoProvider, VideoGenerationInput, VideoSubmitResult, VideoTaskStatus } from './types';

const SUBMIT_TIMEOUT_MS = 30_000;
const STATUS_TIMEOUT_MS = 15_000;
const RESPONSE_SIZE_LIMIT = 8 * 1024 * 1024;

function isConfigured(): boolean {
  return Boolean(env.HOTAPI_API_KEY);
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
    if (total > RESPONSE_SIZE_LIMIT) throw new Error('hotapi: response exceeded size limit');
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

async function submit(input: VideoGenerationInput): Promise<VideoSubmitResult> {
  if (!isConfigured()) {
    return { success: false, error: 'hotapi: HOTAPI_API_KEY not configured', statusCode: undefined };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);

  try {
    const res = await fetch(`${env.HOTAPI_API_URL.replace(/\/$/, '')}/v1/videos/generate`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${env.HOTAPI_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        image:            input.imageUrl,
        prompt:           input.prompt,
        negative_prompt:  input.negativePrompt,
        duration:         input.durationSeconds ?? '5',
        mode:             input.mode ?? 'std',
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        success: false,
        error:   `hotapi ${res.status}: ${sanitizeProviderError(text)}`,
        statusCode: res.status,
      };
    }

    const raw  = await readWithLimit(res);
    const data = JSON.parse(raw) as { task_id?: string; id?: string; error?: string };
    const taskId = data.task_id ?? data.id;

    if (!taskId) {
      return { success: false, error: data.error ?? 'hotapi: no task_id in response', statusCode: res.status };
    }

    return { success: true, taskId, statusCode: res.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('[hotapi] video submit failed', { error: sanitizeProviderError(message) });
    return { success: false, error: `hotapi: ${sanitizeProviderError(message)}` };
  } finally {
    clearTimeout(timer);
  }
}

async function getStatus(taskId: string): Promise<VideoTaskStatus> {
  if (!isConfigured()) {
    return { status: 'failed', error: 'hotapi: HOTAPI_API_KEY not configured' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);

  try {
    const res = await fetch(`${env.HOTAPI_API_URL.replace(/\/$/, '')}/v1/videos/${taskId}`, {
      headers: { 'Authorization': `Bearer ${env.HOTAPI_API_KEY}` },
      signal: controller.signal,
    });

    if (!res.ok) {
      // A 5xx/429 checking status doesn't mean the *task* failed — it means
      // we couldn't confirm its state this attempt. Let the caller retry.
      logger.warn('[hotapi] video status check http error — treating as transient', { taskId, status: res.status });
      return { status: 'check_error', error: `hotapi_http_${res.status}` };
    }

    const raw = await readWithLimit(res);
    const data = JSON.parse(raw) as { status?: string; video_url?: string; url?: string; error?: string };

    if (data.status === 'succeeded' || data.status === 'succeed' || data.status === 'completed') {
      const videoUrl = data.video_url ?? data.url;
      if (!videoUrl) {
        return { status: 'failed', error: 'hotapi: succeeded status missing video url' };
      }
      return { status: 'succeed', videoUrl };
    }
    if (data.status === 'failed' || data.status === 'error') {
      return { status: 'failed', error: data.error ?? 'hotapi_task_failed' };
    }
    if (data.status === 'processing' || data.status === 'running') {
      return { status: 'processing' };
    }
    return { status: 'submitted' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('[hotapi] video status check threw — treating as transient', { taskId, error: sanitizeProviderError(message) });
    return { status: 'check_error', error: sanitizeProviderError(message) };
  } finally {
    clearTimeout(timer);
  }
}

export const hotapiVideoProvider: VideoProvider = {
  name: 'hotapi',
  submit,
  getStatus,
};
