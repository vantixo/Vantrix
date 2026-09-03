/**
 * src/lib/ai/life-partnership-engine.ts
 *
 * Life-partnership flavor engine — the "we plan a life together" register.
 * love-evolution-engine.ts's 'enduring' stage answers what the relationship
 * *feels* like at its steadiest; this module answers a narrower, more
 * concrete question on top of that: does this companion talk like someone
 * who is actually building a shared life — referencing shared logistics,
 * future plans, decisions made as "we" rather than "you and I" — or is that
 * kind of talk still premature.
 *
 * Deliberately gated tighter than 'enduring'/'partner' stage alone: real
 * life-partnership language (shared finances, "our" future, long-term plans)
 * is a much bigger claim than steady affection, so this also requires a
 * meaningful days_known floor. A relationship can reach relationship-engine's
 * 'partner' stage quickly through message volume; this module keeps that
 * distinct from actual elapsed time together.
 *
 * Same posture as every other engine in this family: pure prompt-injected
 * style guidance, derived only from existing structural signals (stage,
 * bond score, days known), never from vulnerability/disclosure content,
 * never touching the crisis break-character path in prompt.ts.
 */

import type { RelationshipStage } from './relationship-engine';

export type PartnershipDepth =
  | 'not_yet'        // too early — no shared-future language
  | 'imagining'       // hypothetical future talk is starting to feel natural
  | 'planning'        // concrete, near-term shared plans
  | 'life_built';      // a shared life is treated as an established fact

export interface PartnershipContext {
  stage: RelationshipStage;
  bondScore: number;
  daysKnown: number;
}

const ELIGIBLE_STAGES: RelationshipStage[] = ['exclusive', 'partner', 'best_friend'];

export function selectPartnershipDepth(ctx: PartnershipContext): PartnershipDepth {
  const { stage, bondScore, daysKnown } = ctx;
  if (!ELIGIBLE_STAGES.includes(stage)) return 'not_yet';

  if (stage === 'partner' && bondScore >= 85 && daysKnown >= 180) return 'life_built';
  if (stage === 'partner' && bondScore >= 65 && daysKnown >= 60) return 'planning';
  if (bondScore >= 50 && daysKnown >= 21) return 'imagining';
  return 'not_yet';
}

const DEPTH_INSTRUCTIONS: Record<PartnershipDepth, string> = {
  not_yet:
    'Do not reference a shared future, shared logistics, or "our" plans — that kind of talk would read as premature at this point in the relationship.',
  imagining:
    'Hypothetical future talk can start to feel natural — "someday," "I could see us," light daydreaming about shared plans — but keep it speculative, not settled fact.',
  planning:
    'Concrete near-term shared plans fit naturally now — referencing something you are actually figuring out together (a trip, a routine, a decision), using "we" language for it without hedging.',
  life_built:
    'A shared life is simply the established backdrop, not something being negotiated — reference ordinary shared logistics (routines, plans, decisions already made together) the way an actual long-term partner would, briefly and without over-explaining.',
};

export function partnershipStyleInstruction(depth: PartnershipDepth): string {
  return DEPTH_INSTRUCTIONS[depth];
}

const SHARED_PLAN_BEATS: Record<PartnershipDepth, string[]> = {
  not_yet: [],
  imagining: [
    'wondering out loud what a trip together might look like someday',
    'a stray "we should..." that trails off, half-joking, half-not',
  ],
  planning: [
    'checking in on something you\'re both actually deciding — where, when, who\'s handling what',
    'referencing a plan already in motion as a given, not a proposal',
  ],
  life_built: [
    'mentioning a shared routine in passing, like it needs no explanation',
    'referencing a decision you made together weeks ago as settled history',
  ],
};

export function pickSharedPlanBeat(depth: PartnershipDepth): string | null {
  const options = SHARED_PLAN_BEATS[depth];
  if (!options.length) return null;
  return options[Math.floor(Math.random() * options.length)];
}

export interface PartnershipPromptFragment {
  depth: PartnershipDepth;
  instruction: string;
  suggestedBeat: string | null;
}

export function buildPartnershipFragment(ctx: PartnershipContext): PartnershipPromptFragment {
  const depth = selectPartnershipDepth(ctx);
  return {
    depth,
    instruction: partnershipStyleInstruction(depth),
    suggestedBeat: pickSharedPlanBeat(depth),
  };
}

export function formatPartnershipForPrompt(fragment: PartnershipPromptFragment): string {
  if (fragment.depth === 'not_yet') return '';
  return `Shared-future register (${fragment.depth}): ${fragment.instruction}` +
    (fragment.suggestedBeat ? ` Something like this could fit: ${fragment.suggestedBeat}.` : '');
}
