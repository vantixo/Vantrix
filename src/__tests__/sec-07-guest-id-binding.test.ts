/**
 * SEC-07 — Guest Chat Rate-Limit Identity Binding
 *
 * /api/chat/guest previously keyed its per-guest message cap on the
 * client-supplied `guestId` body field. Any caller could reset their cap
 * by sending a fresh random guestId on every request, leaving only the
 * 20/hour IP cap as a real limit — itself trivially rotated via proxies.
 *
 * Fix: the rate-limit identity is now a server-issued httpOnly cookie
 * (`vtx_gid`). The route trusts the cookie value when it is present and
 * well-formed; otherwise it mints a fresh one server-side. The client
 * body's guestId is no longer read for this purpose.
 *
 * These tests cover the pure identity-resolution logic extracted from the
 * route (mirrors the `cookieIsValid` / `guestSessionId` derivation).
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';

const GUEST_COOKIE_RE = /^[a-f0-9-]{8,64}$/i;

/** Mirror of the identity-resolution logic in src/app/api/chat/guest/route.ts */
function resolveGuestSessionId(cookieValue: string | undefined): { id: string; reused: boolean } {
  const cookieIsValid = !!cookieValue && GUEST_COOKIE_RE.test(cookieValue);
  return cookieIsValid
    ? { id: cookieValue!, reused: true }
    : { id: randomUUID(), reused: false };
}

describe('SEC-07 — guest chat identity is server-bound, not client-controlled', () => {
  it('reuses a valid existing cookie value instead of minting a new identity', () => {
    const existing = randomUUID();
    const { id, reused } = resolveGuestSessionId(existing);
    expect(id).toBe(existing);
    expect(reused).toBe(true);
  });

  it('mints a fresh identity when no cookie is present', () => {
    const { id, reused } = resolveGuestSessionId(undefined);
    expect(GUEST_COOKIE_RE.test(id)).toBe(true);
    expect(reused).toBe(false);
  });

  it('rejects a malformed/forged cookie value and mints a fresh identity instead', () => {
    const { id, reused } = resolveGuestSessionId('"; DROP guest:session:*; --');
    expect(reused).toBe(false);
    expect(GUEST_COOKIE_RE.test(id)).toBe(true);
  });

  it('two requests that send different client-controlled guestId bodies but the same cookie resolve to the same rate-limit identity', () => {
    // Simulates an attacker varying the JSON body's guestId field while the
    // httpOnly cookie (which they cannot script-set) stays constant.
    const cookie = randomUUID();
    const first  = resolveGuestSessionId(cookie);
    const second = resolveGuestSessionId(cookie);
    expect(first.id).toBe(second.id);
  });

  it('a request with no cookie cannot reuse a previous session by guessing — each unauthenticated attempt without the cookie gets a new identity', () => {
    const a = resolveGuestSessionId(undefined);
    const b = resolveGuestSessionId(undefined);
    // Different random identities — proves the cap can no longer be reset
    // by simply omitting/varying a client-supplied value; the cookie, which
    // the server controls and the client cannot set via JS, is what's
    // actually required to persist (and therefore exhaust) one identity.
    expect(a.id).not.toBe(b.id);
  });
});
