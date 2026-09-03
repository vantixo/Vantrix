/**
 * ARCH-01 — Daily Message Cap TTL Tests
 *
 * Verifies that the Redis TTL for the daily cap key expires at midnight UTC
 * rather than using a flat +86400s window, which could allow up to ~48 hours
 * of effective use before the cron resets the counter.
 */

import { describe, it, expect} from 'vitest';

/**
 * Pure TTL calculation extracted from rate-limit/index.ts (ARCH-01 fix).
 * Returns the number of seconds until next midnight UTC.
 */
function secondsUntilMidnightUTC(now: Date): number {
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  return Math.ceil((midnight.getTime() - now.getTime()) / 1000);
}

describe('ARCH-01 — daily cap TTL alignment to midnight UTC', () => {
  it('returns 86400 when now is exactly midnight UTC', () => {
    const midnight = new Date('2026-06-16T00:00:00.000Z');
    expect(secondsUntilMidnightUTC(midnight)).toBe(86400);
  });

  it('returns ~1 second when now is 23:59:59 UTC', () => {
    const almostMidnight = new Date('2026-06-16T23:59:59.000Z');
    expect(secondsUntilMidnightUTC(almostMidnight)).toBe(1);
  });

  it('returns ~43200 when now is noon UTC', () => {
    const noon = new Date('2026-06-16T12:00:00.000Z');
    expect(secondsUntilMidnightUTC(noon)).toBe(43200);
  });

  it('returns less than 86400 for any time after midnight', () => {
    const oneSecondAfterMidnight = new Date('2026-06-16T00:00:01.000Z');
    expect(secondsUntilMidnightUTC(oneSecondAfterMidnight)).toBeLessThan(86400);
  });

  it('always returns a positive TTL (never zero or negative)', () => {
    // Even at 23:59:59.999 we ceil to 1
    const almostMidnight = new Date('2026-06-16T23:59:59.999Z');
    expect(secondsUntilMidnightUTC(almostMidnight)).toBeGreaterThan(0);
  });

  it('TTL does not exceed 86400 seconds', () => {
    // We only ever expire forward to the *next* midnight
    const samples = [
      new Date('2026-06-16T00:00:00.000Z'),
      new Date('2026-06-16T06:00:00.000Z'),
      new Date('2026-06-16T12:00:00.000Z'),
      new Date('2026-06-16T18:00:00.000Z'),
      new Date('2026-06-16T23:59:59.000Z'),
    ];
    for (const t of samples) {
      expect(secondsUntilMidnightUTC(t)).toBeLessThanOrEqual(86400);
    }
  });

  it('a user who first messages at 23:59 gets a TTL of ~60s, not 86400', () => {
    const lateNight = new Date('2026-06-16T23:59:00.000Z');
    const ttl = secondsUntilMidnightUTC(lateNight);
    expect(ttl).toBeLessThanOrEqual(60);
    // Old (buggy) code would have returned 86400 here, giving the user
    // an effective 48-hour window. This verifies the fix closes that gap.
    expect(ttl).not.toBe(86400);
  });
});
