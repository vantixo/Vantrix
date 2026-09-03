/**
 * CODE-08 — Daily Image Cap Is Actually Enforced (H-03)
 *
 * Regression test for a bug class worse than H-02 (see limits.ts / CODE-04):
 * checkImageLimit()/IMAGE_LIMITS in rate-limit/index.ts was, and remains, a
 * per-MINUTE burst limiter — it was never a daily cap. Meanwhile the pricing
 * page and tiers/config.ts have always advertised a *daily* image figure
 * ("3 image generations/day" for free). Nothing enforced that daily number:
 * a free user could hit the 5/min burst ceiling every minute, all day.
 *
 * H-03 adds `dailyImages` to TIER_LIMITS (tiers/limits.ts) as the single
 * source of truth, `checkDailyImageCap()` (rate-limit/index.ts) as the
 * Redis-backed enforcement, and wires it into every image-generation route
 * alongside the existing burst limiter. This test locks all three pieces
 * together so they can't drift apart again.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { TIER_LIMITS, getTierLimits } from '../lib/tiers/limits';
import { TIERS } from '../lib/tiers/config';

function src(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf-8');
}

const ROUTES_USING_IMAGE_GEN = [
  ['app', 'api', 'chat', 'image', 'route.ts'],
  ['app', 'api', 'characters', 'generate-image', 'route.ts'],
  ['app', 'api', 'dating', 'scene', 'route.ts'],
];

describe('CODE-08 — dailyImages is enforced, not just displayed', () => {
  it('tiers/config.ts dailyImages matches TIER_LIMITS.dailyImages for every tier still in TIERS', () => {
    for (const tier of Object.keys(TIERS) as (keyof typeof TIERS)[]) {
      expect(TIERS[tier].limits.dailyImages).toBe(getTierLimits(tier).dailyImages);
    }
  });

  it('free tier is 1 image/day (matches pricing page copy)', () => {
    // Tightened from the original 3/day figure referenced in this test's
    // module comment — tiers/config.ts's copy ("1 image generation/day",
    // see the free tier's feature list) and TIER_LIMITS.free.dailyImages
    // were moved together, so 1 is the current source of truth both sides
    // must agree on.
    expect(TIER_LIMITS.free.dailyImages).toBe(1);
  });

  it('every image-generation route calls checkDailyImageCap, not just checkImageLimit', () => {
    for (const parts of ROUTES_USING_IMAGE_GEN) {
      const file = src(...parts);
      expect(file).toMatch(/checkImageLimit/);
      expect(file).toMatch(/checkDailyImageCap/);
    }
  });

  it('rate-limit/index.ts exports checkDailyImageCap sourced from getTierLimits', () => {
    const rateLimit = src('lib', 'rate-limit', 'index.ts');
    expect(rateLimit).toMatch(/export async function checkDailyImageCap/);
    expect(rateLimit).toMatch(/getTierLimits\(tier\)\.dailyImages/);
  });
});
