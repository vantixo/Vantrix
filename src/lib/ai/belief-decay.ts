/**
 * Belief Decay — Vantrix
 *
 * Beliefs that stop getting reinforced should soften, not stay frozen at
 * whatever confidence they hit last. Without this, a belief formed from
 * one sharp early moment ("he canceled on me once, he's unreliable") would
 * sit at the same strength forever even if the following six months gave
 * no further evidence either way — which reads as her holding a grudge
 * indefinitely rather than a belief naturally loosening its grip with time
 * and lack of reinforcement, the way real impressions do.
 *
 * Pure function over BeliefState — belief-engine.ts is responsible for
 * calling this and persisting the result; this module has no storage of
 * its own.
 */

import type { BeliefState, BeliefRecord } from '@/lib/ai/belief-engine';

// ── Config ──────────────────────────────────────────────────────────────

const DAY_MS = 1000 * 60 * 60 * 24;

// Grace period before decay starts — a belief shouldn't visibly soften
// just because a few days passed without new evidence.
const GRACE_DAYS = 10;

// How much confidence drains per day once past the grace period, scaled
// down for beliefs with a lot of accumulated evidence (a belief backed by
// twenty experiences shouldn't fade as fast as one backed by two).
const BASE_DECAY_PER_DAY = 0.6;

// Confidence floor — decay never fully erases a belief, it just makes it
// quiet. Full removal only happens via explicit eviction in
// belief-updater.ts when the slot is needed for something new.
const DECAY_FLOOR = 15;

// Beliefs this old with this little confidence are candidates for pruning
// entirely, since they're no longer doing any real work in the prompt.
const PRUNE_CONFIDENCE = 18;
const PRUNE_AFTER_DAYS = 45;

// ── Decay ───────────────────────────────────────────────────────────────

function daysSince(timestamp: number, now: number): number {
  return (now - timestamp) / DAY_MS;
}

function decayOne(belief: BeliefRecord, now: number): BeliefRecord {
  const idleDays = daysSince(belief.lastReinforced, now);
  if (idleDays <= GRACE_DAYS) return belief;

  const evidenceTotal = belief.evidenceFor + belief.evidenceAgainst;
  // More corroborating evidence = more resistant to decay, but never
  // fully immune — floor the resistance factor so nothing decays at 0.
  const resistance = Math.max(0.25, 1 - Math.min(evidenceTotal, 15) / 20);

  const decayDays = idleDays - GRACE_DAYS;
  const drop = decayDays * BASE_DECAY_PER_DAY * resistance;

  const confidence = Math.max(DECAY_FLOOR, Math.round(belief.confidence - drop));
  if (confidence === belief.confidence) return belief;

  return { ...belief, confidence };
}

function shouldPrune(belief: BeliefRecord, now: number): boolean {
  return belief.confidence <= PRUNE_CONFIDENCE && daysSince(belief.lastReinforced, now) >= PRUNE_AFTER_DAYS;
}

export interface DecayResult {
  state:   BeliefState;
  changed: boolean;
  prunedIds: string[];
}

/**
 * Apply time-based decay to every belief, then prune any that have drifted
 * long enough at a low enough confidence to no longer be worth keeping.
 * Cheap, synchronous, deterministic — safe to call every turn.
 */
export function decayStaleBeliefs(state: BeliefState): DecayResult {
  const now = Date.now();
  const prunedIds: string[] = [];

  const decayed = state.beliefs.map(b => decayOne(b, now));
  const kept = decayed.filter((b) => {
    const prune = shouldPrune(b, now);
    if (prune) prunedIds.push(b.id);
    return !prune;
  });

  const changed =
    prunedIds.length > 0 ||
    kept.some((b, i) => b.confidence !== state.beliefs[i]?.confidence);

  return {
    state: changed ? { beliefs: kept, updatedAt: now } : state,
    changed,
    prunedIds,
  };
}
