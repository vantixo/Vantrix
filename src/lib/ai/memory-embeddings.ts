/**
 * Memory Embeddings — real persisted semantic memory (pgvector-backed)
 * ───────────────────────────────────────────────────────────────────────────
 * This is the missing piece described in services/brain/README.md's
 * "Extending this later" section and in this repo's own architecture notes:
 * semantic-memory.ts's semanticRerankMemories() only ever re-sorts a small
 * candidate list that memory-graph.ts already fetched by SQL
 * (emotional_weight + recency) — there was no persisted embedding, no
 * vector column, no ANN index. "Semantic memory" was a live per-request
 * rerank, not retrieval.
 *
 * This module adds the actual retrieval path:
 *   1. embedAndStoreMemory() — called fire-and-forget from
 *      memory-graph.ts's addMemory(), right after a MemoryNode is inserted.
 *      Calls the existing brain service's POST /embed (already implemented
 *      in services/brain/main.py, already documented, never previously
 *      called from Node) and writes the resulting vector onto that same
 *      row's new `embedding` column (see migration
 *      20260902_memory_graph_pgvector.sql).
 *   2. searchMemoriesBySimilarity() — calls the `match_memory_graph`
 *      Postgres RPC to fetch the memories most similar to the user's
 *      current message directly, via the IVFFlat index, instead of
 *      re-ranking whatever a separate recency/weight query happened to
 *      fetch first.
 *
 * FAIL OPEN, always, at every step — identical contract to
 * semantic-memory.ts:
 *   - If BRAIN_SERVICE_URL isn't configured: embedAndStoreMemory() is a
 *     silent no-op (row keeps embedding = NULL) and
 *     searchMemoriesBySimilarity() returns an empty array immediately.
 *   - If the brain service errors/times out: same outcome, logged as a
 *     warning, never thrown.
 *   - If the RPC finds no rows above the similarity threshold: empty array,
 *     not an error. Callers (see semantic-memory.ts's hybrid rerank) are
 *     expected to fall back to the existing emotion/recency order in every
 *     one of these cases — this module never blocks or degrades a chat
 *     reply by itself.
 *
 * Rows written before this module existed (or written while the brain
 * service was down) simply have embedding = NULL and are silently excluded
 * from similarity search — see backfillMissingEmbeddings() below for
 * catching them up in bulk (intended to be run from a cron/one-off script,
 * not the request path).
 */

import { getCircuitBreaker } from '@/lib/circuit-breaker';
import { CircuitOpenError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { env } from '@/env';
import { brainServiceAuthHeaders } from '@/lib/ai/brain-service-auth';
import type { MemoryNode } from '@/lib/ai/memory-graph';

/**
 * match_memory_graph() is a new RPC not yet reflected in the generated
 * src/types/supabase.ts (which validates RPC names against a closed
 * union). Narrowed to just the `rpc` shape actually used here rather than
 * an `any`/`as never` cast on the call site — same workaround
 * lib/admin/safe-rpc.ts, lib/recommendations/trending.ts, and
 * app/api/characters/click/route.ts already use for the same reason — so
 * a typo on supabaseAdmin elsewhere is still caught by the compiler.
 * TYPECHECK-FIX: the previous `as never` on just the args object didn't
 * actually satisfy tsc — the RPC *name* argument is what's checked against
 * the closed union, and casting the second argument doesn't change that.
 * This was a real `npm run typecheck` failure, not just a style deviation.
 */
type RpcCapable = {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};

const REQUEST_TIMEOUT_MS = 1_500; // embedding a single short string; generous but bounded
const MAX_TEXT_LEN = 400; // matches semantic-memory.ts's memoryText() truncation
const EMBEDDING_DIM = 384; // all-MiniLM-L6-v2 — must match the migration's vector(384) column

interface EmbedApiResponse {
  embeddings: number[][];
}

function memoryText(m: Pick<MemoryNode, 'title' | 'description'>): string {
  const combined = `${m.title}. ${m.description}`;
  return combined.length > MAX_TEXT_LEN ? combined.slice(0, MAX_TEXT_LEN) : combined;
}

function breaker() {
  return getCircuitBreaker('ai:brain-service-embed', {
    failureThreshold: 4,
    timeout: 30_000,
  });
}

/**
 * Calls the brain service's /embed endpoint for a batch of texts.
 * Returns null (never throws) on any misconfiguration, timeout, or error —
 * every caller in this file treats a null return as "skip, fail open".
 */
async function embedTexts(texts: string[]): Promise<number[][] | null> {
  if (!texts.length) return [];

  const baseUrl = env.BRAIN_SERVICE_URL;
  if (!baseUrl) return null; // not configured — identical no-op contract to semantic-memory.ts

  try {
    return await breaker().execute(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const res = await fetch(`${baseUrl}/embed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...brainServiceAuthHeaders() },
          body: JSON.stringify({ texts }),
          signal: controller.signal,
        });

        if (!res.ok) throw new Error(`brain-service /embed failed: ${res.status}`);

        const data = (await res.json()) as EmbedApiResponse;
        if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length) {
          throw new Error('brain-service /embed returned malformed response');
        }
        for (const vec of data.embeddings) {
          if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) {
            throw new Error(`brain-service /embed returned wrong dimension (expected ${EMBEDDING_DIM})`);
          }
        }
        return data.embeddings;
      } finally {
        clearTimeout(timer);
      }
    });
  } catch (err) {
    if (!(err instanceof CircuitOpenError)) {
      logger.warn('memory-embeddings:embed-failed', { error: String(err) });
    }
    return null;
  }
}

/** Postgres vector literal format: '[0.1,0.2,...]' */
function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

/**
 * Embed a single freshly-created memory and write the vector onto its row.
 * Fire-and-forget from memory-graph.ts's addMemory() — never awaited on the
 * chat request path. A failure here means the memory just isn't
 * similarity-searchable yet (embedding stays NULL); the memory itself is
 * already safely persisted by addMemory() before this is ever called.
 */
export async function embedAndStoreMemory(memoryId: string, node: Pick<MemoryNode, 'title' | 'description'>): Promise<void> {
  try {
    const vectors = await embedTexts([memoryText(node)]);
    if (!vectors || !vectors[0]) return; // fail open — row keeps embedding = NULL

    const { error } = await supabaseAdmin
      .from('memory_graph')
      // supabase-js has no native pgvector type; a raw vector-literal string
      // is accepted by Postgres on write for a `vector` column same as any
      // other typed column input.
      .update({ embedding: toVectorLiteral(vectors[0]) } as never)
      .eq('id', memoryId);

    if (error) {
      logger.warn('memory-embeddings:store-failed', { memoryId, error: error.message });
    }
  } catch (err) {
    logger.warn('memory-embeddings:store-failed', { memoryId, error: String(err) });
  }
}

export interface SimilarMemory {
  id: string;
  event_type: string;
  title: string;
  description: string;
  emotional_weight: number;
  tags: string[];
  created_at: string;
  similarity: number; // 0..1, higher = more similar
}

/**
 * Real semantic retrieval: embeds `userMessage` once, then asks Postgres
 * (via the match_memory_graph RPC + IVFFlat index — see the pgvector
 * migration) for the most similar memories for this user/character pair,
 * instead of re-ranking a pre-fetched candidate list.
 *
 * Returns [] (never throws) if the brain service is unavailable, or if
 * nothing clears the similarity threshold. See semantic-memory.ts for how
 * this composes with the existing emotion/recency ordering as a fallback.
 */
export async function searchMemoriesBySimilarity(
  userId: string,
  characterId: string,
  userMessage: string,
  opts: { limit?: number; maxDistance?: number } = {},
): Promise<SimilarMemory[]> {
  const baseUrl = env.BRAIN_SERVICE_URL;
  if (!baseUrl || !userMessage.trim()) return [];

  const vectors = await embedTexts([userMessage.slice(0, 4000)]);
  if (!vectors || !vectors[0]) return [];

  try {
    const { data, error } = await (supabaseAdmin as unknown as RpcCapable).rpc('match_memory_graph', {
      p_user_id: userId,
      p_character_id: characterId,
      p_query_embedding: toVectorLiteral(vectors[0]),
      p_match_count: opts.limit ?? 8,
      p_max_distance: opts.maxDistance ?? 0.6,
    });

    if (error) {
      const message = (error as { message?: string })?.message ?? String(error);
      logger.warn('memory-embeddings:search-failed', { userId, characterId, error: message });
      return [];
    }
    return (data ?? []) as unknown as SimilarMemory[];
  } catch (err) {
    logger.warn('memory-embeddings:search-failed', { userId, characterId, error: String(err) });
    return [];
  }
}

/**
 * Bulk-embed memory_graph rows that predate this feature (embedding IS
 * NULL). Intended to be invoked from a one-off script or a low-frequency
 * cron (same tier as api/cron/memory-archive) — NOT from the request path.
 * Processes in small batches so a single /embed call batch stays well
 * under the brain service's own MAX_CANDIDATES=100 cap.
 */
export async function backfillMissingEmbeddings(batchSize = 50): Promise<{ processed: number; embedded: number }> {
  const { data, error } = await supabaseAdmin
    .from('memory_graph')
    .select('id, title, description')
    .is('embedding', null)
    .limit(batchSize);

  if (error || !data?.length) {
    if (error) logger.warn('memory-embeddings:backfill-fetch-failed', { error: error.message });
    return { processed: 0, embedded: 0 };
  }

  const rows = data as unknown as { id: string; title: string; description: string }[];
  const vectors = await embedTexts(rows.map((r) => memoryText(r)));
  if (!vectors) return { processed: rows.length, embedded: 0 };

  let embedded = 0;
  for (let i = 0; i < rows.length; i++) {
    const vec = vectors[i];
    if (!vec) continue;
    const { error: updateError } = await supabaseAdmin
      .from('memory_graph')
      .update({ embedding: toVectorLiteral(vec) } as never)
      .eq('id', rows[i].id);
    if (!updateError) embedded++;
    else logger.warn('memory-embeddings:backfill-write-failed', { id: rows[i].id, error: updateError.message });
  }

  logger.info('memory-embeddings:backfill-batch-complete', { processed: rows.length, embedded });
  return { processed: rows.length, embedded };
}
