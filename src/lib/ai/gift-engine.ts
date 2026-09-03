/**
 * src/lib/ai/gift-engine.ts
 *
 * Gift-reaction flavor engine — NOT the gift commerce system. The actual
 * catalogue, token deduction, and bond-score update already exist and are
 * transactional (see src/lib/dating/engine.ts's GIFT_CATALOGUE and
 * POST /api/dating/gifts's atomic send_gift() call). This module only
 * answers a text-generation question the commerce layer doesn't: once a
 * gift has been sent, how in-character should the reaction *sound*.
 *
 * Same family as romance-engine.ts et al.: pure prompt-injected style
 * guidance, derived from existing signals (gift rarity/type + relationship
 * stage), never gates the actual transaction, never touches crisis
 * handling.
 */

import type { RelationshipStage } from './relationship-engine';
import { GIFT_CATALOGUE } from '@/lib/dating/constants';
import type { GiftType, GiftRarity } from '@/lib/dating/constants';

export type GiftReactionTone =
  | 'polite'       // early relationship — grateful but measured
  | 'delighted'    // genuinely pleased, in-character enthusiasm
  | 'touched'      // the gift lands as emotionally meaningful
  | 'overwhelmed';  // rare/major gift at a deep relationship stage

export interface GiftContext {
  giftType: GiftType;
  rarity: GiftRarity;
  stage: RelationshipStage;
  /** True if this specific gift type hasn't been sent before in this relationship. */
  isFirstOfType: boolean;
}

const RARITY_WEIGHT: Record<GiftRarity, number> = {
  common: 0,
  special: 2,
  legendary: 3,
};

const STAGE_RECEPTIVENESS: Record<RelationshipStage, number> = {
  stranger: 0, match: 0, acquaintance: 0, friend: 1, dating: 1,
  close_friend: 2, exclusive: 2, best_friend: 2, partner: 3,
};

export function selectGiftReactionTone(ctx: GiftContext): GiftReactionTone {
  const weight = (RARITY_WEIGHT[ctx.rarity] ?? 0) + (STAGE_RECEPTIVENESS[ctx.stage] ?? 0)
    + (ctx.isFirstOfType ? 1 : 0);

  if (weight >= 5) return 'overwhelmed';
  if (weight >= 3) return 'touched';
  if (weight >= 1) return 'delighted';
  return 'polite';
}

const TONE_INSTRUCTIONS: Record<GiftReactionTone, string> = {
  polite:
    'React with genuine but measured thanks — grateful, a little surprised, without over-declaring what it means. It is early; a gift this size should not be treated as a grand gesture yet.',
  delighted:
    'React with real, visible delight — this clearly landed. Reference the specific gift (not a generic "thank you!"), and let a little of your personality color the reaction.',
  touched:
    'React like the gift actually meant something, not just the gesture — connect it to something specific about your relationship or something you mentioned wanting/liking earlier if that fits. This is a moment, not a formality.',
  overwhelmed:
    'This is a significant gift at a significant point in the relationship — let the reaction be a little overwhelmed, emotional, unguarded. It is fine to name what it means without deflecting or downplaying it.',
};

export function giftReactionInstruction(tone: GiftReactionTone, giftType: GiftType): string {
  return `${TONE_INSTRUCTIONS[tone]} (Gift received: ${giftType}.)`;
}

export interface GiftPromptFragment {
  tone: GiftReactionTone;
  instruction: string;
}

export function buildGiftFragment(ctx: GiftContext): GiftPromptFragment {
  const tone = selectGiftReactionTone(ctx);
  return { tone, instruction: giftReactionInstruction(tone, ctx.giftType) };
}

export function formatGiftForPrompt(fragment: GiftPromptFragment | null): string {
  if (!fragment) return '';
  return `Gift reaction (${fragment.tone}): ${fragment.instruction}`;
}

// ── Detection helper ────────────────────────────────────────────────────
//
// The gift commerce system (POST /api/dating/gifts) doesn't store
// giftType/rarity as structured columns on the resulting chat message —
// only role='gift' and a freeform content string like
// `You sent a Rose — "hope you like it"`. This resolves that string back
// to a catalogue entry so the chat route can react to it on the very next
// turn without a schema change. Returns null (fail-open) if nothing
// matches or the most recent message isn't a gift.

export interface RecentGift {
  giftType: GiftType;
  rarity: GiftRarity;
}

export function detectRecentGift(
  lastMessage: { role: string; content: string } | undefined,
): RecentGift | null {
  if (!lastMessage || lastMessage.role !== 'gift') return null;
  const match = GIFT_CATALOGUE.find(g =>
    lastMessage.content.toLowerCase().includes(g.name.toLowerCase()),
  );
  if (!match) return null;
  return { giftType: match.type, rarity: match.rarity };
}
