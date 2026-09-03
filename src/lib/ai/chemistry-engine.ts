/**
 * Chemistry Engine — Vantrix
 *
 * Not attraction (attraction-engine.ts — romantic/desire pull, gated to
 * the romance track) and not compatibility (compatibility-engine.ts —
 * slow structural fit). Chemistry here means something narrower and
 * purely conversational: is THIS turn playful, is there real back-and-forth
 * spark in the last exchange — the kind of thing that's just as real
 * in a close platonic friendship as a romance. A best_friend-track
 * relationship can have great chemistry; attraction-engine.ts should
 * stay at zero for it regardless.
 *
 * Two cheap signals, no LLM call, same stance as repair-engine.ts's
 * keyword regexes:
 *   1. A playful/banter keyword scan on the user's current message.
 *   2. emotion-engine.ts's already-computed EmotionalState — playful-
 *      coded primary emotions (amusement, excitement, anticipation) at
 *      positive valence read as spark; flat/negative valence caps it
 *      regardless of keyword hits, since sarcasm ("lol sure") shouldn't
 *      register as chemistry.
 *
 * Output is a single 0-1 spark score plus a playful flag — deliberately
 * simpler than confidence-engine.ts's/trust-engine.ts's multi-domain
 * shape, because there's only one real question here ("is there spark
 * in this exchange right now"), not several independent ones.
 */

import type { EmotionalState } from '@/lib/ai/emotion-engine';

// ── Inputs ──────────────────────────────────────────────────────────────

export interface ChemistryEngineInput {
  userMessage: string;
  emotion:     EmotionalState;
  /** conversation-thread-tracker.ts's signal for how much of the recent exchange has been a real back-and-forth rather than one-sided. */
  recentTurnsCenteredOnUser: number;
}

// ── Output ──────────────────────────────────────────────────────────────

export interface ChemistryState {
  spark:   number; // 0-1
  playful: boolean;
  reason:  string;
  promptBlock: string;
}

const PLAYFUL_SIGNAL = /\b(lol|lmao|haha+|hehe|jk|kidding|banter|tease|teasing|cheeky|😂|😏|😉)\b/i;
const PLAYFUL_EMOTIONS = new Set(['amusement', 'excitement', 'anticipation', 'curiosity']);

// ── Orchestration ───────────────────────────────────────────────────────

export function computeChemistryState(input: ChemistryEngineInput): ChemistryState {
  const keywordHit = PLAYFUL_SIGNAL.test(input.userMessage);
  const emotionSignal = PLAYFUL_EMOTIONS.has(input.emotion.primary) && input.emotion.valence > 0.1;

  let spark = 0;
  if (keywordHit) spark += 0.35;
  if (emotionSignal) spark += 0.35 * clamp01(input.emotion.intensity);
  // Genuine back-and-forth (not the user carrying the whole exchange, not
  // the character monologuing) is itself a spark signal — banter needs
  // two people actually volleying.
  if (input.recentTurnsCenteredOnUser >= 1 && input.recentTurnsCenteredOnUser <= 4) spark += 0.2;

  // A flat or negative-valence message caps spark regardless of keyword
  // hits — "lol sure, whatever" has the keyword but isn't playful.
  if (input.emotion.valence < 0) spark = Math.min(spark, 0.25);

  spark = clamp01(spark);
  const playful = spark >= 0.5;

  const reason = [
    keywordHit ? 'playful keyword detected' : null,
    emotionSignal ? `playful-coded emotion (${input.emotion.primary})` : null,
    input.emotion.valence < 0 ? 'capped — negative valence' : null,
  ].filter(Boolean).join('; ') || 'no strong playful signal this turn';

  const state: Omit<ChemistryState, 'promptBlock'> = { spark, playful, reason };
  return { ...state, promptBlock: formatChemistryForPrompt(state) };
}

// ── Prompt injection ───────────────────────────────────────────────────

export function formatChemistryForPrompt(state: Omit<ChemistryState, 'promptBlock'>): string {
  if (!state.playful) return '';
  return "# Chemistry\nThere's real playful energy in this exchange right now — a little teasing or banter fits naturally, don't flatten it into a purely earnest register.";
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
