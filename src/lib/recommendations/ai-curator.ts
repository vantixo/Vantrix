/**
 * AI Curator — LLM-driven final pass over the deterministic recommendation
 * shortlist.
 *
 * Why this sits on top of scoreCandidatesForDiscover() rather than
 * replacing it: the formula-based scorer (content/popularity/recency/
 * exploration) is cheap, deterministic, and already narrows a 150-character
 * pool down to a small, genuinely-relevant shortlist. An LLM call over the
 * full pool would be slow, expensive, and mostly spent re-discovering
 * relevance the formula already found for free. What the formula CAN'T do
 * is read the *shape* of the shortlist the way a person would — notice it's
 * accidentally five variations on the same archetype back to back, write a
 * one-line reason a human would actually find persuasive ("her stubborn
 * streak matches the characters you keep coming back to" vs. a bare
 * "Popular" badge), or nudge the top slot toward whichever candidate best
 * fits the user's evident taste *today*. That's the curator's whole job:
 * re-order a pre-vetted shortlist and caption it, never invent candidates.
 *
 * Guardrails, deliberately conservative (same posture as content-generator.ts):
 *   - Only ever reorders + annotates IDs it was given. The prompt asks for
 *     a permutation of the input ID list, and the response is validated as
 *     exactly that set before use — any hallucinated/missing/duplicate ID
 *     and the whole result is discarded in favor of the deterministic order.
 *   - Redis-cached per user (CURATOR_TTL) so this runs at most once per
 *     window per user, not on every page load.
 *   - Hard daily call budget shared across users, tracked in Redis — once
 *     exhausted, curate() returns the input order unchanged with no reasons
 *     rather than blocking or throwing.
 *   - Every failure mode (budget exhausted, provider error, malformed JSON,
 *     invalid permutation, timeout) degrades silently to the deterministic
 *     order that was already computed and already good. The AI layer can
 *     only improve the result, never break it.
 */

import { routeCompletion } from '@/lib/ai/provider-router';
import { redis }           from '@/lib/redis';
import { logger }          from '@/lib/logger';
import { env }             from '@/env';

const DAILY_CALL_BUDGET = Number(env.CURATOR_DAILY_AI_CALLS ?? 600);
const BUDGET_KEY_PREFIX  = 'ai-curator:budget';
const CURATOR_TTL        = 60 * 60 * 6; // 6h — long enough to avoid re-curating every page load, short enough to react to new likes/chats same day
const MAX_CANDIDATES     = 24;          // cap on how many shortlist items get sent to the LLM per call — keeps prompt small/cheap
const MAX_TASTE_TAGS     = 8;

function todayKey(): string {
  const d = new Date();
  return `${BUDGET_KEY_PREFIX}:${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

async function reserveBudget(): Promise<boolean> {
  try {
    const count = await redis.incr(todayKey());
    if (count === 1) await redis.expire(todayKey(), 60 * 60 * 26);
    return count <= DAILY_CALL_BUDGET;
  } catch (err) {
    logger.warn('[ai-curator] budget-check-failed, skipping curation', { error: String(err) });
    return false;
  }
}

export interface CuratorCandidate {
  id:         string;
  name:       string;
  archetype:  string | null;
  tags:       string[] | null;
  opening_line: string | null;
}

export interface CuratedResult {
  /** Same IDs as the input, reordered. */
  orderedIds: string[];
  /** id → short display reason ("matches your taste for witty banter"), best-effort — may be a partial map. */
  reasons: Map<string, string>;
  /** false when the deterministic order was returned unchanged (budget/cache-miss-with-failure/etc). */
  wasCurated: boolean;
}

function cacheKey(userId: string, candidateIdsHash: string): string {
  return `ai-curator:v1:${userId}:${candidateIdsHash}`;
}

// Cheap order-independent hash so the cache key changes when the shortlist
// composition changes (new characters rotated in) but not when only the
// order changes — order is exactly what we're asking the LLM to decide,
// so it shouldn't invalidate its own cache entry.
function hashIds(ids: string[]): string {
  const sorted = [...ids].sort();
  let h = 0;
  for (const id of sorted.join('|')) h = (h * 31 + id.charCodeAt(0)) | 0;
  return Math.abs(h).toString(36);
}

function topTasteTags(tagWeights: Map<string, number>, limit: number): string[] {
  return [...tagWeights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag]) => tag.replace(/^archetype:/, ''));
}

interface CuratorLLMResponse {
  order: { id: string; reason?: string }[];
}

function parseCuratorResponse(raw: string): CuratorLLMResponse | null {
  try {
    // Models occasionally wrap JSON in a code fence despite instructions not
    // to — strip it defensively rather than failing the whole curation pass.
    const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
    const parsed = JSON.parse(cleaned);
    if (!parsed || !Array.isArray(parsed.order)) return null;
    return parsed as CuratorLLMResponse;
  } catch {
    return null;
  }
}

/**
 * Re-rank a pre-scored shortlist and attach short display reasons.
 *
 * `candidates` should already be in the deterministic scorer's order (best
 * first) — that order is both the fallback and the prior the LLM is nudging,
 * not a random pool.
 */
export async function curateForUser(
  userId: string,
  candidates: CuratorCandidate[],
  tagWeights: Map<string, number>,
): Promise<CuratedResult> {
  const deterministicOrder = candidates.map(c => c.id);
  const fallback: CuratedResult = { orderedIds: deterministicOrder, reasons: new Map(), wasCurated: false };

  if (candidates.length < 3) return fallback; // not enough to meaningfully reorder

  const shortlist = candidates.slice(0, MAX_CANDIDATES);
  const key = cacheKey(userId, hashIds(shortlist.map(c => c.id)));

  try {
    const cached = await redis.get<string>(key);
    if (cached) {
      const parsed = parseCuratorResponse(cached);
      if (parsed) {
        const result = applyCuration(shortlist, deterministicOrder, parsed);
        if (result) return result;
      }
    }
  } catch (err) {
    logger.warn('[ai-curator] cache-read-failed', { userId, error: String(err) });
  }

  if (!(await reserveBudget())) return fallback;

  const tasteTags = topTasteTags(tagWeights, MAX_TASTE_TAGS);

  const system = [
    'You are a companion-recommendation curator for an AI character chat app.',
    'You will be given a shortlist of already-vetted, already-relevant characters (do not question whether they belong — they do) and a brief summary of what this user tends to enjoy.',
    'Your only job: return the shortlist reordered so the character most likely to genuinely appeal to this user right now comes first, and write one short, natural, specific reason (under 8 words, no hashtags, no emojis, sentence case, no trailing period) for each of the top 6.',
    'Respond with ONLY minified JSON, no prose, no code fences, in exactly this shape:',
    '{"order":[{"id":"<id>","reason":"<short reason, top 6 only>"},{"id":"<id>"}]}',
    'The "order" array MUST contain every id from the input list exactly once, no more, no fewer, no invented ids.',
  ].join(' ');

  const userPrompt = JSON.stringify({
    userTaste: tasteTags.length ? tasteTags : 'no strong signal yet — use general appeal and variety',
    shortlist: shortlist.map(c => ({
      id: c.id,
      name: c.name,
      archetype: c.archetype,
      tags: (c.tags ?? []).slice(0, 5),
      opener: c.opening_line ? c.opening_line.slice(0, 80) : null,
    })),
  });

  try {
    const result = await routeCompletion({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userPrompt },
      ],
      modelTier:   'NANO',
      maxTokens:   500,
      temperature: 0.4,
      userId,
    });

    const parsed = parseCuratorResponse(result.reply);
    if (!parsed) {
      logger.warn('[ai-curator] malformed-response', { userId });
      return fallback;
    }

    const curated = applyCuration(shortlist, deterministicOrder, parsed);
    if (!curated) {
      logger.warn('[ai-curator] invalid-permutation, using deterministic order', { userId });
      return fallback;
    }

    try {
      await redis.set(key, JSON.stringify(parsed), { ex: CURATOR_TTL });
    } catch (err) {
      logger.warn('[ai-curator] cache-write-failed', { userId, error: String(err) });
    }

    return curated;
  } catch (err) {
    logger.warn('[ai-curator] completion-failed', { userId, error: String(err) });
    return fallback;
  }
}

/**
 * Validates the LLM's proposed order is a genuine permutation of the
 * shortlist's ids (same set, no additions/omissions/duplicates) before
 * trusting it. Characters beyond the shortlist (page 2+ of the original
 * candidates array, if any) are appended after in their original order —
 * the LLM never saw them and shouldn't be assumed to have opinions about
 * where they'd rank.
 */
function applyCuration(
  shortlist: CuratorCandidate[],
  fullDeterministicOrder: string[],
  parsed: CuratorLLMResponse,
): CuratedResult | null {
  const shortlistIds = new Set(shortlist.map(c => c.id));
  const proposedIds = parsed.order.map(o => o.id);

  const proposedSet = new Set(proposedIds);
  const isValidPermutation =
    proposedIds.length === shortlistIds.size &&
    proposedSet.size === proposedIds.length &&
    [...shortlistIds].every(id => proposedSet.has(id));

  if (!isValidPermutation) return null;

  const remainder = fullDeterministicOrder.filter(id => !shortlistIds.has(id));
  const reasons = new Map<string, string>();
  for (const entry of parsed.order) {
    if (entry.reason && typeof entry.reason === 'string' && entry.reason.trim()) {
      reasons.set(entry.id, entry.reason.trim().slice(0, 60));
    }
  }

  return { orderedIds: [...proposedIds, ...remainder], reasons, wasCurated: true };
}
