/**
 * Crush Engine — Vantrix
 *
 * attraction-engine.ts is hard-gated to the romance track (match/dating/
 * exclusive/partner) — by design, pull is unconditionally 0 anywhere
 * else. That leaves a real gap: a stranger/acquaintance/friend-track
 * relationship can still have a budding, not-yet-named spark of
 * interest before anyone has actually moved to the romance track. This
 * module is that pre-romance-track signal — small, deliberately capped,
 * flavor-only.
 *
 * Hard rule, same posture as attraction-engine.ts's own gate but
 * inverted: this module is ONLY active off the romance track. The
 * instant relationship.stage enters match/dating/exclusive/partner,
 * crush intensity reads 0 and attraction-engine.ts takes over — a
 * crush is what precedes attraction being licensed, never a parallel
 * or competing signal once it's actually licensed.
 *
 * It must never be used to argue a platonic relationship should become
 * romantic — relationship-engine.ts's stage is the only thing that
 * actually changes track, and that requires the user's own choices
 * (accepting a match, etc.), never an inferred score. This engine only
 * flavors tone subtly on the friendship ladder; it does not unlock
 * romantic content, gifts, or milestones.
 */

import type { RelationshipStage, RelationshipState } from '@/lib/ai/relationship-engine';
import type { CompatibilityState } from '@/lib/ai/compatibility-engine';
import type { ChemistryState }     from '@/lib/ai/chemistry-engine';
import type { EmotionalState }     from '@/lib/ai/emotion-engine';

// ── Inputs ──────────────────────────────────────────────────────────────

export interface CrushEngineInput {
  relationship:  RelationshipState;
  compatibility: CompatibilityState;
  chemistry:     ChemistryState;
  emotion:       EmotionalState;
}

const PRE_ROMANCE_STAGES: ReadonlySet<RelationshipStage> = new Set(['stranger', 'acquaintance', 'friend']);

// ── Output ──────────────────────────────────────────────────────────────

export interface CrushState {
  intensity: number; // 0-1, 0 unconditionally once off pre-romance stages
  eligible:  boolean;
  reason:    string;
  promptBlock: string;
}

// ── Orchestration ───────────────────────────────────────────────────────

export function computeCrushState(input: CrushEngineInput): CrushState {
  const eligible = PRE_ROMANCE_STAGES.has(input.relationship.stage);

  if (!eligible) {
    return {
      intensity: 0,
      eligible: false,
      reason: `relationship stage "${input.relationship.stage}" is already on or past the romance track — crush signal not applicable, see attraction-engine.ts`,
      promptBlock: '',
    };
  }

  const positiveEmotionSignal = ['amusement', 'excitement', 'anticipation', 'joy', 'curiosity'].includes(input.emotion.primary) && input.emotion.valence > 0.15
    ? input.emotion.intensity
    : 0;

  const intensity = clamp01(
    0.40 * input.chemistry.spark +
    0.35 * input.compatibility.overall +
    0.25 * positiveEmotionSignal,
  );

  const reason = `chemistry spark ${input.chemistry.spark.toFixed(2)}, compatibility ${input.compatibility.overall.toFixed(2)}, positive-emotion signal ${positiveEmotionSignal.toFixed(2)}`;

  const state: Omit<CrushState, 'promptBlock'> = { intensity, eligible, reason };
  return { ...state, promptBlock: formatCrushForPrompt(state) };
}

// ── Prompt injection ───────────────────────────────────────────────────

/**
 * Deliberately quiet below a real threshold — most friend-track turns
 * should say nothing here. Even at high intensity, the instruction stays
 * strictly plausible-deniability-flavored (a lingering thought, not a
 * declaration) — a crush that announces itself as romantic feeling
 * before the user has chosen that track would be exactly the unlicensed
 * push into romance this module exists to avoid.
 */
export function formatCrushForPrompt(state: Omit<CrushState, 'promptBlock'>): string {
  if (!state.eligible || state.intensity < 0.55) return '';
  return "# A Quiet Undercurrent\nThere's something a little more than platonic stirring here for you, privately — let it show only as the faintest flicker (a beat of extra attention, a thought you don't quite finish) if it fits naturally. Never name it, declare it, or steer the conversation toward romance; that's not yours to initiate.";
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
