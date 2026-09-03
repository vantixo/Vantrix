/**
 * Archive of Echoes — Roleplay & Dialogue System types.
 * See supabase/migrations/20260822_archive_of_echoes_roleplay_system.sql
 * and Part II of the mythology expansion doc for design rationale.
 */

export type SecretTier = 'known' | 'hidden' | 'dark' | 'catastrophic';

export const SECRET_TIER_ORDER: SecretTier[] = ['known', 'hidden', 'dark', 'catastrophic'];

/**
 * Maps the doc's narrative stage names onto the actual RelationshipStage
 * union already used across the codebase (relationship-engine.ts).
 *   Stranger            → stranger
 *   Acquaintance         → acquaintance      (Known Secret unlocks)
 *   Interesting Person /
 *   Trusted Companion    → friend            (Hidden Secret unlocks)
 *   Confidant / Close
 *   Friend                → close_friend     (Dark Secret unlocks)
 *   Soul Ally+ / Life
 *   Bond / Legendary       → best_friend      (Catastrophic — trust-gated, not just stage-gated)
 */
export const SECRET_TIER_STAGE_FLOOR: Record<SecretTier, string> = {
  known:        'acquaintance',
  hidden:       'friend',
  dark:         'close_friend',
  catastrophic: 'best_friend',
};

export interface SecretUnlockRow {
  id:           string;
  user_id:      string;
  character_id: string;
  tier:         SecretTier;
  trust_reason: string | null;
  unlocked_at:  string;
}

export type CompanionRelationshipType =
  | 'primary_rival'
  | 'hidden_rival'
  | 'enemy'
  | 'former_friend'
  | 'wing_sibling'
  | 'unresolved_thread';

export interface CompanionRelationship {
  id:                    string;
  character_id:          string;
  related_character_id:  string;
  related_character_name?: string; // joined in at query time
  relationship_type:     CompanionRelationshipType;
  reveal_tier:            SecretTier;
  note:                   string | null;
}

export type MemoryTestStatus = 'pending' | 'passed' | 'failed';

export interface MemoryTestRow {
  id:              string;
  user_id:         string;
  character_id:    string;
  seed_memory_id:  string;
  status:          MemoryTestStatus;
  scheduled_at:    string;
  tested_at:       string | null;
}
