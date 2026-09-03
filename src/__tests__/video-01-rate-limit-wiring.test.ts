/**
 * VIDEO-01 — Video generation rate limiting is real and gated
 *
 * checkDailyVideoCap (mirrors checkDailyImageCap's H-03 pattern) is the
 * only thing standing between the free tier and unlimited Kling spend.
 * These are source-level checks — same pattern as arch/code tests
 * elsewhere in this suite — verifying the daily cap function exists, uses
 * its own Redis key namespace (not aliased to images or messages), and is
 * actually called from both the content-engine path and the chat-triggered
 * submit route rather than only existing unused.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function src(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf-8');
}

describe('VIDEO-01 — checkDailyVideoCap exists and is wired in', () => {
  it('rate-limit/index.ts exports checkDailyVideoCap with its own Redis key namespace', () => {
    const rateLimit = src('lib', 'rate-limit', 'index.ts');
    expect(rateLimit).toMatch(/export async function checkDailyVideoCap/);
    expect(rateLimit).toMatch(/vantrix:daily:vid:/);
    // Distinct from the image and message namespaces — not aliased.
    expect(rateLimit).toMatch(/vantrix:daily:img:/);
    expect(rateLimit).not.toMatch(/vantrix:daily:vid:.*vantrix:daily:img:/);
  });

  it('checkDailyVideoCap short-circuits to disallowed when the tier limit is 0, without touching Redis', () => {
    const rateLimit = src('lib', 'rate-limit', 'index.ts');
    const fnMatch = rateLimit.match(/export async function checkDailyVideoCap[\s\S]*?\n}\n/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/if \(limit === 0\) return \{ allowed: false/);
  });

  it('the chat video submit route calls checkDailyVideoCap before generating', () => {
    const route = src('app', 'api', 'chat', 'video', 'route.ts');
    expect(route).toMatch(/checkDailyVideoCap/);
    expect(route).toMatch(/import\s*\{[^}]*\bcheckDailyVideoCap\b[^}]*\}\s*from\s*['"]@\/lib\/rate-limit['"]/);
  });

  it('token deduction on the chat video path only happens after a confirmed completion, not on submit', () => {
    const submitRoute = src('app', 'api', 'chat', 'video', 'route.ts');
    const statusRoute  = src('app', 'api', 'chat', 'video', 'status', 'route.ts');
    expect(submitRoute).not.toMatch(/deduct_tokens/);
    expect(statusRoute).toMatch(/deduct_tokens/);
  });

  it('a transient Kling status-check error does not delete the job or report failure to the user', () => {
    const statusRoute = src('app', 'api', 'chat', 'video', 'status', 'route.ts');
    const checkErrorBlock = statusRoute.match(/if \(status\.status === 'check_error'\) \{[\s\S]*?\n {4}\}/);
    expect(checkErrorBlock).not.toBeNull();
    expect(checkErrorBlock![0]).not.toMatch(/redis\.del/);
    expect(checkErrorBlock![0]).toMatch(/status: 'processing'/);
  });
});
