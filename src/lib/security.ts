/**
 * Security Utilities — Centralised Hardening Primitives
 *
 * This module collects security-critical helpers that were previously either
 * missing or scattered. All new route handlers and infrastructure code should
 * import from here rather than re-implementing.
 *
 * Exports:
 *
 *   timingSafeEqual(a, b)          — constant-time string comparison (prevents
 *                                    timing attacks on secret headers)
 *   requireSecret(req, secret)     — enforce Bearer/header secrets safely
 *   readBodyWithLimit(req, max)     — parse JSON with hard byte limit (prevent
 *                                    memory exhaustion from giant payloads)
 *   sanitizeProviderError(err)     — strip internal details from provider errors
 *                                    before surfacing to clients
 *   generateNonce()                — cryptographically random 16-byte base64
 *                                    nonce for CSP headers
 *   validateRedisKey(key)          — assert a string is safe for use as a Redis
 *                                    key (no path traversal, length bounded)
 *   requestDeduplicationKey(req)   — idempotency key from X-Idempotency-Key or
 *                                    derived from userId + message hash
 *   checkDeduplication(key)        — Redis-backed dedup guard (5s window)
 */

import { createHash, timingSafeEqual as nodeTSE, randomBytes } from 'crypto';
import { redis }       from '@/lib/redis';
import type { NextRequest } from 'next/server';

// ── Timing-safe string comparison ────────────────────────────────────────────

/**
 * Constant-time string comparison that does not branch on content.
 * Use for ALL secret header / token comparisons.
 *
 * A naive `a === b` leaks timing information: the comparison short-circuits
 * on the first differing character, letting attackers enumerate valid secrets
 * one character at a time via timing measurements.
 *
 * Implementation compares fixed-length SHA-256 digests of both inputs rather
 * than the raw (variable-length) inputs themselves — see inline comment.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  // SECURITY FIX: The previous implementation zero-padded both inputs to
  // the same length before calling Node's timingSafeEqual. That introduced
  // a false-positive auth bypass: padding makes 'abc' and 'abc\0\0\0'
  // (or any correct-prefix + trailing NUL bytes) compare as EQUAL, since
  // both pad to the identical byte sequence. An attacker could authenticate
  // with a correct-prefix guess plus null-byte padding.
  //
  // Fix: hash both inputs to a fixed-length (32-byte) digest first. This
  // guarantees the buffers passed to nodeTSE are always equal length (so
  // it never throws and never needs padding), while two different inputs
  // collide only with cryptographic-hash-collision probability — not via
  // padding. The comparison itself remains constant-time over a fixed
  // 32-byte buffer regardless of input length, so there's no timing leak
  // tied to input length either.
  const hA = createHash('sha256').update(Buffer.from(a, 'utf8')).digest();
  const hB = createHash('sha256').update(Buffer.from(b, 'utf8')).digest();
  return nodeTSE(hA, hB);
}

/**
 * Validate a Bearer token from the Authorization header.
 * Returns true if the token matches and the header is well-formed.
 * Always uses timing-safe comparison.
 */
export function validateBearer(req: NextRequest, expected: string): boolean {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return false;
  const token = auth.slice(7);
  return timingSafeEqual(token, expected);
}

/**
 * Check if a secret is required and validate it.
 *
 * @param req       Incoming request
 * @param secret    Expected secret value (from env). If empty/undefined, skip check.
 * @param headerName  Header name to check (default: 'authorization' for Bearer)
 */
export function requireSecret(
  req: NextRequest,
  secret: string | undefined,
  headerName = 'authorization',
): boolean {
  if (!secret) {
    // In production, absent secrets should fail closed — in dev, skip.
    if (process.env.NODE_ENV === 'production') return false;
    return true;
  }
  if (headerName === 'authorization') return validateBearer(req, secret);
  const val = req.headers.get(headerName) ?? '';
  return timingSafeEqual(val, secret);
}

// ── Body size guard ───────────────────────────────────────────────────────────

const DEFAULT_MAX_BODY = 64 * 1024;  // 64 KB

/**
 * Parse a JSON request body with a hard byte limit.
 *
 * Problem: `req.json()` reads the entire body into memory. A 10 MB payload
 * causes a 10 MB allocation on every request — trivially exploitable for OOM.
 *
 * This function reads the raw body as text, enforcing the byte limit before
 * any JSON parsing occurs.
 *
 * @param req     Incoming request
 * @param maxBytes  Hard limit in bytes (default 64 KB)
 * @returns Parsed JSON value, or null if limit exceeded or parse fails
 */
export async function readBodyWithLimit(
  req: NextRequest,
  maxBytes = DEFAULT_MAX_BODY,
): Promise<{ ok: true; body: unknown } | { ok: false; reason: 'too_large' | 'invalid_json' }> {
  try {
    const contentLength = parseInt(req.headers.get('content-length') ?? '0', 10);
    if (contentLength > maxBytes) {
      return { ok: false, reason: 'too_large' };
    }

    const reader  = req.body?.getReader();
    if (!reader)  return { ok: false, reason: 'invalid_json' };

    let totalBytes = 0;
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        reader.cancel().catch(() => {});
        return { ok: false, reason: 'too_large' };
      }
      chunks.push(value);
    }

    const text = new TextDecoder().decode(
      chunks.reduce((acc, c) => {
        const merged = new Uint8Array(acc.length + c.length);
        merged.set(acc); merged.set(c, acc.length);
        return merged;
      }, new Uint8Array(0))
    );

    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
}

// ── Provider error sanitization ───────────────────────────────────────────────

// Patterns that must never appear in client-facing error messages
const SENSITIVE_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9\-_]{20,}/g,        // API keys
  /Bearer\s+[a-zA-Z0-9\-_.]{20,}/g, // Bearer tokens
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,  // IP addresses
  /https?:\/\/[^\s"']+/g,            // Internal URLs
  /\b[a-f0-9]{32,}\b/g,              // Hash-like strings (may be internal IDs)
];

/**
 * Strip sensitive details from provider error messages before surfacing to clients.
 * Keeps the HTTP status code visible but removes URLs, tokens, and IPs.
 */
export function sanitizeProviderError(err: unknown): string {
  let msg = err instanceof Error ? err.message : String(err);

  for (const pat of SENSITIVE_PATTERNS) {
    msg = msg.replace(pat, '[redacted]');
  }

  // Keep only the first 200 chars — long error messages often contain stack traces
  return msg.slice(0, 200);
}

// ── CSP Nonce ─────────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random 16-byte base64 nonce for use in CSP headers.
 *
 * Usage in middleware:
 *   const nonce = generateNonce();
 *   response.headers.set('x-nonce', nonce);
 *   // Include in CSP: script-src 'nonce-${nonce}'
 *
 * Usage in layout.tsx:
 *   import { headers } from 'next/headers';
 *   const nonce = headers().get('x-nonce') ?? '';
 *   return <Script nonce={nonce} src="..." />;
 */
export function generateNonce(): string {
  return randomBytes(16).toString('base64');
}

// ── Redis key validation ──────────────────────────────────────────────────────

const REDIS_KEY_UNSAFE = /[\s\n\r\0]/;
const REDIS_KEY_MAX    = 512;  // Redis allows up to 512 MB keys, but we cap at 512 chars

/**
 * Assert a key is safe to use as a Redis key.
 * Throws on unsafe characters or excessive length.
 * Prevents:
 *   - Whitespace/newline injection in Redis protocol
 *   - Unbounded key growth from user-controlled input
 */
export function validateRedisKey(key: string, context = 'redis key'): void {
  if (!key || key.length > REDIS_KEY_MAX) {
    throw new Error(`Invalid ${context}: length must be 1–${REDIS_KEY_MAX} chars (got ${key.length})`);
  }
  if (REDIS_KEY_UNSAFE.test(key)) {
    throw new Error(`Invalid ${context}: contains whitespace or control characters`);
  }
}

/**
 * Sanitize an arbitrary string for use as a Redis key component.
 * Replaces unsafe characters with underscores and truncates to maxLen.
 */
export function safeRedisComponent(raw: string, maxLen = 64): string {
  return raw
    .replace(/[\s\n\r\0]/g, '_')
    .replace(/[^\x20-\x7E]/g, '_')  // non-printable ASCII
    .slice(0, maxLen);
}

// ── Request deduplication ─────────────────────────────────────────────────────

const DEDUP_TTL = 5;  // seconds — window to reject duplicate requests

/**
 * Check if an identical request was made within the dedup window.
 * Returns true if the request is a duplicate (should be rejected or return cached).
 *
 * Key derivation:
 *   - Uses X-Idempotency-Key header if present
 *   - Falls back to SHA-256(userId + ':' + bodyHash) truncated to 24 hex chars
 */
export async function checkDeduplication(key: string): Promise<boolean> {
  try {
    const result = await redis.set(
      `dedup:${key}`,
      '1',
      { nx: true, ex: DEDUP_TTL }
    );
    // nx: true means set only if not exists
    // result === 'OK' → key was NEW (not a duplicate)
    // result === null → key EXISTED (duplicate)
    return result === null;  // true = is a duplicate
  } catch {
    return false;  // fail open: if Redis is down, don't block requests
  }
}

export function dedupKey(userId: string, bodyHash: string): string {
  return createHash('sha256')
    .update(`${userId}:${bodyHash}`)
    .digest('hex')
    .slice(0, 24);
}

export function hashBody(body: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(body))
    .digest('hex')
    .slice(0, 24);
}

// ── Stream concurrency guard ──────────────────────────────────────────────────

const STREAM_SLOT_TTL = 120;  // 2 minutes max per stream

/**
 * CONCURRENCY-SCOPE FIX: this used to be keyed on userId alone, meaning the
 * limit was global across every character/conversation a user had. At
 * concurrentStreams: 1 (free/premium), simply having two tabs open on
 * two different characters and sending a message in each within a few
 * seconds of each other — completely normal usage — was hard-blocked with
 * "Too many concurrent streams." Scoping the key per-conversation (or
 * per-character for a brand-new conversation that doesn't have an id yet)
 * means the guard now only does what it was actually meant to do: stop the
 * SAME conversation from having two generations racing each other (e.g. a
 * rapid double-submit), while chatting with any number of different
 * characters at once works with no ceiling from this guard. Genuine
 * platform-wide abuse (a script firing dozens of simultaneous streams
 * across many characters) is still caught by checkChatLimit's per-minute
 * burst window and checkDailyMessageCap's daily cap — this guard no longer
 * needs to double as an abuse limiter.
 */
const streamSlotKey = (userId: string, scopeId: string) => `stream:slots:${userId}:${scopeId}`;

/** A single conversation should only ever have one generation in flight. */
const MAX_STREAMS_PER_CONVERSATION = 1;

/**
 * Lua script for atomic check-and-increment stream slot acquisition.
 *
 * WHY LUA: The previous pipeline (INCR then check) had a race condition —
 * two simultaneous requests both increment before either checks, allowing
 * one extra concurrent stream through. Lua executes atomically in Redis,
 * so the check and increment are a single indivisible operation.
 *
 * Returns 1 if slot acquired, 0 if at limit.
 */
const LUA_ACQUIRE_SLOT = `
  local key = KEYS[1]
  local max = tonumber(ARGV[1])
  local ttl = tonumber(ARGV[2])
  local cur = redis.call('INCR', key)
  if cur == 1 then redis.call('EXPIRE', key, ttl) end
  if cur > max then
    redis.call('DECR', key)
    return 0
  end
  return 1
`;

/**
 * Acquire a streaming slot, scoped to a single conversation (or character,
 * for a not-yet-created conversation) rather than the whole user. Prevents
 * two generations racing on the SAME conversation; does not limit how many
 * different characters a user can chat with concurrently.
 * Lua-atomic — no race condition between increment and check.
 */
export async function acquireStreamSlot(userId: string, scopeId: string): Promise<boolean> {
  try {
    const key    = streamSlotKey(userId, scopeId);
    const result = await redis.eval(LUA_ACQUIRE_SLOT, [key], [String(MAX_STREAMS_PER_CONVERSATION), String(STREAM_SLOT_TTL)]);
    return result === 1;
  } catch {
    return true;  // fail open — non-critical
  }
}

export async function releaseStreamSlot(userId: string, scopeId: string): Promise<void> {
  try {
    const key = streamSlotKey(userId, scopeId);
    const pipe = redis.pipeline();
    pipe.decr(key);
    // Guard against drift
    const results = await pipe.exec() as [number];
    if (results[0] < 0) await redis.set(key, 0);
  } catch { /* non-critical */ }
}

// ── Cron secret validation ────────────────────────────────────────────────────

/**
 * Validate the CRON_SECRET for all /api/cron/* endpoints.
 * Checks x-cron-secret header first (Vercel Cron pattern), then Authorization Bearer.
 * Uses timing-safe comparison to prevent secret enumeration.
 */
export function requireCronAuth(req: NextRequest, secret: string): boolean {
  const fromHeader = req.headers.get('x-cron-secret');
  if (fromHeader) return timingSafeEqual(fromHeader, secret);
  const fromBearer = req.headers.get('authorization')?.replace('Bearer ', '');
  if (fromBearer)  return timingSafeEqual(fromBearer, secret);
  return false;
}

// ── External link safety ────────────────────────────────────────────────────

// isSafeExternalUrl moved to security.edge.ts (Edge Runtime callers like
// /api/go/route.ts need it without pulling in this file's Node `crypto`
// import). Re-exported here so existing `from '@/lib/security'` imports
// keep working unchanged.
export { isSafeExternalUrl, isSafeLocalImagePath, isSafeInternalLinkPath } from '@/lib/security.edge';
