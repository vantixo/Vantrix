// src/lib/image/providers/atlas.ts
// ─────────────────────────────────────────────────────────────────────────────
// Atlas image-generation adapter — BACKUP image provider for Vantrix. Only
// invoked by image-router.ts when HotAPI is unconfigured, times out, or
// fails with an outage-shaped (5xx/network) error — never on a 4xx
// content-policy rejection from HotAPI. Same moderation note as hotapi.ts:
// moderateCharacter() already ran upstream before this is ever called.
// ─────────────────────────────────────────────────────────────────────────────

import { env } from '@/env';
import { logger } from '@/lib/logger';
import { sanitizeProviderError } from '@/lib/security';
import type { ImageProvider, ImageGenerationInput, ImageGenerationResult } from './types';

const TIMEOUT_MS = 25_000;
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

export const atlasProvider: ImageProvider = {
  name: 'atlas',

  async generate(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    if (!isConfigured()) {
      return { success: false, error: 'atlas: ATLAS_API_KEY not configured', statusCode: undefined };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${env.ATLAS_API_URL.replace(/\/$/, '')}/v1/images/generations`, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${env.ATLAS_API_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          prompt:          input.prompt,
          negative_prompt: input.negativePrompt,
          size:            input.imageSize ?? 'portrait_4_3',
          seed:            input.seed,
          mature:          input.allowMature ?? false,
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
      const data = JSON.parse(raw) as { data?: { url?: string }[]; url?: string; error?: string };
      const imageUrl = data.data?.[0]?.url ?? data.url;

      if (!imageUrl) {
        return { success: false, error: data.error ?? 'atlas: no image url in response', statusCode: res.status };
      }

      return { success: true, imageUrl, statusCode: res.status };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('[atlas] image generation failed', { error: sanitizeProviderError(message) });
      return { success: false, error: `atlas: ${sanitizeProviderError(message)}` };
    } finally {
      clearTimeout(timer);
    }
  },
};
