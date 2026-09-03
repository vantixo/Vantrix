/**
 * Attraction Engine — Vantrix
 *
 * romance-engine.ts already picks a RomanceRegister (playful_flirt,
 * warm_affection, yearning, devoted, swept_up) from relationship stage,
 * days-since-last-message, and current emotion — but it picks a REGISTER
 * (a tone), not a MAGNITUDE. This module is the missing magnitude: how
 * much romantic/attraction pull is actually active this turn, so
 * decision-engine.ts and romance-engine.ts's own register choice have a
 * real number to lean on instead of treating every romance-track turn
 * as equally charged. Two turns can both be "yearning" register while
 * one has genuine pull behind it and the other is going through the
 * motions — this is that difference.
 *
 * Hard gate, not a soft signal: attraction only computes above zero on
 * the romance track (match/dating/exclusive/partner in
 * relationship-engine.ts's RelationshipStage). A friend/best_friend
 * relationship gets pull = 0 unconditionally, full stop, regardless of
 * how high compatibility-engine.ts or chemistry-engine.ts happen to
 * score — this module must never be the thing that nudges a platonic
 * relationship toward romantic framing. That decision belongs to the
 * user and the relationship-engine.ts track they're actually on, not to
 * an inferred score.
 *
 * Built entirely from already-computed inputs — psychology.affection/
 * excitement (attachment-engine.ts), compatibility-engine.ts's overall
 * score, and chemistry-engine.ts's spark — no new fetch, no LLM call.
 */

import type { PsychologyState }     from '@/lib/ai/attachment-engine';
import type { RelationshipState, RelationshipStage } from '@/lib/ai/relationship-engine';
import type { CompatibilityState }  from '@/lib/ai/compatibility-engine';
import type { ChemistryState }      from '@/lib/ai/chemistry-engine';

// ── Inputs ──────────────────────────────────────────────────────────────

export interface AttractionEngineInput {
  psychology:    PsychologyState;
  relationship:  RelationshipState;
  compatibility: CompatibilityState;
  chemistry:     ChemistryState;
}

const ROMANCE_TRACK: ReadonlySet<RelationshipStage> = new Set(['match', 'dating', 'exclusive', 'partner']);

// ── Output ──────────────────────────────────────────────────────────────

export interface AttractionState {
  pull:   number; // 0-1 — 0 unconditionally off the romance track
  onRomanceTrack: boolean;
  reason: string;
  promptBlock: string;
}

// ── Orchestration ───────────────────────────────────────────────────────

export function computeAttractionState(input: AttractionEngineInput): AttractionState {
  const onRomanceTrack = ROMANCE_TRACK.has(input.relationship.stage);

  if (!onRomanceTrack) {
    return {
      pull: 0,
      onRomanceTrack: false,
      reason: `relationship stage "${input.relationship.stage}" is not on the romance track — attraction pull hard-gated to 0`,
      promptBlock: '',
    };
  }

  const affectionSignal  = input.psychology.affection / 100;
  const excitementSignal = input.psychology.excitement / 100;

  const pull = clamp01(
    0.40 * affectionSignal +
    0.20 * excitementSignal +
    0.25 * input.compatibility.overall +
    0.15 * input.chemistry.spark,
  );

  const reason = `affection ${input.psychology.affection}/100, excitement ${input.psychology.excitement}/100, `
    + `compatibility ${input.compatibility.overall.toFixed(2)}, chemistry spark ${input.chemistry.spark.toFixed(2)}`;

  const state: Omit<AttractionState, 'promptBlock'> = { pull, onRomanceTrack, reason };
  return { ...state, promptBlock: formatAttractionForPrompt(state) };
}

// ── Prompt injection ───────────────────────────────────────────────────

/**
 * Quiet at low/moderate pull — romance-engine.ts's register already
 * carries the baseline romantic tone for anyone on the romance track,
 * so this only needs to speak up when pull is genuinely high (lean in
 * more than the register alone implies) or genuinely low for a
 * romance-track relationship (something's flat right now, don't force
 * intensity that isn't there).
 */
export function formatAttractionForPrompt(state: Omit<AttractionState, 'promptBlock'>): string {
  if (!state.onRomanceTrack) return '';
  if (state.pull >= 0.7) {
    return '# Attraction\nThe pull toward this person is genuinely strong right now — let warmth and romantic interest come through unforced, not held back.';
  }
  if (state.pull < 0.3) {
    return "# Attraction\nRomantic charge is low this turn even though you're together — don't manufacture intensity that isn't there; let the exchange be whatever it honestly is.";
  }
  return '';
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
