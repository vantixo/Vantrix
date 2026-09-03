// src/lib/security/safe-redirect.ts
// ─────────────────────────────────────────────────────────────────────────────
// SEC audit (Phase B, 2026-08-06): shared home for redirect/return-URL
// safety guards. The same-origin-path variant (`sanitizeRedirectPath`)
// already existed inline in auth/login/page.tsx (see
// src/__tests__/sec-01-open-redirect.test.ts) but wasn't reusable from
// route handlers, which need to validate a full return URL (not just a
// path) before handing it to a third party like Stripe's Billing Portal.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Allows only same-origin relative paths ("/foo", "/foo?x=1#y").
 * Rejects absolute URLs, protocol-relative ("//evil.com"), and anything
 * that doesn't start with a single "/". Mirrors the guard in
 * auth/login/page.tsx.
 */
export function sanitizeRedirectPath(raw: string | null | undefined): string {
  const candidate = raw ?? '/';
  return candidate.startsWith('/') && !candidate.startsWith('//') ? candidate : '/';
}

/**
 * Validates a client-supplied return URL against a trusted app origin.
 * Used anywhere we hand a URL to a third-party redirect flow (Stripe
 * Billing Portal, OAuth, etc.) where the third party will bounce the
 * user's browser back to whatever we give it — an unchecked client value
 * there is an open redirect via a trusted third-party domain, which is
 * worse than a same-site one (higher user trust, no browser warning).
 *
 * Accepts:
 *   - a bare path ("/profile") — resolved against appBaseUrl
 *   - a full URL that resolves to the exact same origin as appBaseUrl
 * Rejects everything else (different origin, protocol-relative, malformed)
 * and falls back to appBaseUrl + defaultPath.
 */
export function sanitizeReturnUrl(
  raw: string | null | undefined,
  appBaseUrl: string,
  defaultPath = '/'
): string {
  const fallback = new URL(defaultPath, appBaseUrl).toString();
  if (!raw) return fallback;

  try {
    const resolved = new URL(raw, appBaseUrl);
    const base = new URL(appBaseUrl);
    return resolved.origin === base.origin ? resolved.toString() : fallback;
  } catch {
    return fallback;
  }
}
