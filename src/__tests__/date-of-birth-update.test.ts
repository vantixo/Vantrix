import { describe, it, expect } from 'vitest';
import { computeAge, MINIMUM_AGE } from '../lib/age-verification/age-gate';
import { readFileSync } from 'fs';
import { join } from 'path';

function src(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf-8');
}

describe('computeAge — used by both signup and the date-of-birth update route', () => {
  it('computes age correctly for a birthday already passed this year', () => {
    expect(computeAge('2000-01-01', new Date('2026-06-15'))).toBe(26);
  });

  it('computes age correctly for a birthday not yet reached this year', () => {
    expect(computeAge('2000-12-31', new Date('2026-06-15'))).toBe(25);
  });

  it('handles the exact birthday correctly', () => {
    expect(computeAge('2000-06-15', new Date('2026-06-15'))).toBe(26);
  });

  it(`MINIMUM_AGE is ${MINIMUM_AGE}`, () => {
    expect(MINIMUM_AGE).toBe(18);
  });
});

describe('PATCH /api/profile/date-of-birth — structure and safety properties', () => {
  const route = src('app', 'api', 'profile', 'date-of-birth', 'route.ts');

  it('requires authentication before doing anything else', () => {
    const getIdx = route.indexOf('export async function GET');
    const patchIdx = route.indexOf('export async function PATCH');
    const getAuthIdx = route.indexOf('getAuthedUser()', getIdx);
    const patchAuthIdx = route.indexOf('getAuthedUser()', patchIdx);
    expect(getAuthIdx).toBeGreaterThan(getIdx);
    expect(patchAuthIdx).toBeGreaterThan(patchIdx);
  });

  it('rate-limits updates (not just reads) to prevent repeated DOB flipping', () => {
    expect(route).toMatch(/Ratelimit\.slidingWindow\(3, ['"]24 h['"]\)/);
    const patchIdx = route.indexOf('export async function PATCH');
    const limitIdx = route.indexOf('dobUpdateLimiter.limit', patchIdx);
    expect(limitIdx).toBeGreaterThan(patchIdx);
  });

  it('the rate-limit check happens before any DB write', () => {
    const limitIdx = route.indexOf('dobUpdateLimiter.limit(user.id)');
    const writeIdx = route.indexOf('submitSelfAttestation(user.id,');
    expect(limitIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeGreaterThan(limitIdx);
  });

  it('routes through the existing submitSelfAttestation()/getAgeVerification() helpers rather than querying age_verifications directly, keeping validation and the audit trail centralized', () => {
    expect(route).not.toMatch(/\.from\(['"]age_verifications['"]\)/);
    expect(route).toMatch(/from ['"]@\/lib\/age-verification\/age-gate['"]/);
  });

  it('an under-18 rejection returns 403 with a distinct error code, not a generic failure', () => {
    expect(route).toMatch(/status:\s*403/);
    expect(route).toMatch(/UNDER_MINIMUM_AGE/);
  });
});
