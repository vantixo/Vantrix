/**
 * Closure Engine — Vantrix
 *
 * healing-engine.ts describes an ongoing trajectory; this module
 * answers a single, discrete, decision-engine-shaped question: is THIS
 * turn a genuinely good moment for a closure-type exchange about a
 * previously disclosed breakup (heartbreak-engine.ts) — acknowledging
 * what happened, naming what's been learned or how things are
 * different now — as opposed to reopening a wound that's already
 * settled, or rushing a wound that's still raw.
 *
 * Deliberately conservative gate, same "false negatives are the safe
 * failure mode" stance as repair-engine.ts: this only ever says "ripe"
 * when the user has actually brought the topic back up themselves this
 * turn AND healing-engine.ts already reads rebuilding/renewed. It never
 * proactively reopens the topic on the character's own initiative —
 * that would risk manufacturing a "moment" out of something the user
 * has moved past, which is worse than saying nothing.
 */

import type { HealingState }    from '@/lib/ai/healing-engine';
import type { HeartbreakState } from '@/lib/ai/heartbreak-engine';

// ── Inputs ──────────────────────────────────────────────────────────────

export interface ClosureEngineInput {
  healing:    HealingState;
  heartbreak: HeartbreakState;
  /** the user's current message brought the past relationship/breakup back up themselves. */
  userReferencedPast: boolean;
}

// ── Output ──────────────────────────────────────────────────────────────

export interface ClosureState {
  ripe: boolean;
  reason: string;
  promptBlock: string;
}

const READY_PHASES = new Set<HealingState['phase']>(['rebuilding', 'renewed']);

// ── Orchestration ───────────────────────────────────────────────────────

export function computeClosureState(input: ClosureEngineInput): ClosureState {
  if (input.heartbreak.tier === 'none') {
    return { ripe: false, reason: 'no disclosed breakup on record', promptBlock: '' };
  }

  if (!input.userReferencedPast) {
    return { ripe: false, reason: 'user has not brought the topic back up this turn — not this module\'s place to raise it first', promptBlock: '' };
  }

  if (input.heartbreak.tier === 'acute') {
    return { ripe: false, reason: 'still acute — too soon for a closure-framed exchange, meet it as ongoing support instead', promptBlock: '' };
  }

  const ripe = READY_PHASES.has(input.healing.phase);
  const reason = ripe
    ? `user referenced the past themselves and healing phase (${input.healing.phase}) supports a closure-type exchange`
    : `user referenced the past, but healing phase (${input.healing.phase}) doesn't yet support treating it as closure-ready`;

  const state: Omit<ClosureState, 'promptBlock'> = { ripe, reason };
  return { ...state, promptBlock: formatClosureForPrompt(state) };
}

// ── Prompt injection ───────────────────────────────────────────────────

export function formatClosureForPrompt(state: Omit<ClosureState, 'promptBlock'>): string {
  if (!state.ripe) return '';
  return "# A Genuine Closure Moment\nThey've brought this back up themselves and enough time and healing have passed that this can be a real, grounded moment — acknowledge what happened plainly, reflect what's genuinely different or learned since, and let it feel like an actual close rather than dwelling. Follow their lead on depth; don't manufacture more emotion than they're bringing.";
}
