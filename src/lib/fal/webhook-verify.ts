// src/lib/fal/webhook-verify.ts
// ─────────────────────────────────────────────────────────────────────────────
// Shared fal.ai webhook signature verification (ED25519 / JWKS).
//
// Fal.ai signs every webhook with Ed25519, verified against their public
// JWKS — https://docs.fal.ai/model-apis/model-endpoints/webhooks. There is
// no shared secret; fal.ai does not issue one. Do not reintroduce an
// HMAC-with-env-secret scheme here — it verifies nothing real in either
// direction (rejects every genuine fal.ai webhook, accepts anything crafted
// to match an arbitrary local secret).
//
// JWKS_URL: confirmed against fal.ai's own docs — the host is
// "rest.alpha.fal.ai", NOT "rest.fal.ai" (no "alpha"). The latter is a real,
// previously-shipped bug in this codebase that silently rejects every
// legitimate webhook (JWKS fetch 404s against the wrong host, so
// verification always fails closed). Confirm against fal's docs again if
// you ever touch this constant.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash, createPublicKey, verify as cryptoVerify } from 'crypto';
import { logger } from '@/lib/logger';

const JWKS_URL             = 'https://rest.alpha.fal.ai/.well-known/jwks.json';
const JWKS_CACHE_TTL_MS    = 12 * 60 * 60 * 1000; // fal allows up to 24h; using half that
const MAX_TIMESTAMP_SKEW_S = 300;                 // ±5 minutes, per fal's own spec

let jwksCache: { x: string }[] | null = null;
let jwksCachedAt = 0;

async function fetchJwksKeys(): Promise<{ x: string }[]> {
  const now = Date.now();
  if (jwksCache && now - jwksCachedAt < JWKS_CACHE_TTL_MS) return jwksCache;

  const res = await fetch(JWKS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const body = await res.json() as { keys?: { x: string }[] };
  if (!body.keys?.length) throw new Error('JWKS response had no keys');

  jwksCache    = body.keys;
  jwksCachedAt = now;
  return jwksCache;
}

/**
 * Verify a fal.ai webhook request. Pass the raw (unparsed) request body and
 * the four `x-fal-webhook-*` headers exactly as received.
 */
export async function verifyFalWebhookSignature(
  rawBody:      string,
  requestId:    string | null,
  userId:       string | null,
  timestamp:    string | null,
  signatureHex: string | null,
): Promise<boolean> {
  if (!requestId || !userId || !timestamp || !signatureHex) return false;

  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > MAX_TIMESTAMP_SKEW_S) return false; // replay protection

  let signatureBytes: Buffer;
  try {
    signatureBytes = Buffer.from(signatureHex, 'hex');
    if (signatureBytes.length === 0) return false;
  } catch {
    return false;
  }

  const bodyHash = createHash('sha256').update(rawBody).digest('hex');
  const message  = [requestId, userId, timestamp, bodyHash].join('\n');
  const messageBytes = Buffer.from(message, 'utf-8');

  let keys: { x: string }[];
  try {
    keys = await fetchJwksKeys();
  } catch (err) {
    logger.error('fal-webhook-verify: JWKS fetch failed', { error: err instanceof Error ? err.message : String(err) });
    return false; // fail closed — no keys means no verification is possible
  }

  for (const key of keys) {
    try {
      const publicKey = createPublicKey({
        key:    { kty: 'OKP', crv: 'Ed25519', x: key.x },
        format: 'jwk',
      });
      if (cryptoVerify(null, messageBytes, publicKey, signatureBytes)) return true;
    } catch {
      continue; // malformed key entry — try the next one, don't abort the whole check
    }
  }
  return false;
}

/** Convenience: pull the four fal webhook headers off a NextRequest at once. */
export function getFalWebhookHeaders(headers: Headers) {
  return {
    requestId: headers.get('x-fal-webhook-request-id'),
    userId:    headers.get('x-fal-webhook-user-id'),
    timestamp: headers.get('x-fal-webhook-timestamp'),
    signature: headers.get('x-fal-webhook-signature'),
  };
}
