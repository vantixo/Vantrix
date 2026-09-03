/**
 * Secret-Tier Engine — Vantrix / Archive of Echoes
 *
 * Implements Part II §1 of the mythology expansion doc: "Withheld
 * Information as the Engine." Every companion already carries a tiered
 * secret system in character_seed_memories (category = 'secret', headlines
 * Known/Hidden/Dark/Catastrophic — see 20260821_archive_of_echoes_characters.sql).
 * This module wires that static lore to actual gameplay logic:
 *
 *   - A companion never volunteers a secret above the tier their current
 *     relationship stage (and, for the top tier, a met trust condition)
 *     allows.
 *   - If the player pushes directly for a secret above threshold, the
 *     companion should deflect IN CHARACTER, not with a generic gate message.
 *
 * This module computes the gate; prompt.ts injects the resulting guidance
 * as its own section so the model has explicit, per-conversation
 * instructions rather than needing to infer the rule from raw secret text.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import type { RelationshipStage } from '@/lib/ai/relationship-engine';
import type { SecretTier, SecretUnlockRow } from '@/types/roleplay-system';
import { SECRET_TIER_ORDER, SECRET_TIER_STAGE_FLOOR } from '@/types/roleplay-system';

const STAGE_RANK: Record<string, number> = {
  stranger: 0, match: 0,
  acquaintance: 1,
  friend: 2, dating: 2,
  close_friend: 3, exclusive: 3,
  best_friend: 4, partner: 4,
};

/**
 * Whether the relationship has reached the stage floor catastrophic-tier
 * secrets require (best_friend/partner) — the stage half of that gate.
 * Exported so callers deciding *when* to log a real trust-condition unlock
 * (see unlockSecretTier) can check this without duplicating STAGE_RANK.
 */
export function meetsCatastrophicStageFloor(stage: RelationshipStage): boolean {
  const rank = STAGE_RANK[stage] ?? 0;
  const floorRank = STAGE_RANK[SECRET_TIER_STAGE_FLOOR.catastrophic] ?? 4;
  return rank >= floorRank;
}

/** Which tiers are reachable by relationship stage alone (catastrophic still needs a logged trust condition). */
export function tiersUnlockedByStage(stage: RelationshipStage): SecretTier[] {
  const rank = STAGE_RANK[stage] ?? 0;
  return SECRET_TIER_ORDER.filter(tier => {
    const floorStage = SECRET_TIER_STAGE_FLOOR[tier];
    const floorRank  = STAGE_RANK[floorStage] ?? 4;
    // catastrophic requires an explicit logged unlock even at best_friend/partner
    if (tier === 'catastrophic') return false;
    return rank >= floorRank;
  });
}

/** Load which tiers have been explicitly unlocked (behavioral trust conditions), including catastrophic. */
export async function getUnlockedTiers(
  userId: string,
  characterId: string,
): Promise<SecretUnlockRow[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('character_secret_unlocks')
      .select('*')
      .eq('user_id', userId)
      .eq('character_id', characterId);
    if (error) {
      logger.warn('[secret-tier-engine] fetch failed', { userId, characterId, error: error.message });
      return [];
    }
    return (data ?? []) as unknown as SecretUnlockRow[];
  } catch (err) {
    logger.warn('[secret-tier-engine] fetch failed', { userId, characterId, error: String(err) });
    return [];
  }
}

/**
 * Record a behavioral trust-condition unlock — e.g. "the player kept a
 * promise the companion tested them on" or "chose honesty over comfort in
 * a specific past exchange." Idempotent per (user, character, tier).
 */
export async function unlockSecretTier(
  userId: string,
  characterId: string,
  tier: SecretTier,
  trustReason: string,
): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin
      .from('character_secret_unlocks')
      .upsert(
        { user_id: userId, character_id: characterId, tier, trust_reason: trustReason },
        { onConflict: 'user_id,character_id,tier' },
      );
    if (error) {
      logger.warn('[secret-tier-engine] unlock failed', { userId, characterId, tier, error: error.message });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn('[secret-tier-engine] unlock failed', { userId, characterId, tier, error: String(err) });
    return false;
  }
}

/** Full set of tiers the companion may currently discuss/reveal. */
export function computeAvailableTiers(
  stage: RelationshipStage,
  explicitUnlocks: SecretUnlockRow[],
): SecretTier[] {
  const stageUnlocked = new Set(tiersUnlockedByStage(stage));
  for (const row of explicitUnlocks) stageUnlocked.add(row.tier);
  return SECRET_TIER_ORDER.filter(t => stageUnlocked.has(t));
}

/**
 * Format the gating rule + deflection instruction for prompt injection.
 * Deliberately generic-but-in-character: the specific deflection *style*
 * (goes quiet / makes a joke / says something true but unrelated) should
 * already live in the character's own Speech Patterns seed memory, so this
 * section just invokes it rather than duplicating it.
 */
export function formatSecretTierForPrompt(availableTiers: SecretTier[]): string {
  const locked = SECRET_TIER_ORDER.filter(t => !availableTiers.includes(t));
  const lines = [
    '\n── Secret-Tier Gate ──',
    `- Secrets you may currently discuss or reveal if it fits the moment: ${availableTiers.length ? availableTiers.join(', ') : 'none yet'}.`,
  ];
  if (locked.length) {
    lines.push(
      `- Secrets that are still OFF LIMITS at this trust level: ${locked.join(', ')}.`,
      '- If the player pushes directly for one of these ("tell me your darkest secret"), deflect IN CHARACTER — using your own established voice and Use of Silence/Humor patterns above — rather than explaining that there is a gate. Go quiet, change the subject, make a joke, or say something true but unrelated. Never say "I can\'t tell you that yet" in a way that breaks character.',
      '- Never volunteer a locked-tier secret unprompted, even to be helpful or comforting.',
    );
  }
  return lines.join('\n');
}
