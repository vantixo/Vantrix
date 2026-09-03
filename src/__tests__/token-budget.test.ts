/**
 * Token budget and history trimmer tests.
 *
 * Covers:
 *   - trimHistoryForPlan boundary: always preserves at least 1 message
 *   - Non-Latin token estimation: CJK/Arabic characters score higher than ASCII
 *   - historyLimitForTier: values present for all known tiers, free ≤ paid
 */

import { describe, it, expect } from 'vitest';
import {
  trimHistoryForPlan,
  trimToTokenBudget,
  estimateTokens,
  estimateTokensForText,
  historyLimitForTier,
} from '../lib/ai/token-budget';

const msg = (content: string, role = 'user') => ({ role, content });

describe('trimHistoryForPlan', () => {
  it('returns empty array for empty input', () => {
    expect(trimHistoryForPlan([], 'free')).toHaveLength(0);
  });

  it('always preserves at least 1 message (boundary condition)', () => {
    const huge = [msg('x'.repeat(10_000))];
    const result = trimHistoryForPlan(huge, 'free');
    expect(result).toHaveLength(1);
  });

  it('trims from oldest end', () => {
    const messages = [msg('first'), msg('second'), msg('third')];
    // Create a tiny budget that forces trimming
    const result = trimToTokenBudget(messages, 5);
    expect(result[result.length - 1].content).toBe('third');
  });

  it('does not trim when within budget', () => {
    const messages = [msg('hi'), msg('hello')];
    const result = trimHistoryForPlan(messages, 'enterprise');
    expect(result).toHaveLength(2);
  });
});

describe('estimateTokensForText — non-Latin scaling', () => {
  it('CJK characters estimate higher than equivalent ASCII', () => {
    const ascii  = 'a'.repeat(20);
    const cjk    = '日'.repeat(20); // Each CJK char gets 2× weight
    expect(estimateTokensForText(cjk)).toBeGreaterThan(estimateTokensForText(ascii));
  });

  it('Arabic characters estimate higher than equivalent ASCII', () => {
    const ascii  = 'a'.repeat(20);
    const arabic = 'ع'.repeat(20); // U+0639 — within Arabic range
    expect(estimateTokensForText(arabic)).toBeGreaterThan(estimateTokensForText(ascii));
  });

  it('empty string returns 0', () => {
    expect(estimateTokensForText('')).toBe(0);
  });

  it('mixed CJK and ASCII is higher than pure ASCII of same length', () => {
    const mixed = '日a日a日a日a'; // 4 CJK + 4 ASCII = 8 chars
    const ascii = 'aaaaaaaa';     // 8 chars — same length as `mixed`
    expect(estimateTokensForText(mixed)).toBeGreaterThan(estimateTokensForText(ascii));
  });
});

describe('estimateTokens', () => {
  it('returns 0 for empty array', () => {
    expect(estimateTokens([])).toBe(0);
  });

  it('is positive for non-empty messages', () => {
    expect(estimateTokens([msg('hello world')])).toBeGreaterThan(0);
  });
});

describe('historyLimitForTier', () => {
  const TIERS = ['free', 'spark', 'basic', 'premium', 'elite', 'enterprise'];

  it('returns a positive integer for all known tiers', () => {
    for (const tier of TIERS) {
      const limit = historyLimitForTier(tier);
      expect(limit).toBeGreaterThan(0);
      expect(Number.isInteger(limit)).toBe(true);
    }
  });

  it('free limit is less than enterprise limit', () => {
    expect(historyLimitForTier('free')).toBeLessThan(historyLimitForTier('enterprise'));
  });

  it('returns a conservative default for unknown tiers', () => {
    expect(historyLimitForTier('unknown_tier')).toBeGreaterThan(0);
  });
});
