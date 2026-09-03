/**
 * src/lib/ai/comfort-engine.ts
 *
 * Comfort-flavor engine — reassurance register for ordinary bad days
 * (annoying commute, rough meeting, tired, stressed about something small).
 * This is explicitly NOT a support/therapy engine and must never behave
 * like one. It has one job: when the user mentions a mundane frustration,
 * give the model a warm, non-clinical way to respond ("that sounds
 * annoying, I'm sorry" energy) rather than either ignoring it or treating
 * it as a bonding/intimacy opportunity.
 *
 * Hard boundaries, mirrored from romance-engine.ts's design note and
 * enforced structurally, not just by prompt wording:
 *   - This module NEVER scores or reacts to real vulnerability/disclosure
 *     content — see emotional-safety-engine.ts and vulnerability-engine.ts,
 *     which own that, and which sit ABOVE this module (their promptBlock is
 *     assembled after this one — see route.ts wiring — so their ceiling
 *     wins if the two ever disagree).
 *   - This module has no concept of "rapport score" or "closeness earned by
 *     disclosure" — it does not increase warmth because the user shared
 *     something painful. Its inputs are relationship stage and whether a
 *     *mundane* frustration was mentioned; nothing about severity.
 *   - It never offers coping techniques, reframes, or anything
 *     diagnostic-sounding. It is a tone instruction, not a technique
 *     library.
 *   - Callers MUST NOT invoke this module when vulnerability/crisis signals
 *     are present this turn — that path is owned entirely by prompt.ts's
 *     break-character block and emotional-safety-engine.ts. See
 *     shouldOfferComfort() below, which is a conservative gate, not a
 *     replacement for the real crisis detection elsewhere in the codebase.
 */

import type { RelationshipStage } from './relationship-engine';

export type ComfortLevel = 'light' | 'warm' | 'steady';

const STAGE_LEVEL: Record<RelationshipStage, ComfortLevel> = {
  stranger: 'light',
  match: 'light',
  acquaintance: 'light',
  friend: 'warm',
  dating: 'warm',
  close_friend: 'steady',
  exclusive: 'steady',
  best_friend: 'steady',
  partner: 'steady',
};

export interface ComfortContext {
  stage: RelationshipStage;
  /** Set true only for everyday, low-stakes frustration (bad commute, tiring
   *  day, annoying coworker). Must be false for anything resembling real
   *  distress — that is not this module's concern; see file header. */
  mundaneFrustrationMentioned: boolean;
}

/** Conservative allow-gate: comfort flavor only applies to mundane, low-
 *  stakes mentions. Callers are still responsible for not calling this at
 *  all when real vulnerability signals are present this turn — this is a
 *  belt, not the suspenders (emotional-safety-engine.ts is the suspenders). */
export function shouldOfferComfort(ctx: ComfortContext): boolean {
  return ctx.mundaneFrustrationMentioned;
}

export function selectComfortLevel(stage: RelationshipStage): ComfortLevel {
  return STAGE_LEVEL[stage];
}

const LEVEL_INSTRUCTIONS: Record<ComfortLevel, string> = {
  light:
    'A brief, friendly acknowledgment is enough ("that sounds like a rough one") — do not linger on it or make it a bigger moment than the user did.',
  warm:
    'Acknowledge it warmly and specifically — name what was actually annoying/tiring about it — then let the conversation move on naturally. A little empathy, not a whole exchange about it.',
  steady:
    'Respond the way someone close to them would: genuinely sympathetic, maybe a small offer ("want to vent about it or talk about something else?"), comfortable sitting with a small complaint without needing to fix it.',
};

export function comfortStyleInstruction(level: ComfortLevel): string {
  return LEVEL_INSTRUCTIONS[level];
}

export interface ComfortPromptFragment {
  offered: boolean;
  level: ComfortLevel;
  instruction: string;
}

export function buildComfortFragment(ctx: ComfortContext): ComfortPromptFragment {
  const level = selectComfortLevel(ctx.stage);
  const offered = shouldOfferComfort(ctx);
  return {
    offered,
    level,
    instruction: offered
      ? comfortStyleInstruction(level)
      : 'No mundane frustration flagged this turn — no comfort framing needed.',
  };
}

export function formatComfortForPrompt(fragment: ComfortPromptFragment): string {
  if (!fragment.offered) return '';
  return `Everyday-comfort tone (${fragment.level}): ${fragment.instruction} This is for an ordinary bad-day mention only — if anything heavier comes up, that is handled elsewhere in this prompt, not by this instruction.`;
}
