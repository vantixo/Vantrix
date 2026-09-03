/**
 * Lesson Engine — Vantrix Cognition Layer
 *
 * Middle layer of the experience → lesson → wisdom chain (see
 * experience-engine.ts's header for the full picture). Where
 * experience-engine.ts just logs what happened, this module looks for
 * *repeats*: the same category landing the same way (mostly positive or
 * mostly negative) often enough that it stops being coincidence and
 * starts being a pattern worth stating as a lesson — "gifts land badly
 * when she's stressed" rather than five separate negative gift moments.
 *
 * Split the same way belief-engine.ts splits belief-update.ts out of
 * itself: extractLessons() below is pure pattern-matching over an
 * ExperienceRecord[] (no I/O, easy to unit test, same rationale as
 * belief-update.ts/belief-conflict.ts being pure), while the Map-backed
 * store and reinforcement bookkeeping is the orchestration this file
 * owns directly — there wasn't enough surface area here yet to justify
 * a further split into a lesson-store.ts.
 *
 * A lesson that's been reinforced enough (see PROMOTION_THRESHOLD) is
 * what wisdom-engine.ts looks for when synthesizing durable principles —
 * this module is the gate that keeps a single unlucky evening from
 * becoming permanent "wisdom" about a character.
 */

import { logger } from '@/lib/logger';
import type { ExperienceRecord, ExperienceCategory } from '@/lib/cognition/experience-engine';

// ── Types ───────────────────────────────────────────────────────────────

export interface Lesson {
  id: string;
  category: ExperienceCategory;
  /** Short, prompt-ready generalization, e.g. "vulnerability shared late at night lands better". */
  insight: string;
  /** 0..1, grows with reinforcement, same idea as belief confidence. */
  confidence: number;
  /** How many separate extraction passes have found this same pattern. */
  reinforcements: number;
  lastReinforcedTurn: number;
  sourceExperienceIds: string[];
}

// A pattern needs at least this many like-outcome experiences in one
// extraction pass before it's worth stating as a lesson at all.
const MIN_PATTERN_SIZE = 3;
// Fraction of a category's recent experiences that must share an outcome
// for it to count as a pattern rather than noise.
const PATTERN_AGREEMENT = 0.7;
// Reinforcements needed before wisdom-engine.ts should consider a lesson
// stable enough to draw on.
export const PROMOTION_THRESHOLD = 2;

const store = new Map<string, Map<string, Lesson>>();

function key(userId: string, characterId: string): string {
  return `${userId}::${characterId}`;
}

function getBucket(userId: string, characterId: string): Map<string, Lesson> {
  const k = key(userId, characterId);
  let bucket = store.get(k);
  if (!bucket) {
    bucket = new Map();
    store.set(k, bucket);
  }
  return bucket;
}

// ── Pure pattern extraction ──────────────────────────────────────────────

function insightFor(category: ExperienceCategory, outcome: 'positive' | 'negative'): string {
  const polarity = outcome === 'positive' ? 'tends to land well' : 'tends to land badly';
  const label: Record<ExperienceCategory, string> = {
    gift: 'giving gifts',
    conflict: 'raising conflict directly',
    vulnerability: 'sharing vulnerability',
    humor: 'leaning on humor',
    plan: 'making forward-looking plans',
    affection: 'expressing affection openly',
    other: 'this kind of moment',
  };
  return `${label[category]} ${polarity}`;
}

/**
 * Group experiences by category and flag any category where outcomes
 * agree strongly enough to be a pattern rather than chance. Pure
 * function — callers own persistence (reinforceLesson below).
 */
export function extractLessons(records: ExperienceRecord[]): Array<{
  category: ExperienceCategory;
  outcome: 'positive' | 'negative';
  insight: string;
  sourceExperienceIds: string[];
}> {
  const byCategory = new Map<ExperienceCategory, ExperienceRecord[]>();
  for (const r of records) {
    if (r.outcome === 'neutral') continue;
    const list = byCategory.get(r.category) ?? [];
    list.push(r);
    byCategory.set(r.category, list);
  }

  const found: Array<{
    category: ExperienceCategory;
    outcome: 'positive' | 'negative';
    insight: string;
    sourceExperienceIds: string[];
  }> = [];

  for (const [category, list] of byCategory) {
    if (list.length < MIN_PATTERN_SIZE) continue;

    const positive = list.filter(r => r.outcome === 'positive');
    const negative = list.filter(r => r.outcome === 'negative');
    const dominant = positive.length >= negative.length ? positive : negative;
    const outcome: 'positive' | 'negative' = dominant === positive ? 'positive' : 'negative';

    if (dominant.length / list.length < PATTERN_AGREEMENT) continue;

    found.push({
      category,
      outcome,
      insight: insightFor(category, outcome),
      sourceExperienceIds: dominant.map(r => r.id),
    });
  }

  return found;
}

// ── Reinforcement + read path ────────────────────────────────────────────

/**
 * Run extraction over a fresh window of experiences and fold each found
 * pattern into the stored lesson set — new patterns start at low
 * confidence, repeats of an existing lesson reinforce it. Intended to be
 * called periodically (e.g. alongside reflection-engine.ts's session
 * reflection) rather than every turn, the same cadence belief-engine.ts's
 * runBeliefMaintenance() runs at.
 */
export function reinforceLessons(
  userId: string,
  characterId: string,
  turn: number,
  records: ExperienceRecord[],
): Lesson[] {
  const patterns = extractLessons(records);
  const bucket = getBucket(userId, characterId);
  const touched: Lesson[] = [];

  for (const pattern of patterns) {
    const lessonKey = `${pattern.category}:${pattern.outcome}`;
    const existing = bucket.get(lessonKey);

    if (existing) {
      existing.reinforcements += 1;
      existing.confidence = Math.min(1, existing.confidence + 0.15);
      existing.lastReinforcedTurn = turn;
      existing.sourceExperienceIds = pattern.sourceExperienceIds;
      touched.push(existing);
    } else {
      const lesson: Lesson = {
        id: `lesson-${userId}-${characterId}-${lessonKey}`,
        category: pattern.category,
        insight: pattern.insight,
        confidence: 0.35,
        reinforcements: 1,
        lastReinforcedTurn: turn,
        sourceExperienceIds: pattern.sourceExperienceIds,
      };
      bucket.set(lessonKey, lesson);
      touched.push(lesson);
    }
  }

  logger.debug('[cognition/lesson-engine] reinforced', {
    userId, characterId, turn, patterns: patterns.length,
  });

  return touched;
}

/** All lessons currently stored for this pair, highest confidence first. */
export function getActiveLessons(userId: string, characterId: string): Lesson[] {
  return Array.from(getBucket(userId, characterId).values())
    .sort((a, b) => b.confidence - a.confidence);
}

/** Lessons reinforced enough to be worth wisdom-engine.ts's attention. */
export function getPromotableLessons(userId: string, characterId: string): Lesson[] {
  return getActiveLessons(userId, characterId)
    .filter(l => l.reinforcements >= PROMOTION_THRESHOLD);
}

export function formatLessonsForPrompt(lessons: Lesson[]): string {
  if (lessons.length === 0) return '';
  return `Patterns noticed so far: ${lessons.map(l => l.insight).join('; ')}`;
}

/** Test/session-reset helper — same shape as resetWorkingMemory / resetPlans. */
export function resetLessons(userId?: string, characterId?: string): void {
  if (userId && characterId) {
    store.delete(key(userId, characterId));
  } else {
    store.clear();
  }
}
