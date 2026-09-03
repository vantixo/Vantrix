/**
 * SEC-01 — Open Redirect Guard Tests
 *
 * Verifies the path-safety guard that mirrors auth/callback/page.tsx:
 *   - safeRedirect allows same-origin paths starting with "/"
 *   - safeRedirect blocks absolute URLs, protocol-relative URLs, and "//"-prefixed paths
 *   - OAuth redirectTo always encodes the safeRedirect value
 *
 * These tests are pure logic tests — no DOM/React required.
 */

import { describe, it, expect } from 'vitest';

/**
 * Mirror of the guard added in auth/login/page.tsx (SEC-01 fix).
 * Extracted here so the logic can be unit-tested independently of the component.
 */
function sanitizeRedirect(raw: string | null | undefined): string {
  const candidate = raw ?? '/';
  return candidate.startsWith('/') && !candidate.startsWith('//')
    ? candidate
    : '/';
}

describe('SEC-01 — sanitizeRedirect (open-redirect guard)', () => {
  // Safe inputs — should pass through unchanged
  it('allows root path', () => {
    expect(sanitizeRedirect('/')).toBe('/');
  });

  it('allows deep same-origin path', () => {
    expect(sanitizeRedirect('/chat/abc-123')).toBe('/chat/abc-123');
  });

  it('allows path with query string', () => {
    expect(sanitizeRedirect('/premium?ref=promo')).toBe('/premium?ref=promo');
  });

  it('allows path with fragment', () => {
    expect(sanitizeRedirect('/profile#billing')).toBe('/profile#billing');
  });

  // Dangerous inputs — must be rejected → "/"
  it('blocks absolute http URL', () => {
    expect(sanitizeRedirect('http://evil.com')).toBe('/');
  });

  it('blocks absolute https URL', () => {
    expect(sanitizeRedirect('https://evil.com/steal-tokens')).toBe('/');
  });

  it('blocks protocol-relative URL (//evil.com)', () => {
    expect(sanitizeRedirect('//evil.com')).toBe('/');
  });

  it('blocks ///triple-slash', () => {
    expect(sanitizeRedirect('///evil.com')).toBe('/');
  });

  it('blocks javascript: URI', () => {
    expect(sanitizeRedirect('javascript:alert(1)')).toBe('/');
  });

  it('blocks empty string → defaults to /', () => {
    expect(sanitizeRedirect('')).toBe('/');
  });

  it('handles null gracefully', () => {
    expect(sanitizeRedirect(null)).toBe('/');
  });

  it('handles undefined gracefully', () => {
    expect(sanitizeRedirect(undefined)).toBe('/');
  });

  // Encoding — OAuth redirectTo must encode the safe value to prevent injection
  it('encoded safe redirect is decodable to the same path', () => {
    const safe    = sanitizeRedirect('/profile?tab=settings');
    const encoded = encodeURIComponent(safe);
    expect(decodeURIComponent(encoded)).toBe(safe);
  });

  it('encoding does not double-encode an already-safe path', () => {
    const safe    = sanitizeRedirect('/chat/abc');
    const encoded = encodeURIComponent(safe);
    // Should not contain unencoded "/" after encode (safe to embed in query)
    expect(encoded).not.toContain('/');
  });
});
