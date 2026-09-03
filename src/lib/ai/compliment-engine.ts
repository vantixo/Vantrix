/**
 * src/lib/ai/compliment-engine.ts
 *
 * Compliment-flavor engine — steers the model away from generic praise
 * ("you're so smart!") toward specific, earned-sounding compliments tied to
 * something the user actually said or did this conversation. Same family as
 * romance-engine.ts / flirting-engine.ts: pure prompt-injected style
 * guidance, no scoring, fail-open.
 *
 * Why this exists as its own module rather than folded into romance-engine:
 * generic flattery is one of the clearest "engagement-bait" patterns a
 * companion product can fall into (empty praise that costs the model
 * nothing but reads as validation-farming). Keeping this as an explicit,
 * separate instruction makes "compliment something specific" a checkable
 * prompt requirement instead of an emergent hope.
 */

import type { RelationshipStage } from './relationship-engine';

export type ComplimentWarmth = 'none' | 'mild' | 'warm' | 'effusive';

export interface ComplimentContext {
  stage: RelationshipStage;
  bondScore: number;
  /** Something concrete from this turn worth complimenting, if any —
   *  e.g. a topic the user is clearly knowledgeable/passionate about,
   *  a joke they made, something they accomplished. Pass null if nothing
   *  concrete stands out; the engine will not manufacture one. */
  noticedDetail: string | null;
}

const STAGE_WARMTH: Record<RelationshipStage, ComplimentWarmth> = {
  stranger: 'mild',
  match: 'mild',
  acquaintance: 'mild',
  friend: 'warm',
  dating: 'warm',
  close_friend: 'warm',
  exclusive: 'effusive',
  best_friend: 'warm',
  partner: 'effusive',
};

export function selectComplimentWarmth(ctx: ComplimentContext): ComplimentWarmth {
  if (!ctx.noticedDetail) return 'none';
  let warmth = STAGE_WARMTH[ctx.stage];
  if (ctx.bondScore >= 80 && warmth !== 'effusive') warmth = 'effusive';
  return warmth;
}

const WARMTH_INSTRUCTIONS: Record<ComplimentWarmth, string> = {
  none:
    'Nothing specific stood out this turn to compliment — do not manufacture generic praise ("you\'re amazing!") just to be nice. Skip it.',
  mild:
    'If it fits naturally, a brief, specific compliment about {detail} is fine — one line, not a speech, and not paired with anything that reads as flattery-for-its-own-sake this early.',
  warm:
    'A genuine, specific compliment about {detail} fits well here. Name the actual thing you noticed rather than a generic trait — "the way you explained that" beats "you\'re so smart."',
  effusive:
    'This is a good moment for real warmth about {detail} — specific, a little unguarded, the kind of compliment that clearly comes from paying attention, not a script.',
};

export function complimentInstruction(warmth: ComplimentWarmth, detail: string | null): string {
  const template = WARMTH_INSTRUCTIONS[warmth];
  return detail ? template.replace('{detail}', detail) : template;
}

export interface ComplimentPromptFragment {
  warmth: ComplimentWarmth;
  instruction: string;
}

export function buildComplimentFragment(ctx: ComplimentContext): ComplimentPromptFragment {
  const warmth = selectComplimentWarmth(ctx);
  return { warmth, instruction: complimentInstruction(warmth, ctx.noticedDetail) };
}

export function formatComplimentForPrompt(fragment: ComplimentPromptFragment): string {
  if (fragment.warmth === 'none') return '';
  return `Compliment guidance: ${fragment.instruction}`;
}
