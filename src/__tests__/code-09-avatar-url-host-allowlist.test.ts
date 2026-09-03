/**
 * CODE-09 — Avatar URL Host Allowlist
 *
 * PATCH /api/profile/settings newly accepts `avatar_url` (previously
 * writable nowhere despite /api/upload existing and GET already reading
 * it back — see that route's own AVATAR-FIX comment). The one thing
 * that write path can't skip is host validation: without it, a user
 * could set their avatar to any arbitrary URL rather than something that
 * actually went through /api/upload's magic-byte/size/type checks.
 *
 * Mirrors the guard added in profile/settings/route.ts (same shape as
 * sec-01's sanitizeRedirect tests: pure logic, no Next.js request/route
 * plumbing needed) — reuses the real, already-exported isAllowedImageHost
 * from lib/utils.ts rather than re-implementing it, since that's the
 * actual function the route calls.
 */

import { describe, it, expect } from 'vitest';
import { isAllowedImageHost } from '@/lib/utils';

/** Exact validation shape used in profile/settings/route.ts's PATCH handler. */
function isValidAvatarUrl(candidate: string): boolean {
  try {
    const hostname = new URL(candidate).hostname;
    return isAllowedImageHost(hostname);
  } catch {
    return false;
  }
}

describe('CODE-09 — avatar_url host allowlist', () => {
  it('allows a Supabase storage URL (what /api/upload actually returns)', () => {
    expect(
      isValidAvatarUrl('https://abcxyz.supabase.co/storage/v1/object/public/uploads/user-1/avatar.png')
    ).toBe(true);
  });

  it('allows the .supabase.in variant', () => {
    expect(isValidAvatarUrl('https://abcxyz.supabase.in/storage/v1/object/public/uploads/x.png')).toBe(true);
  });

  it('allows the R2 CDN host', () => {
    expect(isValidAvatarUrl('https://cdn.vantrix.ink/avatars/x.png')).toBe(true);
  });

  it('rejects an arbitrary external host', () => {
    expect(isValidAvatarUrl('https://evil.example.com/tracker.png')).toBe(false);
  });

  it('rejects a host that merely contains "supabase" as a substring', () => {
    // Regression guard: the allowlist check is a hostname suffix match
    // (/\.supabase\.co$/), not a substring test — "supabase.co.evil.com"
    // must not slip through.
    expect(isValidAvatarUrl('https://supabase.co.evil.com/x.png')).toBe(false);
  });

  it('rejects a non-URL string', () => {
    expect(isValidAvatarUrl('not-a-url')).toBe(false);
  });

  it('rejects a javascript: URI', () => {
    expect(isValidAvatarUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects a relative path (avatar_url must be an absolute uploaded URL)', () => {
    expect(isValidAvatarUrl('/uploads/x.png')).toBe(false);
  });
});
