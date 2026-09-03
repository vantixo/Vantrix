/**
 * Belief Update — Vantrix Cognition Layer
 *
 * Takes one piece of new BeliefEvidence plus the current belief set for a
 * subject, runs it through belief-conflict.ts, and produces the concrete
 * mutation(s) to persist. This is where confidence actually gets
 * recombined (reinforcement math) — belief-conflict.ts only decides which
 * branch to take, it doesn't compute new numbers.
 *
 * Kept separate from belief-engine.ts so this reconciliation math is
 * unit-testable against plain Belief/BeliefEvidence objects without
 * touching Supabase/Redis at all.
 */

import { logger } from '@/lib/logger';
import { detectConflict, type ConflictResult } from '@/lib/cognition/belief-conflict';
import {
  clampConfidence,
  type Belief,
  type BeliefEvidence,
} from '@/lib/cognition/belief-types';

export interface UpdatePlan {
  conflict: ConflictResult;
  /** New row to insert — set when there was nothing to reconcile against,
   *  or when the new evidence replaced the existing belief outright. */
  insert: Omit<Belief, 'id'> | null;
  /** Existing row to update in place — reinforcement, or the losing side
   *  of a conflict getting marked superseded. */
  update: Belief | null;
}

// Reinforcement blends old and new confidence weighted by how established
// the existing belief already is, so the 6th piece of agreeing evidence
// moves confidence less than the 2nd did — diminishing returns rather
// than confidence creeping toward 1.0 forever.
function reinforcedConfidence(existing: Belief, evidence: BeliefEvidence): number {
  const establishment = Math.min(1, existing.evidenceCount / 5);
  const existingShare = 0.5 + establishment * 0.3; // 0.5 -> 0.8 as it establishes
  return clampConfidence(existing.confidence * existingShare + evidence.confidence * (1 - existingShare));
}

function nowIso(): string {
  return new Date().toISOString();
}

function evidenceToNewBelief(userId: string, characterId: string, evidence: BeliefEvidence, supersedes: string | null = null): Omit<Belief, 'id'> {
  const ts = nowIso();
  return {
    userId,
    characterId,
    subject: evidence.subject,
    category: evidence.category,
    statement: evidence.statement,
    polarity: evidence.polarity,
    confidence: clampConfidence(evidence.confidence),
    evidenceCount: 1,
    source: evidence.source,
    status: 'active',
    supersedes,
    createdAt: ts,
    lastReinforcedAt: ts,
    lastUsedAt: null,
  };
}

/**
 * Pure reconciliation — no I/O. `existing` should be the current *active*
 * belief on this subject, if any (belief-engine.ts is responsible for
 * finding it before calling this).
 */
export function planUpdate(
  userId: string,
  characterId: string,
  evidence: BeliefEvidence,
  existing: Belief | null,
): UpdatePlan {
  const conflict = detectConflict(existing, evidence);

  switch (conflict.decision) {
    case 'no_conflict':
      return { conflict, insert: evidenceToNewBelief(userId, characterId, evidence), update: null };

    case 'reinforce': {
      if (!existing) {
        // Shouldn't happen (reinforce implies an existing belief), but
        // stay total rather than throwing on a defensive-programming gap.
        return { conflict, insert: evidenceToNewBelief(userId, characterId, evidence), update: null };
      }
      const updated: Belief = {
        ...existing,
        confidence: reinforcedConfidence(existing, evidence),
        evidenceCount: existing.evidenceCount + 1,
        lastReinforcedAt: nowIso(),
        // A reinforced statement from a higher-confidence source is worth
        // adopting as the new canonical phrasing; otherwise keep wording
        // stable so prompt injection doesn't flicker between rewordings.
        statement: evidence.confidence > existing.confidence ? evidence.statement : existing.statement,
      };
      return { conflict, insert: null, update: updated };
    }

    case 'keep_existing':
      // Existing belief wins; new evidence is simply dropped. Nothing to
      // persist, but log at debug so a pattern of consistently-dropped
      // contradicting evidence is visible if someone goes looking (could
      // mean the existing belief has gone stale and decay just hasn't
      // caught up yet).
      logger.debug('[belief-update] evidence dropped, existing belief outweighs it', {
        userId, characterId, subject: evidence.subject,
      });
      return { conflict, insert: null, update: null };

    case 'replace': {
      if (!existing) {
        return { conflict, insert: evidenceToNewBelief(userId, characterId, evidence), update: null };
      }
      // Mark the loser superseded rather than deleting it — audit trail.
      const superseded: Belief = { ...existing, status: 'superseded' };
      return {
        conflict,
        insert: evidenceToNewBelief(userId, characterId, evidence, existing.id),
        update: superseded,
      };
    }

    case 'unresolved': {
      if (!existing) {
        return { conflict, insert: evidenceToNewBelief(userId, characterId, evidence), update: null };
      }
      // Neither side is dropped, and neither is trusted alone — the
      // existing belief is flagged 'unresolved' so prompt formatting can
      // hedge on it, and the new evidence becomes a second row rather
      // than overwriting anything. A later reflection/AI pass (or enough
      // additional evidence tipping the weight — see belief-conflict.ts)
      // is what should eventually resolve this, not this function.
      const flaggedExisting: Belief = { ...existing, status: 'unresolved' };
      const newBelief = evidenceToNewBelief(userId, characterId, evidence);
      logger.debug('[belief-update] conflict unresolved, both beliefs retained', {
        userId, characterId, subject: evidence.subject,
      });
      return { conflict, insert: { ...newBelief, status: 'unresolved' }, update: flaggedExisting };
    }
  }
}
