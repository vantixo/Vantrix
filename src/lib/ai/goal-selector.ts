/**
 * Goal Selector — Vantrix
 *
 * goal-engine.ts's `character_goals` table can hold several active goals
 * at once (an ambition, a relationship goal, a self goal). Nothing
 * previously picked which ONE of those should actually drive this specific
 * turn — decision-engine.ts's `currentGoals` was consumed as an
 * undifferentiated list. This module is that missing choice: given the
 * active goals and the current drive-engine.ts state, select the single
 * goal-of-the-moment, using priority-engine.ts to rank them.
 *
 * This is the first real "choose" step in the choose-before-speak
 * pipeline: goal-selector.ts picks *what she's generally trying to do*
 * before task-manager.ts breaks that into a concrete this-turn action and
 * attention-router.ts decides what context is worth drawing on to do it.
 */

import type { Goal } from '@/lib/ai/decision-engine';
import type { DriveState, DriveName } from '@/lib/ai/drive-engine';
import { rankCandidates, type PriorityCandidate, type PriorityWeights } from '@/lib/ai/priority-engine';

// ── Types ───────────────────────────────────────────────────────────────

export interface GoalRecency {
  goalId: string;
  turnsSinceLastAdvanced: number;
}

export interface SelectedGoal {
  goal:       Goal;
  score:      number;
  reasoning:  string;
  runnerUp:   Goal | null; // second place — useful for task-manager.ts to know what almost won
}

// Which drive most naturally aligns with which goal category — used to
// compute alignment scores rather than requiring goals to be manually
// tagged with drive relevance.
const CATEGORY_DRIVE_AFFINITY: Record<Goal['category'], Partial<Record<DriveName, number>>> = {
  ambition:     { status: 25, novelty: 15, curiosity: 10 },
  relationship: { attachment: 30, security: 10 },
  self:         { security: 20, status: 15 },
};

function driveAlignmentFor(category: Goal['category'], drives: DriveState): number {
  const affinity = CATEGORY_DRIVE_AFFINITY[category];
  let alignment = 50; // neutral baseline

  for (const reading of drives.readings) {
    const weight = affinity[reading.drive];
    if (!weight) continue;
    alignment += (reading.effectiveLevel - 50) * (weight / 100);
  }

  return Math.max(0, Math.min(100, Math.round(alignment)));
}

// ── Selection ───────────────────────────────────────────────────────────

const GOAL_WEIGHTS: PriorityWeights = {
  importance: 0.35,
  urgency:    0.15,
  alignment:  0.35,
  freshnessBias: 0.15,
};

/**
 * Select the single goal that should drive this turn. `recency` lets
 * callers avoid the same goal dominating every single turn even when it's
 * consistently the highest-priority one — a goal that was just advanced
 * recently cedes a little ground to the next-best one, the same way a
 * person doesn't monomaniacally pursue one thing in every exchange.
 */
export function selectGoal(
  goals: Goal[],
  drives: DriveState,
  recency: GoalRecency[] = [],
): SelectedGoal | null {
  if (!goals.length) return null;

  const recencyById = new Map(recency.map(r => [r.goalId, r.turnsSinceLastAdvanced]));

  const candidates: PriorityCandidate[] = goals.map(g => ({
    id: g.id,
    importance: Math.round(g.priority * 100),
    urgency: Math.round(g.priority * 60 + (drives.dominant.drive === 'security' ? -20 : 0)),
    alignment: driveAlignmentFor(g.category, drives),
    staleness: recencyById.get(g.id) ?? 10, // unknown recency defaults to "not stale" but not maximally fresh either
  }));

  const ranked = rankCandidates(candidates, GOAL_WEIGHTS);
  const top = ranked[0]!;
  const goal = goals.find(g => g.id === top.id)!;
  const runnerUpEntry = ranked[1];
  const runnerUp = runnerUpEntry ? goals.find(g => g.id === runnerUpEntry.id) ?? null : null;

  const reasoning = `"${goal.label}" ranked highest (${top.score}/100) given the current ${drives.dominant.drive} pull` +
    (runnerUp ? `, narrowly ahead of "${runnerUp.label}"` : '');

  return { goal, score: top.score, reasoning, runnerUp };
}

// ── Prompt injection ───────────────────────────────────────────────────

export function formatSelectedGoalForPrompt(selected: SelectedGoal | null): string {
  if (!selected) return '';
  return [
    '# What She\'s Quietly Working Toward This Turn',
    `${selected.goal.label}`,
    'This should shape what she\'s drawn to bring up or steer toward — never stated outright as a goal.',
  ].join('\n');
}
