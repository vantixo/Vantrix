/**
 * Memory Arbiter — single canonical owner for "what's true when memories
 * disagree"
 * ───────────────────────────────────────────────────────────────────────────
 * There are 7 memory-related modules under lib/ai/, and none of them owns
 * conflict resolution:
 *
 *   memory.ts                 — Redis fact strings (regex + AI extraction)
 *   user-fact-graph.ts         — Supabase typed UserFact rows (regex + AI)
 *   memory-graph.ts            — Supabase MemoryNode events (moments, not facts)
 *   priority-memory.ts         — derived cache promoted FROM the two above
 *   character-seed-memory.ts   — creator-authored, static, per-character
 *   memory-compressor.ts       — pure prompt-budget trimming of memory.ts's output
 *   memory-consolidation.ts    — pure folding of memory-graph.ts's events
 *
 * memory.ts and user-fact-graph.ts in particular extract overlapping,
 * independently-sourced facts about the same user from the same
 * conversation (memory.ts: "User occupation: teacher"; user-fact-graph.ts:
 * category 'work', value "works as a nurse") with no shared key space, no
 * recency reconciliation, and no check for contradiction — both get
 * formatted and injected into the same system prompt via their own
 * format*ForPrompt(), independently, at independent call sites. If they
 * disagree, the model sees both statements with no signal about which is
 * current, and duplicate-but-differently-worded facts double up in the
 * token budget instead of being recognized as the same fact.
 *
 * This module is NOT a new storage layer. It owns zero tables and changes
 * no existing writer. It is a read-time arbitration pass: call
 * getCanonicalMemoryContext() instead of calling formatMemoryForPrompt() /
 * formatFactGraphForPrompt() / formatSeedMemoriesForPrompt() separately, and
 * it fetches from all three, normalizes them into one comparable shape,
 * resolves conflicts by an explicit precedence order, and returns a single
 * deduplicated block plus a structured conflict log (for observability —
 * NOT injected into the prompt; the model should never see "you have
 * conflicting information").
 *
 * Precedence, most authoritative first (ties broken by this order, not by
 * whichever happened to be fetched first):
 *   1. character_seed_memories — creator-authored, deliberately static;
 *      always wins for identity/backstory-shaped facts about the CHARACTER.
 *      (Out of scope for this module otherwise — seed memories are about
 *      the character, not the user, so they never actually collide with
 *      the user-fact sources below; included here so callers have one
 *      function to call instead of three, per the module's actual purpose.)
 *   2. user-fact-graph.ts (UserFact) — structured, categorized, has its own
 *      confidence score AND a real `learnedAt`/`lastUsed` timestamp, which
 *      memory.ts's flat strings don't reliably carry through to the prompt
 *      layer. Treated as more trustworthy than memory.ts at equal apparent
 *      topic, because it's purpose-built for this and versioned per-fact.
 *   3. memory.ts (MemoryFact) — legacy flat fact store. Still authoritative
 *      for anything user-fact-graph.ts's fixed category set doesn't cover
 *      (e.g. a bare name extraction), but yields to (2) on overlap.
 *
 * "Overlap" is detected by a coarse topic key (see topicKeyFor* below) —
 * this is deliberately conservative (string/keyword based, not semantic)
 * so it only merges things that are actually about the same narrow topic
 * (e.g. "occupation") rather than risking silently dropping two genuinely
 * different facts that happen to share a word.
 */

import { logger } from '@/lib/logger';
import { getMemory, type MemoryFact } from '@/lib/ai/memory';
import { getFactGraph, type UserFact, type FactCategory } from '@/lib/ai/user-fact-graph';
import { getCharacterSeedMemories, type CharacterSeedMemory } from '@/lib/ai/character-seed-memory';

// ── Normalized shape both sources get mapped into for comparison ─────────

interface NormalizedFact {
  /** Coarse topic bucket used to detect overlap — see topicKeyFor*(). */
  topicKey: string;
  text: string;
  confidence: number; // 0-1, already on a comparable scale for both sources
  timestampMs: number;
  precedence: 1 | 2; // 1 = user-fact-graph, 2 = memory.ts — lower wins ties
  origin: 'user-fact-graph' | 'legacy-memory';
}

export interface MemoryConflict {
  topicKey: string;
  kept: string;
  discarded: string[];
  reason: 'higher-precedence-source' | 'higher-confidence' | 'more-recent';
}

export interface CanonicalMemoryContext {
  /** Ready-to-inject prompt block — seed memories + arbitrated user facts combined. */
  promptBlock: string;
  /**
   * Arbitrated user-facts only, no seed memories — for callers (route.ts)
   * that already inject seed memories separately via
   * formatSeedMemoriesForPrompt() and would otherwise double them up.
   */
  factsPromptBlock: string;
  /** Structured, for logging/admin/debugging — never inject this. */
  conflicts: MemoryConflict[];
  factCount: number;
}

// A small set of category → topic-key mappings for user-fact-graph.ts's
// structured categories, so e.g. 'work' facts always collide with
// memory.ts's "User occupation:" facts regardless of exact wording.
const CATEGORY_TOPIC_KEY: Partial<Record<FactCategory, string>> = {
  work: 'occupation',
  location: 'location',
  family: 'family',
};

// Mirrors memory.ts's own label prefixes (see LABEL_ABBREV in
// memory-compressor.ts and the NAME_RE/WORK_RE/etc. extractors in
// memory.ts) — the only reliable signal memory.ts's flat strings carry
// about their own topic is this label prefix.
const LEGACY_LABEL_TOPIC_KEY: Record<string, string> = {
  "user's name": 'name',
  'user occupation': 'occupation',
  'user location': 'location',
  'user preference': 'preference',
  'user fact': 'general',
};

function topicKeyForUserFact(fact: UserFact): string {
  return CATEGORY_TOPIC_KEY[fact.category] ?? `category:${fact.category}:${fact.key}`;
}

function topicKeyForLegacyFact(text: string): string {
  const [label] = text.split(':');
  const key = LEGACY_LABEL_TOPIC_KEY[label?.trim().toLowerCase() ?? ''];
  // Facts without a recognized label prefix (shouldn't normally happen —
  // every heuristicExtract()/aiExtract() output in memory.ts is
  // "Label: value") are each their own topic, so they never accidentally
  // collide with something unrelated.
  return key ?? `legacy-unlabeled:${text}`;
}

function normalizeUserFacts(facts: UserFact[]): NormalizedFact[] {
  return facts.map((f) => ({
    topicKey: topicKeyForUserFact(f),
    text: `${f.category}: ${f.value}`,
    confidence: f.confidence,
    timestampMs: Date.parse(f.lastUsed ?? f.learnedAt) || 0,
    precedence: 1,
    origin: 'user-fact-graph',
  }));
}

function normalizeLegacyFacts(facts: MemoryFact[]): NormalizedFact[] {
  return facts.map((f) => ({
    topicKey: topicKeyForLegacyFact(f.text),
    text: f.text,
    confidence: f.confidence,
    timestampMs: f.createdAt,
    precedence: 2,
    origin: 'legacy-memory',
  }));
}

/**
 * Resolve overlapping facts down to one winner per topic key.
 *   - Lower `precedence` number always wins regardless of confidence
 *     (user-fact-graph over legacy memory.ts) — see module header.
 *   - Within the same precedence tier, higher confidence wins.
 *   - Ties on confidence go to the more recent timestamp.
 * Non-overlapping facts (unique topicKey) pass through untouched.
 */
function resolveConflicts(all: NormalizedFact[]): { winners: NormalizedFact[]; conflicts: MemoryConflict[] } {
  const byTopic = new Map<string, NormalizedFact[]>();
  for (const f of all) {
    const list = byTopic.get(f.topicKey) ?? [];
    list.push(f);
    byTopic.set(f.topicKey, list);
  }

  const winners: NormalizedFact[] = [];
  const conflicts: MemoryConflict[] = [];

  for (const [topicKey, group] of byTopic) {
    if (group.length === 1) {
      winners.push(group[0]);
      continue;
    }

    const sorted = [...group].sort((a, b) => {
      if (a.precedence !== b.precedence) return a.precedence - b.precedence;
      if (a.confidence !== b.confidence) return b.confidence - a.confidence;
      return b.timestampMs - a.timestampMs;
    });

    const winner = sorted[0];
    const losers = sorted.slice(1).filter((l) => l.text !== winner.text);
    winners.push(winner);

    if (losers.length) {
      const reason: MemoryConflict['reason'] =
        losers.some((l) => l.precedence !== winner.precedence)
          ? 'higher-precedence-source'
          : losers.some((l) => l.confidence !== winner.confidence)
            ? 'higher-confidence'
            : 'more-recent';
      conflicts.push({
        topicKey,
        kept: winner.text,
        discarded: losers.map((l) => l.text),
        reason,
      });
    }
  }

  return { winners, conflicts };
}

function formatSeedBlock(memories: CharacterSeedMemory[]): string {
  if (!memories.length) return '';
  const sorted = [...memories].sort((a, b) => b.importance - a.importance);
  const lines = sorted.map((m) => `- ${m.headline}: ${m.content.slice(0, 200)}`);
  return `── Foundational Memories (true in every conversation) ──\n${lines.join('\n')}`;
}

function formatUserFactsBlock(facts: NormalizedFact[]): string {
  if (!facts.length) return '';
  const sorted = [...facts].sort((a, b) => b.confidence - a.confidence).slice(0, 15);
  const lines = sorted.map((f) => `- ${f.text}`);
  return `What you know about this user:\n${lines.join('\n')}`;
}

/**
 * Pure arbitration over already-fetched data — no I/O. Callers that already
 * hold memory.ts/user-fact-graph.ts/seed-memory results (e.g.
 * companion-context.ts, which fetches all three in its own Promise.all)
 * should use this directly instead of arbitrateAndFetch() below, to avoid
 * re-fetching the same three sources a second time per turn.
 */
export function arbitrateMemoryContext(
  legacyFacts: MemoryFact[],
  structuredFacts: UserFact[],
  seedMemories: CharacterSeedMemory[],
  logCtx?: { userId: string; characterId: string },
): CanonicalMemoryContext {
  const normalized = [...normalizeUserFacts(structuredFacts), ...normalizeLegacyFacts(legacyFacts)];
  const { winners, conflicts } = resolveConflicts(normalized);

  if (conflicts.length && logCtx) {
    logger.info('memory-arbiter: resolved conflicting facts', { ...logCtx, conflicts });
  }

  const seedBlock = formatSeedBlock(seedMemories);
  const factsBlock = formatUserFactsBlock(winners);
  const combined = [seedBlock, factsBlock].filter(Boolean);

  return {
    promptBlock: combined.length ? `\n${combined.join('\n\n')}` : '',
    factsPromptBlock: factsBlock ? `\n${factsBlock}` : '',
    conflicts,
    factCount: winners.length,
  };
}

/**
 * Convenience wrapper for call sites that do NOT already have
 * legacy/structured/seed facts in hand. Fetches all three sources
 * independently (fail-open per source — a failed fetch contributes nothing
 * rather than failing the whole call, same tolerance model as
 * unified-mind.ts's getUnifiedMind()) and arbitrates them.
 *
 * Prefer arbitrateMemoryContext() directly when the caller already fetched
 * these three (companion-context.ts does) — calling this instead would
 * silently duplicate those fetches.
 */
export async function getCanonicalMemoryContext(
  userId: string,
  characterId: string,
): Promise<CanonicalMemoryContext> {
  const [legacyFacts, structuredFacts, seedMemories] = await Promise.all([
    getMemory(userId, characterId).catch((err) => {
      logger.warn('memory-arbiter: getMemory failed', { userId, characterId, error: String(err) });
      return [] as MemoryFact[];
    }),
    getFactGraph(userId, characterId).catch((err) => {
      logger.warn('memory-arbiter: getFactGraph failed', { userId, characterId, error: String(err) });
      return [] as UserFact[];
    }),
    getCharacterSeedMemories(characterId).catch((err) => {
      logger.warn('memory-arbiter: getCharacterSeedMemories failed', { characterId, error: String(err) });
      return [] as CharacterSeedMemory[];
    }),
  ]);

  return arbitrateMemoryContext(legacyFacts, structuredFacts, seedMemories, { userId, characterId });
}
