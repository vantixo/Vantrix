// src/lib/video/video-router.ts
// ─────────────────────────────────────────────────────────────────────────────
// VideoRouter — HotAPI primary, Atlas backup. Single entry point every route
// should call instead of touching a provider's video client directly, so the
// fallback policy lives in exactly one place. Mirrors lib/image/image-router.ts.
//
// Replaces the old direct-Kling video path (lib/kling/client.ts) — Kling is
// no longer used for video generation anywhere in the app. HotAPI and Atlas
// both support a video-generation endpoint, so the same primary/backup
// gateway pattern already used for images now covers video too.
//
// Failover rule (identical discipline to image-router.ts): only fail over
// to Atlas on an OUTAGE-shaped failure from HotAPI — missing config,
// timeout/network error, or 5xx. A 4xx from HotAPI means it rejected the
// prompt on its own content policy, and that must NOT be retried on a
// different, possibly-more-permissive provider with the same prompt.
//
// Async model — submitVideo() returns a task id immediately (composite,
// "<provider>:<taskId>", so getVideoStatus() knows which provider to poll
// without a separate lookup); callers poll getVideoStatus() until terminal.
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from '@/lib/logger';
import { getCircuitBreaker } from '@/lib/circuit-breaker';
import { hotapiVideoProvider } from './providers/hotapi';
import { atlasVideoProvider } from './providers/atlas';
import type { VideoGenerationInput, VideoSubmitResult, VideoTaskStatus, VideoProvider } from './providers/types';

const VIDEO_BREAKER_CONFIG = { failureThreshold: 3, timeout: 30_000 } as const;

type VideoProviderName = 'hotapi' | 'atlas';

const PROVIDERS: Record<VideoProviderName, VideoProvider> = {
  hotapi: hotapiVideoProvider,
  atlas:  atlasVideoProvider,
};

function isOutage(result: VideoSubmitResult): boolean {
  return !result.statusCode || result.statusCode >= 500;
}

export interface RoutedVideoSubmitResult extends VideoSubmitResult {
  provider?: VideoProviderName;
}

async function submitWithBreaker(provider: VideoProvider, input: VideoGenerationInput): Promise<VideoSubmitResult> {
  const breaker = getCircuitBreaker(`video:${provider.name}`, VIDEO_BREAKER_CONFIG);
  return breaker.execute(() => provider.submit(input));
}

/**
 * Submit an image-to-video generation task via HotAPI, falling back to
 * Atlas on an outage-shaped failure. The returned taskId is composite
 * ("hotapi:abc123" / "atlas:abc123") — pass it straight to getVideoStatus(),
 * never parse it or store the pieces separately.
 */
export async function submitVideo(input: VideoGenerationInput): Promise<RoutedVideoSubmitResult> {
  let hotapiResult: VideoSubmitResult;
  try {
    hotapiResult = await submitWithBreaker(hotapiVideoProvider, input);
  } catch (err) {
    hotapiResult = { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (hotapiResult.success && hotapiResult.taskId) {
    return { ...hotapiResult, taskId: `hotapi:${hotapiResult.taskId}`, provider: 'hotapi' };
  }

  if (!isOutage(hotapiResult)) {
    logger.warn('[video-router] HotAPI rejected prompt on content policy; not failing over to Atlas', {
      statusCode: hotapiResult.statusCode,
    });
    return { ...hotapiResult, provider: 'hotapi' };
  }

  logger.warn('[video-router] HotAPI unavailable, falling back to Atlas', { error: hotapiResult.error });

  let atlasResult: VideoSubmitResult;
  try {
    atlasResult = await submitWithBreaker(atlasVideoProvider, input);
  } catch (err) {
    atlasResult = { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (atlasResult.success && atlasResult.taskId) {
    return { ...atlasResult, taskId: `atlas:${atlasResult.taskId}`, provider: 'atlas' };
  }

  return { ...atlasResult, provider: 'atlas', error: atlasResult.error ?? hotapiResult.error };
}

function splitRoutedTaskId(routedTaskId: string): { provider: VideoProviderName; taskId: string } | null {
  const idx = routedTaskId.indexOf(':');
  if (idx <= 0) return null;
  const providerName = routedTaskId.slice(0, idx);
  const taskId = routedTaskId.slice(idx + 1);
  if (providerName !== 'hotapi' && providerName !== 'atlas') return null;
  if (!taskId) return null;
  return { provider: providerName, taskId };
}

/** Poll a previously-submitted video task. routedTaskId must be the composite
 *  id returned by submitVideo() — this is how the router knows which
 *  provider (HotAPI vs Atlas) originally accepted the job. */
export async function getVideoStatus(routedTaskId: string): Promise<VideoTaskStatus> {
  const split = splitRoutedTaskId(routedTaskId);
  if (!split) {
    return { status: 'failed', error: 'video-router: malformed task id' };
  }
  return PROVIDERS[split.provider].getStatus(split.taskId);
}

/**
 * Poll until the task completes or maxWaitMs elapses. Used by the
 * content-engine (synchronous queue processing) — chat's route polls
 * client-side instead, since chat requests can't hold an HTTP connection
 * open for minutes. See src/app/api/chat/video/route.ts.
 *
 * 'check_error' is treated like 'processing' — a transient blip checking
 * status doesn't mean the underlying task failed, so this keeps polling
 * through it rather than aborting on the first hiccup. Only a genuine
 * 'failed' (or exhausting maxWaitMs) ends the loop early.
 */
export async function pollVideoUntilDone(
  routedTaskId: string,
  maxWaitMs = 5 * 60 * 1000,
  pollIntervalMs = 5000,
): Promise<VideoTaskStatus> {
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const status = await getVideoStatus(routedTaskId);
    if (status.status === 'succeed' || status.status === 'failed') {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return { status: 'failed', error: 'timed_out_waiting_for_video_provider' };
}
