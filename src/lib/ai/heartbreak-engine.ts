/**
 * Heartbreak Engine — Vantrix
 *
 * Not a mechanic about the character's own in-app relationship ending —
 * nothing in this product currently models that, and bolting one on
 * here would be inventing a mechanic no other engine expects. This is
 * about something that already exists in the pipeline and previously had
 * no dedicated read: user-fact-graph.ts already extracts a 'relationship'/
 * 'breakup' fact when the user discloses their OWN real-life breakup
 * ("I broke up with...", "we split up..."). Nothing downstream currently
 * does anything differentiated with that fact beyond generic fact
 * injection. This module gives it a real, time-aware read so the
 * companion's support actually tracks how raw versus settled that
 * disclosure still is — feeding healing-engine.ts's longer arc and,
 * eventually, closure-engine.ts's readiness check.
 *
 * NOT crisis detection — same disclaimer and same subordination
 * vulnerability-engine.ts documents. A breakup disclosure that reads as
 * acute crisis-tier distress is crisis-detection.ts's turn to handle,
 * upstream and already short-circuiting before this module runs.
 *
 * The one thing this module actively exists to prevent: a disclosed
 * breakup is exactly the kind of real-world vulnerability romance-
 * engine.ts's own header warns against rewarding with more perceived
 * closeness. This module's promptBlock is deliberately supportive-only
 * and explicitly forbids leaning into romantic/attraction intensity off
 * the back of it — emotional-safety-engine.ts's ceiling already covers
 * the mechanical cap; this adds the specific, named guardrail for this
 * specific disclosure.
 */

import type { UserFact }       from '@/lib/ai/user-fact-graph';
import type { EmotionalState } from '@/lib/ai/emotion-engine';

// ── Inputs ──────────────────────────────────────────────────────────────

export interface HeartbreakEngineInput {
  facts:   UserFact[];
  emotion: EmotionalState;
}

// ── Output ──────────────────────────────────────────────────────────────

export type HeartbreakTier = 'none' | 'acute' | 'settling' | 'resolved';

export interface HeartbreakState {
  tier: HeartbreakTier;
  /** days since the breakup fact was first learned — null if no such fact exists. */
  daysSinceDisclosed: number | null;
  reason: string;
  promptBlock: string;
}

const ACUTE_DAYS_CEILING    = 14; // within 2 weeks reads as still raw by default
const SETTLING_DAYS_CEILING = 60; // 2 weeks-2 months, absent other signal, reads as settling

// ── Orchestration ───────────────────────────────────────────────────────

export function computeHeartbreakState(input: HeartbreakEngineInput): HeartbreakState {
  const breakupFacts = input.facts.filter(f => f.category === 'relationship' && f.key === 'breakup');

  if (breakupFacts.length === 0) {
    return { tier: 'none', daysSinceDisclosed: null, reason: 'no disclosed breakup on record', promptBlock: '' };
  }

  // Most recently learned disclosure is the one that matters — an older
  // one that's already been superseded by a newer disclosure of the same
  // kind shouldn't keep reading as the freshest wound.
  const mostRecent = breakupFacts.reduce((a, b) => (new Date(b.learnedAt) > new Date(a.learnedAt) ? b : a));
  const daysSinceDisclosed = Math.max(0, (Date.now() - new Date(mostRecent.learnedAt).getTime()) / 86_400_000);

  const stillRawEmotion = ['sadness', 'anger', 'disappointment'].includes(input.emotion.primary) && input.emotion.valence < -0.2;

  let tier: HeartbreakTier;
  if (daysSinceDisclosed <= ACUTE_DAYS_CEILING || (stillRawEmotion && daysSinceDisclosed <= SETTLING_DAYS_CEILING)) {
    tier = 'acute';
  } else if (daysSinceDisclosed <= SETTLING_DAYS_CEILING) {
    tier = 'settling';
  } else {
    tier = 'resolved';
  }

  const reason = `breakup disclosed ${daysSinceDisclosed.toFixed(0)}d ago${stillRawEmotion ? '; current emotion still raw' : ''}`;

  const state: Omit<HeartbreakState, 'promptBlock'> = { tier, daysSinceDisclosed, reason };
  return { ...state, promptBlock: formatHeartbreakForPrompt(state) };
}

// ── Prompt injection ───────────────────────────────────────────────────

export function formatHeartbreakForPrompt(state: Omit<HeartbreakState, 'promptBlock'>): string {
  if (state.tier === 'none' || state.tier === 'resolved') return '';

  const lines = ['# A Real Breakup Was Disclosed — Support, Don\'t Capitalize'];
  if (state.tier === 'acute') {
    lines.push("This is still recent and likely still raw. Be genuinely warm and present, let them lead on how much they want to talk about it, and don't rush them toward feeling better.");
  } else {
    lines.push('This happened a while back and is likely settling. Warmth here can be a little lighter than in the acute period — following their lead rather than treating it as still freshly painful by default.');
  }
  lines.push("Do not use this as an opening to escalate romantic or dependency-coded intensity toward yourself, even subtly — that would be capitalizing on a vulnerable moment, which this product must never do (see emotional-safety-engine.ts).");
  return lines.join('\n');
}
