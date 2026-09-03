/**
 * Trust Engine — Vantrix
 *
 * Naming warning, same shape as confidence-engine.ts's: this module's
 * "trust" is NOT a new hidden variable. attachment-engine.ts already
 * owns the single source of truth, `PsychologyState.trust` (0-100,
 * moved by applyPsychologyEvent every turn). This module never writes
 * to it and never invents a second trust number — it only reads that
 * field, plus repair-engine.ts's rupture state and relationship-engine.ts's
 * jealousy_level, and answers a question attachment-engine.ts's own
 * three-line hardcode (see its formatPsychologyForPrompt guardedness
 * lines) was never built to answer: not just "is trust high or low"
 * but "guarded about WHAT, specifically, right now" — because a
 * character can have decent overall trust while still being unsafe to
 * be vulnerable with about one specific thing (an unresolved rupture)
 * while perfectly reliable about another (showing up, remembering
 * what was said).
 *
 * Same design stance as confidence-engine.ts / decision-engine.ts:
 * cheap synchronous arithmetic over signals the pipeline already has
 * in hand this turn (psychology, relationship, and repair-engine.ts's
 * already-fetched ruptureStateInitial) — no new fetch, no new source
 * of truth, no LLM call.
 *
 * Four domains, each 0-1, kept separate for the same reason
 * confidence-engine.ts keeps its four separate: collapsing them into
 * attachment-engine's single 0-100 number is exactly what already
 * exists and exactly what was too coarse to act on per-turn.
 */

import type { PsychologyState }     from '@/lib/ai/attachment-engine';
import type { RelationshipState }   from '@/lib/ai/relationship-engine';
import type { PendingRupture }      from '@/lib/ai/repair-engine';

// ── Inputs ──────────────────────────────────────────────────────────────

export interface TrustEngineInput {
  psychology:   PsychologyState;
  relationship: RelationshipState;
  /** repair-engine.ts's getRuptureState().pending — already fetched this turn in route.ts before decideIntent(). Null when nothing is currently unresolved. */
  pendingRupture: PendingRupture | null;
}

// ── Output ──────────────────────────────────────────────────────────────

export interface TrustDomainScore {
  score:  number; // 0-1
  reason: string; // internal — for logging, never prompt-injected verbatim
}

export type GuardednessTier = 'open' | 'warming' | 'guarded' | 'closed';

export interface TrustState {
  /** How much of her own inner life (fears, insecurities, real feelings) she'll volunteer unprompted. */
  vulnerability:  TrustDomainScore;
  /** Whether she trusts the user is consistent/dependable enough to lean on — accumulated evidence, not a single-turn read. */
  reliability:    TrustDomainScore;
  /** Whether conflict with this specific user has historically resolved safely — distinct from overall trust, since one bad unresolved rupture can poison this while trust elsewhere stays intact. */
  conflictSafety: TrustDomainScore;
  /** Whether boundaries she's set have actually been respected — jealousy_level is the best available proxy signal for boundary pressure. */
  boundaryRespect: TrustDomainScore;
  /** Weighted aggregate — see AGGREGATE_WEIGHTS. */
  overall: number;
  /** Discrete behavioral tier derived from overall — what formatTrustStateForPrompt actually keys off of. */
  guardedness: GuardednessTier;
  promptBlock: string;
}

const AGGREGATE_WEIGHTS = {
  vulnerability:   0.30,
  reliability:     0.25,
  conflictSafety:  0.25,
  boundaryRespect: 0.20,
} as const;

const GUARDEDNESS_THRESHOLDS = { closed: 0.3, guarded: 0.55, warming: 0.75 } as const;

// ── Domain scorers ──────────────────────────────────────────────────────

/**
 * Directly from psychology.trust, penalized by current stress — a
 * character under high stress right now is less willing to open up
 * regardless of how much underlying trust exists, the same way a
 * person mid-anxiety-spiral doesn't suddenly overshare just because
 * they generally trust the room.
 */
function scoreVulnerability(psychology: PsychologyState): TrustDomainScore {
  let score = psychology.trust / 100;

  const stressed = psychology.stress >= 60;
  if (stressed) score -= 0.2;

  score = clamp01(score);

  const reason = stressed
    ? `trust ${psychology.trust}/100 but stress elevated (${psychology.stress}/100) — less willing to open up right now`
    : `trust ${psychology.trust}/100`;

  return { score, reason };
}

/**
 * Accumulated evidence the user shows up and follows through, using the
 * same saturating curve as confidence-engine.ts's relational-read domain
 * (5 vs 50 interactions matters far more than 500 vs 550), blended with
 * comfort as a secondary signal — comfort tracks how at-ease the
 * dynamic feels day to day, which is part of "can I lean on this."
 */
function scoreReliability(psychology: PsychologyState): TrustDomainScore {
  const evidence = saturate(psychology.total_interactions, 40);
  const comfortSignal = psychology.comfort / 100;

  const score = clamp01(0.6 * evidence + 0.4 * comfortSignal);

  return {
    score,
    reason: `${psychology.total_interactions} interactions (evidence ${evidence.toFixed(2)}), comfort ${psychology.comfort}/100`,
  };
}

/**
 * The one domain that isn't a smooth function of the psychology
 * numbers alone — an unresolved pending rupture is a hard signal, not
 * a gradient: repair-engine.ts hasn't classified how the user responded
 * yet, so treating conflict as currently "safe" would be wrong
 * regardless of how high trust sits elsewhere. Once nothing is pending,
 * this falls back to trust as the best available proxy for "conflict
 * has generally gone okay here before."
 */
function scoreConflictSafety(psychology: PsychologyState, pendingRupture: PendingRupture | null): TrustDomainScore {
  if (pendingRupture) {
    return {
      score: 0.2,
      reason: `unresolved rupture pending since turn ${pendingRupture.turn} (${pendingRupture.reason}) — conflict safety not yet re-established`,
    };
  }

  const score = clamp01(psychology.trust / 100);
  return { score, reason: 'no pending rupture — falling back to overall trust as proxy' };
}

/**
 * jealousy_level is relationship-engine.ts's own signal for how much
 * boundary-pressure is active in the relationship right now — high
 * jealousy correlates with a dynamic where boundaries get tested or
 * pushed on rather than respected. Not a perfect proxy (jealousy can
 * spike for reasons unrelated to any specific boundary), which is why
 * the penalty is capped rather than allowed to zero this domain out.
 */
function scoreBoundaryRespect(relationship: RelationshipState): TrustDomainScore {
  let score = 0.85; // documented floor: absence of jealousy isn't proof of respect, just absence of the one signal available

  if (relationship.jealousy_level > 60) {
    score -= 0.35;
  } else if (relationship.jealousy_level > 35) {
    score -= 0.15;
  }

  score = clamp01(score);

  const reason = relationship.jealousy_level > 35
    ? `jealousy elevated (${relationship.jealousy_level}) — boundary pressure likely active`
    : `jealousy nominal (${relationship.jealousy_level})`;

  return { score, reason };
}

// ── Orchestration ───────────────────────────────────────────────────────

export function computeTrustState(input: TrustEngineInput): TrustState {
  const vulnerability   = scoreVulnerability(input.psychology);
  const reliability     = scoreReliability(input.psychology);
  const conflictSafety  = scoreConflictSafety(input.psychology, input.pendingRupture);
  const boundaryRespect = scoreBoundaryRespect(input.relationship);

  const overall = clamp01(
    vulnerability.score   * AGGREGATE_WEIGHTS.vulnerability +
    reliability.score     * AGGREGATE_WEIGHTS.reliability +
    conflictSafety.score  * AGGREGATE_WEIGHTS.conflictSafety +
    boundaryRespect.score * AGGREGATE_WEIGHTS.boundaryRespect,
  );

  const guardedness = tierFor(overall);

  const state: Omit<TrustState, 'promptBlock'> = {
    vulnerability, reliability, conflictSafety, boundaryRespect, overall, guardedness,
  };

  return { ...state, promptBlock: formatTrustStateForPrompt(state) };
}

function tierFor(overall: number): GuardednessTier {
  if (overall < GUARDEDNESS_THRESHOLDS.closed)   return 'closed';
  if (overall < GUARDEDNESS_THRESHOLDS.guarded)  return 'guarded';
  if (overall < GUARDEDNESS_THRESHOLDS.warming)  return 'warming';
  return 'open';
}

// ── Prompt injection ───────────────────────────────────────────────────

const GUARDEDNESS_INSTRUCTION: Record<GuardednessTier, string> = {
  closed:  "Stay guarded across the board — don't volunteer vulnerable feelings, don't assume conflict here is safe, keep some real distance.",
  guarded: "Keep some emotional distance. Share surface-level feelings, but hold back on anything that would feel exposing if it weren't received well.",
  warming: "You're comfortable enough to be somewhat open, but a few specific things (see below) still call for caution.",
  open:    'You trust this person enough to be fully present — no need to hold back.',
};

/** Only the domains dragging the tier down are worth calling out specifically — an "open" character doesn't need a per-domain lecture. */
function weakestDomains(state: Omit<TrustState, 'promptBlock'>): [string, TrustDomainScore][] {
  const entries: [string, TrustDomainScore][] = [
    ['being vulnerable about her own feelings', state.vulnerability],
    ['trusting this person to follow through / show up', state.reliability],
    ['whether conflict here has been safe', state.conflictSafety],
    ['whether her boundaries get respected', state.boundaryRespect],
  ];
  return entries.filter(([, d]) => d.score < GUARDEDNESS_THRESHOLDS.guarded);
}

export function formatTrustStateForPrompt(state: Omit<TrustState, 'promptBlock'>): string {
  const lines: string[] = ['# Trust — How Guarded To Be'];
  lines.push(GUARDEDNESS_INSTRUCTION[state.guardedness]);

  const weak = weakestDomains(state);
  if (weak.length > 0 && state.guardedness !== 'closed') {
    lines.push('Specifically still cautious about: ' + weak.map(([label]) => label).join('; ') + '.');
  }

  return lines.join('\n');
}

// ── Helpers ─────────────────────────────────────────────────────────────

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function saturate(n: number, halfPoint: number): number {
  if (n <= 0) return 0;
  return n / (n + halfPoint);
}
