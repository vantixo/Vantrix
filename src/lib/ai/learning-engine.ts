/**
 * Learning Engine — Vantrix
 *
 * Public entry point for the skill → knowledge → practice → learning
 * chain (see skill-engine.ts's header) — same facade role
 * autobiography-engine.ts plays for the memory-consolidation/timeline/
 * life-story chain and cognition-engine.ts plays for src/lib/cognition/:
 * callers outside this group of four files should import from here
 * rather than reaching into skill-engine.ts / knowledge-engine.ts /
 * practice-engine.ts directly, so a session always goes through
 * practice-engine.ts's combined XP+knowledge fold rather than a call
 * site accidentally calling addXp() or learnFact() on its own and
 * letting the two stores drift apart.
 *
 *   skill-engine.ts          — procedural: level + XP per skill
 *   knowledge-engine.ts      — declarative: discrete learned facts
 *   practice-engine.ts       — the session mechanism feeding both
 *   learning-engine.ts (this file) — orchestration + "what next" decision
 *
 * The one piece of judgment this layer adds beyond pure re-export is
 * pickNextFocus(): given the character's current skills and a list of
 * candidate new skills a caller thinks might interest her (e.g. surfaced
 * from goal-engine.ts's active goals or drive-engine.ts's drives), decide
 * whether to keep deepening an existing skill or start a new one. This
 * module never calls goal-engine.ts or drive-engine.ts itself — same
 * read-only, caller-supplies-context boundary autobiography-engine.ts's
 * header describes for its own sources — it only needs candidates
 * handed to it, not the ability to fetch its own.
 */

import { logger } from '@/lib/logger';
import {
  startSkill,
  getSkill,
  getSkills,
  formatSkillsForPrompt,
  type Skill,
  type SkillDomain,
} from '@/lib/ai/skill-engine';
import {
  getKnowledgeForSkill,
  formatKnowledgeForPrompt,
  type KnowledgeItem,
} from '@/lib/ai/knowledge-engine';
import {
  getRecentSessions,
  formatPracticeForPrompt,
  type PracticeSession,
} from '@/lib/ai/practice-engine';

export type { Skill, SkillDomain } from '@/lib/ai/skill-engine';
export { startSkill, getSkill, getSkills, formatSkillsForPrompt, resetSkills, xpRequiredForLevel } from '@/lib/ai/skill-engine';
export type { KnowledgeItem } from '@/lib/ai/knowledge-engine';
export {
  getKnowledgeForSkill,
  formatKnowledgeForPrompt,
  contradictFact,
  runKnowledgeMaintenance,
  resetKnowledge,
  type KnowledgeMaintenanceReport,
} from '@/lib/ai/knowledge-engine';
export type { PracticeSession, PracticeOutcome } from '@/lib/ai/practice-engine';
export { runPracticeSession, getRecentSessions, formatPracticeForPrompt, resetPracticeLog } from '@/lib/ai/practice-engine';

// ── Types ───────────────────────────────────────────────────────────────

export interface LearningSnapshot {
  characterId: string;
  skills: Skill[];
  knowledgeBySkill: Record<string, KnowledgeItem[]>;
  recentSessions: PracticeSession[];
}

export interface FocusDecision {
  action: 'deepen' | 'start_new';
  skillName: string;
  reason: string;
}

// A skill that hasn't been practiced in this many turns is considered
// stalled — worth revisiting before starting something new, the same
// "don't abandon what's in flight" instinct planner.ts and
// routine-engine.ts both apply to their own in-progress state.
const STALL_TURNS = 20;
// Below this level a skill is still early enough that deepening it
// usually beats starting something else entirely from scratch.
const EARLY_LEVEL_CEILING = 3;

// ── Orchestration ─────────────────────────────────────────────────────────

/** Everything a caller needs to narrate the character's current
 *  learning state in one call — the "what's she working on" snapshot. */
export function getLearningSnapshot(characterId: string): LearningSnapshot {
  const skills = getSkills(characterId);
  const knowledgeBySkill: Record<string, KnowledgeItem[]> = {};
  for (const skill of skills) {
    knowledgeBySkill[skill.name] = getKnowledgeForSkill(characterId, skill.name);
  }
  const recentSessions = getRecentSessions(characterId, { limit: 5 });

  return { characterId, skills, knowledgeBySkill, recentSessions };
}

/**
 * Decide whether to keep deepening the character's current focus skill
 * or start a new one from `candidates`. Priority order: an existing
 * skill that's stalled (not practiced in a while) but still early gets
 * first claim on attention; failing that, an existing skill below
 * EARLY_LEVEL_CEILING that's still active gets deepened; only once
 * every current skill is either mature (past the ceiling) or has none
 * of those conditions does this reach for a brand-new candidate.
 */
export function pickNextFocus(
  characterId: string,
  currentTurn: number,
  candidates: Array<{ domain: SkillDomain; name: string }>,
): FocusDecision {
  const skills = getSkills(characterId);

  const stalled = skills.find(
    s => s.level <= EARLY_LEVEL_CEILING && currentTurn - s.lastPracticedTurn >= STALL_TURNS,
  );
  if (stalled) {
    return { action: 'deepen', skillName: stalled.name, reason: 'early-stage skill has stalled, worth returning to' };
  }

  const early = skills.find(s => s.level <= EARLY_LEVEL_CEILING);
  if (early) {
    return { action: 'deepen', skillName: early.name, reason: 'still early progress, worth continuing before starting something new' };
  }

  const candidate = candidates.find(c => !getSkill(characterId, c.name));
  if (candidate) {
    startSkill(characterId, currentTurn, candidate.domain, candidate.name);
    logger.debug('[learning-engine] started new focus', { characterId, skill: candidate.name });
    return { action: 'start_new', skillName: candidate.name, reason: 'existing skills are mature, starting something new' };
  }

  // Nothing early, nothing new offered — default to the least mature
  // existing skill so there's always a sensible answer.
  const fallback = [...skills].sort((a, b) => a.level - b.level)[0];
  return { action: 'deepen', skillName: fallback?.name ?? '', reason: 'no better option available' };
}

export function formatLearningSnapshotForPrompt(snapshot: LearningSnapshot): string {
  const parts = [
    formatSkillsForPrompt(snapshot.skills),
    ...snapshot.skills.map(s => formatKnowledgeForPrompt(snapshot.knowledgeBySkill[s.name] ?? [])),
    formatPracticeForPrompt(snapshot.recentSessions),
  ].filter(Boolean);
  return parts.join('\n');
}
