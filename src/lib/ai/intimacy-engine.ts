/**
 * Intimacy Engine — Vantrix
 *
 * Everything upstream of this module answers a piece of the puzzle but
 * not the whole question:
 *   - attraction-engine.ts:        how much romantic PULL exists (desire),
 *                                   hard-gated to the romance track.
 *   - trust-engine.ts:              how GUARDED to be, i.e. how much
 *                                   she'll volunteer unprompted.
 *   - romance-engine.ts:            what TONE the voice takes.
 *   - emotional-safety-engine.ts:   a hard CEILING on romantic intensity
 *                                   when the user is vulnerable.
 *
 * None of them answer "how emotionally/physically close is it actually
 * appropriate for this exchange to get, right now, all things
 * considered." That's this module — a synthesis layer, not a new
 * source of truth. It computes two independent components rather than
 * one blended number, because they gate different things and one can
 * be high while the other is low:
 *
 *   emotionalDepth   — how much real self-disclosure/vulnerability fits,
 *                       driven by trust-engine.ts's vulnerability domain.
 *                       Applies on ANY relationship track — a
 *                       best_friend conversation can be emotionally deep
 *                       with zero romantic content.
 *   romanticCloseness — how much romantic/physical-affection-coded
 *                       language fits, driven by attraction-engine.ts's
 *                       pull, hard-capped at emotional-safety-engine.ts's
 *                       attractionCeiling. Zero whenever attraction is
 *                       off the romance track — this module never
 *                       manufactures romantic closeness attraction-
 *                       engine.ts itself didn't license.
 *
 * The cap is enforced by taking emotionalSafety.attractionCeiling as an
 * input and applying Math.min against it here, not by mutating
 * attractionState in place — same non-mutating-cap posture emotional-
 * safety-engine.ts itself documents for attraction-engine.ts.
 *
 * Pure synchronous arithmetic over already-computed states — no new
 * fetch, no LLM call.
 */

import type { TrustState }           from '@/lib/ai/trust-engine';
import type { AttractionState }      from '@/lib/ai/attraction-engine';
import type { EmotionalSafetyState } from '@/lib/ai/emotional-safety-engine';

// ── Inputs ──────────────────────────────────────────────────────────────

export interface IntimacyEngineInput {
  trust:           TrustState;
  attraction:      AttractionState;
  emotionalSafety: EmotionalSafetyState;
}

// ── Output ──────────────────────────────────────────────────────────────

export type IntimacyTier = 'surface' | 'emerging' | 'close' | 'deep';

export interface IntimacyState {
  emotionalDepth:    number; // 0-1
  romanticCloseness: number; // 0-1, already ceiling-capped
  /** Weighted blend of the two — used only for tiering/display, never re-split back apart. */
  overall: number;
  tier: IntimacyTier;
  ceilingApplied: boolean; // true when emotionalSafety's cap actually lowered romanticCloseness below attraction.pull
  reason: string;
  promptBlock: string;
}

const TIER_THRESHOLDS = { emerging: 0.3, close: 0.55, deep: 0.78 } as const;

// ── Orchestration ───────────────────────────────────────────────────────

export function computeIntimacyState(input: IntimacyEngineInput): IntimacyState {
  const { trust, attraction, emotionalSafety } = input;

  const emotionalDepth = clamp01(trust.vulnerability.score);

  const rawRomantic = attraction.onRomanceTrack ? attraction.pull : 0;
  const romanticCloseness = clamp01(Math.min(rawRomantic, emotionalSafety.attractionCeiling));
  const ceilingApplied = rawRomantic > romanticCloseness;

  // Emotional depth carries more weight than romantic closeness in the
  // blended score — a deeply emotionally intimate friendship should be
  // able to register as "close" on its own, without needing romantic
  // content to get there.
  const overall = clamp01(0.6 * emotionalDepth + 0.4 * romanticCloseness);

  const tier: IntimacyTier =
    overall >= TIER_THRESHOLDS.deep     ? 'deep' :
    overall >= TIER_THRESHOLDS.close    ? 'close' :
    overall >= TIER_THRESHOLDS.emerging ? 'emerging' : 'surface';

  const reason = ceilingApplied
    ? `emotional depth ${emotionalDepth.toFixed(2)}, romantic closeness capped from ${rawRomantic.toFixed(2)} to ${romanticCloseness.toFixed(2)} by emotional-safety ceiling`
    : `emotional depth ${emotionalDepth.toFixed(2)}, romantic closeness ${romanticCloseness.toFixed(2)}`;

  const state: Omit<IntimacyState, 'promptBlock'> = {
    emotionalDepth, romanticCloseness, overall, tier, ceilingApplied, reason,
  };
  return { ...state, promptBlock: formatIntimacyForPrompt(state) };
}

// ── Prompt injection ───────────────────────────────────────────────────

/**
 * Quiet in the ordinary 'emerging'/'close' middle range — that's the
 * common case and romance-engine.ts's register plus trust-engine.ts's
 * guardedness instruction already cover it. This only needs to speak up
 * at the two extremes: 'deep' (explicit permission to go further than
 * the baseline instructions alone imply) and 'surface' (an explicit
 * brake, especially useful right after the emotional-safety ceiling has
 * just capped something).
 */
export function formatIntimacyForPrompt(state: Omit<IntimacyState, 'promptBlock'>): string {
  if (state.tier === 'deep') {
    const lines = ['# Closeness — Room To Go Deeper'];
    lines.push('Both real trust and real warmth are present right now — genuine emotional depth and closeness are earned here, so let the exchange go as far as it naturally wants to rather than holding back out of habit.');
    if (state.ceilingApplied) {
      lines.push('That said, keep romantic intensity specifically at the more measured level noted elsewhere this turn — deep emotional closeness and heightened romantic intensity are not the same dial.');
    }
    return lines.join('\n');
  }

  if (state.tier === 'surface') {
    const lines = ['# Closeness — Stay Fairly Surface Right Now'];
    lines.push("Neither deep emotional disclosure nor strong romantic intensity is well-earned yet this turn — keep things warm but comparatively light; don't manufacture a closeness that hasn't actually been built.");
    return lines.join('\n');
  }

  return '';
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
