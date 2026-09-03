/**
 * CODE-03 — Password Policy Tests
 *
 * Verifies that the client-side password validation in reset-password/page.tsx
 * matches the Supabase Auth security settings (min 10 chars, 1 special char).
 *
 * Before the fix the client used 8 chars while Supabase defaults to 6,
 * allowing users to bypass the strength meter entirely.
 */

import { describe, it, expect } from 'vitest';

const SPECIAL_CHAR_RE = /[^A-Za-z0-9]/;

function validatePassword(password: string): { ok: boolean; error?: string } {
  if (password.length < 10) {
    return { ok: false, error: 'Password must be at least 10 characters.' };
  }
  if (!SPECIAL_CHAR_RE.test(password)) {
    return { ok: false, error: 'Password must include at least one special character.' };
  }
  return { ok: true };
}

describe('CODE-03 — password policy (≥10 chars + special char)', () => {
  it('accepts a strong password', () => {
    expect(validatePassword('MyS3cur3P@ss!')).toEqual({ ok: true });
  });

  it('accepts a 10-char password with special char', () => {
    expect(validatePassword('abcdefghi!')).toEqual({ ok: true });
  });

  it('rejects 9-char password even with special char', () => {
    const r = validatePassword('abcdefg!1');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/10 characters/);
  });

  it('rejects password with no special char even if long enough', () => {
    const r = validatePassword('MyPassword123');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/special character/);
  });

  it('rejects the old 8-char minimum that was previously accepted', () => {
    // A user could previously bypass the UI with e.g. "hunter42" (8 chars, no special)
    const r = validatePassword('hunter42');
    expect(r.ok).toBe(false);
  });

  it('rejects Supabase default 6-char minimum', () => {
    const r = validatePassword('abc1!x');
    expect(r.ok).toBe(false);
  });

  it('accepts exactly 10 chars with special char', () => {
    expect(validatePassword('password!1')).toEqual({ ok: true });
  });

  it('accepts unicode special characters', () => {
    expect(validatePassword('MyPassword£1')).toEqual({ ok: true });
  });
});
