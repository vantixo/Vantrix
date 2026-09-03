/**
 * Focus Stack — Vantrix
 *
 * attention-router.ts scores candidates fresh every single turn, and
 * task-manager.ts persists the task queue — but nothing persists *what
 * actually won attention* or *which goal actually got selected* across
 * turns. Two concrete gaps this closes, both named explicitly in
 * executive-controller.ts's live wiring (chat/stream/route.ts):
 *
 *   1. goal-selector.ts accepts a `GoalRecency[]` so a goal that keeps
 *      winning doesn't monomaniacally dominate every turn — but the live
 *      route passes `[]` because nothing tracked turns-since-last-advanced
 *      per goal. This module is that tracker.
 *   2. salience-engine.ts's per-candidate `staleness` field is only as
 *      good as the caller's ability to say "this exact thing won
 *      attention N turns ago" — this module is the memory that makes that
 *      possible, distinct from salience-engine.ts's fresh-every-turn
 *      scoring and from task-manager.ts's goal-decomposition queue.
 *
 * A "focus stack" in the cognitive-science sense: a small, short-lived,
 * ordered record of what's recently been in the foreground — not a
 * durable memory (that's memory-graph.ts's job) and not a task queue
 * (task-manager.ts), just "what did she just attend to," so the next
 * turn's routing decision isn't made from a blank slate.
 *
 * Storage: Redis, per (user, character), same TTL class as task-manager.ts
 * — working state for the current stretch of conversation, not durable.
 *
 * Not to be confused with cognition/working-memory.ts, which is a
 * broader, in-process (non-persistent) buffer of arbitrary "what's live
 * right now" items — open threads, commitments, surfaced facts, watch
 * flags. This module answers a narrower, specifically numeric question
 * working-memory.ts's activation-decay model doesn't: "how many turns
 * has it actually been since goal X last won selection." goal-selector.ts
 * needs that exact count, not a decaying salience score, to avoid one
 * goal monomaniacally dominating every turn. The two are complementary,
 * not overlapping — this module doesn't try to also track open threads
 * or commitments, and working-memory.ts doesn't try to also count
 * turns-per-goal. This module is also durable (Redis) where
 * working-memory.ts is deliberately not, since goal recency needs to
 * survive across serverless invocations the way a scratchpad doesn't.
 */

import { logger } from '@/lib/logger';
import { redis }  from '@/lib/redis';

import type { RoutedAttention } from '@/lib/ai/attention-router';
import type { GoalRecency } from '@/lib/ai/goal-selector';

// ── Config ──────────────────────────────────────────────────────────────

const STACK_TTL = 60 * 60 * 6; // 6 hours — mirrors task-manager.ts's QUEUE_TTL, same "current session" scope
const MAX_GOAL_ENTRIES = 10;   // more than any character realistically has active goals at once
const MAX_ATTENTION_ENTRIES = 20;

// ── Types ───────────────────────────────────────────────────────────────

interface GoalFocusEntry {
  goalId:       string;
  lastTurnAt:   number; // epoch ms of the turn this goal was last selected
  turnsAdvanced: number; // running count — not currently consumed downstream, kept for future weighting/telemetry
}

interface AttentionFocusEntry {
  candidateId: string;
  lastTurnAt:  number;
}

export interface FocusStackState {
  goals:       GoalFocusEntry[];
  attention:   AttentionFocusEntry[];
  turnCounter: number;      // monotonic, incremented once per recorded turn — used to derive turns-since, not just wall-clock
  updatedAt:   number;
}

function emptyState(): FocusStackState {
  return { goals: [], attention: [], turnCounter: 0, updatedAt: Date.now() };
}

function focusKey(userId: string, characterId: string): string {
  return `vantrix:focus-stack:${userId}:${characterId}`;
}

// ── Storage ─────────────────────────────────────────────────────────────

export async function getFocusStack(userId: string, characterId: string): Promise<FocusStackState> {
  try {
    const state = await redis.get<FocusStackState>(focusKey(userId, characterId));
    return state ?? emptyState();
  } catch (err) {
    logger.warn('[focus-stack] Redis get failed', { userId, characterId, error: String(err) });
    return emptyState();
  }
}

async function saveFocusStack(userId: string, characterId: string, state: FocusStackState): Promise<void> {
  try {
    await redis.set(focusKey(userId, characterId), state, { ex: STACK_TTL });
  } catch (err) {
    logger.warn('[focus-stack] save failed', { userId, characterId, error: String(err) });
  }
}

// ── Read: derive recency for this turn's inputs ────────────────────────

/**
 * Derive GoalRecency[] for every goal id the caller cares about, from
 * whatever's currently on the stack. Goals never previously recorded get
 * omitted — goal-selector.ts already defaults unknown recency to a
 * reasonable neutral value, so there's no need to fabricate an entry
 * here for a goal the stack has never seen.
 */
export function deriveGoalRecency(state: FocusStackState, goalIds: string[]): GoalRecency[] {
  const byId = new Map(state.goals.map(g => [g.goalId, g]));
  const recency: GoalRecency[] = [];

  for (const id of goalIds) {
    const entry = byId.get(id);
    if (!entry) continue;
    recency.push({
      goalId: id,
      turnsSinceLastAdvanced: Math.max(0, state.turnCounter - entry.turnsAdvanced),
    });
  }

  return recency;
}

/**
 * Derive a staleness value (in the same rough unit salience-engine.ts
 * uses — turns/hours, monotonic) for a given attention candidate id, for
 * callers that want stack-backed staleness instead of a source-computed
 * guess. Returns null if the candidate has never been recorded — callers
 * should fall back to their own default in that case, not treat null as
 * zero (that would read as "just attended to," the opposite of unknown).
 */
export function deriveAttentionStaleness(state: FocusStackState, candidateId: string): number | null {
  const entry = state.attention.find(a => a.candidateId === candidateId);
  if (!entry) return null;
  // Elapsed hours since last selected — same unit salience-engine.ts's
  // hoursAgo() produces, so the two compose without a unit mismatch,
  // rather than reconstructing an approximate turn index from wall clock.
  return Math.max(0, (Date.now() - entry.lastTurnAt) / 3_600_000);
}

// ── Write: record what actually happened this turn ─────────────────────

/**
 * Call once per turn, after goal-selector.ts and attention-router.ts have
 * both run, with what they actually decided. Advances the stack's turn
 * counter and folds the new selections in, evicting the oldest entries
 * past the caps so this never grows unbounded across a long session.
 */
export async function recordFocusTurn(
  userId:       string,
  characterId:  string,
  selectedGoalId: string | null,
  routed:       RoutedAttention,
): Promise<FocusStackState> {
  const state = await getFocusStack(userId, characterId);
  const nextTurn = state.turnCounter + 1;
  const now = Date.now();

  let goals = [...state.goals];
  if (selectedGoalId) {
    const idx = goals.findIndex(g => g.goalId === selectedGoalId);
    if (idx >= 0) {
      goals[idx] = { ...goals[idx]!, lastTurnAt: now, turnsAdvanced: nextTurn };
    } else {
      goals.push({ goalId: selectedGoalId, lastTurnAt: now, turnsAdvanced: nextTurn });
    }
  }
  if (goals.length > MAX_GOAL_ENTRIES) {
    goals = goals.sort((a, b) => b.lastTurnAt - a.lastTurnAt).slice(0, MAX_GOAL_ENTRIES);
  }

  let attention = [...state.attention];
  for (const c of routed.selected) {
    const idx = attention.findIndex(a => a.candidateId === c.id);
    if (idx >= 0) {
      attention[idx] = { ...attention[idx]!, lastTurnAt: now };
    } else {
      attention.push({ candidateId: c.id, lastTurnAt: now });
    }
  }
  if (attention.length > MAX_ATTENTION_ENTRIES) {
    attention = attention.sort((a, b) => b.lastTurnAt - a.lastTurnAt).slice(0, MAX_ATTENTION_ENTRIES);
  }

  const updated: FocusStackState = { goals, attention, turnCounter: nextTurn, updatedAt: now };
  await saveFocusStack(userId, characterId, updated);
  return updated;
}
