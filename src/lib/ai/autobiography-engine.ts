/**
 * Autobiography Engine — Vantrix
 *
 * Public entry point for the memory-consolidation → timeline →
 * life-story chain (see memory-consolidation.ts's header for the full
 * picture) — same facade role cognition-engine.ts plays for
 * src/lib/cognition/ and belief-engine.ts plays for the belief
 * submodules: callers outside this small group of files should import
 * from here, not reach into consolidateMemories/buildTimeline/
 * deriveChapters directly, so the pipeline order (consolidate → build
 * timeline → derive chapters) can't be accidentally run out of order or
 * partially skipped from a call site.
 *
 *   memory-consolidation.ts               — merges repetitive raw memories
 *   timeline-engine.ts                    — orders everything chronologically
 *   life-story.ts                         — segments into narrative chapters
 *   autobiography-engine.ts   (this file) — orchestration + cadence gate
 *
 * Best path for a caller wiring this up: fetch raw MemoryNodes
 * (memory-graph.ts), a RelationshipHistoryEntry[] (relationship-
 * history-engine.ts), and canon KnowledgeEntry[] (knowledge-library.ts)
 * the normal way each of those modules already reads them, then call
 * generateAutobiography() once with all three. This module does not
 * fetch anything itself — same read/write separation relationship-
 * history-engine.ts documents (it aggregates, it never reads its own
 * sources' tables directly beyond what's passed in).
 *
 * Cadence-gated the same way backstory-engine.ts gates canon expansion:
 * a character's life story shouldn't visibly re-shuffle every turn, so
 * shouldRegenerate() below caps how often a caller should bother
 * re-running the full pipeline. Unlike backstory-engine.ts this module
 * has no LLM/moderation step of its own — chapters are already
 * prompt-ready bullet summaries (life-story.ts's narrativeSummary). If a
 * caller wants flowing first-person prose instead of bullets, that's an
 * LLM call over formatAutobiographyForPrompt()'s output, done the same
 * way backstory-engine.ts calls OpenRouter and gates the result through
 * moderateCharacter() — deliberately left to the caller rather than
 * duplicated here, since only the caller knows whether this is a
 * character-global narration (canon-safe) or user-facing (needs the
 * same per-user privacy boundary backstory-engine.ts's header warns
 * about).
 */

import { logger } from '@/lib/logger';
import { redis } from '@/lib/redis';
import { consolidateMemories } from '@/lib/ai/memory-consolidation';
import { buildTimeline, type TimelineEntry, type TimelineInputs } from '@/lib/ai/timeline-engine';
import { deriveChapters, formatLifeStoryForPrompt, type LifeChapter } from '@/lib/ai/life-story';
import type { MemoryNode } from '@/lib/ai/memory-graph';
import type { RelationshipHistoryEntry } from '@/lib/ai/relationship-history-engine';
import type { KnowledgeEntry } from '@/lib/ai/knowledge-library';

export type { ConsolidatedMemory } from '@/lib/ai/memory-consolidation';
export { consolidateMemories, formatConsolidatedForPrompt } from '@/lib/ai/memory-consolidation';
export type { TimelineEntry, TimelineSource, TimelineInputs } from '@/lib/ai/timeline-engine';
export { buildTimeline, getTimelineWindow, getTopEntries, formatTimelineForPrompt } from '@/lib/ai/timeline-engine';
export type { LifeChapter } from '@/lib/ai/life-story';
export { deriveChapters, formatLifeStoryForPrompt } from '@/lib/ai/life-story';

// ── Types ───────────────────────────────────────────────────────────────

export interface AutobiographyInputs {
  memoryNodes?: MemoryNode[];
  relationshipHistory?: RelationshipHistoryEntry[];
  canon?: KnowledgeEntry[];
}

export interface Autobiography {
  userId: string;
  characterId: string;
  chapters: LifeChapter[];
  timeline: TimelineEntry[];
  /** Short single-line framing, e.g. the most significant chapter's
   *  summary — for callers that only have room for one line. */
  headline: string;
  generatedAt: string;
}

// Same cadence class as backstory-engine.ts's MIN_DAYS_BETWEEN_EXPANSIONS,
// but far shorter — this is a cheap recompute over already-fetched data,
// not an LLM generation call, so there's no cost reason to space it out
// as much; the only reason to gate it at all is to avoid a chapter list
// visibly reshuffling turn to turn on borderline entries.
export const MIN_HOURS_BETWEEN_REGENERATIONS = 6;

// ── Orchestration ─────────────────────────────────────────────────────────

/**
 * Run the full consolidate → timeline → chapters pipeline. Safe to call
 * as often as a caller likes correctness-wise (it's pure computation
 * over its inputs) — shouldRegenerate() below is about UX stability,
 * not correctness or cost.
 */
export function generateAutobiography(
  userId: string,
  characterId: string,
  inputs: AutobiographyInputs,
): Autobiography {
  const consolidated = consolidateMemories(inputs.memoryNodes ?? []);

  const timelineInputs: TimelineInputs = {
    consolidatedMemories: consolidated,
    relationshipHistory: inputs.relationshipHistory,
    canon: inputs.canon,
  };
  const timeline = buildTimeline(timelineInputs);
  const chapters = deriveChapters(timeline);

  const topChapter = [...chapters].sort(
    (a, b) => b.entries.reduce((s, e) => s + e.significance, 0) - a.entries.reduce((s, e) => s + e.significance, 0),
  )[0];

  const autobiography: Autobiography = {
    userId,
    characterId,
    chapters,
    timeline,
    headline: topChapter?.narrativeSummary ?? '',
    generatedAt: new Date().toISOString(),
  };

  logger.debug('[autobiography-engine] generated', {
    userId, characterId, chapters: chapters.length, timelineEntries: timeline.length,
  });

  return autobiography;
}

/**
 * Whether enough time has passed since the last generation to bother
 * re-running the pipeline. `lastGeneratedAt` is owned by the caller
 * (e.g. cached alongside the prior Autobiography, or a column the
 * caller maintains) — this module keeps no state of its own, matching
 * the rest of the chain's pure/no-I/O design.
 */
export function shouldRegenerate(lastGeneratedAt: string | null): boolean {
  if (!lastGeneratedAt) return true;
  const elapsedMs = Date.now() - Date.parse(lastGeneratedAt);
  return elapsedMs >= MIN_HOURS_BETWEEN_REGENERATIONS * 60 * 60 * 1000;
}

// ── Persistent cadence cache ──────────────────────────────────────────────
//
// shouldRegenerate() above is pure — it just compares a timestamp the
// caller supplies. Without somewhere to durably store that timestamp
// between requests, every call site would end up passing `null` and the
// gate would never actually gate anything (this was the case until now:
// the module was called at most once per process, so there was nothing to
// gate against). Cache the whole formatted result, not just the
// timestamp, so a cache hit skips recomputation entirely rather than just
// skipping the "is it time yet" check.
//
// TTL is set generously above MIN_HOURS_BETWEEN_REGENERATIONS so a cache
// entry naturally expires a little after it would have been eligible for
// regeneration anyway — Redis eviction backs up shouldRegenerate()'s own
// time check rather than replacing it.
const CACHE_TTL_SECONDS = (MIN_HOURS_BETWEEN_REGENERATIONS + 6) * 60 * 60;

interface CachedAutobiography {
  prompt: string;
  generatedAt: string;
}

function cacheKey(userId: string, characterId: string): string {
  return `autobiography:${userId}:${characterId}`;
}

/**
 * Read the cached, pre-formatted autobiography prompt for this user/
 * character pair, if one exists and doesn't need regenerating yet per
 * shouldRegenerate(). Returns null on a cache miss OR when it's time to
 * regenerate — callers don't need to call shouldRegenerate() separately.
 * Fails open (returns null) on any Redis error so a cache outage just
 * means "regenerate this turn" rather than breaking the chain.
 */
export async function getCachedAutobiographyPrompt(
  userId: string,
  characterId: string,
): Promise<string | null> {
  try {
    const cached = await redis.get<CachedAutobiography>(cacheKey(userId, characterId));
    if (!cached) return null;
    if (shouldRegenerate(cached.generatedAt)) return null;
    return cached.prompt;
  } catch (err) {
    logger.warn('[autobiography-engine] cache read failed', { error: String(err) });
    return null;
  }
}

/** Persist a freshly generated autobiography's formatted prompt + timestamp. */
export async function setCachedAutobiographyPrompt(
  userId: string,
  characterId: string,
  prompt: string,
  generatedAt: string,
): Promise<void> {
  try {
    await redis.set(cacheKey(userId, characterId), { prompt, generatedAt } satisfies CachedAutobiography, {
      ex: CACHE_TTL_SECONDS,
    });
  } catch (err) {
    logger.warn('[autobiography-engine] cache write failed', { error: String(err) });
  }
}

export function formatAutobiographyForPrompt(autobiography: Autobiography): string {
  const body = formatLifeStoryForPrompt(autobiography.chapters);
  return body ? `Her life story so far:\n${body}` : '';
}
