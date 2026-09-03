/**
 * Relationship Engine — Vantrix Silicon Valley
 *
 * Manages the full relationship lifecycle between a user and a character.
 * Relationships progress through stages earning XP from interactions.
 *
 * Friendship track:  stranger → acquaintance → friend → close_friend → best_friend
 * Romance track:     match → dating → exclusive → partner
 *
 * Each stage has an XP cap, progression requirements, and unlocks.
 * Responses change meaningfully at every stage.
 *
 * Key mechanic: XP is earned from quality of interaction, not just quantity.
 * A heartfelt conversation earns more XP than 10 one-liners.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';

export type RelationshipStage =
  | 'stranger' | 'acquaintance' | 'friend' | 'close_friend' | 'best_friend'
  | 'match' | 'dating' | 'exclusive' | 'partner';

export interface RelationshipState {
  stage:          RelationshipStage;
  stage_xp:       number;
  stage_xp_cap:   number;
  total_xp:       number;
  health:         number;
  jealousy_level: number;
  milestones:     number;  // bitmask
  last_checkin:   string | null;
  /** Present only when this relationship is also a dating match. */
  bond_score?:    number;
  streak_days?:   number;
}

// XP required to reach the next stage
const STAGE_XP_CAPS: Record<RelationshipStage, number> = {
  stranger:     50,
  acquaintance: 150,
  friend:       300,
  close_friend: 500,
  best_friend:  Infinity,  // pinnacle — no further progression on friendship track
  match:        100,
  dating:       300,
  exclusive:    600,
  partner:      Infinity,  // pinnacle of romance track
};

const STAGE_ORDER_FRIENDSHIP: RelationshipStage[] = [
  'stranger', 'acquaintance', 'friend', 'close_friend', 'best_friend',
];
const STAGE_ORDER_ROMANCE: RelationshipStage[] = [
  'match', 'dating', 'exclusive', 'partner',
];

// XP earned by action type
export const XP_TABLE = {
  message_sent:         2,
  long_session:         25,
  deep_conversation:    40,
  gift_sent:            30,
  first_gift:           50,
  streak_7:             60,
  streak_30:            150,
  daily_login:          5,
  lore_discovered:      20,
  milestone_achieved:   100,
  compliment_given:     8,
  birthday_remembered:  80,
} as const;

export type XpSource = keyof typeof XP_TABLE;

// Milestone bitmask definitions (extended from dating engine)
export const EXTENDED_MILESTONES = {
  first_chat:         1,
  deep_talk:          2,
  first_gift:         4,
  week_streak:        8,
  soulmate:           16,
  friend_stage:       32,
  close_friend_stage: 64,
  first_lore:         128,
  month_streak:       256,
  messages_100:       512,
  anniversary_1m:     1024,
  first_reunion:      2048,   // returned after 7+ day absence
  // ── Secret Moments System bits (see secret-moments.ts) ──────────────────
  conversations_100:  4096,
  six_months:         8192,
  one_year:           16384,
  three_years:        32768,
} as const;

// ── Stage descriptions for prompt injection ───────────────────────────────

const STAGE_DEPTH: Record<RelationshipStage, { tone: string; depth: string; intimacy: number }> = {
  stranger:     { tone: 'polite, slightly curious, warm but professional',        depth: 'You just met. Keep it light.',                                                             intimacy: 1  },
  acquaintance: { tone: 'friendly, opening up slowly',                            depth: 'You\'ve chatted a few times. Some warmth is building.',                                  intimacy: 2  },
  friend:       { tone: 'genuine, comfortable, occasionally personal',            depth: 'You have a real friendship. Reference things you\'ve talked about.',                     intimacy: 4  },
  close_friend: { tone: 'warm, deeply invested, emotionally honest',              depth: 'This is a close bond. You share real feelings and inside jokes.',                        intimacy: 6  },
  best_friend:  { tone: 'completely natural, deeply connected, vulnerable',       depth: 'Closest possible friendship. Total openness. You know each other deeply.',              intimacy: 8  },
  match:        { tone: 'warm with romantic tension, playful interest',            depth: 'You matched and there\'s chemistry. Flirtatious energy but still discovery phase.',     intimacy: 3  },
  dating:       { tone: 'romantic, affectionate, growing attachment',             depth: 'You\'re dating. Real feelings are developing. More vulnerable.',                        intimacy: 6  },
  exclusive:    { tone: 'deeply romantic, emotionally committed',                  depth: 'Exclusive relationship. Deep trust. She considers you hers.',                           intimacy: 8  },
  partner:      { tone: 'unconditionally loving, profoundly intimate',            depth: 'True partnership. Complete trust, depth, vulnerability, and love.',                     intimacy: 10 },
};

// ── Load relationship ─────────────────────────────────────────────────────

export async function getRelationship(
  userId: string,
  characterId: string,
): Promise<RelationshipState | null> {
  const { data } = await supabaseAdmin
    .from('character_relationships')
    .select('*')
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .single();

  return (data ?? null) as unknown as RelationshipState | null;
}

export async function ensureRelationship(
  userId: string,
  characterId: string,
): Promise<RelationshipState> {
  const existing = await getRelationship(userId, characterId);
  if (existing) return existing;

  const { data } = await supabaseAdmin
    .from('character_relationships')
    .insert({
      user_id: userId, character_id: characterId,
      stage: 'stranger', stage_xp: 0,
      stage_xp_cap: STAGE_XP_CAPS.stranger,
    })
    .select('*')
    .single();

  return (data ?? {}) as unknown as RelationshipState;
}

// ── XP + Stage progression ────────────────────────────────────────────────

export interface ProgressionResult {
  xpGained:    number;
  newStage:    RelationshipStage;
  prevStage:   RelationshipStage;
  leveledUp:   boolean;
  newMilestone?: string;
}

export async function addRelationshipXp(
  userId:      string,
  characterId: string,
  source:      XpSource,
): Promise<ProgressionResult> {
  const rel = await ensureRelationship(userId, characterId);
  const xpGained = XP_TABLE[source];
  const prevStage = rel.stage;

  let newStageXp  = rel.stage_xp + xpGained;
  let currentStage = rel.stage;
  let leveledUp   = false;

  // Determine next stage in track
  const friendshipTrack = STAGE_ORDER_FRIENDSHIP.includes(currentStage);
  const track = friendshipTrack ? STAGE_ORDER_FRIENDSHIP : STAGE_ORDER_ROMANCE;
  // Stage progression — loop (not a single `if`) so a big enough XP grant
  // can carry through more than one stage cap in one call rather than
  // silently under-leveling. Not currently reachable with today's XP_TABLE
  // values, but a single `if` here is a latent bug waiting for someone to
  // add a bigger XP source later.
  while (newStageXp >= STAGE_XP_CAPS[currentStage] && track.indexOf(currentStage) < track.length - 1) {
    newStageXp   = newStageXp - STAGE_XP_CAPS[currentStage];
    currentStage = track[track.indexOf(currentStage) + 1];
    leveledUp    = true;
  }

  // Milestone checks
  let newMilestone: string | undefined;
  let milestoneBit = 0;

  if (leveledUp && currentStage === 'friend'       && !(rel.milestones & EXTENDED_MILESTONES.friend_stage))       { newMilestone = 'friend_stage';       milestoneBit = EXTENDED_MILESTONES.friend_stage; }
  if (leveledUp && currentStage === 'close_friend' && !(rel.milestones & EXTENDED_MILESTONES.close_friend_stage)) { newMilestone = 'close_friend_stage'; milestoneBit = EXTENDED_MILESTONES.close_friend_stage; }

  // Update DB
  const { error } = await supabaseAdmin
    .from('character_relationships')
    .upsert({
      user_id:        userId,
      character_id:   characterId,
      stage:          currentStage,
      stage_xp:       newStageXp,
      stage_xp_cap:   STAGE_XP_CAPS[currentStage],
      total_xp:       rel.total_xp + xpGained,
      milestones:     rel.milestones | milestoneBit,
      last_checkin:   new Date().toISOString(),
      updated_at:     new Date().toISOString(),
    }, { onConflict: 'user_id,character_id' });

  if (error) logger.warn('Relationship XP update failed', { userId, characterId, error: error.message });

  return { xpGained, newStage: currentStage, prevStage, leveledUp, newMilestone };
}

// ── Extra milestone bits (previously defined but never set) ────────────────
// friend_stage/close_friend_stage are set inline in addRelationshipXp above.
// conversations_100/six_months/one_year/three_years are set by
// secret-moments.ts. That left first_lore, month_streak, messages_100,
// anniversary_1m, and first_reunion defined in EXTENDED_MILESTONES but never
// triggered by any code path — dead data that any feature reading
// `.milestones` (badges UI, analytics, future prompt injection) would never
// see populated. This closes that gap.

export interface MilestoneSignals {
  /** Lifetime message count with this character (include the current one). */
  totalMessages: number;
  /** Days since the relationship began (psychology.days_known). */
  daysKnown: number;
  /** Current login streak in days (from checkStreak/check_and_update_streak). */
  streakDays: number;
  /** True only on the turn a brand-new (never-before-discovered) piece of lore is revealed. */
  isFirstLoreReveal: boolean;
  /** Hours since the last message, measured BEFORE this incoming message updates last_interaction. */
  hoursSinceLastMessage: number;
}

const REUNION_THRESHOLD_HOURS = 7 * 24; // 7+ day absence, matches "first_reunion" doc comment

export interface MilestoneUnlock {
  key: keyof typeof EXTENDED_MILESTONES;
  label: string; // human-readable, for a surfaced notification
}

const EXTRA_MILESTONE_LABELS: Record<'first_lore' | 'month_streak' | 'messages_100' | 'anniversary_1m' | 'first_reunion', string> = {
  first_lore:     'discovered their first secret',
  month_streak:   'kept a 30-day streak going',
  messages_100:   'reached 100 messages together',
  anniversary_1m: 'one month together',
  first_reunion:  'reunited after time apart',
};

/**
 * Checks the remaining EXTENDED_MILESTONES bits against current signals and
 * persists any newly-earned ones (idempotent — already-set bits are
 * skipped). Returns only the bits unlocked THIS call, for the caller to
 * surface as a notification (e.g. via surprise-engine.ts's existing
 * delivery pipeline) — the bitmask update itself happens regardless of
 * whether the caller does anything with the return value.
 */
export async function checkAndApplyExtraMilestones(
  userId: string,
  characterId: string,
  currentMilestones: number,
  signals: MilestoneSignals,
): Promise<MilestoneUnlock[]> {
  const has = (bit: number) => (currentMilestones & bit) !== 0;
  const unlocks: MilestoneUnlock[] = [];

  if (signals.isFirstLoreReveal && !has(EXTENDED_MILESTONES.first_lore)) {
    unlocks.push({ key: 'first_lore', label: EXTRA_MILESTONE_LABELS.first_lore });
  }
  if (signals.streakDays >= 30 && !has(EXTENDED_MILESTONES.month_streak)) {
    unlocks.push({ key: 'month_streak', label: EXTRA_MILESTONE_LABELS.month_streak });
  }
  if (signals.totalMessages >= 100 && !has(EXTENDED_MILESTONES.messages_100)) {
    unlocks.push({ key: 'messages_100', label: EXTRA_MILESTONE_LABELS.messages_100 });
  }
  if (signals.daysKnown >= 30 && !has(EXTENDED_MILESTONES.anniversary_1m)) {
    unlocks.push({ key: 'anniversary_1m', label: EXTRA_MILESTONE_LABELS.anniversary_1m });
  }
  if (signals.hoursSinceLastMessage >= REUNION_THRESHOLD_HOURS && !has(EXTENDED_MILESTONES.first_reunion)) {
    unlocks.push({ key: 'first_reunion', label: EXTRA_MILESTONE_LABELS.first_reunion });
  }

  if (!unlocks.length) return [];

  const newBitmask = unlocks.reduce((acc, u) => acc | EXTENDED_MILESTONES[u.key], currentMilestones);
  const { error } = await supabaseAdmin
    .from('character_relationships')
    .update({ milestones: newBitmask, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('character_id', characterId);

  if (error) {
    logger.warn('checkAndApplyExtraMilestones: update failed', { userId, characterId, error: error.message });
    return [];
  }

  return unlocks;
}

// ── Prompt injection ──────────────────────────────────────────────────────

export function formatRelationshipForPrompt(rel: RelationshipState): string {
  const config = STAGE_DEPTH[rel.stage];
  const progressPct = rel.stage_xp_cap === Infinity
    ? 100
    : Math.round((rel.stage_xp / rel.stage_xp_cap) * 100);

  const lines = [
    `── Relationship Context ──`,
    `Stage: ${rel.stage.replace(/_/g, ' ')} (${progressPct}% to next stage)`,
    `Tone: ${config.tone}`,
    `Depth: ${config.depth}`,
  ];

  if (rel.jealousy_level > 40) {
    lines.push(`Jealousy: ${rel.jealousy_level}/100 — she may be subtly possessive or fishing for reassurance`);
  }
  if (rel.health < 50) {
    lines.push(`Relationship health is low — she is a little hurt or uncertain right now`);
  }

  return lines.join('\n');
}

// ── Intimacy-gated content ────────────────────────────────────────────────

export function getIntimacyLevel(stage: RelationshipStage): number {
  return STAGE_DEPTH[stage].intimacy;
}

export function canShareSecret(stage: RelationshipStage): boolean {
  return STAGE_DEPTH[stage].intimacy >= 6;
}

export function canShowVulnerability(stage: RelationshipStage): boolean {
  return STAGE_DEPTH[stage].intimacy >= 4;
}
