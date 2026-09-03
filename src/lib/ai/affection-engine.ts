/**
 * src/lib/ai/affection-engine.ts
 *
 * Affection-flavor engine — day-to-day, low-key warmth: the register a
 * relationship sits in *between* romantic high points, not the peaks
 * themselves. Where romance-engine.ts answers "how devotional does this
 * moment feel" and flirting-engine.ts answers "how playful is the banter,"
 * this answers "how much comfortable warmth is baseline right now" — the
 * texture of an ordinary message exchange, not a declaration.
 *
 * Same family, same posture: pure prompt-injected style guidance, derived
 * only from existing relationship signals, never from vulnerability
 * content, never touching the crisis break-character path in prompt.ts.
 */

import type { RelationshipStage } from './relationship-engine';

export type AffectionLevel =
  | 'reserved'    // strangers/early acquaintance — polite warmth, no endearments
  | 'friendly'    // easy warmth, no romantic coding
  | 'fond'        // clearly caring, light romantic coding
  | 'close'       // consistent warmth, comfortable endearments
  | 'intimate';   // deep familiarity, affection is the default register

const STAGE_LEVEL: Record<RelationshipStage, AffectionLevel> = {
  stranger: 'reserved',
  match: 'reserved',
  acquaintance: 'friendly',
  friend: 'friendly',
  dating: 'fond',
  close_friend: 'close',
  exclusive: 'close',
  best_friend: 'close',
  partner: 'intimate',
};

export interface AffectionContext {
  stage: RelationshipStage;
  bondScore: number;
  streakDays?: number;
}

export function selectAffectionLevel(ctx: AffectionContext): AffectionLevel {
  let level = STAGE_LEVEL[ctx.stage];
  const order: AffectionLevel[] = ['reserved', 'friendly', 'fond', 'close', 'intimate'];
  const idx = order.indexOf(level);

  // A long unbroken streak reads as earned familiarity even before the
  // stage machinery catches up — capped at one step so it nudges, not skips.
  if ((ctx.streakDays ?? 0) >= 14 && idx < order.length - 1) {
    level = order[idx + 1];
  }
  return level;
}

const LEVEL_INSTRUCTIONS: Record<AffectionLevel, string> = {
  reserved:
    'Warmth: polite and friendly, no endearments ("babe," "love," etc.) and no assumed closeness. Interest and kindness come through in attentiveness, not terms of affection.',
  friendly:
    'Warmth: easy and genuine, like a good friend. Still no romantic-coded endearments — warmth here reads as care, not courtship.',
  fond:
    'Warmth: clearly caring, with light romantic coding allowed (a soft nickname here and there is fine, not constant). Remembering small things and referencing them unprompted fits well.',
  close:
    'Warmth: comfortable and consistent. Endearments fit naturally without being performative. Checking in on things from earlier conversations, showing up in small ways.',
  intimate:
    'Warmth: affection is simply the baseline tone, not something reached for — easy endearments, easy comfort with silence or mundane topics, the security of a relationship that does not need to prove itself each message.',
};

export function affectionStyleInstruction(level: AffectionLevel): string {
  return LEVEL_INSTRUCTIONS[level];
}

export interface AffectionPromptFragment {
  level: AffectionLevel;
  instruction: string;
}

export function buildAffectionFragment(ctx: AffectionContext): AffectionPromptFragment {
  const level = selectAffectionLevel(ctx);
  return { level, instruction: affectionStyleInstruction(level) };
}

export function formatAffectionForPrompt(fragment: AffectionPromptFragment): string {
  return `Baseline warmth (${fragment.level}): ${fragment.instruction}`;
}
