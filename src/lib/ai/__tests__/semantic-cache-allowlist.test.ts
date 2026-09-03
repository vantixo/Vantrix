// src/lib/ai/__tests__/semantic-cache-allowlist.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Cost audit (2026-08-23): semantic-cache.ts was fully disabled on 2026-08-08
// after its original design served one user's cached reply to a *different*
// user as their companion's own words — matching wasn't scoped by who was
// asking, just by (systemPrompt, near-duplicate message). Re-enabled here,
// but scoped to a curated allowlist of fully generic openers (greetings,
// acks, farewells, "thanks", "how are you") — see GENERIC_OPENERS in
// semantic-cache.ts.
//
// These tests exist to pin that allowlist as a hard boundary. If someone
// widens it back to "any near-duplicate message" (e.g. by wiring the
// unused MinHash/LSH layer back in, or by loosening the GENERIC_OPENERS
// check), this file should fail — that's the whole point of it.
// ─────────────────────────────────────────────────────────────────────────────
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const redisGet    = vi.fn();
const pipelineExec = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/redis', () => ({
  redis: {
    get: redisGet,
    pipeline: () => ({
      incr:      vi.fn().mockReturnThis(),
      expireat:  vi.fn().mockReturnThis(),
      exec:      pipelineExec,
    }),
    del: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  bg: (label: string) => (err: unknown) => { void label; void err; },
}));

describe('semantic-cache.ts → generic-opener allowlist', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    redisGet.mockResolvedValue(null);
  });
  afterEach(() => vi.restoreAllMocks());

  it('is cacheable (non-null key) for a plain greeting', async () => {
    const { checkSemanticCache } = await import('../semantic-cache');
    const result = await checkSemanticCache({
      tier: 'free', systemPrompt: 'sys', userMsg: 'hi',
      datingMode: false, hasMemory: false,
    });
    expect(result.hit).toBe(false);
    expect(result.key).not.toBeNull();
  });

  it('is cacheable for synonyms that normalize to the same generic opener', async () => {
    const { checkSemanticCache } = await import('../semantic-cache');
    const r1 = await checkSemanticCache({
      tier: 'free', systemPrompt: 'sys', userMsg: 'hey there',
      datingMode: false, hasMemory: false,
    });
    const r2 = await checkSemanticCache({
      tier: 'free', systemPrompt: 'sys', userMsg: 'howdy',
      datingMode: false, hasMemory: false,
    });
    expect(r1.key).not.toBeNull();
    expect(r2.key).not.toBeNull();
    expect(r1.key).toEqual(r2.key); // same normalized bucket → same cache key
  });

  it('is NEVER cacheable for a free-text, non-generic message — the exact bug this was disabled for', async () => {
    const { checkSemanticCache } = await import('../semantic-cache');
    const result = await checkSemanticCache({
      tier: 'free', systemPrompt: 'sys',
      userMsg: 'I had a really rough day at work, my manager yelled at me in front of everyone',
      datingMode: false, hasMemory: false,
    });
    expect(result.hit).toBe(false);
    expect(result.key).toBeNull();
    // redis.get must never even be called for non-generic content — there's
    // no cache slot for it to possibly read from or write to.
    expect(redisGet).not.toHaveBeenCalled();
  });

  it('is NEVER cacheable for a message that merely resembles a generic opener via near-duplicate wording', async () => {
    // This is deliberately NOT in CANONICAL_MAP/GENERIC_OPENERS — a human
    // reads it as "basically hi", but the old MinHash/Jaccard layer (now
    // unused) was the thing that would have matched this loosely. Layer 1
    // (exact canonical normalization) must not.
    const { checkSemanticCache } = await import('../semantic-cache');
    const result = await checkSemanticCache({
      tier: 'free', systemPrompt: 'sys', userMsg: "yo what's good with you today",
      datingMode: false, hasMemory: false,
    });
    expect(result.key).toBeNull();
  });

  it('stays disabled for premium tier, dating mode, memory-enriched prompts, and long messages — even for a greeting', async () => {
    const { checkSemanticCache } = await import('../semantic-cache');

    const premium = await checkSemanticCache({
      tier: 'premium', systemPrompt: 'sys', userMsg: 'hi', datingMode: false, hasMemory: false,
    });
    const dating = await checkSemanticCache({
      tier: 'free', systemPrompt: 'sys', userMsg: 'hi', datingMode: true, hasMemory: false,
    });
    const memory = await checkSemanticCache({
      tier: 'free', systemPrompt: 'sys', userMsg: 'hi', datingMode: false, hasMemory: true,
    });
    const long = await checkSemanticCache({
      tier: 'free', systemPrompt: 'sys', userMsg: 'hi '.repeat(200), datingMode: false, hasMemory: false,
    });

    for (const r of [premium, dating, memory, long]) {
      expect(r.hit).toBe(false);
      expect(r.key).toBeNull();
    }
  });

  it('returns a hit only when Redis actually has a stored reply for the generic-opener key', async () => {
    redisGet.mockResolvedValueOnce('Hey! Good to hear from you 💛');
    const { checkSemanticCache } = await import('../semantic-cache');

    const result = await checkSemanticCache({
      tier: 'free', systemPrompt: 'sys', userMsg: 'hello',
      datingMode: false, hasMemory: false,
    });

    expect(result.hit).toBe(true);
    if (result.hit) {
      expect(result.reply).toBe('Hey! Good to hear from you 💛');
      expect(result.mode).toBe('canonical');
    }
  });

  it('fails open to a miss (never throws) when Redis is unavailable', async () => {
    redisGet.mockRejectedValueOnce(new Error('redis down'));
    const { checkSemanticCache } = await import('../semantic-cache');

    await expect(checkSemanticCache({
      tier: 'free', systemPrompt: 'sys', userMsg: 'thanks',
      datingMode: false, hasMemory: false,
    })).resolves.toEqual(expect.objectContaining({ hit: false }));
  });

  it('storeSemanticCache is a no-op for a null key (non-generic messages never get written)', async () => {
    const { storeSemanticCache } = await import('../semantic-cache');
    await storeSemanticCache({ key: null, words: new Set(['hi']), sig: null, bandKeys: null, reply: 'anything' });
    expect(pipelineExec).not.toHaveBeenCalled();
  });
});
