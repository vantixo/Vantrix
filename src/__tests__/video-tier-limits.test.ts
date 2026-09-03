/**
 * dailyVideos tier limits — video generation (Kling) is far more expensive
 * per call than an image, so free tier is deliberately 0 (paid-only feature)
 * and premium is the only paid tier. These tests pin that shape so a future
 * pricing edit can't silently reopen video to free users.
 */

import { describe, it, expect } from 'vitest';
import { TIER_LIMITS, getTierLimits } from '../lib/tiers/limits';

describe('dailyVideos tier limits', () => {
  it('is 0 on the free tier — video is a paid-only feature', () => {
    expect(TIER_LIMITS.free.dailyVideos).toBe(0);
  });

  it('is present and positive for the premium tier', () => {
    expect(TIER_LIMITS.premium.dailyVideos).toBeGreaterThan(0);
  });

  it('premium dailyVideos is greater than free dailyVideos', () => {
    expect(TIER_LIMITS.premium.dailyVideos).toBeGreaterThan(TIER_LIMITS.free.dailyVideos);
  });

  it('is always well below dailyImages — video stays the more scarce resource', () => {
    for (const tier of Object.keys(TIER_LIMITS) as Array<keyof typeof TIER_LIMITS>) {
      expect(TIER_LIMITS[tier].dailyVideos).toBeLessThanOrEqual(TIER_LIMITS[tier].dailyImages);
    }
  });

  it('getTierLimits falls back to free (dailyVideos 0) for an unknown tier', () => {
    expect(getTierLimits('not-a-real-tier').dailyVideos).toBe(0);
  });
});
