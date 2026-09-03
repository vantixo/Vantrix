/**
 * Whether a cookie should be marked `Secure` for the current request.
 *
 * SECURE-COOKIE-FIX (2026-08-16): every call site in this codebase used to
 * decide this with `process.env.NODE_ENV === 'production'` (or, in one
 * place, a hardcoded `true`). That's the same category of bug as the HSTS
 * issue fixed earlier: a `Secure` cookie is silently dropped by the browser
 * when the response arrives over plain HTTP — no error, no warning, the
 * Set-Cookie header is just ignored. `NODE_ENV === 'production'` does NOT
 * mean "this connection is actually HTTPS" — `next build && next start`
 * run locally, a Docker container port-forwarded to localhost, or any
 * plain-HTTP self-host all set NODE_ENV to "production" with no TLS
 * anywhere in the chain. Every guest-chat session, referral cookie, or
 * signup-attribution cookie set that way was silently failing to persist
 * in exactly those setups, with nothing in any log to point at why.
 *
 * Fix: key off the Host header instead, the same signal already used for
 * the HSTS/redirect localhost exemptions in middleware.ts. A real
 * production deploy is never reached at these hostnames, so this changes
 * nothing for actual users — it only stops local/self-hosted plain-HTTP
 * testing from silently losing cookies.
 */
const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/i;

export function shouldUseSecureCookies(headers: { get(name: string): string | null }): boolean {
  const host = headers.get('host') ?? '';
  if (LOCAL_HOST_RE.test(host)) return false;
  return process.env.NODE_ENV === 'production';
}
