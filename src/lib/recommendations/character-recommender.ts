/**
 * lib/recommendations/character-recommender.ts
 * ─────────────────────────────────────────────────────────────────────────
 * Internal recommendation engine: takes a free-text description of what the
 * user wants ("someone funny who talks about gaming and remembers me") and
 * ranks Vantrix's own character catalog by semantic relevance to it.
 *
 * PGVECTOR UPGRADE: this module now searches persisted embeddings across
 * the entire eligible catalog first (lib/ai/character-embeddings.ts +
 * migration 20260902b_character_pgvector.sql) — the natural extension the
 * services/brain README already pointed at ("the natural next step beyond
 * reranking existing memories is using /embed to do actual semantic
 * search"). The original candidate-pool-then-/rerank approach below is kept
 * as-is and used as the fallback: if no characters have embeddings yet
 * (pre-migration rows, or the brain service was down when they were
 * written), it still reranks the popularity-ordered pool exactly as
 * before. Nothing that depended on the old behavior breaks; it degrades to
 * it. Reuses the same service and the same fail-open circuit-breaker
 * pattern as lib/ai/semantic-memory.ts throughout — deliberately does not
 * introduce a second embedding provider, a vector DB, or a new failure
 * mode. If the brain service is unavailable at any layer, this degrades
 * all the way down to the existing keyword/tag ranking rather than failing
 * the request.
 *
 * Signals blended (see module docstring intent in the SEO plan this
 * implements — "explicit / behavioral / contextual"):
 *   - explicit:   the user's free-text query (primary signal, via /rerank)
 *   - behavioral: like_count / follower_count as a tiebreak within
 *                 similar-scoring candidates, not a primary sort key —
 *                 popularity should nudge, not override, relevance
 *   - contextual: caller-supplied filters (gender/category/nsfw), applied
 *                 as hard SQL filters before ranking, not blended in
 *
 * Sensitive attributes (age, protected characteristics of the *user*) are
 * never inputs here — only what the user explicitly typed and the
 * character catalog's own public fields.
 */

import { getCircuitBreaker } from '@/lib/circuit-breaker';
import { logger } from '@/lib/logger';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { redis } from '@/lib/redis';
import { env } from '@/env';
import { brainServiceAuthHeaders } from '@/lib/ai/brain-service-auth';
import { searchCharactersBySimilarity } from '@/lib/ai/character-embeddings';

const REQUEST_TIMEOUT_MS = 1_500;
const CANDIDATE_POOL_SIZE = 100; // fetched from DB once per filter set, then cached
const RERANK_POOL_SIZE = 60;     // subset of the pool actually sent to /rerank — trims embed payload/latency without meaningfully hurting recall, since the pool is already popularity-ordered
const MAX_QUERY_LEN = 400;

// Candidate pool changes slowly relative to request volume (new characters,
// like_count drift) — short TTL cache avoids re-querying Postgres on every
// recommendation request while staying fresh enough that a newly-published
// character shows up within a minute. Same Redis client / fail-open posture
// as ai-curator.ts's budget counter: a cache failure degrades to a normal
// DB fetch, never an error.
const CANDIDATE_CACHE_TTL_SEC = 60;
// Full ranked result cache — the expensive part is the brain-service call,
// not the DB fetch, so this is the higher-value cache. Short enough that
// popularity/catalog changes surface quickly; long enough that the example
// prompts on /find-my-companion (shared across all visitors) are effectively
// free after the first hit.
const RESULT_CACHE_TTL_SEC = 300;

export interface RecommendableCharacter {
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
}

export interface RecommendationResult {
  character: RecommendableCharacter;
  score: number;       // 0..1 semantic similarity, or a coarse fallback score
  reason: string;       // short human-readable explanation, no scoring internals exposed
}

export interface RecommendFilters {
  gender?: 'female' | 'male' | 'anime' | 'other';
  category?: string;
  allowNsfw: boolean; // caller must resolve this from auth/profile state before calling — never defaulted true here
  limit?: number;
}

interface BrainRerankResponse {
  ranked: { id: string; score: number }[];
}

function characterText(c: RecommendableCharacter): string {
  const parts = [c.name, c.description, c.personality ?? '', (c.tags ?? []).join(' ')];
  const combined = parts.filter(Boolean).join('. ');
  return combined.length > 300 ? combined.slice(0, 300) : combined;
}

function filterCacheKey(filters: RecommendFilters): string {
  return `char-rec:pool:v1:${filters.gender ?? '*'}:${filters.category ?? '*'}:${filters.allowNsfw}`;
}

// Simple deterministic hash — same technique ai-curator.ts uses for its own
// cache keys, kept consistent rather than pulling in a hashing dependency
// for something this small.
function hashQuery(query: string): string {
  let h = 0;
  for (const ch of query.toLowerCase().trim()) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h).toString(36);
}

async function fetchCandidatesCached(filters: RecommendFilters): Promise<RecommendableCharacter[]> {
  const key = filterCacheKey(filters);
  try {
    const cached = await redis.get<string>(key);
    if (cached) return JSON.parse(cached) as RecommendableCharacter[];
  } catch (err) {
    // Redis unavailable/misconfigured, or a malformed cache entry — fall
    // through to a normal DB fetch either way. Never let a cache failure
    // become a request failure.
    logger.warn('recommendCharacters: candidate cache read failed', { error: err instanceof Error ? err.message : String(err) });
  }

  const fresh = await fetchCandidates(filters);

  try {
    if (fresh.length > 0) await redis.set(key, JSON.stringify(fresh), { ex: CANDIDATE_CACHE_TTL_SEC });
  } catch (err) {
    logger.warn('recommendCharacters: candidate cache write failed', { error: err instanceof Error ? err.message : String(err) });
  }

  return fresh;
}

async function fetchCandidates(filters: RecommendFilters): Promise<RecommendableCharacter[]> {
  let query = supabaseAdmin
    .from('characters')
    .select('id,name,description,personality,category,tags,image_url,gender,is_nsfw,like_count,follower_count')
    .eq('active', true)
    .eq('is_public', true)
    .eq('is_live', true);

  if (!filters.allowNsfw) query = query.eq('is_nsfw', false);
  if (filters.gender) query = query.eq('gender', filters.gender);
  if (filters.category) query = query.eq('category', filters.category);

  // Order by popularity before truncation so the fallback path (and the
  // candidate pool fed to /rerank when semantic search IS available) both
  // favor already-good characters rather than an arbitrary DB order.
  query = query.order('like_count', { ascending: false, nullsFirst: false }).limit(CANDIDATE_POOL_SIZE);

  const { data, error } = await query;
  if (error) {
    logger.warn('recommendCharacters: candidate fetch failed', { error: error.message });
    return [];
  }
  return (data ?? []) as RecommendableCharacter[];
}

/** Keyword-overlap fallback — used when the brain service is unset, down, or the circuit is open. Coarse but never blocks the feature. */
function keywordFallbackRank(query: string, candidates: RecommendableCharacter[]): RecommendationResult[] {
  const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
  return candidates
    .map((c) => {
      const text = characterText(c).toLowerCase();
      const hits = terms.filter((t) => text.includes(t)).length;
      const score = terms.length ? hits / terms.length : 0;
      return { character: c, score, reason: hits > 0 ? 'Matches what you described' : 'Popular on Vantrix' };
    })
    .sort((a, b) => b.score - a.score || (b.character.like_count ?? 0) - (a.character.like_count ?? 0));
}

/**
 * Ranks Vantrix's character catalog by semantic relevance to `userQuery`.
 * Always returns a result (never throws) — fails open to keyword/popularity
 * ranking exactly like semanticRerankMemories() does for memories.
 */
export async function recommendCharacters(
  userQuery: string,
  filters: RecommendFilters,
): Promise<RecommendationResult[]> {
  const query = userQuery.trim().slice(0, MAX_QUERY_LEN);
  const limit = Math.min(filters.limit ?? 10, 25);

  const candidates = await fetchCandidatesCached(filters);
  if (candidates.length === 0) return [];
  if (!query) {
    // No explicit intent given — pure popularity, no fabricated "reason".
    // Not cached: this is already just a slice of the (already-cached)
    // pool, so there's nothing further to save.
    return candidates
      .slice(0, limit)
      .map((c) => ({ character: c, score: 0, reason: 'Popular on Vantrix' }));
  }

  const resultCacheKey = `char-rec:result:v1:${filterCacheKey(filters)}:${hashQuery(query)}:${limit}`;
  try {
    const cached = await redis.get<string>(resultCacheKey);
    if (cached) return JSON.parse(cached) as RecommendationResult[];
  } catch (err) {
    logger.warn('recommendCharacters: result cache read failed', { error: err instanceof Error ? err.message : String(err) });
  }

  const results = await computeRecommendations(query, candidates, limit, filters);

  try {
    if (results.length > 0) await redis.set(resultCacheKey, JSON.stringify(results), { ex: RESULT_CACHE_TTL_SEC });
  } catch (err) {
    logger.warn('recommendCharacters: result cache write failed', { error: err instanceof Error ? err.message : String(err) });
  }

  return results;
}

async function computeRecommendations(
  query: string,
  candidates: RecommendableCharacter[],
  limit: number,
  filters: RecommendFilters,
): Promise<RecommendationResult[]> {
  const baseUrl = env.BRAIN_SERVICE_URL;
  if (!baseUrl) {
    return keywordFallbackRank(query, candidates).slice(0, limit);
  }

  // PGVECTOR UPGRADE: search persisted embeddings across the ENTIRE eligible
  // catalog first (character-embeddings.ts, migration
  // 20260902b_character_pgvector.sql) — not just the popularity-ordered pool
  // fetchCandidatesCached() happened to fetch. A character outside that pool
  // (low like_count, newly published) can now surface if it's genuinely the
  // best semantic match, which the old pool-then-rerank approach could never
  // do by construction. Falls through to the pre-upgrade behavior below if
  // this finds nothing — no embeddings yet (pre-migration rows, or
  // backfillMissingCharacterEmbeddings() hasn't reached them), brain service
  // down, or genuinely no similar character above the threshold. Wrapped in
  // its own try/catch even though searchCharactersBySimilarity() already
  // fails open internally — same belt-and-suspenders posture
  // semantic-memory.ts's retrieveRelevantMemories() uses around the
  // equivalent memory call.
  try {
    const similar = await searchCharactersBySimilarity(query, {
      gender: filters.gender,
      category: filters.category,
      allowNsfw: filters.allowNsfw,
      limit,
    });

    if (similar.length > 0) {
      return similar.map((s) => ({
        character: {
          id: s.id,
          name: s.name,
          description: s.description,
          personality: s.personality,
          category: s.category,
          tags: s.tags,
          image_url: s.image_url,
          gender: s.gender,
          is_nsfw: s.is_nsfw,
          like_count: s.like_count,
          follower_count: s.follower_count,
        },
        score: s.similarity,
        reason: s.similarity > 0.35 ? 'Closely matches what you described' : 'Related to what you described',
      }));
    }
  } catch (err) {
    logger.warn('recommendCharacters: pgvector search failed, falling back to pool rerank', {
      error: err instanceof Error ? err.message : String(err),
    });
    // fall through to the pre-upgrade pool-then-rerank path below
  }

  // PRE-UPGRADE FALLBACK — unchanged. Trim to the top RERANK_POOL_SIZE (already popularity-ordered) before
  // sending to the brain service — cuts embed-batch size/latency for the
  // common case without meaningfully hurting recall, since the tail of a
  // 100-deep popularity-ordered pool is rarely the best semantic match
  // anyway. The full CANDIDATE_POOL_SIZE pool is still what gets cached
  // and reused across queries/filters.
  const rerankPool = candidates.slice(0, RERANK_POOL_SIZE);

  const breaker = getCircuitBreaker('ai:brain-service', { failureThreshold: 4, timeout: 30_000 });

  try {
    const ranked = await breaker.execute(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(`${baseUrl}/rerank`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...brainServiceAuthHeaders() },
          body: JSON.stringify({
            query,
            candidates: rerankPool.map((c) => ({ id: c.id, text: characterText(c) })),
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`brain-service rerank failed: ${res.status}`);
        const data = (await res.json()) as BrainRerankResponse;
        return data.ranked;
      } finally {
        clearTimeout(timer);
      }
    });

    const byId = new Map(rerankPool.map((c) => [c.id, c]));
    return ranked
      .map((r) => {
        const character = byId.get(r.id);
        if (!character) return null;
        return {
          character,
          score: r.score,
          reason: r.score > 0.35 ? 'Closely matches what you described' : 'Related to what you described',
        };
      })
      .filter((r): r is RecommendationResult => r !== null)
      .slice(0, limit);
  } catch (err) {
    logger.warn('recommendCharacters: brain service unavailable, falling back to keyword ranking', {
      error: err instanceof Error ? err.message : String(err),
    });
    return keywordFallbackRank(query, candidates).slice(0, limit);
  }
}
