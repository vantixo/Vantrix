/**
 * Belief Conflict — Vantrix Cognition Layer
 *
 * Decides what happens when new evidence about a subject disagrees with
 * an already-active belief on that same subject (e.g. stored belief:
 * "doesn't drink coffee", 0.7 confidence; new evidence this turn: "loves
 * her morning coffee", 0.6 confidence — people also just... change, or an
 * earlier heuristic extraction was wrong). Reuses reasoning-engine.ts's
 * arithmetic (`reason`) rather than re-inventing conflict math, so a
 * belief conflict and an in-turn reasoning conflict resolve by the same
 * rules and CONFLICT_MARGIN.
 *
 * This module only decides *what to do* — belief-update.ts is what
 * actually mutates/persists the outcome.
 */

import { reason, type Claim } from '@/lib/cognition/reasoning-engine';
import type { Belief, BeliefEvidence } from '@/lib/cognition/belief-types';

export type ConflictDecision =
  | 'no_conflict'      // different polarity/subject don't actually collide, or evidence agrees
  | 'reinforce'        // same polarity — evidence agrees with the existing belief
  | 'replace'          // evidence clearly outweighs the existing belief
  | 'keep_existing'    // existing belief clearly outweighs the new evidence
  | 'unresolved';      // too close to call — both stay, flagged for a human/AI pass later

export interface ConflictResult {
  decision: ConflictDecision;
  /** Existing-belief "weight" used in the decision — evidenceCount acts as
   *  a confidence multiplier so a belief reinforced ten times isn't
   *  flipped by one contradicting message the way a single-evidence
   *  belief would be. */
  existingWeight: number;
  evidenceWeight: number;
  reason: string;
}

// A belief reinforced this many times or more is treated as "well
// established" and gets the full weight multiplier below; less than that
// scales down linearly. Keeps a belief seen once from being as sticky as
// one confirmed five times.
const ESTABLISHED_THRESHOLD = 5;
const ESTABLISHED_WEIGHT_MULTIPLIER = 1.6;

function existingClaimWeight(existing: Belief): number {
  const establishment = Math.min(1, existing.evidenceCount / ESTABLISHED_THRESHOLD);
  return 1 + establishment * (ESTABLISHED_WEIGHT_MULTIPLIER - 1);
}

/**
 * Compare one piece of new evidence against the current active belief for
 * the same subject, if any. Pass `existing: null` when there's nothing on
 * this subject yet — belief-update.ts short-circuits that case to a plain
 * insert without calling this at all, but the function stays total for
 * callers/tests that want to pass null directly.
 */
export function detectConflict(existing: Belief | null, evidence: BeliefEvidence): ConflictResult {
  if (!existing) {
    return { decision: 'no_conflict', existingWeight: 0, evidenceWeight: evidence.confidence, reason: 'no prior belief on this subject' };
  }

  if (existing.subject !== evidence.subject) {
    return { decision: 'no_conflict', existingWeight: existing.confidence, evidenceWeight: evidence.confidence, reason: 'different subjects, cannot conflict' };
  }

  if (existing.polarity === evidence.polarity) {
    return { decision: 'reinforce', existingWeight: existing.confidence, evidenceWeight: evidence.confidence, reason: 'evidence agrees with existing belief' };
  }

  // Same subject, opposite polarity — genuine conflict. Weigh it the same
  // way reasoning-engine.ts weighs any other pair of claims: strength *
  // weight per side, net compared against CONFLICT_MARGIN.
  const existingClaim: Claim = {
    id: existing.id,
    source: `belief:${existing.source}`,
    subject: existing.subject,
    polarity: existing.polarity === 'affirms' ? 'supports' : 'opposes',
    strength: existing.confidence,
    weight: existingClaimWeight(existing),
  };

  const evidenceClaim: Claim = {
    id: `evidence:${evidence.subject}:${Date.now()}`,
    source: `evidence:${evidence.source}`,
    subject: evidence.subject,
    polarity: evidence.polarity === 'affirms' ? 'supports' : 'opposes',
    strength: evidence.confidence,
    weight: 1,
  };

  const result = reason([existingClaim, evidenceClaim]);
  const step = result.steps.find(s => s.subject === evidence.subject);

  const existingWeight = existingClaim.strength * (existingClaim.weight ?? 1);
  const evidenceWeight = evidenceClaim.strength * (evidenceClaim.weight ?? 1);

  if (!step || step.conflicting) {
    return {
      decision: 'unresolved',
      existingWeight,
      evidenceWeight,
      reason: 'existing belief and new evidence are too close in weight to resolve confidently',
    };
  }

  // net > 0 means the "supports" side (whichever claim mapped to it) won.
  // Figure out which side that was by checking which claim polarity
  // matches 'supports'.
  const existingIsSupport = existingClaim.polarity === 'supports';
  const existingWon = existingIsSupport ? step.net > 0 : step.net < 0;

  if (existingWon) {
    return { decision: 'keep_existing', existingWeight, evidenceWeight, reason: 'existing belief outweighs contradicting evidence' };
  }

  return { decision: 'replace', existingWeight, evidenceWeight, reason: 'new evidence outweighs existing belief' };
}
