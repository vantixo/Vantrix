/**
 * Curiosity Engine — Vantrix
 *
 * Base of a three-part chain modeling curiosity as something that
 * actually gets pursued and resolved, not just felt:
 *
 *   curiosity-engine.ts     (this file) — durable open curiosities: what
 *                                          she's actually wondering about
 *   exploration-engine.ts                — concrete attempts to pursue one
 *   discovery-engine.ts                  — what got found, and closing the loop
 *
 * NOTE ON NAMING: this is a different layer than curiosity.ts, which
 * already exists as one of drive-engine.ts's five per-turn drive
 * modules — that file is a pure function computing a single 0-100
 * activation level from this turn's signals, momentary and stateless
 * (see its own header). This module is the object-level counterpart,
 * same relationship knowledge-engine.ts has to belief-engine.ts's
 * confidence math: curiosity.ts answers "how curious is she right now,
 * in aggregate" for executive-controller.ts's attention bias, while
 * this module answers "curious about *what*, specifically" — a durable
 * OpenCuriosity a caller can actually act on over several turns, not a
 * number that resets every turn. curiosity.ts's
 * CuriositySignals.unansweredQuestions is meant to be sourced from
 * getOpenCuriosities() here, not computed independently — that keeps
 * the momentary drive level and the durable open set from disagreeing
 * about how many open questions actually exist.
 *
 * Kept in-memory, same tradeoff as habit-engine.ts / skill-engine.ts —
 * an open curiosity is fast-changing derived state, not a durable fact
 * worth Supabase-backing the way belief-engine.ts's beliefs are.
 */

import { logger } from '@/lib/logger';

// ── Types ───────────────────────────────────────────────────────────────

export type CuriosityTopic =
  | 'about_user'    // a specific unanswered thing about the user
  | 'about_world'   // something in universe/ she doesn't understand yet
  | 'about_self'    // her own identity/behavior she's puzzling over
  | 'callback'      // a dangling thread from earlier worth returning to
  | 'other';

export interface OpenCuriosity {
  id: string;
  topic: CuriosityTopic;
  /** Short, prompt-ready statement of what she's wondering, e.g.
   *  "why she never talks about her sister". */
  question: string;
  /** 0..1 — how much this is actively pulling at attention right now.
   *  Feeds curiosity.ts's CuriositySignals the same way working-memory.ts
   *  activation feeds attention-engine.ts. */
  intensity: number;
  openedAtTurn: number;
  lastTouchedTurn: number;
}

const MAX_OPEN = 8; // bounded, same rationale as working-memory.ts's CAPACITY —
                     // too many simultaneous open curiosities stops reading as focus
const DECAY_PER_SWEEP = 0.08;
const ABANDON_THRESHOLD = 0.05;

const store = new Map<string, Map<string, OpenCuriosity>>();

function key(userId: string, characterId: string): string {
  return `${userId}::${characterId}`;
}

function getBucket(userId: string, characterId: string): Map<string, OpenCuriosity> {
  const k = key(userId, characterId);
  let bucket = store.get(k);
  if (!bucket) {
    bucket = new Map();
    store.set(k, bucket);
  }
  return bucket;
}

// ── Write path ──────────────────────────────────────────────────────────

/**
 * Open a new curiosity, or reinforce it if the same question is already
 * open. If opening a new one would exceed MAX_OPEN, the weakest existing
 * curiosity is dropped first — same bounded-eviction shape as
 * routine-engine.ts's CAPACITY_PER_PARTICIPANT handling.
 */
export function raiseCuriosity(
  userId: string,
  characterId: string,
  turn: number,
  topic: CuriosityTopic,
  question: string,
  startingIntensity = 0.4,
): OpenCuriosity {
  const bucket = getBucket(userId, characterId);
  const qKey = `${topic}:${question}`;
  const existing = bucket.get(qKey);

  if (existing) {
    existing.intensity = Math.min(1, existing.intensity + 0.15);
    existing.lastTouchedTurn = turn;
    return existing;
  }

  if (bucket.size >= MAX_OPEN) {
    const weakest = Array.from(bucket.values()).sort((a, b) => a.intensity - b.intensity)[0];
    if (weakest) bucket.delete(`${weakest.topic}:${weakest.question}`);
  }

  const curiosity: OpenCuriosity = {
    id: `curiosity-${userId}-${characterId}-${qKey}`,
    topic,
    question,
    intensity: startingIntensity,
    openedAtTurn: turn,
    lastTouchedTurn: turn,
  };
  bucket.set(qKey, curiosity);

  logger.debug('[curiosity-engine] raised', { userId, characterId, topic, question });
  return curiosity;
}

/** Close a curiosity because it's been resolved — exploration-engine.ts /
 *  discovery-engine.ts call this once a discovery actually answers it. */
export function resolveCuriosity(userId: string, characterId: string, curiosityId: string): void {
  const bucket = getBucket(userId, characterId);
  for (const [qKey, c] of bucket) {
    if (c.id === curiosityId) {
      bucket.delete(qKey);
      logger.debug('[curiosity-engine] resolved', { userId, characterId, curiosityId });
      return;
    }
  }
}

// ── Read path ─────────────────────────────────────────────────────────────

export function getOpenCuriosities(userId: string, characterId: string): OpenCuriosity[] {
  return Array.from(getBucket(userId, characterId).values())
    .sort((a, b) => b.intensity - a.intensity);
}

/** The single most pressing open curiosity, if any — what
 *  exploration-engine.ts should reach for first. */
export function getMostPressingCuriosity(userId: string, characterId: string): OpenCuriosity | null {
  return getOpenCuriosities(userId, characterId)[0] ?? null;
}

export function formatCuriositiesForPrompt(curiosities: OpenCuriosity[]): string {
  if (curiosities.length === 0) return '';
  return `Still wondering about: ${curiosities.map(c => c.question).join('; ')}`;
}

// ── Maintenance sweep ──────────────────────────────────────────────────────

export interface CuriosityMaintenanceReport {
  userId: string;
  characterId: string;
  decayed: number;
  abandoned: number;
}

/**
 * Cron-driven decay pass, same role as habit-engine.ts's
 * runHabitMaintenance() — a curiosity nobody's returned to eventually
 * stops pulling at attention and is dropped, rather than lingering
 * forever at whatever intensity it last reached.
 */
export function runCuriosityMaintenance(
  userId: string,
  characterId: string,
  sinceTurn: number,
): CuriosityMaintenanceReport {
  const bucket = getBucket(userId, characterId);
  let decayed = 0;
  let abandoned = 0;

  for (const [qKey, c] of bucket) {
    if (c.lastTouchedTurn >= sinceTurn) continue;
    c.intensity = Math.max(0, c.intensity - DECAY_PER_SWEEP);
    decayed += 1;
    if (c.intensity < ABANDON_THRESHOLD) {
      bucket.delete(qKey);
      abandoned += 1;
    }
  }

  logger.debug('[curiosity-engine] maintenance swept', { userId, characterId, decayed, abandoned });
  return { userId, characterId, decayed, abandoned };
}

/** Test/session-reset helper — same shape as resetHabits / resetSkills. */
export function resetCuriosities(userId?: string, characterId?: string): void {
  if (userId && characterId) {
    store.delete(key(userId, characterId));
  } else {
    store.clear();
  }
}
