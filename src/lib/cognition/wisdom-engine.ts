/**
 * Wisdom Engine — Vantrix Cognition Layer
 *
 * Top of the experience → lesson → wisdom chain (see
 * experience-engine.ts's header). lesson-engine.ts already gates out
 * one-off noise via PROMOTION_THRESHOLD; this module is the further
 * step of turning a *promotable* lesson into a WisdomPrinciple — a
 * durable, prompt-ready statement about how this relationship works
 * ("she opens up more after a shared quiet moment than after a direct
 * question") that's meant to keep informing behavior long after the
 * individual ExperienceRecords that supported it have scrolled out of
 * experience-engine.ts's bounded log.
 *
 * Same three-part shape as belief-engine.ts:
 *   synthesizeWisdom()      — write path, called from wherever lesson-engine.ts's
 *                             getPromotableLessons() is checked (session end,
 *                             same cadence as reflection-engine.ts's session pass)
 *   getWisdom()              — read path, for prompt injection
 *   runWisdomMaintenance()   — cron-driven decay sweep, same role as
 *                             belief-engine.ts's runBeliefMaintenance()
 *
 * GAP-FIX: this module used to keep its store as an in-process
 * `Map<string, Map<string, WisdomPrinciple>>`, which its own header
 * correctly flagged as needing promotion to a Supabase-backed store to
 * survive process restarts — in production, a serverless chat request and
 * a later cron/chat invocation aren't guaranteed to share a process, so
 * that Map was effectively always empty by the time it mattered. Now
 * backed by wisdom-store.ts (Redis-cached Supabase, same pattern as
 * belief-store.ts), which is what makes runWisdomMaintenance() actually
 * meaningful when cron-driven. Every function here is now async as a
 * result — callers (synthesizeWisdom at session end, getWisdom for prompt
 * injection) need an await they didn't before.
 */

import { logger } from '@/lib/logger';
import { getPromotableLessons, type Lesson } from '@/lib/cognition/lesson-engine';
import {
  getAllWisdom,
  upsertWisdom,
  updateWisdomBulk,
  deleteWisdom,
} from '@/lib/cognition/wisdom-store';

// ── Types ───────────────────────────────────────────────────────────────

export interface WisdomPrinciple {
  id: string;
  /** Short, prompt-ready statement of the durable pattern. */
  principle: string;
  domain: Lesson['category'];
  /** 0..1. Starts from the source lesson's confidence, grows with reapplication. */
  confidence: number;
  timesApplied: number;
  lastAppliedTurn: number;
  derivedFromLessonIds: string[];
}

// Below this, a principle is considered stale enough that getWisdom()
// stops surfacing it — same idea as belief-decay.ts's threshold, but
// wisdom decays slower since it represents more corroborated ground.
const RETIREMENT_THRESHOLD = 0.15;
// Confidence lost per maintenance sweep for a principle that wasn't
// reapplied since the last sweep.
const DECAY_PER_SWEEP = 0.05;

// A synthesizeWisdom() call that hasn't been persisted yet needs a
// placeholder id for wisdom-store.ts's isRealId() to recognize as "not a
// real row" — same non-uuid-sentinel convention as before, kept purely so
// a caller inspecting the return value mid-flight still gets something
// legible in logs if the upsert fails and persisted stays null.
function draftId(userId: string, characterId: string, wisdomKey: string): string {
  return `wisdom-${userId}-${characterId}-${wisdomKey}`;
}

// ── Write path ──────────────────────────────────────────────────────────

/**
 * Check lesson-engine.ts's promotable lessons and fold any new ones into
 * the durable wisdom set, reinforcing principles that already exist for
 * the same category+insight. Intended to run once per session end,
 * alongside reflection-engine.ts's reflectOnSession() and
 * lesson-engine.ts's reinforceLessons() — not per turn.
 */
export async function synthesizeWisdom(
  userId: string,
  characterId: string,
  turn: number,
): Promise<WisdomPrinciple[]> {
  const promotable = getPromotableLessons(userId, characterId);
  if (promotable.length === 0) return [];

  const existingAll = await getAllWisdom(userId, characterId);
  const byKey = new Map(existingAll.map(w => [`${w.domain}:${w.principle}`, w]));
  const touched: WisdomPrinciple[] = [];

  for (const lesson of promotable) {
    const wisdomKey = `${lesson.category}:${lesson.insight}`;
    const existing = byKey.get(wisdomKey);

    const next: WisdomPrinciple = existing
      ? {
          ...existing,
          timesApplied: existing.timesApplied + 1,
          confidence: Math.min(1, existing.confidence + 0.1),
          lastAppliedTurn: turn,
          derivedFromLessonIds: existing.derivedFromLessonIds.includes(lesson.id)
            ? existing.derivedFromLessonIds
            : [...existing.derivedFromLessonIds, lesson.id],
        }
      : {
          id: draftId(userId, characterId, wisdomKey),
          principle: lesson.insight,
          domain: lesson.category,
          confidence: lesson.confidence,
          timesApplied: 1,
          lastAppliedTurn: turn,
          derivedFromLessonIds: [lesson.id],
        };

    const persisted = await upsertWisdom(userId, characterId, next);
    touched.push(persisted ?? next);
    if (persisted) byKey.set(wisdomKey, persisted);
  }

  logger.debug('[cognition/wisdom-engine] synthesized', {
    userId, characterId, turn, promoted: touched.length,
  });

  return touched;
}

// ── Read path ─────────────────────────────────────────────────────────────

/** Active (non-retired) wisdom, highest confidence first. */
export async function getWisdom(userId: string, characterId: string): Promise<WisdomPrinciple[]> {
  const all = await getAllWisdom(userId, characterId);
  return all
    .filter(w => w.confidence >= RETIREMENT_THRESHOLD)
    .sort((a, b) => b.confidence - a.confidence);
}

export function formatWisdomForPrompt(principles: WisdomPrinciple[]): string {
  if (principles.length === 0) return '';
  return `What's been learned about this relationship: ${principles.map(p => p.principle).join('; ')}`;
}

// ── Maintenance sweep ──────────────────────────────────────────────────────

export interface WisdomMaintenanceReport {
  userId: string;
  characterId: string;
  decayed: number;
  retired: number;
}

/**
 * Cron-driven decay pass, same role/cadence as belief-engine.ts's
 * runBeliefMaintenance() — walks every stored principle for this pair
 * and decays anything not reapplied since `sinceTurn`, dropping it
 * entirely once it crosses RETIREMENT_THRESHOLD so the store doesn't
 * grow unbounded with principles nobody's relied on in a long time.
 */
export async function runWisdomMaintenance(
  userId: string,
  characterId: string,
  sinceTurn: number,
): Promise<WisdomMaintenanceReport> {
  const all = await getAllWisdom(userId, characterId);
  const toUpdate: WisdomPrinciple[] = [];
  const toRetireIds: string[] = [];
  let decayed = 0;
  let retired = 0;

  for (const principle of all) {
    if (principle.lastAppliedTurn >= sinceTurn) continue;
    const nextConfidence = Math.max(0, principle.confidence - DECAY_PER_SWEEP);
    decayed += 1;
    if (nextConfidence < RETIREMENT_THRESHOLD) {
      toRetireIds.push(principle.id);
      retired += 1;
    } else {
      toUpdate.push({ ...principle, confidence: nextConfidence });
    }
  }

  if (toUpdate.length > 0) await updateWisdomBulk(userId, characterId, toUpdate);
  if (toRetireIds.length > 0) await deleteWisdom(userId, characterId, toRetireIds);

  logger.debug('[cognition/wisdom-engine] maintenance swept', {
    userId, characterId, decayed, retired,
  });

  return { userId, characterId, decayed, retired };
}

export interface WisdomMaintenanceCronReport {
  pairsScanned: number;
  pairsFailed: number;
  totalDecayed: number;
  totalRetired: number;
}

/**
 * Batched entry point for the wisdom half of the cron in
 * api/cron/wisdom-habit-maintenance/route.ts — same
 * "scan distinct pairs off the table itself" shape as
 * belief-engine.ts's runBeliefMaintenanceCron(), for the same reason:
 * most relationships have no stored wisdom yet, so sweeping every active
 * relationship would mostly be wasted round-trips.
 *
 * BUG FIX: this used to take a single shared `sinceTurn` (defaulted to
 * 0) applied to every pair. Since a real lastAppliedTurn is never
 * negative, `lastAppliedTurn >= 0` was true for every principle, every
 * week — the sweep never decayed anything. Each pair now carries its own
 * `currentTurn` (character_psychology.total_interactions, fetched by the
 * caller), used directly as that pair's sinceTurn: "hasn't been
 * reapplied as of this week's actual turn count" is the correct reading
 * of "decay anything not reapplied since sinceTurn" without needing a
 * separately-invented staleness window — DECAY_PER_SWEEP is deliberately
 * small, so a principle still genuinely in use climbs back up from real
 * reinforcement faster than this weekly nudge erodes it.
 */
export async function runWisdomMaintenanceCron(
  distinctPairs: Array<{ userId: string; characterId: string; currentTurn: number }>,
): Promise<WisdomMaintenanceCronReport> {
  const report: WisdomMaintenanceCronReport = {
    pairsScanned: 0, pairsFailed: 0, totalDecayed: 0, totalRetired: 0,
  };

  for (const { userId, characterId, currentTurn } of distinctPairs) {
    try {
      const result = await runWisdomMaintenance(userId, characterId, currentTurn);
      report.pairsScanned += 1;
      report.totalDecayed += result.decayed;
      report.totalRetired += result.retired;
    } catch (err) {
      report.pairsFailed += 1;
      logger.warn('[cognition/wisdom-engine] maintenance-cron pair failed', {
        userId, characterId, error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('[cognition/wisdom-engine] maintenance-cron complete', { ...report });
  return report;
}

/** Test/session-reset helper — same shape as resetWorkingMemory / resetPlans.
 *  Only clears the Redis cache layer; does not delete persisted rows, since
 *  (unlike the old in-memory Map) this store's rows are the durable record,
 *  not a scratchpad. Use deleteWisdom() directly in tests that need to
 *  clear Supabase state too. */
export async function resetWisdom(userId: string, characterId: string): Promise<void> {
  const { invalidate } = await import('@/lib/cognition/wisdom-store');
  await invalidate(userId, characterId);
}
