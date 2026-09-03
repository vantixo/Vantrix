// src/lib/image/providers/hotapi.ts
// ─────────────────────────────────────────────────────────────────────────────
// HotAPI image-generation adapter — PRIMARY image provider for Vantrix.
// Implements the shared ImageProvider interface (types.ts) so the router
// (image-router.ts) and every call site never touch HotAPI's own request/
// response shape directly.
//
// Moderation note (same rule as every other provider in this app — see
// lib/grok/image-pipeline.ts): moderateCharacter() runs upstream in the
// calling route BEFORE this module is ever invoked. This file has no
// moderation logic and no bypass path.
// ─────────────────────────────────────────────────────────────────────────────

import { env } from '@/env';
import { logger } from '@/lib/logger';
import { sanitizeProviderError } from '@/lib/security';
import type { ImageProvider, ImageGenerationInput, ImageGenerationResult } from './types';

const TIMEOUT_MS = 25_000;
const RESPONSE_SIZE_LIMIT = 8 * 1024 * 1024; // 8 MB — image responses are larger than text completions

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

export const hotapiProvider: ImageProvider = {
  name: 'hotapi',

  async generate(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    if (!isConfigured()) {
      return { success: false, error: 'hotapi: HOTAPI_API_KEY not configured', statusCode: undefined };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${env.HOTAPI_API_URL.replace(/\/$/, '')}/v1/images/generate`, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${env.HOTAPI_API_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          prompt:           input.prompt,
          negative_prompt:  input.negativePrompt,
          image_size:       input.imageSize ?? 'portrait_4_3',
          seed:             input.seed,
          allow_mature:     input.allowMature ?? false,
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
      const data = JSON.parse(raw) as { image_url?: string; url?: string; error?: string };
      const imageUrl = data.image_url ?? data.url;

      if (!imageUrl) {
        return { success: false, error: data.error ?? 'hotapi: no image_url in response', statusCode: res.status };
      }

      return { success: true, imageUrl, statusCode: res.status };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('[hotapi] image generation failed', { error: sanitizeProviderError(message) });
      // Aborted/network failures — outage-shaped, no statusCode means the
      // image-router treats this as failover-eligible (see isOutage() there).
      return { success: false, error: `hotapi: ${sanitizeProviderError(message)}` };
    } finally {
      clearTimeout(timer);
    }
  },
};
