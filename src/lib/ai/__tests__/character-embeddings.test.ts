// src/lib/ai/__tests__/character-embeddings.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// pgvector retrieval for characters (20260902b_character_pgvector.sql) is only
// as safe as its fail-open contract: a brain-service outage, misconfiguration,
// or malformed response must never throw into a request path, must never write
// a garbage vector, and must always leave callers (character-recommender.ts)
// with an empty result to fall back from — never a crash. These tests pin
// that contract, mirroring the same shape memory-embeddings.ts's design
// implies (see that module's docstring) since there is no dedicated test file
// for it either; this is the first for either module.
// ─────────────────────────────────────────────────────────────────────────────
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_FETCH = global.fetch;

const updateEq = vi.fn().mockResolvedValue({ error: null });
const updateFn = vi.fn((_payload: { embedding: string }) => ({ eq: updateEq }));
const rpcFn = vi.fn();
const selectChain = {
  is: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
};
const selectFn = vi.fn(() => selectChain);

const supabaseAdmin = {
  from: vi.fn(() => ({ update: updateFn, select: selectFn })),
  rpc: rpcFn,
};

let mockEnv: { BRAIN_SERVICE_URL?: string; BRAIN_SERVICE_API_KEY?: string } = {
  BRAIN_SERVICE_URL: 'http://brain.test',
};

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin }));
vi.mock('@/env', () => ({ get env() { return mockEnv; } }));
vi.mock('@/lib/ai/brain-service-auth', () => ({ brainServiceAuthHeaders: () => ({}) }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
// Real circuit breaker, no mock — 4-failure threshold means a handful of
// failing tests in one file won't trip it into masking a later test's
// intended-success case, and exercising the real implementation is more
// honest than stubbing it away entirely for a module whose whole point is
// resilience to the dependency it wraps.

function jsonResponse(body: unknown, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as Response);
}

const DIM_384 = new Array(384).fill(0.01);

describe('character-embeddings.ts', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockEnv = { BRAIN_SERVICE_URL: 'http://brain.test' };
    updateEq.mockResolvedValue({ error: null });
    selectChain.limit.mockResolvedValue({ data: [], error: null });
  });
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  describe('embedAndStoreCharacter', () => {
    it('writes a vector-literal string onto the character row on success', async () => {
      global.fetch = vi.fn(() => jsonResponse({ embeddings: [DIM_384] })) as unknown as typeof fetch;
      const { embedAndStoreCharacter } = await import('../character-embeddings');

      await embedAndStoreCharacter('char-1', {
        name: 'Aria', description: 'A curious explorer.', personality: 'Warm and witty', tags: ['adventure'],
      });

      expect(updateFn).toHaveBeenCalledTimes(1);
      const written = updateFn.mock.calls[0][0] as { embedding: string };
      expect(written.embedding.startsWith('[')).toBe(true);
      expect(written.embedding.endsWith(']')).toBe(true);
      expect(updateEq).toHaveBeenCalledWith('id', 'char-1');
    });

    it('is a silent no-op when BRAIN_SERVICE_URL is unset', async () => {
      mockEnv = {};
      global.fetch = vi.fn() as unknown as typeof fetch;
      const { embedAndStoreCharacter } = await import('../character-embeddings');

      await embedAndStoreCharacter('char-1', { name: 'A', description: 'B', personality: null, tags: null });

      expect(global.fetch).not.toHaveBeenCalled();
      expect(updateFn).not.toHaveBeenCalled();
    });

    it('never throws and never writes when the brain service errors', async () => {
      global.fetch = vi.fn(() => jsonResponse({}, false, 500)) as unknown as typeof fetch;
      const { embedAndStoreCharacter } = await import('../character-embeddings');

      await expect(
        embedAndStoreCharacter('char-1', { name: 'A', description: 'B', personality: null, tags: null }),
      ).resolves.toBeUndefined();
      expect(updateFn).not.toHaveBeenCalled();
    });

    it('rejects a malformed embedding dimension rather than writing it', async () => {
      global.fetch = vi.fn(() => jsonResponse({ embeddings: [[0.1, 0.2]] })) as unknown as typeof fetch;
      const { embedAndStoreCharacter } = await import('../character-embeddings');

      await embedAndStoreCharacter('char-1', { name: 'A', description: 'B', personality: null, tags: null });

      expect(updateFn).not.toHaveBeenCalled();
    });
  });

  describe('searchCharactersBySimilarity', () => {
    it('returns [] immediately for an empty query, without calling the brain service', async () => {
      global.fetch = vi.fn() as unknown as typeof fetch;
      const { searchCharactersBySimilarity } = await import('../character-embeddings');

      const result = await searchCharactersBySimilarity('   ', { allowNsfw: false });

      expect(result).toEqual([]);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('embeds the query then calls match_characters with the resolved filters', async () => {
      global.fetch = vi.fn(() => jsonResponse({ embeddings: [DIM_384] })) as unknown as typeof fetch;
      rpcFn.mockResolvedValue({ data: [{ id: 'c1', similarity: 0.8 }], error: null });
      const { searchCharactersBySimilarity } = await import('../character-embeddings');

      const result = await searchCharactersBySimilarity('funny gamer who remembers me', {
        allowNsfw: false, gender: 'female', category: 'gaming', limit: 5,
      });

      expect(result).toEqual([{ id: 'c1', similarity: 0.8 }]);
      expect(rpcFn).toHaveBeenCalledWith('match_characters', expect.objectContaining({
        p_gender: 'female', p_category: 'gaming', p_allow_nsfw: false, p_match_count: 5,
      }));
    });

    it('returns [] (not a throw) when the RPC errors', async () => {
      global.fetch = vi.fn(() => jsonResponse({ embeddings: [DIM_384] })) as unknown as typeof fetch;
      rpcFn.mockResolvedValue({ data: null, error: { message: 'boom' } });
      const { searchCharactersBySimilarity } = await import('../character-embeddings');

      const result = await searchCharactersBySimilarity('anything', { allowNsfw: true });
      expect(result).toEqual([]);
    });

    it('returns [] when the brain service is unreachable', async () => {
      global.fetch = vi.fn(() => Promise.reject(new Error('network down'))) as unknown as typeof fetch;
      const { searchCharactersBySimilarity } = await import('../character-embeddings');

      const result = await searchCharactersBySimilarity('anything', { allowNsfw: true });
      expect(result).toEqual([]);
      expect(rpcFn).not.toHaveBeenCalled();
    });
  });

  describe('backfillMissingCharacterEmbeddings', () => {
    it('only selects active, public, live, approved rows with no embedding', async () => {
      selectChain.limit.mockResolvedValue({ data: [], error: null });
      const { backfillMissingCharacterEmbeddings } = await import('../character-embeddings');

      const result = await backfillMissingCharacterEmbeddings(25);

      expect(result).toEqual({ processed: 0, embedded: 0 });
      expect(selectChain.is).toHaveBeenCalledWith('embedding', null);
      expect(selectChain.eq).toHaveBeenCalledWith('active', true);
      expect(selectChain.eq).toHaveBeenCalledWith('is_public', true);
      expect(selectChain.eq).toHaveBeenCalledWith('is_live', true);
      expect(selectChain.eq).toHaveBeenCalledWith('moderation_status', 'approved');
      expect(selectChain.limit).toHaveBeenCalledWith(25);
    });

    it('embeds every fetched row and reports an accurate count', async () => {
      selectChain.limit.mockResolvedValue({
        data: [
          { id: 'c1', name: 'A', description: 'a', personality: null, tags: null },
          { id: 'c2', name: 'B', description: 'b', personality: null, tags: null },
        ],
        error: null,
      });
      global.fetch = vi.fn(() => jsonResponse({ embeddings: [DIM_384, DIM_384] })) as unknown as typeof fetch;
      const { backfillMissingCharacterEmbeddings } = await import('../character-embeddings');

      const result = await backfillMissingCharacterEmbeddings();

      expect(result).toEqual({ processed: 2, embedded: 2 });
      expect(updateFn).toHaveBeenCalledTimes(2);
    });

    it('reports processed but not embedded when the brain service is down mid-backfill', async () => {
      selectChain.limit.mockResolvedValue({
        data: [{ id: 'c1', name: 'A', description: 'a', personality: null, tags: null }],
        error: null,
      });
      mockEnv = {};
      const { backfillMissingCharacterEmbeddings } = await import('../character-embeddings');

      const result = await backfillMissingCharacterEmbeddings();

      expect(result).toEqual({ processed: 1, embedded: 0 });
      expect(updateFn).not.toHaveBeenCalled();
    });
  });
});
