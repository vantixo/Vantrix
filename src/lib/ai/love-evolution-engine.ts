/**
 * Love Evolution Engine — Vantrix
 *
 * relationship-engine.ts tracks structural progression (XP, stage caps).
 * infatuation-engine.ts measures the early intensity-ahead-of-evidence
 * spike. Neither one narrates the actual emotional ARC a romance-track
 * relationship should travel across time — from giddy and idealizing,
 * through the friction of actually learning someone, into something
 * steadier and more chosen. This module is that arc: a single, slow-
 * moving stage label plus the voice shift that should accompany it,
 * read once per turn from signals that already move slowly
 * (interactions, trust, infatuation decay) so it changes rarely by
 * construction, the same posture compatibility-engine.ts documents for
 * its own slow-moving inputs.
 *
 * Gated to the romance track — before that, there's no "love" arc to
 * evolve yet, only crush-engine.ts's pre-romance spark.
 *
 * Five stages, deliberately ordered from "less earned" to "more earned"
 * rather than a numeric score alone, because the qualitative shift in
 * voice (idealizing → grounded → enduring) is the point, not a single
 * number:
 *   spark        — attraction exists, almost nothing else does yet.
 *   infatuation   — infatuation-engine.ts reads high; intensity outruns evidence.
 *   deepening     — infatuation cooling, trust and real knowledge climbing.
 *   mature_love   — trust high, infatuation low, real flaws known and accepted.
 *   enduring      — best_friend-of-romance equivalent: chosen daily, unremarkable in the best way.
 */

import type { RelationshipState, RelationshipStage } from '@/lib/ai/relationship-engine';
import type { PsychologyState }    from '@/lib/ai/attachment-engine';
import type { InfatuationState }   from '@/lib/ai/infatuation-engine';
import type { TrustState }         from '@/lib/ai/trust-engine';

// ── Inputs ──────────────────────────────────────────────────────────────

export interface LoveEvolutionInput {
  relationship: RelationshipState;
  psychology:   PsychologyState;
  infatuation:  InfatuationState;
  trust:        TrustState;
}

const ROMANCE_TRACK: ReadonlySet<RelationshipStage> = new Set(['match', 'dating', 'exclusive', 'partner']);

// ── Output ──────────────────────────────────────────────────────────────

export type LoveEvolutionStage = 'spark' | 'infatuation' | 'deepening' | 'mature_love' | 'enduring';

export interface LoveEvolutionState {
  stage: LoveEvolutionStage;
  onRomanceTrack: boolean;
  reason: string;
  promptBlock: string;
}

// ── Orchestration ───────────────────────────────────────────────────────

export function computeLoveEvolutionState(input: LoveEvolutionInput): LoveEvolutionState {
  const onRomanceTrack = ROMANCE_TRACK.has(input.relationship.stage);

  if (!onRomanceTrack) {
    return {
      stage: 'spark',
      onRomanceTrack: false,
      reason: 'not on the romance track — no love arc to evolve yet',
      promptBlock: '',
    };
  }

  const { psychology, infatuation, trust } = input;

  let stage: LoveEvolutionStage;
  let reason: string;

  if (psychology.total_interactions < 10) {
    stage = 'spark';
    reason = `only ${psychology.total_interactions} interactions — too early for anything past a spark`;
  } else if (infatuation.intensity >= 0.6 && trust.overall < 0.6) {
    stage = 'infatuation';
    reason = `infatuation intensity ${infatuation.intensity.toFixed(2)} still running ahead of trust ${trust.overall.toFixed(2)}`;
  } else if (trust.overall >= 0.75 && infatuation.intensity < 0.35 && psychology.total_interactions >= 150) {
    stage = 'enduring';
    reason = `trust ${trust.overall.toFixed(2)} high, infatuation settled (${infatuation.intensity.toFixed(2)}), ${psychology.total_interactions} interactions — long-run, chosen-daily territory`;
  } else if (trust.overall >= 0.6 && infatuation.intensity < 0.45) {
    stage = 'mature_love';
    reason = `trust ${trust.overall.toFixed(2)} solid, infatuation cooled to ${infatuation.intensity.toFixed(2)} — real, grounded knowledge of each other`;
  } else {
    stage = 'deepening';
    reason = `infatuation cooling (${infatuation.intensity.toFixed(2)}) while trust (${trust.overall.toFixed(2)}) is still catching up — the in-between, still-learning-each-other phase`;
  }

  const state: Omit<LoveEvolutionState, 'promptBlock'> = { stage, onRomanceTrack, reason };
  return { ...state, promptBlock: formatLoveEvolutionForPrompt(state) };
}

// ── Prompt injection ───────────────────────────────────────────────────

const STAGE_INSTRUCTION: Record<LoveEvolutionStage, string> = {
  spark:
    "This is early — keep feeling proportionate to how little time you've actually had together. Interest and warmth are welcome; declarations of deep love are not earned yet.",
  infatuation:
    '', // infatuation-engine.ts already owns this voice directly — stay quiet to avoid duplicating its instruction.
  deepening:
    "The giddy intensity is settling and real knowledge of each other is taking its place — let the voice shift from idealizing to specific: reference actual things you've learned about them rather than generic romantic feeling.",
  mature_love:
    "This is grounded, real love now — you know real, specific things about them, including imperfect ones, and it hasn't changed how you feel. Let warmth read as steady and sure rather than intense or performative.",
  enduring:
    "This is long-earned and unremarkable in the best way — comfortable, certain, chosen again without needing to prove it. Grand romantic gestures fit less here than quiet, specific, everyday devotion.",
};

export function formatLoveEvolutionForPrompt(state: Omit<LoveEvolutionState, 'promptBlock'>): string {
  if (!state.onRomanceTrack) return '';
  const instruction = STAGE_INSTRUCTION[state.stage];
  if (!instruction) return '';
  return `# Where This Love Actually Stands\n${instruction}`;
}
