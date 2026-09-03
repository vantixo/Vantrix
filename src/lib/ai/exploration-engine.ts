/**
 * Exploration Engine — Vantrix
 *
 * Second layer of the curiosity → exploration → discovery chain (see
 * curiosity-engine.ts's header). An OpenCuriosity is a standing want —
 * "wondering why she never talks about her sister" — but wanting to
 * know something isn't the same as acting on it, and not every attempt
 * to satisfy a curiosity lands: a question can be deflected, a topic
 * can go nowhere. This module is the concrete, single-attempt act of
 * pursuing a curiosity, tracked separately from whether it actually
 * succeeded — that judgment (and what was actually found, if anything)
 * belongs to discovery-engine.ts, the same separation
 * practice-engine.ts keeps between running a session and
 * skill-engine.ts's/knowledge-engine.ts's judgment of what it produced.
 *
 *   curiosity-engine.ts                  — durable open curiosities
 *   exploration-engine.ts   (this file)  — concrete attempts to pursue one
 *   discovery-engine.ts                  — outcomes + closing the loop
 *
 * An ExplorationAttempt does not itself resolve or decay the source
 * OpenCuriosity — repeated attempts are expected and normal (asking
 * about the same thing more than once, from different angles, is how
 * real curiosity usually plays out). Only discovery-engine.ts, once it
 * judges an attempt to have actually answered the question, calls back
 * into curiosity-engine.ts's resolveCuriosity().
 */

import { logger } from '@/lib/logger';
import { getOpenCuriosities, type OpenCuriosity } from '@/lib/ai/curiosity-engine';

// ── Types ───────────────────────────────────────────────────────────────

export type ExplorationMethod =
  | 'direct_question'   // asked outright
  | 'indirect_probe'    // circled around it without asking directly
  | 'observation'       // watched/inferred rather than asked
  | 'experiment';        // tried something to see what happens (universe/ world actions)

export type ExplorationResult = 'answered' | 'deflected' | 'partial' | 'no_response';

export interface ExplorationAttempt {
  id: string;
  curiosityId: string;
  turn: number;
  method: ExplorationMethod;
  result: ExplorationResult;
  /** Short, prompt-ready description of what was actually tried, e.g.
   *  "asked directly about her sister over dinner talk". */
  description: string;
}

const CAPACITY = 100;

const log = new Map<string, ExplorationAttempt[]>();

function key(userId: string, characterId: string): string {
  return `${userId}::${characterId}`;
}

// ── Write path ──────────────────────────────────────────────────────────

/**
 * Record one attempt to pursue an open curiosity. Callers decide the
 * method and result (this module doesn't judge conversational outcomes
 * itself, same separation-of-concerns choice lesson-engine.ts's
 * extractLessons() makes for judging patterns vs recording raw
 * experience-engine.ts records) — it only owns the bookkeeping and
 * bounded log.
 */
export function recordExplorationAttempt(
  userId: string,
  characterId: string,
  turn: number,
  curiosityId: string,
  method: ExplorationMethod,
  result: ExplorationResult,
  description: string,
): ExplorationAttempt {
  const k = key(userId, characterId);
  const list = log.get(k) ?? [];

  const attempt: ExplorationAttempt = {
    id: `exploration-${k}-${turn}-${list.length}`,
    curiosityId,
    turn,
    method,
    result,
    description,
  };

  list.push(attempt);
  if (list.length > CAPACITY) list.splice(0, list.length - CAPACITY);
  log.set(k, list);

  logger.debug('[exploration-engine] attempt recorded', {
    userId, characterId, curiosityId, method, result,
  });

  return attempt;
}

// ── Read path ─────────────────────────────────────────────────────────────

export function getAttemptsForCuriosity(
  userId: string,
  characterId: string,
  curiosityId: string,
): ExplorationAttempt[] {
  return (log.get(key(userId, characterId)) ?? []).filter(a => a.curiosityId === curiosityId);
}

/**
 * Pick the best curiosity to explore this turn — the most pressing one
 * that hasn't already been tried and deflected too many times in a row
 * (repeatedly poking at something that keeps getting shut down reads as
 * pushy, not curious). Returns null if nothing is worth exploring right
 * now, in which case the caller should just let the turn proceed
 * normally.
 */
export function pickExplorationTarget(
  userId: string,
  characterId: string,
  maxRecentDeflections = 2,
): OpenCuriosity | null {
  const open = getOpenCuriosities(userId, characterId);

  for (const curiosity of open) {
    const attempts = getAttemptsForCuriosity(userId, characterId, curiosity.id);
    const recentDeflections = attempts.slice(-maxRecentDeflections)
      .filter(a => a.result === 'deflected').length;
    if (recentDeflections < maxRecentDeflections) return curiosity;
  }

  return null;
}

export function formatExplorationForPrompt(attempts: ExplorationAttempt[]): string {
  if (attempts.length === 0) return '';
  const last = attempts[attempts.length - 1];
  return `Last time this came up: ${last.description} (${last.result})`;
}

/** Test/session-reset helper — same shape as resetCuriosities / resetHabits. */
export function resetExplorationLog(userId?: string, characterId?: string): void {
  if (userId && characterId) {
    log.delete(key(userId, characterId));
  } else {
    log.clear();
  }
}
