/**
 * Experience Engine — Vantrix Cognition Layer
 *
 * The base of a three-layer chain that sits above ordinary working
 * memory: experience-engine.ts (this file) logs discrete episodic
 * moments → lesson-engine.ts finds patterns across them → wisdom-engine.ts
 * distills the durable, cross-session principles those patterns support.
 *
 *   experience-engine.ts   (this file) — raw episodic log, per-turn
 *   lesson-engine.ts                   — pattern extraction over the log
 *   wisdom-engine.ts                   — durable, decaying synthesis of lessons
 *
 * working-memory.ts already covers "what's salient right now" and decays
 * hard within a session (DECAY_RATE 0.15, evicted below 0.05). This module
 * is deliberately not that: an ExperienceRecord is a small, already-summarized
 * fact about how a turn went ("she went quiet after a joke about her job"),
 * kept for the lifetime of the process specifically so lesson-engine.ts has
 * enough history to find repeats that a single session's working memory
 * would have already evicted by the time the pattern would show up again.
 *
 * Like working-memory.ts and belief-store.ts's in-process callers, this is
 * kept in-memory (Map, not Supabase) — same lossy-on-restart tradeoff as
 * working-memory.ts, chosen because the log is an input to further
 * computation (lesson-engine.ts), not itself a durable record. Anything
 * that survives lesson/wisdom synthesis is what's worth persisting, and
 * that's wisdom-engine.ts's job, not this one's.
 */

import { logger } from '@/lib/logger';

// ── Types ───────────────────────────────────────────────────────────────

export type ExperienceCategory =
  | 'gift'          // gift-engine.ts / gift-shop.tsx moments
  | 'conflict'      // repair-engine.ts / trust-repair-engine.ts territory
  | 'vulnerability'  // vulnerability-engine.ts territory
  | 'humor'
  | 'plan'          // a plan/commitment made or kept/broken
  | 'affection'
  | 'other';

export type ExperienceOutcome = 'positive' | 'negative' | 'neutral';

export interface ExperienceRecord {
  id: string;
  turn: number;
  category: ExperienceCategory;
  /** Short, prompt-ready description of what happened. */
  summary: string;
  /** -1..1, how the moment landed emotionally. */
  valence: number;
  outcome: ExperienceOutcome;
  data?: Record<string, unknown>;
}

interface ExperienceLog {
  userId: string;
  characterId: string;
  turn: number;
  records: ExperienceRecord[];
}

// Deep enough that lesson-engine.ts can find a repeated pattern (3+
// occurrences) without the log itself becoming an unbounded memory leak.
const CAPACITY = 200;

const store = new Map<string, ExperienceLog>();

function key(userId: string, characterId: string): string {
  return `${userId}::${characterId}`;
}

function getLog(userId: string, characterId: string): ExperienceLog {
  const k = key(userId, characterId);
  let log = store.get(k);
  if (!log) {
    log = { userId, characterId, turn: 0, records: [] };
    store.set(k, log);
  }
  return log;
}

// ── Write path ──────────────────────────────────────────────────────────

/**
 * Append one episodic moment to the log. Cheap and synchronous —
 * callers (executive-controller.ts, the domain engines under
 * src/lib/ai/ that already classify a turn's category) are expected to
 * call this inline rather than batching, the same way attention-engine.ts's
 * signals are built up turn by turn.
 */
export function recordExperience(
  userId: string,
  characterId: string,
  turn: number,
  input: Omit<ExperienceRecord, 'id' | 'turn'>,
): ExperienceRecord {
  const log = getLog(userId, characterId);
  log.turn = Math.max(log.turn, turn);

  const record: ExperienceRecord = {
    id: `exp-${userId}-${characterId}-${turn}-${log.records.length}`,
    turn,
    ...input,
  };

  log.records.push(record);
  if (log.records.length > CAPACITY) {
    log.records.splice(0, log.records.length - CAPACITY);
  }

  logger.debug('[cognition/experience-engine] recorded', {
    userId, characterId, turn, category: record.category, outcome: record.outcome,
  });

  return record;
}

// ── Read path ───────────────────────────────────────────────────────────

/**
 * Most recent records, optionally filtered by category. Newest last
 * (matches WorkingMemoryItem/ResolutionNote ordering conventions used
 * elsewhere in this directory).
 */
export function getRecentExperiences(
  userId: string,
  characterId: string,
  opts?: { category?: ExperienceCategory; limit?: number },
): ExperienceRecord[] {
  const log = getLog(userId, characterId);
  const filtered = opts?.category
    ? log.records.filter(r => r.category === opts.category)
    : log.records;
  const limit = opts?.limit ?? filtered.length;
  return filtered.slice(-limit);
}

export function formatExperiencesForPrompt(records: ExperienceRecord[]): string {
  if (records.length === 0) return '';
  return `Recent moments: ${records.map(r => r.summary).join('; ')}`;
}

/** Test/session-reset helper — same shape as resetWorkingMemory / resetPlans. */
export function resetExperiences(userId?: string, characterId?: string): void {
  if (userId && characterId) {
    store.delete(key(userId, characterId));
  } else {
    store.clear();
  }
}
