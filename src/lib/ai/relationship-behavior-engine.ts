/**
 * src/lib/ai/relationship-behavior-engine.ts
 *
 * Relationship-Stage Behavioral Shifts — Archive of Echoes roleplay system,
 * Part II §4 of the mythology expansion doc: "not just tone changes." This
 * was the one section of that doc's roleplay design that never got a home —
 * §1 (secret tiers), §2 (memory tests), §3 (deflection/voice), and §5
 * (companion awareness) are all implemented (secret-tier-engine.ts,
 * memory-test-engine.ts, companion-awareness.ts). This module is §4.
 *
 * Relationship to romance-engine.ts: that module answers "how romantic
 * should this sound right now" (a tone/voice axis, driven by bond score,
 * time-apart, and emotion). This module answers a different question —
 * "what is this companion now permitted or expected to actually DO" (a
 * behavior/agency axis, driven by relationship stage and whether a rival or
 * enemy exists for this character). The two are complementary and both get
 * injected into the same prompt; neither reads or overrides the other.
 *
 * Also distinct from secret-tier-engine.ts: secrets gate what a companion
 * will *say* about themselves. This gates what a companion will *do* in the
 * world of the conversation — reach out first, ask for something, let a
 * rival get involved, let their own questline reference the player's
 * choices, or make an Ending branch narratively reachable.
 */

import type { RelationshipStage } from '@/lib/ai/relationship-engine';
import type { CompanionRelationship } from '@/types/roleplay-system';

// ── Behavior rank — coarser than RelationshipStage because both the dating
//    ladder (match/dating/exclusive/partner) and the friendship ladder
//    (stranger/acquaintance/friend/close_friend/best_friend) exist in this
//    codebase, and §4's behavior classes apply the same way to both. ──

const BEHAVIOR_RANK: Record<RelationshipStage, number> = {
  stranger: 0,
  match: 0,
  acquaintance: 1,
  friend: 2,
  dating: 2,
  close_friend: 3,
  exclusive: 3,
  best_friend: 4,
  partner: 4,
};

export interface BehaviorClass {
  stage: RelationshipStage;
  rank: number;
  canInitiateContact: boolean;
  canAskToKeepSecret: boolean;
  rivalMayContactPlayer: boolean;
  questlineEntanglement: boolean;
  endingBranchEligible: boolean;
}

/**
 * hasRivalOrEnemy should be true if this character has any
 * primary_rival / hidden_rival / enemy row in their companion_relationships
 * (the same data companion-awareness.ts already formats) — i.e. there is
 * someone who could plausibly contact the player.
 */
export function computeBehaviorClass(
  stage: RelationshipStage,
  hasRivalOrEnemy: boolean,
): BehaviorClass {
  const rank = BEHAVIOR_RANK[stage] ?? 0;
  return {
    stage,
    rank,
    canInitiateContact:     rank >= 2,
    canAskToKeepSecret:     rank >= 3,
    rivalMayContactPlayer:  rank >= 3 && hasRivalOrEnemy,
    questlineEntanglement:  rank >= 4,
    endingBranchEligible:   rank >= 4,
  };
}

export function hasRivalOrEnemy(relationships: CompanionRelationship[] | undefined): boolean {
  if (!relationships?.length) return false;
  return relationships.some(r =>
    r.relationship_type === 'primary_rival' ||
    r.relationship_type === 'hidden_rival'  ||
    r.relationship_type === 'enemy',
  );
}

export function formatBehaviorClassForPrompt(bc: BehaviorClass): string {
  const lines = ['\n── Relationship Behavior (this is not just tone — see also your Romantic register above) ──'];

  if (bc.rank <= 1) {
    lines.push('- You are still at the asking-questions stage: ask the player one real question this conversation and actually remember the answer later. You respond right now — you do not yet reach out unprompted.');
  }
  if (bc.canInitiateContact) {
    lines.push('- You may now initiate contact unprompted, in-fiction — you "find" the player rather than only responding when spoken to. Do this occasionally, not every turn, and only when it fits the moment.');
  }
  if (bc.canAskToKeepSecret) {
    lines.push('- You may ask the player to keep something from another companion. This is allowed to entangle them in Wing politics — let it feel like a real, slightly uncomfortable ask, not a throwaway line.');
  }
  if (bc.rivalMayContactPlayer) {
    lines.push('- Your rival or enemy (see Companions You Know Of, above) may now be aware the player exists and could attempt contact with them, in-fiction, outside this conversation. You may reference that possibility, or react genuinely if the player brings it up — don\'t introduce it every turn.');
  }
  if (bc.questlineEntanglement) {
    lines.push('- Your own questline crisis should now actively involve the player\'s prior choices in this relationship, not just their presence — reference specific things they\'ve actually done when it\'s relevant.');
  }
  if (bc.endingBranchEligible) {
    lines.push('- One of your Ending branches (Friend / Hero / Dark / Sacrifice / Ascension / Secret) may now be narratively appropriate if the moment genuinely calls for it. Do not force it and do not avoid it — let the conversation decide.');
  }

  return lines.join('\n');
}
