/**
 * Shared Cloudflare R2 client + upload helpers.
 *
 * Extracted from lib/fal/lora-pipeline.ts (which had its own private
 * getR2Client()) so every R2 write in the codebase — Fal-generated images,
 * scene renders, and now direct admin uploads of seed-character media —
 * shares one lazily-instantiated S3Client instead of each call site
 * creating its own.
 *
 * R2's S3-compatible endpoint requires AWS SigV4-signed requests (handled
 * by the S3 SDK). A plain `Authorization: Bearer <token>` header is the
 * auth scheme for Cloudflare's separate *native* R2 management API, not
 * this S3-compatible data endpoint, and would be rejected with 401/403
 * here regardless of token validity.
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { env } from '@/env';

let _r2Client: S3Client | null = null;
export function getR2Client(): S3Client {
  if (_r2Client) return _r2Client;
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new Error(
      'R2 is not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and ' +
      'R2_SECRET_ACCESS_KEY to enable permanent image storage. See .env.example.'
    );
  }
  _r2Client = new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
  return _r2Client;
}

// Hard ceiling on any single source-URL download this helper will buffer
// into memory before giving up. Kling/fal video payloads are a few MB for
// a 5-10s clip; 100MB is generous headroom while still bounding worst-case
// memory use per request (no streaming path to R2 here — the whole body is
// buffered before the PUT). Without this, a misbehaving or slow upstream
// returning an enormous or never-ending body could OOM the process.
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
// A hung upstream connection would otherwise tie up the request
// indefinitely — chat-video's status route is on the user's polling
// critical path, so this needs to fail fast rather than hang.
const DOWNLOAD_TIMEOUT_MS = 60_000;

/**
 * Upload a remote URL's content to R2 for permanent storage — e.g. a
 * Fal.ai-generated image, whose hosted URLs expire, or any other
 * third-party URL that needs to become a permanent R2-hosted asset.
 */
export async function uploadUrlToR2(
  sourceUrl: string,
  key: string,
  contentType: string = 'image/jpeg',
): Promise<{ success: boolean; r2Url?: string; error?: string }> {
  try {
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`fetch_failed:${response.status}`);

    const declaredLength = Number(response.headers.get('content-length') ?? '0');
    if (declaredLength > MAX_DOWNLOAD_BYTES) {
      throw new Error(`source_too_large:${declaredLength}`);
    }

    if (!response.body) {
      // Some runtimes/mocks may not expose a streaming body — fall back to
      // buffering directly, still bounded by the timeout above.
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > MAX_DOWNLOAD_BYTES) throw new Error(`source_too_large:${buffer.byteLength}`);
      return await uploadBufferToR2(buffer, key, contentType);
    }

    // Enforce the cap on actual bytes read too, in case content-length was
    // absent, wrong, or the server misreported it.
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_DOWNLOAD_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error(`source_too_large:${total}`);
      }
      chunks.push(value);
    }

    const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    return await uploadBufferToR2(buffer, key, contentType);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}

/**
 * Upload a raw buffer directly to R2 — used for admin-uploaded seed
 * character media (images/videos coming straight from a multipart form),
 * where there's no intermediate URL to fetch from.
 */
// Upload timeout — bounds how long a single admin upload can hang on a
// stalled/unreachable R2 endpoint before failing. Paired with maxAttempts
// below so a bad credential or DNS failure surfaces in ~10s, not ~5s of
// silent SDK-level retries piled on top of the request's own stall.
const UPLOAD_TIMEOUT_MS = 15_000;

export async function uploadBufferToR2(
  buffer: Buffer,
  key: string,
  contentType: string,
): Promise<{ success: boolean; r2Url?: string; error?: string }> {
  if (!env.R2_BUCKET_NAME || !env.R2_PUBLIC_URL) {
    return { success: false, error: 'R2 is not configured — set R2_BUCKET_NAME and R2_PUBLIC_URL. See .env.example.' };
  }
  try {
    await getR2Client().send(new PutObjectCommand({
      Bucket:        env.R2_BUCKET_NAME,
      Key:           key,
      Body:          buffer,
      ContentType:   contentType,
      ContentLength: buffer.byteLength,
    }), {
      // Default SDK retry behavior (3 attempts w/ backoff) turns a single
      // bad credential or unreachable endpoint into several seconds of
      // silent retrying before the caller ever sees an error. One attempt
      // + an explicit abort keeps failures fast and diagnosable.
      requestTimeout: UPLOAD_TIMEOUT_MS,
      abortSignal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });

    const r2Url = `${env.R2_PUBLIC_URL}/${key}`;
    return { success: true, r2Url };
  } catch (err) {
    // Surface the AWS SDK's actual failure signal (HTTP status + error
    // name/code) instead of a bare message — "unknown" told us nothing
    // about auth vs. network vs. missing-bucket failures.
    const meta = (err as { $metadata?: { httpStatusCode?: number } } | undefined)?.$metadata;
    const name = err instanceof Error ? err.name : undefined;
    const message = err instanceof Error ? err.message : 'unknown';
    const detail = [name, meta?.httpStatusCode ? `http_${meta.httpStatusCode}` : null, message]
      .filter(Boolean)
      .join(':');
    return { success: false, error: detail || 'unknown' };
  }
}
