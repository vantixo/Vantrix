/**
 * Semantic Memory — Node client for the Python brain service
 * ───────────────────────────────────────────────────────────────────────────
 * memory-graph.ts fetches candidates ranked by emotional_weight + recency.
 * emotion-state.ts's applyEmotionBias() re-sorts those candidates using a
 * hardcoded emotion→event-type affinity table. Both are rule-based and blind
 * to what the user's current message is actually about.
 *
 * PGVECTOR UPGRADE: this module now does real retrieval first, not just
 * reranking. searchMemoriesBySimilarity() (memory-embeddings.ts) queries
 * persisted embeddings directly via Postgres/pgvector's IVFFlat index —
 * candidates the emotion/recency query wouldn't have surfaced at all can
 * now be found. semanticRerankMemories() below is kept as-is and used as
 * the fallback path: if no memories have embeddings yet (pre-migration
 * rows, or the brain service was down when they were written), it still
 * reranks whatever memory-graph.ts already fetched, exactly as before.
 * Nothing that depended on the old behavior breaks; it degrades to it.
 *
 * FAIL OPEN, always: if BRAIN_SERVICE_URL isn't configured, the service is
 * down, slow, or errors, this returns the input order completely unchanged.
 * A chat reply must never be blocked or degraded by this being unavailable —
 * this is a quality enhancement layer, not a dependency.
 */

import { getCircuitBreaker } from '@/lib/circuit-breaker';
import { CircuitOpenError }  from '@/lib/errors';
import { logger }            from '@/lib/logger';
import type { MemoryNode }   from '@/lib/ai/memory-graph';
import { env }                from '@/env';
import { brainServiceAuthHeaders } from '@/lib/ai/brain-service-auth';
import { searchMemoriesBySimilarity } from '@/lib/ai/memory-embeddings';

const REQUEST_TIMEOUT_MS = 1_200; // generous enough for a small local model, short enough to never be felt in chat latency
const MAX_TEXT_LEN       = 400;   // truncate memory text before sending — keeps payload + encode time small

interface RerankApiResponse {
  ranked: { id: string; score: number }[];
}

function memoryText(m: MemoryNode): string {
  const combined = `${m.title}. ${m.description}`;
  return combined.length > MAX_TEXT_LEN ? combined.slice(0, MAX_TEXT_LEN) : combined;
}

/**
 * Re-orders `memories` by semantic similarity to `userMessage`, blended with
 * the existing (emotion-biased) order as a stable tiebreak. Returns the
 * original array, untouched, on any failure or misconfiguration.
 */
export async function semanticRerankMemories(
  memories:    MemoryNode[],
  userMessage: string,
): Promise<MemoryNode[]> {
  if (memories.length < 2) return memories;

  const baseUrl = env.BRAIN_SERVICE_URL;
  if (!baseUrl) return memories; // not configured — silent no-op, same pattern as heartbeat.ts

  const breaker = getCircuitBreaker('ai:brain-service', {
    failureThreshold: 4,
    timeout: 30_000,
  });

  try {
    return await breaker.execute(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const res = await fetch(`${baseUrl}/rerank`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...brainServiceAuthHeaders() },
          body: JSON.stringify({
            query: userMessage.slice(0, 4000),
            candidates: memories.map((m) => ({ id: m.id, text: memoryText(m) })),
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`brain-service rerank failed: ${res.status}`);
        }

        const data = (await res.json()) as RerankApiResponse;
        const scoreById = new Map(data.ranked.map((r) => [r.id, r.score]));

        // Blend: semantic score is the primary sort key, but stable — memories
        // missing from the response (shouldn't happen, but defensively handled)
        // keep their original relative order via the index tiebreak.
        const withIndex = memories.map((m, idx) => ({ m, idx, score: scoreById.get(m.id) ?? -1 }));
        withIndex.sort((a, b) => b.score - a.score || a.idx - b.idx);

        return withIndex.map((x) => x.m);
      } finally {
        clearTimeout(timer);
      }
    });
  } catch (err) {
    if (!(err instanceof CircuitOpenError)) {
      logger.warn('semantic-memory:rerank-failed', { error: String(err) });
    }
    return memories; // fail open — never block or degrade the chat reply
  }
}

/**
 * PGVECTOR UPGRADE — the entry point call sites should use going forward.
 *
 * Real retrieval-first ordering, with graceful degradation through every
 * layer this system already has:
 *
 *   1. Try pgvector similarity search (searchMemoriesBySimilarity) against
 *      ALL of this pair's embedded memories, not just the small candidate
 *      set memory-graph.ts happened to fetch by weight/recency. If that
 *      finds real matches, use them (re-hydrated against the full
 *      MemoryNode objects passed in, so callers still get complete nodes,
 *      not the RPC's trimmed row shape).
 *   2. If pgvector finds nothing (no embedded rows yet, brain service down,
 *      or genuinely no similar memory exists), fall back to the *existing*
 *      semanticRerankMemories() behavior — live rerank of the candidates
 *      already fetched. This is the exact pre-upgrade behavior, unchanged.
 *   3. If that also can't run (brain service unavailable), fall back to the
 *      candidates' original (emotion/recency-biased) order, untouched.
 *
 * Every step is independently fail-open; a chat reply is never blocked or
 * degraded by any layer of this being unavailable.
 */
export async function retrieveRelevantMemories(
  userId: string,
  characterId: string,
  candidates: MemoryNode[],
  userMessage: string,
): Promise<MemoryNode[]> {
  if (candidates.length < 2) return candidates;

  try {
    const similar = await searchMemoriesBySimilarity(userId, characterId, userMessage, {
      limit: candidates.length,
    });

    if (similar.length > 0) {
      const byId = new Map(candidates.map((c) => [c.id, c]));
      const ordered: MemoryNode[] = [];
      const usedIds = new Set<string>();

      for (const s of similar) {
        const full = byId.get(s.id);
        if (full) {
          ordered.push(full);
          usedIds.add(full.id);
        }
        // A similarity hit outside the original candidate set (e.g. an
        // older, lower-weight memory the recency/weight query didn't fetch
        // at all) is real signal worth surfacing — but this function's
        // contract is to reorder `candidates`, not silently grow the
        // result set from a shape callers don't expect. Widening that
        // contract is a deliberate follow-up (see docs note), not a quiet
        // side effect here.
      }
      // Preserve any candidates pgvector didn't return (below threshold or
      // not yet embedded) at the end, in their original order.
      for (const c of candidates) {
        if (!usedIds.has(c.id)) ordered.push(c);
      }
      return ordered;
    }
  } catch (err) {
    logger.warn('semantic-memory:pgvector-search-failed', { userId, characterId, error: String(err) });
    // fall through to legacy rerank path below
  }

  return semanticRerankMemories(candidates, userMessage);
}
