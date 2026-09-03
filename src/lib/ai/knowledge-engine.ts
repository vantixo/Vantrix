/**
 * Knowledge Engine (Learning) — Vantrix
 *
 * Second layer of the skill → knowledge → practice → learning chain
 * (see skill-engine.ts's header). Deliberately a sibling of
 * skill-engine.ts, not built on top of it: cognitive science's usual
 * procedural/declarative split is exactly the distinction that matters
 * here — skill-engine.ts's level is "how good she's gotten at guitar",
 * this module is "what she's actually learned about it along the way"
 * ("drop D makes this riff way easier", "her third finger keeps
 * muting the B string"). A caller narrating a practice session wants
 * both: the level for how competent to sound, discrete KnowledgeItems
 * for something concrete and specific to actually say.
 *
 *   skill-engine.ts                     — procedural: level + XP per skill
 *   knowledge-engine.ts     (this file) — declarative: discrete learned facts
 *   practice-engine.ts                  — feeds both from a practice session
 *   learning-engine.ts                  — public facade + decision layer
 *
 * NOTE ON NAMING: this is unrelated to knowledge-library.ts's
 * `character_knowledge` table — that module is the character's
 * creator-authored + backstory-engine.ts-generated *canon* (books she's
 * read, established backstory), persisted, character-global, and never
 * user-derived (see its header's privacy boundary). This module is the
 * opposite in every one of those respects: it's specifically about
 * things learned *through practice* captured here, in-process, and
 * meant to grow turn over turn the same way skill-engine.ts's XP does —
 * it is not meant to ever be promoted into knowledge-library.ts's canon
 * table, since that would let one relationship's practice sessions leak
 * into another user's version of the character.
 *
 * Reinforcement/decay follows the same loop as belief-engine.ts /
 * habit-engine.ts: a KnowledgeItem gains masteryConfidence when recalled
 * successfully, loses it when contradicted or simply unused long enough
 * (real learned facts fade if never revisited).
 */

import { logger } from '@/lib/logger';
import type { SkillDomain } from '@/lib/ai/skill-engine';

// ── Types ───────────────────────────────────────────────────────────────

export interface KnowledgeItem {
  id: string;
  domain: SkillDomain;
  /** Tie to the specific skill this fact belongs to, e.g. "guitar". */
  skillName: string;
  /** Short, prompt-ready statement of what was learned. */
  fact: string;
  /** 0..1, same role as Belief.confidence — grows with recall, decays unused. */
  masteryConfidence: number;
  timesRecalled: number;
  learnedAtTurn: number;
  lastRecalledTurn: number;
}

const RECALL_REWARD = 0.15;
const CONTRADICTION_PENALTY = 0.3;
const DECAY_PER_SWEEP = 0.05;
// Below this a fact is considered forgotten and dropped — same idea as
// wisdom-engine.ts's RETIREMENT_THRESHOLD, tuned lower because a single
// specific fact is cheaper to re-learn than a whole wisdom principle.
const FORGOTTEN_THRESHOLD = 0.1;

const store = new Map<string, Map<string, KnowledgeItem>>();

function key(characterId: string): string {
  return characterId;
}

function getBucket(characterId: string): Map<string, KnowledgeItem> {
  const k = key(characterId);
  let bucket = store.get(k);
  if (!bucket) {
    bucket = new Map();
    store.set(k, bucket);
  }
  return bucket;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n));
}

// ── Write path ──────────────────────────────────────────────────────────

/**
 * Learn a new fact, or reinforce it if the same fact (matched by exact
 * text within the same skill) has already been learned. Callers
 * normally reach this through practice-engine.ts's runPracticeSession(),
 * which decides *when* a session produces a new fact worth learning —
 * this function itself doesn't judge whether a fact is worth recording.
 */
export function learnFact(
  characterId: string,
  turn: number,
  domain: SkillDomain,
  skillName: string,
  fact: string,
): KnowledgeItem {
  const bucket = getBucket(characterId);
  const itemKey = `${skillName}:${fact}`;
  const existing = bucket.get(itemKey);

  if (existing) {
    existing.timesRecalled += 1;
    existing.masteryConfidence = clamp(existing.masteryConfidence + RECALL_REWARD);
    existing.lastRecalledTurn = turn;
    return existing;
  }

  const item: KnowledgeItem = {
    id: `knowledge-${characterId}-${itemKey}`,
    domain,
    skillName,
    fact,
    masteryConfidence: 0.4,
    timesRecalled: 1,
    learnedAtTurn: turn,
    lastRecalledTurn: turn,
  };
  bucket.set(itemKey, item);

  logger.debug('[knowledge-engine] learned', { characterId, skillName, fact });
  return item;
}

/** Weaken a fact that turned out to be wrong or got corrected —
 *  mirrors belief-conflict.ts's role for beliefs, but simpler since
 *  a learned technique either gets contradicted or it doesn't. */
export function contradictFact(characterId: string, skillName: string, fact: string): KnowledgeItem | null {
  const bucket = getBucket(characterId);
  const item = bucket.get(`${skillName}:${fact}`);
  if (!item) return null;

  item.masteryConfidence = clamp(item.masteryConfidence - CONTRADICTION_PENALTY);
  if (item.masteryConfidence < FORGOTTEN_THRESHOLD) {
    bucket.delete(`${skillName}:${fact}`);
    return null;
  }
  return item;
}

// ── Read path ─────────────────────────────────────────────────────────────

export function getKnowledgeForSkill(characterId: string, skillName: string): KnowledgeItem[] {
  return Array.from(getBucket(characterId).values())
    .filter(k => k.skillName === skillName)
    .sort((a, b) => b.masteryConfidence - a.masteryConfidence);
}

export function formatKnowledgeForPrompt(items: KnowledgeItem[]): string {
  if (items.length === 0) return '';
  return `Things learned along the way: ${items.map(i => i.fact).join('; ')}`;
}

// ── Maintenance sweep ──────────────────────────────────────────────────────

export interface KnowledgeMaintenanceReport {
  characterId: string;
  decayed: number;
  forgotten: number;
}

/**
 * Cron-driven decay pass, same role/cadence as belief-engine.ts's
 * runBeliefMaintenance() and habit-engine.ts's runHabitMaintenance() —
 * weakens anything not recalled since `sinceTurn`, dropping it once it
 * crosses FORGOTTEN_THRESHOLD.
 */
export function runKnowledgeMaintenance(characterId: string, sinceTurn: number): KnowledgeMaintenanceReport {
  const bucket = getBucket(characterId);
  let decayed = 0;
  let forgotten = 0;

  for (const [itemKey, item] of bucket) {
    if (item.lastRecalledTurn >= sinceTurn) continue;
    item.masteryConfidence = clamp(item.masteryConfidence - DECAY_PER_SWEEP);
    decayed += 1;
    if (item.masteryConfidence < FORGOTTEN_THRESHOLD) {
      bucket.delete(itemKey);
      forgotten += 1;
    }
  }

  logger.debug('[knowledge-engine] maintenance swept', { characterId, decayed, forgotten });
  return { characterId, decayed, forgotten };
}

/** Test/session-reset helper — same shape as resetSkills / resetHabits. */
export function resetKnowledge(characterId?: string): void {
  if (characterId) {
    store.delete(key(characterId));
  } else {
    store.clear();
  }
}
