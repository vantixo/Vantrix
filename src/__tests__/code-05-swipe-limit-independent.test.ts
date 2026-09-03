/**
 * CODE-05 — Swipes Never Share a Counter With Chat Messages
 *
 * Regression test for: dating/swipe/route.ts called checkChatLimit() to
 * gate swipes — two completely unrelated actions (a cheap DB write vs. an
 * LLM-backed chat turn) sharing one Redis counter. Burning through swipes
 * could lock a user out of chatting and vice versa.
 *
 * checkSwipeLimit() is now its own function with its own Redis key
 * namespace (vantrix:swipe:* vs vantrix:daily:* for messages) and its own
 * per-tier limit (TIER_LIMITS[tier].dailySwipes vs .dailyMessages).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { TIER_LIMITS } from '../lib/tiers/limits';

function src(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf-8');
}

describe('CODE-05 — checkSwipeLimit is independent of chat limits', () => {
  it('dating/swipe imports checkSwipeLimit, not checkChatLimit', () => {
    const route = src('app', 'api', 'dating', 'swipe', 'route.ts');
    const withoutComments = route
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(route).toMatch(/import\s*\{[^}]*\bcheckSwipeLimit\b[^}]*\}\s*from\s*['"]@\/lib\/rate-limit['"]/);
    expect(withoutComments).not.toMatch(/checkChatLimit\(/);
  });

  it('checkSwipeLimit and checkDailyMessageCap use different Redis key prefixes', () => {
    const rateLimit = src('lib', 'rate-limit', 'index.ts');
    expect(rateLimit).toMatch(/vantrix:swipe:/);
    expect(rateLimit).toMatch(/vantrix:daily:/);
  });

  it('every tier has independently configured dailySwipes and dailyMessages', () => {
    for (const tier of Object.keys(TIER_LIMITS) as Array<keyof typeof TIER_LIMITS>) {
      expect(TIER_LIMITS[tier].dailySwipes).toBeGreaterThan(0);
      expect(TIER_LIMITS[tier].dailyMessages).toBeGreaterThan(0);
    }
    // Confirms these are genuinely separate knobs, not aliases of each other.
    expect(TIER_LIMITS.premium.dailySwipes).not.toBe(TIER_LIMITS.premium.dailyMessages);
  });

  it('tiers/config.ts pricing page sources dailySwipes from the same place as dailyMessages (no drift)', () => {
    const config = src('lib', 'tiers', 'config.ts');
    const swipesSourced  = config.match(/dailySwipes: getTierLimits\(/g) ?? [];
    const messagesSourced = config.match(/dailyMessages: getTierLimits\(/g) ?? [];
    // SINGLE-PLAN MODEL: TIERS in config.ts now only has 'free' and 'premium'
    // (the one paid plan) — was 6 tier blocks, now 2.
    expect(swipesSourced.length).toBe(2);
    expect(messagesSourced.length).toBe(2);
  });
});
