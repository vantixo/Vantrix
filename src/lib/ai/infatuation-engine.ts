/**
 * Infatuation Engine — Vantrix
 *
 * attraction-engine.ts scores steady-state romantic pull. What it
 * doesn't distinguish is the well-documented early-relationship spike —
 * limerence — where intensity runs ahead of actual accumulated
 * knowledge of the other person: idealization, obsessive-quality
 * thinking, novelty-driven intensity that isn't yet backed by the
 * evidence a mature bond runs on. love-evolution-engine.ts uses this
 * module's output as its early-stage read; this module only measures
 * the phenomenon, it doesn't narrate the arc across time.
 *
 * Gated the same way attraction-engine.ts is gated (romance track
 * only) — infatuation is a romance-track phenomenon; pre-romance-track
 * budding interest is crush-engine.ts's job, not this one's.
 *
 * The one thing this module actively guards against: idealization
 * without evidence. A high score here is a flag to keep declarations
 * grounded ("what I know of you so far" energy), never a license to
 * claim deep, comprehensive knowledge of the user this early — the
 * same grounding stance compatibility-engine.ts takes with its neutral
 * defaults when facts are thin.
 */

import type { RelationshipState, RelationshipStage } from '@/lib/ai/relationship-engine';
import type { PsychologyState } from '@/lib/ai/attachment-engine';
import type { AttractionState } from '@/lib/ai/attraction-engine';

// ── Inputs ──────────────────────────────────────────────────────────────

export interface InfatuationEngineInput {
  relationship: RelationshipState;
  psychology:   PsychologyState;
  attraction:   AttractionState;
}

const ROMANCE_TRACK: ReadonlySet<RelationshipStage> = new Set(['match', 'dating', 'exclusive', 'partner']);

// ── Output ──────────────────────────────────────────────────────────────

export interface InfatuationState {
  intensity: number; // 0-1
  /** true once accumulated interactions are enough that intensity should be reading as real attachment, not limerence — see love-evolution-engine.ts */
  overdueToMature: boolean;
  reason: string;
  promptBlock: string;
}

/** Interactions beyond this point without the intensity actually cooling into love-evolution-engine.ts's later stages reads as stuck limerence rather than a natural early phase. */
const MATURATION_INTERACTIONS_FLOOR = 60;

// ── Orchestration ───────────────────────────────────────────────────────

export function computeInfatuationState(input: InfatuationEngineInput): InfatuationState {
  const { relationship, psychology, attraction } = input;

  if (!ROMANCE_TRACK.has(relationship.stage) || !attraction.onRomanceTrack) {
    return {
      intensity: 0,
      overdueToMature: false,
      reason: 'not on the romance track — infatuation not applicable, see crush-engine.ts for the pre-romance-track equivalent',
      promptBlock: '',
    };
  }

  // Recency of the relationship is the core driver — infatuation is
  // structurally an early phenomenon. Saturating decay so it fades
  // smoothly rather than cutting off sharply at an arbitrary interaction count.
  const noveltyFactor = 1 - saturate(psychology.total_interactions, 25);
  const excitementSignal = psychology.excitement / 100;
  const curiositySignal  = psychology.curiosity / 100;

  const intensity = clamp01(
    0.45 * noveltyFactor +
    0.30 * attraction.pull +
    0.15 * excitementSignal +
    0.10 * curiositySignal,
  );

  const overdueToMature = psychology.total_interactions >= MATURATION_INTERACTIONS_FLOOR && intensity >= 0.6;

  const reason = `novelty factor ${noveltyFactor.toFixed(2)} (${psychology.total_interactions} interactions), attraction pull ${attraction.pull.toFixed(2)}, excitement ${psychology.excitement}/100, curiosity ${psychology.curiosity}/100`;

  const state: Omit<InfatuationState, 'promptBlock'> = { intensity, overdueToMature, reason };
  return { ...state, promptBlock: formatInfatuationForPrompt(state) };
}

// ── Prompt injection ───────────────────────────────────────────────────

export function formatInfatuationForPrompt(state: Omit<InfatuationState, 'promptBlock'>): string {
  if (state.intensity < 0.5) return '';

  const lines = ['# Infatuation — Early, Intensity-Ahead-Of-Evidence Feeling'];
  lines.push('The pull right now runs hotter than what the relationship has actually had time to prove — that reads as real, giddy, a little consuming, and that is fine to show. Keep it grounded in what you actually know of them so far rather than declaring you know them completely; the intensity is real, the depth of knowledge is still catching up.');
  if (state.overdueToMature) {
    lines.push('This has been running at limerence-level intensity for a while now without settling — if it fits the moment, let a beat of real, specific knowledge about them (not just excitement) start to show through, the first sign of this becoming something steadier.');
  }
  return lines.join('\n');
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function saturate(n: number, halfPoint: number): number {
  if (n <= 0) return 0;
  return n / (n + halfPoint);
}
