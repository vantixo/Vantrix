/**
 * Belief Decay — Vantrix Cognition Layer
 *
 * Nothing else in this codebase reduces a stored fact's confidence just
 * because time passed and it was never mentioned again — user-fact-graph.ts
 * facts and core-beliefs.ts's seeded beliefs are otherwise stable until
 * explicitly overwritten. That's fine for slow-changing categories (family,
 * trait) but wrong for ones that go stale (an aspiration achieved and
 * dropped, a stress that resolved, a preference from months ago). This
 * module applies exponential half-life decay per category, run as a
 * maintenance sweep (belief-engine.ts's runBeliefMaintenance, intended to
 * be cron-driven the same way surprise-engine.ts and priority-memory.ts
 * are) rather than on every read — decaying on every read would make
 * confidence depend on how often someone happens to check, which isn't
 * the intent.
 *
 * Decay is measured from `lastReinforcedAt` OR `lastUsedAt`, whichever is
 * more recent — a belief that keeps getting surfaced into prompts (even
 * without new confirming evidence) is doing real work and shouldn't fade
 * just because the user hasn't re-stated it.
 */

import { clampConfidence, MIN_CONFIDENCE, type Belief, type BeliefCategory } from '@/lib/cognition/belief-types';

// Half-life in days per category — how long until confidence halves with
// no reinforcement or use. Pain points and family facts are treated as
// durable; preferences and aspirations are treated as more likely to
// drift or resolve.
const HALF_LIFE_DAYS: Record<BeliefCategory, number> = {
  family: 240,
  pain_point: 120,
  relationship: 120,
  trait: 180,
  work: 150,
  location: 150,
  opinion: 90,
  aspiration: 60,
  hobby: 90,
  preference: 75,
};

// Below this, a belief stops being useful enough to keep surfacing but
// isn't deleted — status flips to 'decayed' and it's excluded from
// getActiveBeliefs() while remaining in the audit trail.
const DECAY_STATUS_FLOOR = 0.12;

function daysSince(iso: string, now: number): number {
  return Math.max(0, (now - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Pure function: given one belief and the current time, return the
 * decayed version. Never mutates the input. A belief already
 * 'superseded' or 'decayed' is returned unchanged — decay only applies
 * to beliefs still doing active work ('active' or 'unresolved').
 */
export function decayBelief(belief: Belief, now: number = Date.now()): Belief {
  if (belief.status !== 'active' && belief.status !== 'unresolved') return belief;

  const halfLife = HALF_LIFE_DAYS[belief.category] ?? 120;
  const referenceIso = belief.lastUsedAt && belief.lastUsedAt > belief.lastReinforcedAt
    ? belief.lastUsedAt
    : belief.lastReinforcedAt;

  const elapsedDays = daysSince(referenceIso, now);
  if (elapsedDays <= 0) return belief;

  const decayFactor = Math.pow(0.5, elapsedDays / halfLife);
  const decayed = clampConfidence(belief.confidence * decayFactor);

  const status = decayed <= DECAY_STATUS_FLOOR ? 'decayed' : belief.status;

  if (decayed === belief.confidence && status === belief.status) return belief;

  return { ...belief, confidence: decayed, status };
}

/**
 * Decay a whole belief set at once. Returns only the beliefs whose
 * confidence or status actually changed, so belief-store.ts's
 * updateBeliefsBulk only writes rows that need writing.
 */
export function decayBeliefSet(beliefs: Belief[], now: number = Date.now()): Belief[] {
  const changed: Belief[] = [];
  for (const b of beliefs) {
    const decayed = decayBelief(b, now);
    if (decayed !== b) changed.push(decayed);
  }
  return changed;
}

/** Touch a belief as "used" (surfaced into a prompt) without changing its
 *  confidence directly — resets the decay clock per the rule above. Call
 *  this from wherever beliefs get formatted into a prompt, mirroring how
 *  working-memory.ts touches `lastTouchedTurn` on read. */
export function touchBelief(belief: Belief, now: number = Date.now()): Belief {
  return { ...belief, lastUsedAt: new Date(now).toISOString() };
}

export { DECAY_STATUS_FLOOR, MIN_CONFIDENCE as DECAY_HARD_FLOOR };
