/**
 * Belief Types — Vantrix Cognition Layer
 *
 * Shared shapes for belief-store.ts / belief-update.ts / belief-conflict.ts /
 * belief-decay.ts / belief-engine.ts. Split into its own file purely to
 * avoid a circular-import knot (store and conflict both need the Belief
 * type; conflict also needs reasoning-engine's Claim type, and store must
 * not depend on conflict).
 *
 * Where this sits relative to what already exists:
 *   - src/lib/ai/user-fact-graph.ts extracts flat UserFacts (category/key/
 *     value/confidence) and persists them, but never checks a new fact
 *     against an old one that disagrees, and never fades a fact that
 *     stops being reinforced.
 *   - src/lib/cognition/theory-of-mind.ts models what the user believes,
 *     in-process only (Map, lost on restart), replacing the prior signal
 *     per referent outright rather than reconciling confidence.
 *   - This subsystem is the missing durable middle: persisted beliefs
 *     (survive restarts, queryable across sessions) with confidence that
 *     accumulates with reinforcement, contradicts explicitly instead of
 *     silently overwriting, and decays when unused. It does not replace
 *     either module above — belief-engine.ts's recordBelief() is meant to
 *     be called from the same extraction call sites that currently feed
 *     user-fact-graph.ts, and getActiveBeliefs() is meant to feed
 *     theory-of-mind.ts's reconcile() as ground truth alongside
 *     working-memory.
 */

export type BeliefCategory =
  | 'family'
  | 'work'
  | 'hobby'
  | 'location'
  | 'preference'
  | 'pain_point'
  | 'aspiration'
  | 'opinion'
  | 'relationship'
  | 'trait';

export type BeliefPolarity = 'affirms' | 'negates';

export type BeliefSource = 'heuristic' | 'ai' | 'stated' | 'inferred';

export type BeliefStatus = 'active' | 'superseded' | 'decayed' | 'unresolved';

/**
 * A single persisted belief. `subject` is the axis beliefs compete on —
 * two beliefs only ever conflict if they share a subject (same convention
 * as reasoning-engine.ts's Claim.subject: free text, not a closed enum,
 * so upstream extraction code doesn't need to register subjects anywhere).
 * Keep subjects specific enough that unrelated facts don't collide
 * ("coffee_preference", not "preferences").
 */
export interface Belief {
  id: string;
  userId: string;
  characterId: string;
  subject: string;
  category: BeliefCategory;
  /** Prompt-ready natural-language statement, e.g. "drinks her coffee black". */
  statement: string;
  polarity: BeliefPolarity;
  /** 0-1. How confident the character should be that this is still true. */
  confidence: number;
  evidenceCount: number;
  source: BeliefSource;
  status: BeliefStatus;
  /** id of the belief this one replaced, if any — kept for audit trail. */
  supersedes: string | null;
  createdAt: string;
  lastReinforcedAt: string;
  lastUsedAt: string | null;
}

/**
 * New evidence about a subject, not yet reconciled against the store.
 * This is the input shape callers (extraction pipelines) build.
 */
export interface BeliefEvidence {
  subject: string;
  category: BeliefCategory;
  statement: string;
  polarity: BeliefPolarity;
  /** 0-1. How strongly this single piece of evidence supports the statement. */
  confidence: number;
  source: BeliefSource;
}

export const MIN_CONFIDENCE = 0.05;
export const MAX_CONFIDENCE = 0.98;

export function clampConfidence(n: number): number {
  return Math.max(MIN_CONFIDENCE, Math.min(MAX_CONFIDENCE, n));
}
