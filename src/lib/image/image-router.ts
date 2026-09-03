// src/lib/image/image-router.ts
// ─────────────────────────────────────────────────────────────────────────────
// ImageRouter — HotAPI primary, Atlas backup. Single entry point every route
// should call instead of touching hotapi.ts/atlas.ts directly, so the
// fallback policy lives in exactly one place.
//
// Failover rule (same discipline as lib/media/primary-image.ts's old
// Grok→fal logic, and lib/grok/image-pipeline.ts's shouldFailoverToGrok()):
// only fail over to Atlas on an OUTAGE-shaped failure from HotAPI — missing
// config, timeout/network error, or 5xx. A 4xx from HotAPI means it rejected
// the prompt on its own content policy, and that must NOT be retried on a
// different, possibly-more-permissive provider with the same prompt.
//
// KAETAH NOTE: image generation is explicitly out of scope for Kaetah — it's
// a text/orchestration brain, not an image model. This router is stable
// infrastructure regardless of whether Kaetah is active for chat.
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from '@/lib/logger';
import { getCircuitBreaker } from '@/lib/circuit-breaker';
import { hotapiProvider } from './providers/hotapi';
import { atlasProvider } from './providers/atlas';
import type { ImageGenerationInput, ImageGenerationResult, ImageProvider } from './providers/types';

const IMAGE_BREAKER_CONFIG = { failureThreshold: 3, timeout: 30_000 } as const;

function isOutage(result: ImageGenerationResult): boolean {
  return !result.statusCode || result.statusCode >= 500;
}

export interface RoutedImageResult extends ImageGenerationResult {
  provider: 'hotapi' | 'atlas';
}

async function callWithBreaker(provider: ImageProvider, input: ImageGenerationInput): Promise<ImageGenerationResult> {
  const breaker = getCircuitBreaker(`image:${provider.name}`, IMAGE_BREAKER_CONFIG);
  return breaker.execute(() => provider.generate(input));
}

export async function generateImage(input: ImageGenerationInput): Promise<RoutedImageResult> {
  let hotapiResult: ImageGenerationResult;
  try {
    hotapiResult = await callWithBreaker(hotapiProvider, input);
  } catch (err) {
    // Circuit open, or breaker rethrew — treat identically to an outage.
    hotapiResult = { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (hotapiResult.success) {
    return { ...hotapiResult, provider: 'hotapi' };
  }

  if (!isOutage(hotapiResult)) {
    logger.warn('[image-router] HotAPI rejected prompt on content policy; not failing over to Atlas', {
      statusCode: hotapiResult.statusCode,
    });
    return { ...hotapiResult, provider: 'hotapi' };
  }

  logger.warn('[image-router] HotAPI unavailable, falling back to Atlas', { error: hotapiResult.error });

  let atlasResult: ImageGenerationResult;
  try {
    atlasResult = await callWithBreaker(atlasProvider, input);
  } catch (err) {
    atlasResult = { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  return { ...atlasResult, provider: 'atlas', error: atlasResult.error ?? hotapiResult.error };
}
