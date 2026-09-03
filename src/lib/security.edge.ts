/**
 * Edge-safe security primitives — Web Crypto API only.
 *
 * This module contains the subset of security.ts that is safe to import in
 * Edge Runtime contexts (Next.js middleware). It deliberately avoids all
 * Node.js built-ins (Buffer, crypto module, randomBytes) so it runs cleanly
 * in Vercel Edge, Cloudflare Workers, and any WinterCG-compatible runtime.
 *
 * Node-only helpers (createHash, randomBytes, Buffer-based timingSafeEqual,
 * Redis dedup, stream slots) remain in security.ts for use in Node API routes.
 *
 * Exports:
 *   generateNonce()         — cryptographically random 16-byte base64 nonce for CSP
 *   timingSafeCompare(a, b) — constant-time string comparison via XOR accumulator
 */

// ── Nonce generation ──────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random 16-byte base64 nonce for CSP headers.
 *
 * Uses globalThis.crypto.getRandomValues (Web Crypto API):
 *   - Available in Edge Runtime (Vercel, Cloudflare)
 *   - Available in Node.js ≥ 19 natively; polyfilled in Next.js for Node 18
 *   - Available in all modern browsers
 *
 * Does NOT use Buffer or Node's randomBytes — those are not in Edge Runtime.
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  // btoa + fromCharCode converts raw bytes to base64 without Buffer
  return btoa(String.fromCharCode(...Array.from(bytes)));
}

// ── Timing-safe comparison ────────────────────────────────────────────────────

/**
 * Constant-time string comparison — safe in Edge Runtime.
 *
 * Encodes both strings as UTF-8, then XOR-compares every byte position up
 * to the longer input's length, accumulating differences without
 * short-circuiting. Length mismatch is folded into the same accumulator
 * (rather than handled via an early-return branch or zero-padding) — see
 * inline comment for why both alternatives are unsafe. The function always
 * takes the same amount of time regardless of where (or whether) the
 * strings differ.
 *
 * Use for: cron secrets, worker secrets, admin tokens, webhook signatures.
 *
 * NOTE: For Node.js API routes, prefer the digest-based timingSafeEqual in
 * security.ts which delegates to Node's native crypto.timingSafeEqual.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const bA  = enc.encode(a);
  const bB  = enc.encode(b);
  const len = Math.max(bA.length, bB.length, 1);

  // SECURITY FIX: Zero-padding bA/bB to a common length before XOR-ing
  // created a false-positive collision — e.g. 'abc' and 'abc\0\0\0' both
  // pad to the identical byte sequence and compare as equal, letting an
  // attacker authenticate with a correct-prefix guess plus trailing NUL
  // bytes. We still must not branch on `bA.length !== bB.length` with an
  // early return (that reintroduces a timing leak), so instead we fold
  // the length mismatch into the same constant-time accumulator: seed
  // `diff` with the XOR of the two lengths before the byte loop. Any
  // length mismatch guarantees diff !== 0 at the end, with no branching
  // and no padding-induced collisions, while the loop below still always
  // runs the same number of iterations regardless of input.
  let diff = bA.length ^ bB.length;
  for (let i = 0; i < len; i++) {
    diff |= (bA[i] ?? 0) ^ (bB[i] ?? 0);
  }
  return diff === 0;
}

// ── Safe external URL check ─────────────────────────────────────────────────
//
// BUILD FIX: this lived in security.ts, which does `import { createHash,
// timingSafeEqual, randomBytes } from 'crypto'` at module scope — a Node
// built-in with no Edge Runtime equivalent. /api/go/route.ts declares
// `export const runtime = 'edge'` and only needs this one pure, dependency-
// free function, but importing it from security.ts pulled in that Node
// import transitively and broke edge bundling: "Module not found: Can't
// resolve 'crypto'", failing `next build` outright. The function itself has
// zero Node dependencies (just the standard URL class), so it belongs in
// this Edge-safe module. security.ts re-exports it so existing `from
// '@/lib/security'` imports (src/app/api/ads/route.ts) keep working
// unchanged.
//
// Ad links (and potentially creator/social links later) rendered as
// `<a href={value}>` are a stored-XSS vector unless the scheme is
// allowlisted separately from "is this a well-formed URL". Rejects
// javascript:, data:, vbscript:, file:, and anything unparseable. Does not
// attempt SSRF protection (no outbound fetch is made to these URLs
// server-side — they're only ever used as browser redirect targets), only
// script-execution and local-file-access schemes.
const SAFE_URL_SCHEMES = new Set(['http:', 'https:']);

export function isSafeExternalUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return SAFE_URL_SCHEMES.has(url.protocol);
  } catch {
    return false;
  }
}

// Site-relative asset path, e.g. "/images/characters/rumi.jpg" — used to
// let admin-managed ads reference images already shipped under /public
// instead of requiring an absolute external URL. Deliberately narrow:
// must start with a single "/" (not "//", which is protocol-relative and
// can point off-site), must not contain ".." (no path traversal out of
// /public), and must not contain a scheme or backslash.
export function isSafeLocalImagePath(raw: string): boolean {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 500) return false;
  if (!raw.startsWith('/') || raw.startsWith('//')) return false;
  if (raw.includes('..') || raw.includes('\\') || raw.includes(':')) return false;
  return /^\/[a-zA-Z0-9/_.\-]+\.(jpg|jpeg|png|webp|gif|svg)$/i.test(raw);
}

// Site-relative app route, e.g. "/pricing" or "/create-character" — lets
// an admin-managed ad link to an in-app feature/page instead of being
// forced through an external URL and treated as an outside sponsored ad.
// Same traversal/scheme guards as isSafeLocalImagePath, but no file
// extension requirement since this points at a route, not an asset.
export function isSafeInternalLinkPath(raw: string): boolean {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 500) return false;
  if (!raw.startsWith('/') || raw.startsWith('//')) return false;
  if (raw.includes('..') || raw.includes('\\') || raw.includes(':')) return false;
  return /^\/[a-zA-Z0-9/_.\-?=&%]*$/.test(raw);
}
