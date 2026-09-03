/**
 * Character Embeddings — real persisted semantic search (pgvector-backed)
 * ───────────────────────────────────────────────────────────────────────────
 * The other half of the gap described in services/brain/README.md's
 * "Extending this later" section (memory-embeddings.ts closed the first
 * half): lib/recommendations/character-recommender.ts fetches a
 * popularity-ordered candidate pool by SQL and reranks a trimmed slice of
 * it LIVE via the brain service's /rerank on every request. A character
 * outside that pool can never surface, no matter how well it matches —
 * "semantic search" was a per-request rerank of an already-truncated list,
 * not retrieval, exactly the same failure mode memory-embeddings.ts fixed
 * for memories.
 *
 * This module adds the actual retrieval path for characters:
 *   1. embedAndStoreCharacter() — called fire-and-forget after a character
 *      is created (POST /api/characters) or after an edit that touches a
 *      semantically-relevant field (PATCH /api/characters/:id, currently
 *      just `personality` — see that route's patchSchema). Calls the
 *      brain service's existing POST /embed and writes the resulting
 *      vector onto that row's `embedding` column (see migration
 *      20260902b_character_pgvector.sql).
 *   2. searchCharactersBySimilarity() — calls the `match_characters`
 *      Postgres RPC to fetch the characters most similar to a user's
 *      free-text query directly, via the IVFFlat index, scoped to the
 *      same eligibility rules (active/public/live/approved, NSFW/gender/
 *      category filters) character-recommender.ts's fetchCandidates()
 *      already enforces at the SQL layer.
 *
 * FAIL OPEN, always, at every step — identical contract to
 * memory-embeddings.ts / semantic-memory.ts:
 *   - If BRAIN_SERVICE_URL isn't configured: embedAndStoreCharacter() is a
 *     silent no-op (row keeps embedding = NULL) and
 *     searchCharactersBySimilarity() returns an empty array immediately.
 *   - If the brain service errors/times out: same outcome, logged as a
 *     warning, never thrown.
 *   - If the RPC finds no rows above the similarity threshold: empty
 *     array, not an error. character-recommender.ts is expected to fall
 *     back to its existing candidate-pool-then-rerank behavior in every
 *     one of these cases — this module never blocks or degrades a
 *     recommendation response by itself.
 *
 * Rows written before this module existed (or written while the brain
 * service was down) simply have embedding = NULL and are silently excluded
 * from similarity search — see backfillMissingCharacterEmbeddings() below
 * for catching them up in bulk (run from /api/cron/embedding-backfill, not
 * the request path).
 */

import { getCircuitBreaker } from '@/lib/circuit-breaker';
import { CircuitOpenError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { env } from '@/env';
import { brainServiceAuthHeaders } from '@/lib/ai/brain-service-auth';

/**
 * match_characters() is a new RPC not yet reflected in the generated
 * src/types/supabase.ts — same closed-union problem match_memory_graph()
 * has in memory-embeddings.ts, same fix: narrow to just the `rpc` shape
 * actually used here rather than casting the call site, matching
 * lib/admin/safe-rpc.ts / lib/recommendations/trending.ts /
 * app/api/characters/click/route.ts.
 */
type RpcCapable = {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};

const REQUEST_TIMEOUT_MS = 1_500; // same budget as memory-embeddings.ts — one short-text embed call
const MAX_TEXT_LEN = 400;         // matches character-recommender.ts's characterText() truncation
const EMBEDDING_DIM = 384;        // all-MiniLM-L6-v2 — must match the migration's vector(384) column

interface EmbedApiResponse {
  embeddings: number[][];
}

export interface EmbeddableCharacter {
  name: string;
  description: string;
  personality: string | null;
  tags: string[] | null;
}

/** Mirrors character-recommender.ts's characterText() exactly — same fields, same order, same cap — so a live /rerank call and a persisted embedding are computed from identical text. */
function characterText(c: EmbeddableCharacter): string {
  const parts = [c.name, c.description, c.personality ?? '', (c.tags ?? []).join(' ')];
  const combined = parts.filter(Boolean).join('. ');
  return combined.length > MAX_TEXT_LEN ? combined.slice(0, MAX_TEXT_LEN) : combined;
}

// Deliberately reuses the SAME circuit-breaker key as memory-embeddings.ts's
// embedTexts() (both call the identical /embed endpoint on the identical
// service) — one breaker per downstream dependency, not one per caller, so
// a brain-service outage trips once and both callers fail open together
// instead of each needing its own failures to independently discover it.
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
  if (!baseUrl) return null; // not configured — identical no-op contract to memory-embeddings.ts

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
      logger.warn('character-embeddings:embed-failed', { error: String(err) });
    }
    return null;
  }
}

/** Postgres vector literal format: '[0.1,0.2,...]' — same helper as memory-embeddings.ts. */
function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

/**
 * Embed a single character (freshly created, or edited on a
 * semantically-relevant field) and write the vector onto its row.
 * Fire-and-forget from the characters API routes via next/server's
 * after() — never awaited on the create/edit request path. A failure here
 * means the character just isn't similarity-searchable yet (embedding
 * stays NULL); the character row itself is already safely persisted
 * before this is ever called.
 */
export async function embedAndStoreCharacter(characterId: string, character: EmbeddableCharacter): Promise<void> {
  try {
    const vectors = await embedTexts([characterText(character)]);
    if (!vectors || !vectors[0]) return; // fail open — row keeps embedding = NULL

    const { error } = await supabaseAdmin
      .from('characters')
      // supabase-js has no native pgvector type; a raw vector-literal string
      // is accepted by Postgres on write for a `vector` column same as any
      // other typed column input — see memory-embeddings.ts for precedent.
      .update({ embedding: toVectorLiteral(vectors[0]) } as never)
      .eq('id', characterId);

    if (error) {
      logger.warn('character-embeddings:store-failed', { characterId, error: error.message });
    }
  } catch (err) {
    logger.warn('character-embeddings:store-failed', { characterId, error: String(err) });
  }
}

export interface SimilarCharacter {
  id: string;
  name: string;
  description: string;
  personality: string | null;
  category: string | null;
  tags: string[] | null;
  image_url: string | null;
  gender: string | null;
  is_nsfw: boolean;
  like_count: number | null;
  follower_count: number | null;
  similarity: number; // 0..1, higher = more similar
}

export interface CharacterSearchFilters {
  gender?: 'female' | 'male' | 'anime' | 'other';
  category?: string;
  allowNsfw: boolean; // caller must resolve this from auth/profile state — never defaulted true here, same contract as RecommendFilters
  limit?: number;
  maxDistance?: number;
}

/**
 * Real semantic retrieval: embeds `query` once, then asks Postgres (via the
 * match_characters RPC + IVFFlat index — see the pgvector migration) for
 * the most similar eligible characters in the ENTIRE catalog, instead of
 * reranking whichever popularity-ordered slice fetchCandidates() happened
 * to fetch first.
 *
 * Returns [] (never throws) if the brain service is unavailable, the query
 * is empty, or nothing clears the similarity threshold. See
 * character-recommender.ts for how this composes with the existing
 * pool-then-rerank behavior as a fallback.
 */
export async function searchCharactersBySimilarity(
  query: string,
  filters: CharacterSearchFilters,
): Promise<SimilarCharacter[]> {
  const baseUrl = env.BRAIN_SERVICE_URL;
  if (!baseUrl || !query.trim()) return [];

  const vectors = await embedTexts([query.slice(0, 400)]);
  if (!vectors || !vectors[0]) return [];

  try {
    const { data, error } = await (supabaseAdmin as unknown as RpcCapable).rpc('match_characters', {
      p_query_embedding: toVectorLiteral(vectors[0]),
      p_gender: filters.gender ?? null,
      p_category: filters.category ?? null,
      p_allow_nsfw: filters.allowNsfw,
      p_match_count: filters.limit ?? 10,
      p_max_distance: filters.maxDistance ?? 0.6,
    });

    if (error) {
      const message = (error as { message?: string })?.message ?? String(error);
      logger.warn('character-embeddings:search-failed', { error: message });
      return [];
    }
    return (data ?? []) as unknown as SimilarCharacter[];
  } catch (err) {
    logger.warn('character-embeddings:search-failed', { error: String(err) });
    return [];
  }
}

/**
 * Bulk-embed `characters` rows that predate this feature (embedding IS
 * NULL). Intended to be invoked from /api/cron/embedding-backfill (low
 * frequency, alongside memory-embeddings.ts's backfillMissingEmbeddings())
 * — NOT from the request path. Only embeds rows that could ever actually
 * be returned by a search (active/public/live/approved) — a private,
 * unapproved, or deactivated character has no recommendation surface to
 * backfill for, and skipping them keeps batches focused on rows that
 * matter.
 */
export async function backfillMissingCharacterEmbeddings(batchSize = 50): Promise<{ processed: number; embedded: number }> {
  const { data, error } = await supabaseAdmin
    .from('characters')
    .select('id, name, description, personality, tags')
    .is('embedding', null)
    .eq('active', true)
    .eq('is_public', true)
    .eq('is_live', true)
    .eq('moderation_status', 'approved')
    .limit(batchSize);

  if (error || !data?.length) {
    if (error) logger.warn('character-embeddings:backfill-fetch-failed', { error: error.message });
    return { processed: 0, embedded: 0 };
  }

  const rows = data as unknown as { id: string; name: string; description: string; personality: string | null; tags: string[] | null }[];
  const vectors = await embedTexts(rows.map((r) => characterText(r)));
  if (!vectors) return { processed: rows.length, embedded: 0 };

  let embedded = 0;
  for (let i = 0; i < rows.length; i++) {
    const vec = vectors[i];
    if (!vec) continue;
    const { error: updateError } = await supabaseAdmin
      .from('characters')
      .update({ embedding: toVectorLiteral(vec) } as never)
      .eq('id', rows[i].id);
    if (!updateError) embedded++;
    else logger.warn('character-embeddings:backfill-write-failed', { id: rows[i].id, error: updateError.message });
  }

  logger.info('character-embeddings:backfill-batch-complete', { processed: rows.length, embedded });
  return { processed: rows.length, embedded };
}
