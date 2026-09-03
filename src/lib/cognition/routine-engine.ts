/**
 * Routine Engine — Vantrix Cognition Layer
 *
 * Middle layer of the habit → routine → automatic-behavior chain (see
 * habit-engine.ts's header). A single Habit is one cue→response pair;
 * some automatic behavior is genuinely multi-step even when none of it
 * is deliberate — greeting-then-callback-then-checkin is a routine, not
 * three unrelated habits that happen to fire in sequence. This module
 * is what holds that ordering, the same relationship planner.ts's Plan
 * has to task-manager.ts's single ConversationalTask, but one layer
 * down in the deliberate/automatic split: a Plan is something she's
 * working toward on purpose; a Routine is something she does without
 * having to decide to.
 *
 *   habit-engine.ts                 — individual cue → response strength
 *   routine-engine.ts   (this file) — ordered sequences of habit cues
 *   automatic-behavior.ts           — the fast-path gate that consults both
 *
 * A Routine only advances one step at a time (advanceRoutine), same
 * shape as planner.ts's advancePlan, and only via the cue that step
 * expects — a routine that's waiting on 'callback' doesn't advance just
 * because 'goodbye' fired, it stays parked until its actual next cue
 * shows up or the caller abandons it. Kept in-process like every other
 * module in this chain.
 */

import { logger } from '@/lib/logger';
import type { HabitCue } from '@/lib/cognition/habit-engine';

// ── Types ───────────────────────────────────────────────────────────────

export type RoutineStepStatus = 'pending' | 'active' | 'done' | 'skipped';

export interface RoutineStep {
  id: string;
  cue: HabitCue;
  /** Short, prompt-ready description of what this step does automatically. */
  description: string;
  status: RoutineStepStatus;
}

export interface Routine {
  id: string;
  userId: string;
  characterId: string;
  /** Short label for the whole sequence, e.g. "settling-in check-in". */
  name: string;
  steps: RoutineStep[];
  createdAtTurn: number;
  updatedAtTurn: number;
  complete: boolean;
}

const CAPACITY_PER_PARTICIPANT = 3; // at most this many concurrent routines, same cap as planner.ts's plans

const store = new Map<string, Routine[]>();

function key(userId: string, characterId: string): string {
  return `${userId}::${characterId}`;
}

// ── Reads ───────────────────────────────────────────────────────────────

export function listRoutines(userId: string, characterId: string): Routine[] {
  return store.get(key(userId, characterId)) ?? [];
}

export function getRoutine(userId: string, characterId: string, routineId: string): Routine | null {
  return listRoutines(userId, characterId).find(r => r.id === routineId) ?? null;
}

/** The active step in a routine — the first one not yet done/skipped. Null if complete. */
export function activeStep(routine: Routine): RoutineStep | null {
  return routine.steps.find(s => s.status !== 'done' && s.status !== 'skipped') ?? null;
}

/** Any in-progress routines whose active step is waiting on this cue. */
export function routinesAwaitingCue(userId: string, characterId: string, cue: HabitCue): Routine[] {
  return listRoutines(userId, characterId).filter(r => {
    if (r.complete) return false;
    const step = activeStep(r);
    return step !== null && step.cue === cue;
  });
}

// ── Writes ──────────────────────────────────────────────────────────────

/**
 * Start a new routine. Callers decide the step breakdown (same
 * separation of concerns as planner.ts's createPlan) — this module only
 * owns sequencing and advancement, not deciding what a routine's steps
 * should be.
 */
export function startRoutine(
  userId: string,
  characterId: string,
  turn: number,
  name: string,
  steps: Array<{ cue: HabitCue; description: string }>,
): Routine {
  const k = key(userId, characterId);
  const existing = store.get(k) ?? [];

  // Same eviction shape as planner.ts's CAPACITY_PER_PARTICIPANT — drop
  // the oldest incomplete routine rather than let the set grow unbounded.
  const incomplete = existing.filter(r => !r.complete);
  if (incomplete.length >= CAPACITY_PER_PARTICIPANT) {
    const oldest = incomplete.sort((a, b) => a.createdAtTurn - b.createdAtTurn)[0];
    abandonRoutine(userId, characterId, oldest.id);
  }

  const routine: Routine = {
    id: `routine-${userId}-${characterId}-${turn}-${existing.length}`,
    userId,
    characterId,
    name,
    steps: steps.map((s, i) => ({
      id: `step-${i}`,
      cue: s.cue,
      description: s.description,
      status: i === 0 ? 'active' : 'pending',
    })),
    createdAtTurn: turn,
    updatedAtTurn: turn,
    complete: false,
  };

  const list = store.get(k) ?? [];
  list.push(routine);
  store.set(k, list);

  logger.debug('[cognition/routine-engine] started', {
    userId, characterId, name, steps: steps.length,
  });

  return routine;
}

/**
 * Advance a routine's active step to 'done' if the cue that fired
 * matches what it was waiting on, activating the next step. No-op
 * (returns the routine unchanged) if the cue doesn't match — a routine
 * only advances on its own terms, it doesn't get pulled along by
 * whatever cue happens to fire elsewhere.
 */
export function advanceRoutine(
  userId: string,
  characterId: string,
  routineId: string,
  turn: number,
  firedCue: HabitCue,
): Routine | null {
  const routine = getRoutine(userId, characterId, routineId);
  if (!routine || routine.complete) return routine;

  const step = activeStep(routine);
  if (!step || step.cue !== firedCue) return routine;

  step.status = 'done';
  const next = routine.steps.find(s => s.status === 'pending');
  if (next) next.status = 'active';

  routine.complete = routine.steps.every(s => s.status === 'done' || s.status === 'skipped');
  routine.updatedAtTurn = turn;

  logger.debug('[cognition/routine-engine] advanced', {
    userId, characterId, routineId, complete: routine.complete,
  });

  return routine;
}

export function abandonRoutine(userId: string, characterId: string, routineId: string): void {
  const k = key(userId, characterId);
  const list = store.get(k);
  if (!list) return;
  store.set(k, list.filter(r => r.id !== routineId));
}

/** Test/session-reset helper — same shape as resetHabits / resetLessons. */
export function resetRoutines(userId?: string, characterId?: string): void {
  if (userId && characterId) {
    store.delete(key(userId, characterId));
  } else {
    store.clear();
  }
}
