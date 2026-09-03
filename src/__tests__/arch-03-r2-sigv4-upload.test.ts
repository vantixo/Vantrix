/**
 * ARCH-03 — R2 Upload Uses SigV4, Not a Bearer Token
 *
 * Regression test for a non-functional upload path: uploadToR2() sent
 * `Authorization: Bearer ${R2_API_TOKEN}` against R2's S3-COMPATIBLE
 * endpoint (https://{account}.r2.cloudflarestorage.com/...). That endpoint
 * requires AWS SigV4-signed requests like any other S3-compatible API — a
 * bearer token there is rejected with 401/403 regardless of how valid the
 * token is. (A bearer token IS correct for Cloudflare's separate *native*
 * R2 management API, a different endpoint/auth scheme entirely — the bug
 * was combining the S3-compatible URL with the native-API auth header.)
 *
 * This never surfaced in `next build`/typecheck because it's a runtime-only
 * HTTP auth failure, not a type error. Statically inspecting the source is
 * cheap and catches a regression before it ships, same approach as ARCH-02.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// The SigV4 R2 client was extracted out of lora-pipeline.ts into a shared
// module (lib/storage/r2.ts) so every R2 write site — Fal images, scene
// renders, and admin media uploads — shares one client. lora-pipeline.ts
// now just re-exports it, so we check both sources for the invariants.
const SOURCE =
  readFileSync(join(__dirname, '..', 'lib', 'fal', 'lora-pipeline.ts'), 'utf-8') +
  '\n' +
  readFileSync(join(__dirname, '..', 'lib', 'storage', 'r2.ts'), 'utf-8');

describe('ARCH-03 — R2 upload uses SigV4 (S3 SDK), never a bearer token', () => {
  it('does not send an Authorization: Bearer header to the R2 S3-compatible endpoint', () => {
    expect(SOURCE).not.toMatch(/Authorization[\s\S]{0,40}Bearer[\s\S]{0,40}R2_/);
    expect(SOURCE).not.toMatch(/['"]Bearer \$\{env\.R2/);
  });

  it('signs requests via the S3 SDK using the Access Key ID / Secret Access Key pair', () => {
    expect(SOURCE).toMatch(/PutObjectCommand/);
    expect(SOURCE).toMatch(/accessKeyId:\s*env\.R2_ACCESS_KEY_ID/);
    expect(SOURCE).toMatch(/secretAccessKey:\s*env\.R2_SECRET_ACCESS_KEY/);
  });

  it('targets the R2 S3-compatible endpoint with region "auto"', () => {
    expect(SOURCE).toMatch(/r2\.cloudflarestorage\.com/);
    expect(SOURCE).toMatch(/region:\s*['"]auto['"]/);
  });
});
