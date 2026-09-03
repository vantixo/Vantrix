/**
 * SEC-04 — Moderation Fail-Closed Tests
 *
 * The AI moderation layer (src/lib/moderation/index.ts) previously had a
 * fail-open/fail-closed contradiction:
 *
 *   - If `fetch` THREW (network error, timeout, bad JSON) → fail CLOSED
 *     (allowed: false), with a comment explaining why that's the safe choice.
 *   - If `fetch` resolved but the response was non-OK (5xx, 429, 401 from
 *     the moderation provider) → fail OPEN (allowed: true), silently.
 *
 * Both are "moderation is unavailable" states and must behave identically.
 * A non-OK response is the MORE common real-world failure mode (rate
 * limits, provider outages, bad API keys) — failing open there would let
 * unreviewed character content (including the minors/exploitation/violence
 * categories this gate exists to catch) straight through.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { moderateCharacter } from '@/lib/moderation';

const baseFields = {
  name:        'Aria',
  description: 'A friendly adventurer who loves stargazing and tea.',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SEC-04 — moderateCharacter fails closed on AI moderation errors', () => {
  it('fails CLOSED when the moderation API returns a non-OK response (e.g. 500)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok:     false,
      status: 500,
    }));

    const result = await moderateCharacter(baseFields);

    expect(result.allowed).toBe(false);
    expect(result.category).toBe('moderation_unavailable');
  });

  it('fails CLOSED when the moderation API returns a non-OK response (e.g. 429 rate limit)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok:     false,
      status: 429,
    }));

    const result = await moderateCharacter(baseFields);

    expect(result.allowed).toBe(false);
    expect(result.category).toBe('moderation_unavailable');
  });

  it('fails CLOSED when fetch throws (network error) — pre-existing behaviour, must not regress', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const result = await moderateCharacter(baseFields);

    expect(result.allowed).toBe(false);
    expect(result.category).toBe('moderation_unavailable');
  });

  it('still allows clean content through when the moderation API responds normally', async () => {
    // routeCompletion() reads the response via a streaming reader (with a
    // size cap) rather than res.json() — see readResponseWithLimit() in
    // provider-router.ts — so the mock must supply a real ReadableStream
    // body, not a json() method, to exercise that path faithfully.
    const bodyJson = JSON.stringify({
      choices: [{ message: { content: '{"allowed":true}' } }],
    });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(bodyJson));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok:   true,
      body: stream,
    }));

    const result = await moderateCharacter(baseFields);

    expect(result.allowed).toBe(true);
  });

  it('blocklist still blocks obviously disallowed content before any fetch happens', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await moderateCharacter({
      name:        'Test',
      description: 'a story involving a minor',
    });

    expect(result.allowed).toBe(false);
    expect(result.category).toBe('minors');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
