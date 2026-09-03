/**
 * Skill Engine — Vantrix
 *
 * Base of a four-part chain modeling a character actually getting
 * better at things over time, the procedural counterpart to the
 * declarative side of the same idea:
 *
 *   skill-engine.ts      (this file) — procedural competence: level + XP per skill
 *   knowledge-engine.ts               — declarative competence: discrete learned facts
 *   practice-engine.ts                — the mechanism that feeds both from a session
 *   learning-engine.ts                — public facade + "what to work on next" decision
 *
 * memory-graph.ts's `ambition_update` event type already lets a caller
 * narrate "I finally finished that song I told you about" as a one-off
 * memory, but there was nothing tracking the underlying competence that
 * narration implies — a character can claim to be "getting better at
 * guitar" turn after turn with no actual state backing it up, and
 * nothing stops two contradictory claims (a beginner one session, an
 * expert the next) from both being generated. This module is that
 * state: a Skill has a level and XP, XP is earned through
 * practice-engine.ts sessions (never granted directly by narration), and
 * the level curve below is what a caller should check before letting a
 * response claim any specific competence.
 *
 * Kept in-memory, same tradeoff as working-memory.ts / habit-engine.ts —
 * cheap and lossy is fine because this is character-scoped derived
 * state, not the kind of durable fact belief-engine.ts or memory-graph.ts
 * already persist to Supabase. A caller wanting this to survive process
 * restarts can snapshot getSkills()'s output into whatever store already
 * holds the character row (same "promote later if needed" note
 * wisdom-engine.ts's header makes).
 */

import { logger } from '@/lib/logger';

// ── Types ───────────────────────────────────────────────────────────────

export type SkillDomain =
  | 'music' | 'art' | 'language' | 'sport' | 'craft' | 'cooking'
  | 'academic' | 'social' | 'other';

export interface Skill {
  id: string;
  domain: SkillDomain;
  /** Specific thing being learned, e.g. "guitar", "watercolor painting". */
  name: string;
  /** 1-10, mirrors memory-graph.ts's MemoryNode.emotional_weight scale
   *  for anything that gets narrated — a level-1 skill is "just started",
   *  level-10 is genuine mastery. */
  level: number;
  xp: number;
  xpToNextLevel: number;
  createdAtTurn: number;
  lastPracticedTurn: number;
}

const MAX_LEVEL = 10;
// Standard RPG-style escalating curve — each level costs more XP than
// the last, so early levels come quickly (visible progress fast) and
// later ones take sustained practice (mastery feels earned).
const BASE_XP_PER_LEVEL = 100;

export function xpRequiredForLevel(level: number): number {
  return Math.round(BASE_XP_PER_LEVEL * Math.pow(1.4, level - 1));
}

const store = new Map<string, Map<string, Skill>>();

function key(characterId: string): string {
  return characterId;
}

function getBucket(characterId: string): Map<string, Skill> {
  const k = key(characterId);
  let bucket = store.get(k);
  if (!bucket) {
    bucket = new Map();
    store.set(k, bucket);
  }
  return bucket;
}

// ── Write path ──────────────────────────────────────────────────────────

/** Register a new skill the character has started learning. No-op
 *  (returns the existing one) if a skill with this name already exists. */
export function startSkill(
  characterId: string,
  turn: number,
  domain: SkillDomain,
  name: string,
): Skill {
  const bucket = getBucket(characterId);
  const existing = bucket.get(name);
  if (existing) return existing;

  const skill: Skill = {
    id: `skill-${characterId}-${name}`,
    domain,
    name,
    level: 1,
    xp: 0,
    xpToNextLevel: xpRequiredForLevel(1),
    createdAtTurn: turn,
    lastPracticedTurn: turn,
  };
  bucket.set(name, skill);

  logger.debug('[skill-engine] started', { characterId, domain, name });
  return skill;
}

/**
 * Add XP to an existing skill, leveling it up (possibly multiple times
 * off one large gain) and capping at MAX_LEVEL. Callers should reach
 * this only through practice-engine.ts's runPracticeSession() — it's
 * exported directly for the rare case a caller has its own XP source
 * (e.g. a character-creation seed grant), not as the normal path.
 */
export function addXp(characterId: string, name: string, turn: number, amount: number): Skill | null {
  const bucket = getBucket(characterId);
  const skill = bucket.get(name);
  if (!skill) return null;

  skill.xp += amount;
  skill.lastPracticedTurn = turn;

  while (skill.level < MAX_LEVEL && skill.xp >= skill.xpToNextLevel) {
    skill.xp -= skill.xpToNextLevel;
    skill.level += 1;
    skill.xpToNextLevel = xpRequiredForLevel(skill.level);
  }
  if (skill.level >= MAX_LEVEL) {
    skill.xp = 0;
    skill.xpToNextLevel = 0;
  }

  logger.debug('[skill-engine] xp added', { characterId, name, amount, level: skill.level });
  return skill;
}

// ── Read path ─────────────────────────────────────────────────────────────

export function getSkill(characterId: string, name: string): Skill | null {
  return getBucket(characterId).get(name) ?? null;
}

export function getSkills(characterId: string, domain?: SkillDomain): Skill[] {
  const all = Array.from(getBucket(characterId).values());
  return (domain ? all.filter(s => s.domain === domain) : all)
    .sort((a, b) => b.level - a.level || b.xp - a.xp);
}

export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) return '';
  return `Currently working on: ${skills.map(s => `${s.name} (level ${s.level}/${MAX_LEVEL})`).join(', ')}`;
}

/** Test/session-reset helper — same shape as resetHabits / resetWisdom. */
export function resetSkills(characterId?: string): void {
  if (characterId) {
    store.delete(key(characterId));
  } else {
    store.clear();
  }
}
