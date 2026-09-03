/**
 * Planner — Vantrix Cognition Layer
 *
 * ai/task-manager.ts tracks one ConversationalTask at a time — a single
 * concrete, trackable action for the current goal. That's the right
 * granularity for "what does she do this turn", but some goals genuinely
 * need more than one task to land (asking about a specific worry only
 * makes sense after checking in generally; following up on a promise
 * only makes sense after the thing being promised was actually due).
 * This module sits one level above task-manager.ts: it holds an ordered
 * Plan — a small sequence of steps working toward a SelectedGoal — and
 * hands task-manager.ts one step at a time as a task, advancing when the
 * prior step resolves.
 *
 * Plans are kept in-process, same tradeoff as working-memory.ts: cheap
 * and lossy is fine here, because a lost plan just means she falls back
 * to task-manager.ts's single-step behavior, not that anything breaks.
 * This module never talks to Redis or Supabase itself.
 */

import { logger } from '@/lib/logger';
import type { SelectedGoal } from '@/lib/ai/goal-selector';

// ── Types ───────────────────────────────────────────────────────────────

export type PlanStepStatus = 'pending' | 'active' | 'done' | 'skipped';

export interface PlanStep {
  id: string;
  /** Short, prompt-ready description of what this step accomplishes. */
  description: string;
  status: PlanStepStatus;
  /** Steps that must be 'done' or 'skipped' before this one can go active.
   *  Empty array means it can go active as soon as it's next in order. */
  dependsOn: string[];
}

export interface Plan {
  id: string;
  goalId: string;
  userId: string;
  characterId: string;
  steps: PlanStep[];
  createdAtTurn: number;
  updatedAtTurn: number;
  /** True once every step is 'done' or 'skipped'. */
  complete: boolean;
}

const CAPACITY_PER_PARTICIPANT = 3; // at most this many concurrent plans

const store = new Map<string, Plan[]>();

function key(userId: string, characterId: string): string {
  return `${userId}::${characterId}`;
}

// ── Reads ───────────────────────────────────────────────────────────────

export function listPlans(userId: string, characterId: string): Plan[] {
  return store.get(key(userId, characterId)) ?? [];
}

export function getPlan(userId: string, characterId: string, planId: string): Plan | null {
  return listPlans(userId, characterId).find(p => p.id === planId) ?? null;
}

/** The plan currently tied to a given goal, if one exists and isn't complete. */
export function activePlanForGoal(userId: string, characterId: string, goalId: string): Plan | null {
  return listPlans(userId, characterId).find(p => p.goalId === goalId && !p.complete) ?? null;
}

/** The next step that's actionable right now: not done/skipped, and every
 *  dependency it lists is already resolved. Null if the plan is complete
 *  or every remaining step is still blocked. */
export function nextStep(plan: Plan): PlanStep | null {
  const resolved = new Set(
    plan.steps.filter(s => s.status === 'done' || s.status === 'skipped').map(s => s.id),
  );
  return plan.steps.find(
    s => s.status !== 'done' && s.status !== 'skipped' && s.dependsOn.every(d => resolved.has(d)),
  ) ?? null;
}

// ── Writes ──────────────────────────────────────────────────────────────

/**
 * Create a plan for a goal. Callers decide the step breakdown — this
 * module deliberately doesn't try to decompose a goal into steps itself
 * (that judgment call belongs to whatever's calling it, e.g. a specific
 * ai/ engine that knows the domain), it just owns sequencing and state
 * once a breakdown exists. Evicts the oldest complete/stale plan if the
 * participant is already at capacity.
 */
export function createPlan(
  userId: string,
  characterId: string,
  goal: SelectedGoal,
  stepDescriptions: string[],
  turn: number,
): Plan {
  const k = key(userId, characterId);
  const existing = store.get(k) ?? [];

  if (existing.length >= CAPACITY_PER_PARTICIPANT) {
    const evictable = existing.find(p => p.complete) ?? existing[0];
    store.set(k, existing.filter(p => p.id !== evictable.id));
    logger.debug('[cognition/planner] evicted plan at capacity', { userId, characterId, evicted: evictable.id });
  }

  const goalId = goal.goal.id;

  const steps: PlanStep[] = stepDescriptions.map((description, i) => ({
    id: `${goalId}-step-${i}`,
    description,
    status: i === 0 ? 'active' : 'pending',
    dependsOn: i === 0 ? [] : [`${goalId}-step-${i - 1}`],
  }));

  const plan: Plan = {
    id: `plan-${goalId}-${turn}`,
    goalId,
    userId,
    characterId,
    steps,
    createdAtTurn: turn,
    updatedAtTurn: turn,
    complete: steps.length === 0,
  };

  const list = store.get(k) ?? [];
  list.push(plan);
  store.set(k, list);
  return plan;
}

/** Mark a step resolved and activate whatever becomes unblocked next. */
export function advancePlan(
  userId: string,
  characterId: string,
  planId: string,
  stepId: string,
  outcome: 'done' | 'skipped',
  turn: number,
): Plan | null {
  const plan = getPlan(userId, characterId, planId);
  if (!plan) return null;

  const step = plan.steps.find(s => s.id === stepId);
  if (!step) return plan;

  step.status = outcome;
  plan.updatedAtTurn = turn;

  const upcoming = nextStep(plan);
  if (upcoming) upcoming.status = 'active';

  plan.complete = plan.steps.every(s => s.status === 'done' || s.status === 'skipped');

  logger.debug('[cognition/planner] step resolved', {
    userId, characterId, planId, stepId, outcome, complete: plan.complete,
  });

  return plan;
}

export function abandonPlan(userId: string, characterId: string, planId: string): void {
  const k = key(userId, characterId);
  const list = store.get(k);
  if (!list) return;
  store.set(k, list.filter(p => p.id !== planId));
}

/** Prompt-ready rendering of a plan's current step, if any — analogous
 *  to task-manager.ts's formatTaskForPrompt() but for the step within
 *  the broader arc, so the model can see there's more coming after. */
export function formatPlanForPrompt(plan: Plan | null): string {
  if (!plan) return '';
  const current = nextStep(plan);
  if (!current) return '';
  const remaining = plan.steps.filter(s => s.status === 'pending').length;
  const tail = remaining > 0 ? ` (${remaining} step${remaining === 1 ? '' : 's'} to follow)` : '';
  return `Working toward: ${current.description}${tail}`;
}

/** Test/reset hook. */
export function resetPlans(userId: string, characterId: string): void {
  store.delete(key(userId, characterId));
}
