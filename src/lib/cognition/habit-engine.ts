/**
 * Habit Engine — Vantrix Cognition Layer
 *
 * Base of a second additive chain alongside experience → lesson → wisdom
 * (see experience-engine.ts's header): habit-engine.ts (this file) tracks
 * individual cue→response pairs that have been reinforced enough to fire
 * without deliberation → routine-engine.ts sequences several habits into
 * an ordered multi-step routine → automatic-behavior.ts is the gate
 * consciousness-loop.ts / executive-controller.ts (cognition) can check
 * *before* paying for the full ai/executive-controller.ts pipeline, the
 * same "System 1 vs System 2" split the rest of this directory otherwise
 * only does deliberately (drives → goal → task → attention-router →
 * confidence, all of which run every turn regardless of whether the turn
 * actually needed that much thought).
 *
 *   habit-engine.ts       (this file) — cue → response strength, reinforced/decayed
 *   routine-engine.ts                 — ordered sequences of habits
 *   automatic-behavior.ts             — the fast-path decision gate
 *
 * GAP-FIX: this module used to keep its store as an in-process
 * `Map<string, Map<string, Habit>>` — dead across serverless invocations
 * for the same reason wisdom-engine.ts's was (see that file's header).
 * Now backed by habit-store.ts (Redis-cached Supabase, same pattern as
 * belief-store.ts). Every function here is now async as a result.
 *
 * automatic-behavior.ts's considerAutomaticResponse() is documented as a
 * *cheap* pre-deliberation gate — the whole point is that it should cost
 * less than the full executive-controller.ts pipeline it's meant to skip.
 * Making its habit lookups async (a Redis round-trip, cache-warm case
 * aside) means that gate is no longer free, but there was no working
 * synchronous alternative that also survives serverless: the old Map was
 * synchronous and free but empty on a cold instance, which made the gate
 * cheap and also silently useless in production. This trades "free but
 * broken" for "cheap-ish (Redis-cached) and actually working," which is
 * the correct tradeoff — automatic-behavior.ts is not currently called
 * from consciousness-loop.ts's live path (see that file's own gap notes),
 * so this is closing dead code's storage, not regressing a hot path.
 */

import { logger } from '@/lib/logger';
import {
  getAllHabits,
  upsertHabit,
  updateHabitsBulk,
  deleteHabits,
} from '@/lib/cognition/habit-store';

// ── Types ───────────────────────────────────────────────────────────────

export type HabitCue =
  | 'greeting'          // conversation opener
  | 'compliment'        // user paid a compliment
  | 'silence'           // user went quiet / short replies
  | 'good_news'         // user shared something positive
  | 'bad_news'          // user shared something difficult
  | 'goodbye'           // conversation winding down
  | 'callback'          // a recurring topic/inside joke came back up
  | 'other';

export interface Habit {
  id: string;
  cue: HabitCue;
  /** Short, prompt-ready description of the automatic response, e.g.
   *  "responds to a compliment with a teasing deflection". */
  response: string;
  /** 0..1. Grows with reward, shrinks with punishment or plain disuse. */
  strength: number;
  timesFired: number;
  timesRewarded: number;
  lastFiredTurn: number;
}

// A habit needs to clear this strength before automatic-behavior.ts will
// treat it as safe to fire without deliberation.
export const FIRING_THRESHOLD = 0.55;
const REWARD_STEP = 0.12;
const PUNISH_STEP = 0.2;
// Passive decay applied by runHabitMaintenance() for a habit that hasn't
// fired since the last sweep — undriven habits should fade, not linger
// at whatever strength they last reached.
const DECAY_PER_SWEEP = 0.04;
const MIN_STRENGTH = 0;
const MAX_STRENGTH = 1;

function habitKey(cue: HabitCue, response: string): string {
  return `${cue}:${response}`;
}

// Same non-uuid-sentinel convention as wisdom-engine.ts's draftId — a
// habit that hasn't been persisted yet gets a legible placeholder id.
function draftId(userId: string, characterId: string, hKey: string): string {
  return `habit-${userId}-${characterId}-${hKey}`;
}

function clamp(n: number): number {
  return Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, n));
}

// ── Write path ──────────────────────────────────────────────────────────

/**
 * Register or reinforce a cue→response pair. Call this from wherever a
 * response was actually chosen and its outcome is known this turn (or
 * on the next turn, once the reaction to it is visible) — same
 * after-the-fact bookkeeping shape as metacognition.ts's recordOutcome().
 */
export async function recordHabitOutcome(
  userId: string,
  characterId: string,
  turn: number,
  cue: HabitCue,
  response: string,
  rewarded: boolean,
): Promise<Habit> {
  const all = await getAllHabits(userId, characterId);
  const hKey = habitKey(cue, response);
  const existing = all.find(h => h.cue === cue && h.response === response);

  const next: Habit = existing
    ? {
        ...existing,
        timesFired: existing.timesFired + 1,
        timesRewarded: existing.timesRewarded + (rewarded ? 1 : 0),
        strength: clamp(existing.strength + (rewarded ? REWARD_STEP : -PUNISH_STEP)),
        lastFiredTurn: turn,
      }
    : {
        id: draftId(userId, characterId, hKey),
        cue,
        response,
        strength: rewarded ? 0.3 : 0.1,
        timesFired: 1,
        timesRewarded: rewarded ? 1 : 0,
        lastFiredTurn: turn,
      };

  const persisted = await upsertHabit(userId, characterId, next);

  logger.debug('[cognition/habit-engine]', {
    userId, characterId, cue, rewarded, strength: (persisted ?? next).strength,
    event: existing ? 'reinforced' : 'registered',
  });

  return persisted ?? next;
}

// ── Read path ─────────────────────────────────────────────────────────────

/** All habits for a given cue, strongest first. */
export async function getHabitsForCue(userId: string, characterId: string, cue: HabitCue): Promise<Habit[]> {
  const all = await getAllHabits(userId, characterId);
  return all.filter(h => h.cue === cue).sort((a, b) => b.strength - a.strength);
}

/** The single strongest habit for a cue, if any clear FIRING_THRESHOLD. */
export async function getDominantHabit(userId: string, characterId: string, cue: HabitCue): Promise<Habit | null> {
  const candidates = await getHabitsForCue(userId, characterId, cue);
  const top = candidates[0];
  return top && top.strength >= FIRING_THRESHOLD ? top : null;
}

export function formatHabitsForPrompt(habits: Habit[]): string {
  if (habits.length === 0) return '';
  return `Habitual responses: ${habits.map(h => h.response).join('; ')}`;
}

// ── Maintenance sweep ──────────────────────────────────────────────────────

export interface HabitMaintenanceReport {
  userId: string;
  characterId: string;
  decayed: number;
  dropped: number;
}

/**
 * Cron-driven decay pass, same role as belief-engine.ts's
 * runBeliefMaintenance() / wisdom-engine.ts's runWisdomMaintenance() —
 * weakens anything not fired since `sinceTurn` and drops it once it
 * bottoms out, so an old habit that's stopped recurring doesn't linger
 * forever at its last-earned strength.
 */
export async function runHabitMaintenance(
  userId: string,
  characterId: string,
  sinceTurn: number,
): Promise<HabitMaintenanceReport> {
  const all = await getAllHabits(userId, characterId);
  const toUpdate: Habit[] = [];
  const toDropIds: string[] = [];
  let decayed = 0;
  let dropped = 0;

  for (const habit of all) {
    if (habit.lastFiredTurn >= sinceTurn) continue;
    const nextStrength = clamp(habit.strength - DECAY_PER_SWEEP);
    decayed += 1;
    if (nextStrength <= MIN_STRENGTH) {
      toDropIds.push(habit.id);
      dropped += 1;
    } else {
      toUpdate.push({ ...habit, strength: nextStrength });
    }
  }

  if (toUpdate.length > 0) await updateHabitsBulk(userId, characterId, toUpdate);
  if (toDropIds.length > 0) await deleteHabits(userId, characterId, toDropIds);

  logger.debug('[cognition/habit-engine] maintenance swept', {
    userId, characterId, decayed, dropped,
  });

  return { userId, characterId, decayed, dropped };
}

export interface HabitMaintenanceCronReport {
  pairsScanned: number;
  pairsFailed: number;
  totalDecayed: number;
  totalDropped: number;
}

/** Batched entry point for the habit half of the cron in
 *  api/cron/wisdom-habit-maintenance/route.ts — same shape as, and same
 *  sinceTurn=0 bug fix as, wisdom-engine.ts's runWisdomMaintenanceCron().
 *  Each pair now carries its own currentTurn (character_psychology.
 *  total_interactions), used as that pair's sinceTurn — see
 *  wisdom-engine.ts's version for the full rationale. */
export async function runHabitMaintenanceCron(
  distinctPairs: Array<{ userId: string; characterId: string; currentTurn: number }>,
): Promise<HabitMaintenanceCronReport> {
  const report: HabitMaintenanceCronReport = {
    pairsScanned: 0, pairsFailed: 0, totalDecayed: 0, totalDropped: 0,
  };

  for (const { userId, characterId, currentTurn } of distinctPairs) {
    try {
      const result = await runHabitMaintenance(userId, characterId, currentTurn);
      report.pairsScanned += 1;
      report.totalDecayed += result.decayed;
      report.totalDropped += result.dropped;
    } catch (err) {
      report.pairsFailed += 1;
      logger.warn('[cognition/habit-engine] maintenance-cron pair failed', {
        userId, characterId, error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('[cognition/habit-engine] maintenance-cron complete', { ...report });
  return report;
}

/** Test/session-reset helper — clears only the Redis cache layer, same
 *  caveat as wisdom-engine.ts's resetWisdom(). */
export async function resetHabits(userId: string, characterId: string): Promise<void> {
  const { invalidate } = await import('@/lib/cognition/habit-store');
  await invalidate(userId, characterId);
}
