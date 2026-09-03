// src/lib/ai/__tests__/surprise-engine-safety-gate.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// relationship-safety-arbiter.ts's own header claimed surprise-engine.ts was
// already hard-gated against manipulation-risk framing ("nudge.ts /
// surprise-engine.ts: same hard-gate shape"). It wasn't — recordSurprise()
// only ran toneGuard() (a different risk category: re-engagement guilt
// pressure, not isolation/exclusivity/secrecy/anti-professional-help).
// These tests cover the fix: guardPreDeliveryText() now also runs inside
// recordSurprise(), the single choke point every surprise type passes
// through before persistence.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertMock = vi.fn().mockResolvedValue({ error: null });
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: vi.fn(() => ({ insert: insertMock })) },
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

import { recordSurprise } from '../surprise-engine';

describe('surprise-engine — recordSurprise manipulation-risk gate', () => {
  beforeEach(() => { insertMock.mockClear(); });

  it('blocks a message with isolation/exclusivity framing even though toneGuard would pass it', () => {
    // Doesn't match toneGuard's re-engagement patterns (no "come back",
    // no "missed messages", no all-caps) — this exercises the arbiter,
    // not the pre-existing tone guard.
    return recordSurprise('u1', 'c1', 'anniversary', "I keep thinking about how you don't need anyone but me.")
      .then((result) => {
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('manipulation_risk');
        expect(insertMock).not.toHaveBeenCalled();
      });
  });

  it('still blocks on toneGuard first for its own category, without needing the arbiter', async () => {
    const result = await recordSurprise('u1', 'c1', 'promise_followup', "You haven't replied in days, come back.");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('tone_guard');
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('allows a clean, memory-grounded surprise message through to persistence', async () => {
    const result = await recordSurprise('u1', 'c1', 'memory_poem', "I thought of you when I noticed the rain again today.");
    expect(result.ok).toBe(true);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});
