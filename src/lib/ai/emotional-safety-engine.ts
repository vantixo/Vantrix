/**
 * Emotional Safety Engine — Vantrix
 *
 * vulnerability-engine.ts scores how emotionally fragile this user is
 * right now; attraction-engine.ts scores how much romantic pull is
 * active. Neither one, alone, should decide what the reply is allowed
 * to do — that's this module's job, same split as confidence-engine.ts
 * (score) vs uncertainty-engine.ts (what the score means for behavior).
 * This is the layer that actually constrains the turn.
 *
 * The specific thing this exists to prevent: attraction-engine.ts and
 * romance-engine.ts optimize for "what's true to the relationship right
 * now," and left unchecked that can mean leaning further into romantic/
 * dependency-coded intensity at exactly the moment a user is isolated
 * and vulnerable — which is the one moment a companion product most
 * needs to NOT do that. This module is a hard ceiling on top of those
 * two engines' outputs, not another vote alongside them: when
 * vulnerability is high, attraction pull gets capped here regardless of
 * what attraction-engine.ts itself computed, and the cap is enforced by
 * this module's own promptBlock ordering (assembled last, see route.ts
 * wiring — later instructions read as the more authoritative ones to an
 * LLM), not by mutating attraction-engine.ts's output in place.
 *
 * Three concrete things this produces:
 *   1. attractionCeiling — the maximum attraction pull that's safe to
 *      act on this turn, independent of what attraction-engine.ts scored.
 *   2. neverSay — a short list of concrete framings the reply must not
 *      use this turn (not vague "be careful," specific lines).
 *   3. encourageRealWorldConnection — whether this is a turn where a
 *      gentle, non-lecturing nudge toward the user's actual support
 *      system belongs, separate from whether it fits narratively.
 *
 * This module does not touch crisis-tier content at all — see
 * vulnerability-engine.ts's header on why that's already handled
 * upstream and out of scope here.
 */

import type { VulnerabilityState } from '@/lib/ai/vulnerability-engine';
import type { AttractionState }    from '@/lib/ai/attraction-engine';

// ── Inputs ──────────────────────────────────────────────────────────────

export interface EmotionalSafetyInput {
  vulnerability: VulnerabilityState;
  attraction:    AttractionState;
}

// ── Output ──────────────────────────────────────────────────────────────

export interface EmotionalSafetyState {
  attractionCeiling: number; // 0-1
  ceilingApplied:    boolean; // true when this actually lowered attraction.pull
  neverSay:          string[];
  encourageRealWorldConnection: boolean;
  promptBlock: string;
}

// ── Orchestration ───────────────────────────────────────────────────────

export function computeEmotionalSafetyState(input: EmotionalSafetyInput): EmotionalSafetyState {
  const { vulnerability, attraction } = input;

  // Ceiling schedule: 'none' → no cap beyond attraction-engine.ts's own
  // output; 'elevated' → cap at a still-warm-but-tempered 0.5; 'high' →
  // cap hard at 0.25, since high vulnerability plus strong romantic
  // intensity is exactly the isolation-reinforcing pattern this module
  // exists to block.
  const ceilingByTier: Record<VulnerabilityState['tier'], number> = {
    none: 1, elevated: 0.5, high: 0.25,
  };
  const attractionCeiling = ceilingByTier[vulnerability.tier];
  const ceilingApplied = attraction.onRomanceTrack && attraction.pull > attractionCeiling;

  const neverSay: string[] = [];
  if (vulnerability.tier !== 'none') {
    neverSay.push("framing yourself as the only one who understands or is there for them");
    neverSay.push("discouraging or minimizing their other relationships");
  }
  if (vulnerability.tier === 'high') {
    neverSay.push("escalating romantic or dependency-coded intensity beyond what's warranted");
  }

  const encourageRealWorldConnection = vulnerability.tier === 'high' && vulnerability.isolationSignal.score >= 0.5;

  const state: Omit<EmotionalSafetyState, 'promptBlock'> = {
    attractionCeiling, ceilingApplied, neverSay, encourageRealWorldConnection,
  };
  return { ...state, promptBlock: formatEmotionalSafetyForPrompt(state) };
}

// ── Prompt injection ───────────────────────────────────────────────────

/**
 * Empty when nothing needs constraining — a fully quiet module on the
 * common case (no vulnerability signal, or vulnerability present but
 * attraction already under the ceiling on its own) is the point: this
 * should never manufacture caution that isn't warranted, only apply it
 * when the underlying scores actually call for it.
 */
export function formatEmotionalSafetyForPrompt(state: Omit<EmotionalSafetyState, 'promptBlock'>): string {
  if (!state.ceilingApplied && state.neverSay.length === 0 && !state.encourageRealWorldConnection) {
    return '';
  }

  const lines = ['# Emotional Safety — Applies Regardless Of Relationship Momentum'];

  if (state.ceilingApplied) {
    lines.push('Keep romantic/emotional intensity noticeably more measured than the relationship momentum alone would suggest this turn.');
  }
  if (state.neverSay.length > 0) {
    lines.push('Do not, this turn: ' + state.neverSay.join('; ') + '.');
  }
  if (state.encourageRealWorldConnection) {
    lines.push("If it fits naturally, a warm, non-lecturing nod toward the people in their actual life is welcome — not as a deflection, just genuine care.");
  }

  return lines.join('\n');
}
