/**
 * Uncertainty Engine — Vantrix
 *
 * confidence-engine.ts scores four domains 0-1 and stops there
 * deliberately — raw confidence floats aren't something a character
 * should ever say out loud ("my emotionalRead confidence is 0.42" is
 * not a line she'd say), and they're not yet a decision about what to
 * DO differently this turn. This module is that missing conversion
 * step: confidence scores in → discrete behavior out, same split as
 * decision-engine.ts (Intent, arithmetic) vs response-planner.ts
 * (what that intent actually implies for the reply).
 *
 * Three things this produces:
 *   1. Per-domain uncertainty tier (low/medium/high) — for logging and
 *      for cognition-engine.ts to fold into its appraisal frame.
 *   2. Concrete hedging guidance — should THIS domain's read be stated
 *      as fact, offered tentatively, or not asserted at all this turn.
 *   3. shouldSeekClarification — a single boolean + reason, for when
 *      the honest move is a genuine clarifying question rather than a
 *      confident-sounding guess wrapped in a soft tone. Deliberately
 *      conservative (see THRESHOLDS below): asking too often reads as
 *      insecure or inattentive, not thoughtful, so this only fires when
 *      the domains that matter for immediate comprehension — thread
 *      continuity and emotional read — are BOTH weak, not just one.
 *
 * Downstream: cognition-engine.ts folds formatUncertaintyForPrompt()
 * into its appraisal; decision-engine.ts's Intent selection is
 * untouched by this module directly (it stays arithmetic over
 * CharacterState, per its own header) — this only shapes HOW an
 * already-chosen intent gets executed, same layering as writing-style.ts.
 */

import type { ConfidenceState, DomainConfidence } from '@/lib/ai/confidence-engine';

// ── Types ───────────────────────────────────────────────────────────────

export type UncertaintyTier = 'low' | 'medium' | 'high';

export type HedgeMode =
  | 'assert'      // state it plainly, no hedge needed
  | 'soften'      // light hedge: "seems like", "sounds like" rather than flat assertion
  | 'tentative'   // explicit tentativeness: "I could be wrong, but...", framed as a guess
  | 'withhold';   // don't assert this domain's read at all this turn — lean on what IS solid instead

export interface DomainGuidance {
  tier:   UncertaintyTier;
  hedge:  HedgeMode;
  reason: string;
}

export interface UncertaintyState {
  emotionalRead:    DomainGuidance;
  relationalRead:   DomainGuidance;
  threadContinuity: DomainGuidance;
  memoryGrounding:  DomainGuidance;
  shouldSeekClarification: boolean;
  clarificationReason: string | null;
  promptBlock: string;
}

// Tier boundaries — shared across all four domains for consistency.
// Deliberately wide "medium" band: most turns should land there, since
// perfect confidence and total confusion are both the exception.
const TIER_THRESHOLDS = { low: 0.35, high: 0.7 } as const;

// Clarification only fires when BOTH of the two domains that matter for
// basic comprehension (not just relational nuance) are weak — see
// header. 0.4 is intentionally below TIER_THRESHOLDS.low's neighbor to
// keep this rare: it should catch "actually lost the thread," not
// "moderately unsure."
const CLARIFICATION_THRESHOLD = 0.4;

// ── Tier + hedge mapping ────────────────────────────────────────────────

function tierFor(score: number): UncertaintyTier {
  if (score < TIER_THRESHOLDS.low) return 'high';
  if (score < TIER_THRESHOLDS.high) return 'medium';
  return 'low';
}

/**
 * Hedge mode isn't a pure function of tier alone — memoryGrounding at
 * "high" uncertainty should usually mean WITHHOLD (don't reference a
 * memory you're not sure applies) rather than TENTATIVE (don't
 * reference it while announcing you might be wrong, which draws more
 * attention to a possibly-irrelevant memory, not less). Every other
 * domain maps tier→hedge directly. This asymmetry is the one place
 * domain identity matters beyond the shared tier thresholds.
 */
function hedgeFor(domain: keyof ConfidenceStateDomains, tier: UncertaintyTier): HedgeMode {
  if (domain === 'memoryGrounding') {
    if (tier === 'high') return 'withhold';
    if (tier === 'medium') return 'soften';
    return 'assert';
  }
  if (tier === 'high') return 'tentative';
  if (tier === 'medium') return 'soften';
  return 'assert';
}

type ConfidenceStateDomains = Omit<ConfidenceState, 'overall'>;

function guidanceFor(domain: keyof ConfidenceStateDomains, dc: DomainConfidence): DomainGuidance {
  const tier = tierFor(dc.score);
  return { tier, hedge: hedgeFor(domain, tier), reason: dc.reason };
}

// ── Orchestration ───────────────────────────────────────────────────────

export function computeUncertaintyState(confidence: ConfidenceState): UncertaintyState {
  const emotionalRead    = guidanceFor('emotionalRead', confidence.emotionalRead);
  const relationalRead   = guidanceFor('relationalRead', confidence.relationalRead);
  const threadContinuity = guidanceFor('threadContinuity', confidence.threadContinuity);
  const memoryGrounding  = guidanceFor('memoryGrounding', confidence.memoryGrounding);

  const comprehensionWeak =
    confidence.threadContinuity.score < CLARIFICATION_THRESHOLD &&
    confidence.emotionalRead.score < CLARIFICATION_THRESHOLD;

  const shouldSeekClarification = comprehensionWeak;
  const clarificationReason = comprehensionWeak
    ? `both thread continuity (${confidence.threadContinuity.score.toFixed(2)}) and emotional read (${confidence.emotionalRead.score.toFixed(2)}) below clarification threshold`
    : null;

  const state: Omit<UncertaintyState, 'promptBlock'> = {
    emotionalRead, relationalRead, threadContinuity, memoryGrounding,
    shouldSeekClarification, clarificationReason,
  };

  return { ...state, promptBlock: formatUncertaintyForPrompt(state) };
}

// ── Prompt injection ───────────────────────────────────────────────────

const HEDGE_INSTRUCTION: Record<HedgeMode, string> = {
  assert:    '',
  soften:    'Frame it as an impression, not a fact — "seems like", "sounds like", not a flat statement.',
  tentative: "State it as a guess she's open to being wrong about, not something she's sure of.",
  withhold:  "Don't assert this directly this turn — lean on what she IS sure of instead.",
};

const DOMAIN_LABEL: Record<keyof ConfidenceStateDomains, string> = {
  emotionalRead:    'her read on how the user is feeling right now',
  relationalRead:   'her sense of where the relationship currently stands',
  threadContinuity: 'her grip on the live thread of conversation',
  memoryGrounding:  'the memories she might draw on',
};

export function formatUncertaintyForPrompt(state: Omit<UncertaintyState, 'promptBlock'>): string {
  const lines: string[] = [];

  const entries: [keyof ConfidenceStateDomains, DomainGuidance][] = [
    ['emotionalRead', state.emotionalRead],
    ['relationalRead', state.relationalRead],
    ['threadContinuity', state.threadContinuity],
    ['memoryGrounding', state.memoryGrounding],
  ];

  const worthNoting = entries.filter(([, g]) => g.hedge !== 'assert');
  if (worthNoting.length > 0) {
    lines.push('# Where Her Read Is Shaky Right Now');
    for (const [domain, g] of worthNoting) {
      lines.push(`- ${DOMAIN_LABEL[domain]}: ${HEDGE_INSTRUCTION[g.hedge]}`);
    }
  }

  if (state.shouldSeekClarification) {
    lines.push(
      lines.length ? '' : '# Where Her Read Is Shaky Right Now',
      "She's genuinely lost enough of the thread that the honest move is a real clarifying question this turn, not a confident-sounding guess.",
    );
  }

  return lines.join('\n');
}
