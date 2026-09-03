/**
 * Plan limits parity tests.
 *
 * PLAN_LIMITS in spending-cap.ts and PLAN_DAILY_LIMITS in orchestrator.ts
 * (previously a duplicate constant) now share a single source of truth.
 * These tests assert that the exported values remain coherent so a future
 * pricing change cannot silently produce incorrect billing enforcement.
 */

import { describe, it, expect } from 'vitest';
import { PLAN_LIMITS, PLAN_DAILY_LIMITS } from '../lib/ai/spending-cap';

const TIERS = ['free', 'premium'] as const;

describe('PLAN_LIMITS / PLAN_DAILY_LIMITS parity', () => {
  it('PLAN_DAILY_LIMITS is derived from PLAN_LIMITS.daily — no drift', () => {
    for (const tier of TIERS) {
      expect(PLAN_DAILY_LIMITS[tier]).toBe(PLAN_LIMITS[tier].daily);
    }
  });

  it('all tiers are present in both exports', () => {
    for (const tier of TIERS) {
      expect(PLAN_LIMITS[tier]).toBeDefined();
      expect(PLAN_DAILY_LIMITS[tier]).toBeDefined();
    }
  });

  it('perRequest limits are positive and finite', () => {
    for (const tier of TIERS) {
      expect(PLAN_LIMITS[tier].perRequest).toBeGreaterThan(0);
      expect(Number.isFinite(PLAN_LIMITS[tier].perRequest)).toBe(true);
    }
  });

  it('premium has Infinity daily limit', () => {
    expect(PLAN_LIMITS.premium.daily).toBe(Infinity);
  });

  it('free has a finite, positive daily limit', () => {
    expect(PLAN_LIMITS.free.daily).toBeGreaterThan(0);
    expect(Number.isFinite(PLAN_LIMITS.free.daily)).toBe(true);
  });
});
