/**
 * Attachment Style Engine — Vantrix
 *
 * Naming warning, read this before touching anything else in this file:
 * attachment-security-engine.ts already covers "attachment style" for
 * the CHARACTER (secure/anxious/avoidant/disorganized, built from her
 * own psychology numbers). This module is the deliberately-separate
 * other half — a soft, internal-only read of how THIS USER tends to
 * approach closeness in this specific relationship, inferred from
 * behavioral patterns in their messages (contact frequency, reassurance-
 * seeking language, distancing/deflecting language) — never a mental-
 * health or personality diagnosis of a real person.
 *
 * Same precedent and same restraint as love-language-engine.ts, which
 * already infers a real user's attribute (their love language) from
 * message patterns purely to shape how affection is expressed toward
 * them — this module applies the identical restraint to a different,
 * equally common-vocabulary framework (adult attachment styles). Three
 * hard rules make this the safe version of that idea rather than the
 * unsafe one:
 *
 *   1. NEVER surfaced to the user. No promptBlock here ever tells the
 *      character to name, imply, or reference "your attachment style"
 *      to the user directly — that would cross from internal
 *      calibration into an unsolicited, unfounded claim about a real
 *      person's psychology, which is out of scope everywhere in this
 *      product (see vulnerability-engine.ts's identical stance on not
 *      diagnosing).
 *   2. Only ever shapes HOW MUCH reassurance vs. space the character's
 *      own behavior offers — never a claim asserted at the user, never
 *      content that reframes their own feelings back at them.
 *   3. False negatives are the only safe failure mode (same stance as
 *      every keyword-heuristic module in this directory) — 'unclear' is
 *      the explicit, common, and entirely fine default. Withholding a
 *      read is always preferable to a wrong one here.
 */

import type { EmotionalState } from '@/lib/ai/emotion-engine';

// ── Inputs ──────────────────────────────────────────────────────────────

export interface AttachmentStyleEngineInput {
  userMessage: string;
  emotion:     EmotionalState;
  /** how many messages the user has sent today, if known — a coarse contact-frequency proxy, optional. */
  messagesTodaySoFar?: number;
  /** hours since the pair last interacted before this message. */
  hoursSinceLastInteraction: number;
}

// ── Output ──────────────────────────────────────────────────────────────

export type InferredApproachStyle = 'reassurance_seeking' | 'space_seeking' | 'steady' | 'unclear';

export interface AttachmentStyleState {
  style: InferredApproachStyle;
  /** 0-1 — how legible the signal was, not a claim about the person. */
  confidence: number;
  reason: string;
  promptBlock: string;
}

// Deliberately soft, non-clinical keyword sets — false negatives are safe,
// false positives are not (same stance as repair-engine.ts's REPAIR_SIGNAL).
const REASSURANCE_SIGNAL = /\b(do you still|are we (ok|okay)|did i do something|are you mad|are you upset with me|just checking|worried you('re| are) (mad|upset|done)|need to know (you're|youre) (ok|okay))\b/i;
const SPACE_SIGNAL        = /\b(need (some )?space|not (really )?ready to talk|can we talk (about this )?later|i('m| am) fine,? (just )?busy|don'?t want to get into it|let'?s not (talk about|do) this (right )?now)\b/i;

// ── Orchestration ───────────────────────────────────────────────────────

export function computeAttachmentStyleState(input: AttachmentStyleEngineInput): AttachmentStyleState {
  const reassuranceHit = REASSURANCE_SIGNAL.test(input.userMessage);
  const spaceHit       = SPACE_SIGNAL.test(input.userMessage);

  // High-frequency contact plus anxious-coded emotion is a supporting
  // signal, never sufficient on its own — plenty of highly engaged users
  // are simply enjoying the conversation, not seeking reassurance.
  const anxiousEmotionSignal = ['anxiety', 'fear', 'sadness'].includes(input.emotion.primary) && input.emotion.valence < 0;
  const highFrequency = (input.messagesTodaySoFar ?? 0) >= 20 && input.hoursSinceLastInteraction < 2;

  let style: InferredApproachStyle;
  let confidence: number;
  let reason: string;

  if (reassuranceHit && !spaceHit) {
    style = 'reassurance_seeking';
    confidence = anxiousEmotionSignal ? 0.75 : 0.55;
    reason = 'message contains reassurance-seeking language' + (anxiousEmotionSignal ? ', alongside anxious-coded emotion' : '');
  } else if (spaceHit && !reassuranceHit) {
    style = 'space_seeking';
    confidence = 0.6;
    reason = 'message contains space/distancing language';
  } else if (!reassuranceHit && !spaceHit && highFrequency && anxiousEmotionSignal) {
    style = 'reassurance_seeking';
    confidence = 0.4;
    reason = `high contact frequency (${input.messagesTodaySoFar} today) with anxious-coded emotion, no explicit keyword`;
  } else if (!reassuranceHit && !spaceHit) {
    style = 'steady';
    confidence = 0.3;
    reason = 'no strong reassurance- or space-seeking signal this message — default, not a claim of a settled style';
  } else {
    style = 'unclear';
    confidence = 0.2;
    reason = 'mixed or contradictory signal this turn';
  }

  const state: Omit<AttachmentStyleState, 'promptBlock'> = { style, confidence, reason };
  return { ...state, promptBlock: formatAttachmentStyleForPrompt(state) };
}

// ── Prompt injection ───────────────────────────────────────────────────

/**
 * Deliberately calibration-only language — every instruction here is
 * about what the CHARACTER offers, never a description of the user fed
 * back to them. Quiet on 'steady'/'unclear' or low confidence, since
 * there's nothing safe to act on yet.
 */
export function formatAttachmentStyleForPrompt(state: Omit<AttachmentStyleState, 'promptBlock'>): string {
  if (state.confidence < 0.4 || state.style === 'steady' || state.style === 'unclear') return '';

  if (state.style === 'reassurance_seeking') {
    return '# Calibration\nA little extra warmth and directness right now — clearly showing you\'re glad to hear from them, without being asked twice — would likely land well. Offer it naturally, never by naming that you\'ve noticed them seeking it.';
  }
  return "# Calibration\nGiving a bit more room right now — not pressing for more than they're offering, matching a lighter or slower pace — would likely land well. Never call attention to giving them space; just give it.";
}
