/**
 * Practice Engine — Vantrix
 *
 * Third layer of the skill → knowledge → practice → learning chain (see
 * skill-engine.ts's header). skill-engine.ts and knowledge-engine.ts
 * both deliberately expose direct write functions (addXp, learnFact),
 * but neither should normally be called straight from a caller — this
 * module is the one place that decides how a single practice session
 * translates into XP and (sometimes) a new learned fact, so the two
 * stores can't drift out of sync with each other or with what actually
 * happened in the conversation.
 *
 *   skill-engine.ts                 — procedural: level + XP per skill
 *   knowledge-engine.ts             — declarative: discrete learned facts
 *   practice-engine.ts (this file)  — the session mechanism feeding both
 *   learning-engine.ts              — public facade + decision layer
 *
 * A session's `quality` (0-1, caller-supplied — e.g. derived from how
 * the conversation described the attempt) drives three things at once:
 * how much XP it's worth, the odds it also produces a new KnowledgeItem
 * (higher quality = more likely something specific was actually learned,
 * not just repeated), and its outcome label. Struggling sessions still
 * grant a small amount of XP — effort counts even when it doesn't go
 * well — but are far less likely to produce a new fact.
 *
 * Sessions themselves are kept in a bounded in-memory log, same shape
 * and rationale as experience-engine.ts's ExperienceRecord log — enough
 * history for learning-engine.ts to reason about recent practice
 * cadence without an unbounded memory footprint.
 */

import { logger } from '@/lib/logger';
import { addXp, getSkill, type Skill } from '@/lib/ai/skill-engine';
import { learnFact, type KnowledgeItem } from '@/lib/ai/knowledge-engine';

// ── Types ───────────────────────────────────────────────────────────────

export type PracticeOutcome = 'breakthrough' | 'steady' | 'struggle';

export interface PracticeSession {
  id: string;
  skillName: string;
  turn: number;
  /** 0..1, caller-supplied read on how the session went. */
  quality: number;
  outcome: PracticeOutcome;
  xpGained: number;
  /** Set only if this session also produced a new/reinforced fact. */
  knowledgeGained: KnowledgeItem | null;
}

const CAPACITY = 100;
const BASE_XP = 20;
// A session needs to clear this quality before it has any chance of
// producing a new fact — pure struggle sessions build resilience
// (small XP) but rarely teach anything concrete worth stating.
const KNOWLEDGE_QUALITY_FLOOR = 0.5;

const log = new Map<string, PracticeSession[]>();

function key(characterId: string): string {
  return characterId;
}

function outcomeFor(quality: number): PracticeOutcome {
  if (quality >= 0.75) return 'breakthrough';
  if (quality >= 0.4) return 'steady';
  return 'struggle';
}

// ── Write path ──────────────────────────────────────────────────────────

/**
 * Run one practice session against an already-started skill
 * (skill-engine.ts's startSkill()) and fold the result into both
 * skill-engine.ts (always) and knowledge-engine.ts (probabilistically,
 * gated on quality). `fact` is optional and caller-supplied — this
 * module doesn't invent what was learned, only decides whether this
 * session's quality justifies recording it at all.
 */
export function runPracticeSession(
  characterId: string,
  skillName: string,
  turn: number,
  quality: number,
  fact?: string,
): PracticeSession | null {
  const skill: Skill | null = getSkill(characterId, skillName);
  if (!skill) {
    logger.debug('[practice-engine] skipped: skill not started', { characterId, skillName });
    return null;
  }

  const outcome = outcomeFor(quality);
  // Breakthroughs are worth more XP than steady grinding, which is worth
  // more than a struggling session — but nothing is ever zero, since
  // showing up to practice is worth something regardless of outcome.
  const xpGained = Math.round(BASE_XP * (0.3 + quality));
  addXp(characterId, skillName, turn, xpGained);

  let knowledgeGained: KnowledgeItem | null = null;
  if (fact && quality >= KNOWLEDGE_QUALITY_FLOOR) {
    knowledgeGained = learnFact(characterId, turn, skill.domain, skillName, fact);
  }

  const session: PracticeSession = {
    id: `practice-${characterId}-${skillName}-${turn}`,
    skillName,
    turn,
    quality,
    outcome,
    xpGained,
    knowledgeGained,
  };

  const list = log.get(key(characterId)) ?? [];
  list.push(session);
  if (list.length > CAPACITY) list.splice(0, list.length - CAPACITY);
  log.set(key(characterId), list);

  logger.debug('[practice-engine] session recorded', {
    characterId, skillName, outcome, xpGained, learnedFact: knowledgeGained !== null,
  });

  return session;
}

// ── Read path ─────────────────────────────────────────────────────────────

export function getRecentSessions(
  characterId: string,
  opts?: { skillName?: string; limit?: number },
): PracticeSession[] {
  const list = log.get(key(characterId)) ?? [];
  const filtered = opts?.skillName ? list.filter(s => s.skillName === opts.skillName) : list;
  const limit = opts?.limit ?? filtered.length;
  return filtered.slice(-limit);
}

export function formatPracticeForPrompt(sessions: PracticeSession[]): string {
  if (sessions.length === 0) return '';
  const last = sessions[sessions.length - 1];
  return `Last practice (${last.skillName}): ${last.outcome}${last.knowledgeGained ? ` — learned that ${last.knowledgeGained.fact}` : ''}`;
}

/** Test/session-reset helper — same shape as resetSkills / resetKnowledge. */
export function resetPracticeLog(characterId?: string): void {
  if (characterId) {
    log.delete(key(characterId));
  } else {
    log.clear();
  }
}
