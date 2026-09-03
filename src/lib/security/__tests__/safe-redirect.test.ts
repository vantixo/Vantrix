// src/lib/security/__tests__/safe-redirect.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Phase B gap-fix regression: billing/portal/route.ts previously passed a
// raw client-supplied returnUrl straight to Stripe's Billing Portal
// return_url — an open redirect via a trusted third-party domain.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from 'vitest';
import { sanitizeRedirectPath, sanitizeReturnUrl } from '../safe-redirect';

const APP = 'https://app.vantrix.example';

describe('sanitizeRedirectPath', () => {
  it('allows same-origin paths', () => {
    expect(sanitizeRedirectPath('/profile')).toBe('/profile');
    expect(sanitizeRedirectPath('/chat/abc?x=1#y')).toBe('/chat/abc?x=1#y');
  });

  it('rejects absolute URLs and protocol-relative paths', () => {
    expect(sanitizeRedirectPath('https://evil.com')).toBe('/');
    expect(sanitizeRedirectPath('//evil.com')).toBe('/');
  });

  it('defaults to "/" for null/undefined', () => {
    expect(sanitizeRedirectPath(null)).toBe('/');
    expect(sanitizeRedirectPath(undefined)).toBe('/');
  });
});

describe('sanitizeReturnUrl (billing/portal open-redirect fix)', () => {
  it('resolves a bare same-origin path against the app base URL', () => {
    expect(sanitizeReturnUrl('/profile', APP)).toBe(`${APP}/profile`);
  });

  it('allows a full URL on the same origin', () => {
    expect(sanitizeReturnUrl(`${APP}/profile#billing`, APP)).toBe(`${APP}/profile#billing`);
  });

  it('rejects a different origin and falls back to default', () => {
    expect(sanitizeReturnUrl('https://evil.com/steal', APP, '/profile')).toBe(`${APP}/profile`);
  });

  it('rejects protocol-relative values (treated as absolute, different origin)', () => {
    expect(sanitizeReturnUrl('//evil.com', APP)).toBe(`${APP}/`);
  });

  it('treats a non-URL string as a relative same-origin path (safe, allowed)', () => {
    expect(sanitizeReturnUrl('not a url', APP)).toBe(`${APP}/not%20a%20url`);
  });

  it('falls back to default path when nothing is supplied', () => {
    expect(sanitizeReturnUrl(undefined, APP, '/profile')).toBe(`${APP}/profile`);
  });

  it('rejects a same-domain-looking but different-origin attacker string', () => {
    // subdomain/suffix tricks must not be treated as same-origin
    expect(sanitizeReturnUrl('https://app.vantrix.example.evil.com', APP)).toBe(`${APP}/`);
    expect(sanitizeReturnUrl('https://evil-app.vantrix.example', APP)).toBe(`${APP}/`);
  });
});
