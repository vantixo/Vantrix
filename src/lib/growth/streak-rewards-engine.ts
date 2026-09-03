/**
 * Streak & Rewards Engine — Vantrix Silicon Valley
 *
 * Implements the addiction loop that drives daily return:
 *
 *   Chat → Earn XP → Level Up → Unlock Content → Return Tomorrow
 *
 * Systems:
 *   STREAK ENGINE
 *     - Daily login + chat streaks with milestone rewards
 *     - Streak Shield: earned item that prevents a broken streak once
 *     - Bonus XP for streak milestones (3, 7, 14, 30, 60, 100 days)
 *
 *   DAILY QUESTS
 *     - 3 quests per day, refreshed at midnight UTC
 *     - Completing all 3 earns a bonus XP chest
 *     - Quests: "Send 10 messages", "Send a gift", "Chat with a new character", etc.
 *
 *   XP SYSTEM
 *     - XP earned from: chatting, gifts, streaks, quests, milestones
 *     - Level formula: Level N requires N*100 XP
 *     - Levels unlock: memory slots, gift tiers, scenes, photo packs
 *
 *   UNLOCKABLES
 *     - Level gates: new content unlocks at specific levels
 *     - Streak gates: streak milestones unlock exclusive content
 *     - Milestone gates: relationship milestones unlock scenes
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Json }     from '@/types/supabase';
import { logger }        from '@/lib/logger';

/** Typed shape for the daily_quests DB row. */
interface DailyQuestRow {
  quests:          Json;
  bonus_claimed:   boolean;
  [key: string]:   unknown;
}


// ── Quest definitions ──────────────────────────────────────────────────────

export interface QuestDefinition {
  id:          string;
  title:       string;
  description: string;
  xpReward:    number;
  target:      number;
  type:        'messages' | 'gift' | 'new_char' | 'streak' | 'memory' | 'long_session';
}

const ALL_QUESTS: QuestDefinition[] = [
  { id: 'q_chat10',     title: '10 Messages',      description: 'Send 10 messages today',              xpReward: 30,  target: 10, type: 'messages' },
  { id: 'q_chat25',     title: 'Deep Conversation', description: 'Send 25 messages in one session',    xpReward: 60,  target: 25, type: 'long_session' },
  { id: 'q_gift',       title: 'Thoughtful Gift',  description: 'Send a gift to someone special',     xpReward: 50,  target: 1,  type: 'gift' },
  { id: 'q_new_char',   title: 'New Connection',   description: 'Chat with a character you haven\'t chatted with before', xpReward: 40, target: 1, type: 'new_char' },
  { id: 'q_memory',     title: 'Memory Maker',     description: 'Create a shared memory through deep conversation', xpReward: 45, target: 1, type: 'memory' },
  { id: 'q_streak',     title: 'Consistent',       description: 'Maintain your daily streak',         xpReward: 25,  target: 1,  type: 'streak' },
  { id: 'q_chat5',      title: 'Morning Check-in', description: 'Send 5 messages today',              xpReward: 15,  target: 5,  type: 'messages' },
];

function getTodayQuests(): QuestDefinition[] {
  // Deterministic daily selection based on date seed — same for all users
  const seed = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const n    = parseInt(seed) % ALL_QUESTS.length;
  // Pick 3 quests, rotating daily
  return [
    ALL_QUESTS[n % ALL_QUESTS.length],
    ALL_QUESTS[(n + 2) % ALL_QUESTS.length],
    ALL_QUESTS[(n + 4) % ALL_QUESTS.length],
  ];
}

// ── Streak milestones ──────────────────────────────────────────────────────

const STREAK_REWARDS: Record<number, { xp: number; unlock?: string; message: string }> = {
  3:   { xp: 50,  message: '3-day streak! The bond is forming.' },
  7:   { xp: 150, unlock: 'scene_park', message: '7-day streak! Something unlocked...' },
  14:  { xp: 300, message: '2-week streak! You\'re truly dedicated.' },
  30:  { xp: 600, unlock: 'photo_pack_2', message: '30-day streak! A month of connection.' },
  60:  { xp: 1200, message: '60-day streak! Legendary.' },
  100: { xp: 2500, unlock: 'exclusive_companion', message: '100-day streak! Vantrix Legend.' },
};

// ── Level unlockables ─────────────────────────────────────────────────────

const LEVEL_UNLOCKS: Record<number, { key: string; type: string; label: string }> = {
  3:  { key: 'memory_slot_2',   type: 'memory_slot',     label: 'Memory Slot: Store more memories' },
  5:  { key: 'gift_tier_2',     type: 'gift_tier',       label: 'Gift Tier 2: Unlock premium gifts' },
  8:  { key: 'scene_beach',     type: 'scene',           label: 'Beach Scene: Romantic setting unlocked' },
  10: { key: 'photo_pack_1',    type: 'photo_pack',      label: 'Photo Pack: Special moments gallery' },
  15: { key: 'personality_deep',type: 'personality_pack', label: 'Deep Mode: Unlock deeper conversations' },
  20: { key: 'scene_nightcity', type: 'scene',           label: 'Night City Scene: Cinematic setting' },
  25: { key: 'gift_tier_3',     type: 'gift_tier',       label: 'Gift Tier 3: Rare gifts unlocked' },
  30: { key: 'memory_timeline', type: 'memory_slot',     label: 'Memory Timeline: Full relationship history' },
};

// ── Daily Quests ──────────────────────────────────────────────────────────

export interface QuestProgress {
  quest:     QuestDefinition;
  progress:  number;
  completed: boolean;
}

export interface DailyQuestState {
  quests:        QuestProgress[];
  bonus_claimed: boolean;
  completed_count: number;
  bonus_xp:      number;
}

export async function getDailyQuests(userId: string): Promise<DailyQuestState> {
  const today = new Date().toISOString().slice(0, 10);

  const todayQuests = getTodayQuests();
  const questsJson  = todayQuests.map(q => ({ ...q, progress: 0, completed: false }));

  // Atomic "create if missing, then read" — see
  // 20260720b_daily_unlock_hardening.sql for why this replaced a separate
  // select-then-insert (silently lost the day's quest list under
  // concurrent first-load races, e.g. two tabs open at once).
  const { data, error } = await supabaseAdmin.rpc('get_or_create_daily_quests', {
    p_user_id: userId,
    p_date: today,
    p_default_quests: questsJson as unknown as Json,
  });

  if (error) {
    logger.error('getDailyQuests: get_or_create_daily_quests failed', { userId, error });
    return { quests: [], bonus_claimed: false, completed_count: 0, bonus_xp: 0 };
  }

  const row = data as DailyQuestRow | null;
  const quests = ((row?.quests) ?? []) as unknown as Array<QuestDefinition & { progress: number; completed: boolean }>;
  const completed = quests.filter(q => q.completed).length;

  return {
    quests:          quests.map(q => ({ quest: q, progress: q.progress, completed: q.completed })),
    bonus_claimed:   row?.bonus_claimed ?? false,
    completed_count: completed,
    bonus_xp:        completed >= 3 ? 200 : 0,
  };
}

/** Increment progress on a quest type */
export async function progressQuest(
  userId:    string,
  questType: QuestDefinition['type'],
  amount:    number = 1,
): Promise<{ completed: boolean; questId?: string; xpEarned: number }> {
  const today = new Date().toISOString().slice(0, 10);

  // Ensure a row exists first (e.g. a chat message can progress a quest
  // before the client has ever called getDailyQuests today). The RPC
  // itself is what makes the read-modify-write atomic under concurrency —
  // see 20260720b_daily_unlock_hardening.sql. Rapid-fire chat messages
  // previously lost quest progress / XP to exactly this race.
  await getDailyQuests(userId);

  const { data, error } = await supabaseAdmin.rpc('progress_daily_quest', {
    p_user_id:    userId,
    p_date:       today,
    p_quest_type: questType,
    p_amount:     amount,
  });

  if (error) {
    logger.error('progressQuest: progress_daily_quest RPC failed', { userId, questType, error });
    return { completed: false, xpEarned: 0 };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const completedId: string | undefined = row?.completed_quest_id ?? undefined;
  const xpEarned: number = row?.xp_earned ?? 0;

  return { completed: !!completedId, questId: completedId, xpEarned };
}

// ── Streak check + reward ─────────────────────────────────────────────────

export interface StreakResult {
  streak:       number;
  broken:       boolean;
  newDay:       boolean;
  longest:      number;
  shieldUsed?:  boolean;
  milestone?:   { days: number; xp: number; unlock?: string; message: string };
  xpEarned:     number;
}

export interface StreakShieldState {
  hasShield:       boolean;
  shieldsRemaining: number;
  shieldsMax:      number;
}

/**
 * Get shield allocation per tier:
 *   free:    1 shield/month
 *   premium: 3 shields/month (+ 48h grace period on DB side)
 */
export function getShieldsForTier(tier: string): number {
  if (tier === 'premium') return 3;
  return 1; // free (and any unrecognized legacy value)
}

export async function checkStreak(userId: string, tier = 'free'): Promise<StreakResult> {
  const { data, error } = await supabaseAdmin.rpc('check_and_update_streak', { p_user_id: userId });
  if (error || !data) {
    throw new Error(`checkStreak: check_and_update_streak RPC failed for ${userId}: ${error?.message ?? 'no data returned'}`);
  }
  const result = Array.isArray(data) ? data[0] : data;
  if (!result) {
    throw new Error(`checkStreak: check_and_update_streak returned no row for ${userId}`);
  }

  // Streak shield activation — consume shield to protect a broken streak.
  // Atomic (row-locked) RPC: a double-tap or retried request can no longer
  // pass a check-then-update gap and burn two shields for one break.
  if (result.broken && result.streak === 0) {
    const { data: shieldResult, error: shieldErr } = await supabaseAdmin.rpc('consume_streak_shield', {
      p_user_id: userId,
    });

    if (shieldErr) {
      logger.error('checkStreak: consume_streak_shield RPC failed', { userId, error: shieldErr });
    } else {
      const shieldRow = Array.isArray(shieldResult) ? shieldResult[0] : shieldResult;
      if (shieldRow?.consumed) {
        const prevStreak = shieldRow.restored_streak || 1;
        logger.info('Streak shield consumed', { userId, prevStreak, tier });
        return {
          streak:    prevStreak,
          broken:    false,
          shieldUsed: true,
          newDay:    true,
          longest:   result.longest,
          xpEarned:  0,
        };
      }
    }
  }

  if (!result.new_day) {
    return { streak: result.streak, broken: false, newDay: false, longest: result.longest, xpEarned: 0 };
  }

  let xpEarned = 5; // base daily login XP
  let milestone: StreakResult['milestone'];

  // Check streak milestone
  const reward = STREAK_REWARDS[result.streak];
  if (reward) {
    xpEarned  += reward.xp;
    milestone  = { days: result.streak, ...reward };

    // Store unlock if applicable
    if (reward.unlock) {
      await void supabaseAdmin.from('user_unlockables').upsert(
        { user_id: userId, unlock_key: reward.unlock, unlock_type: 'scene', source: 'streak' },
        { onConflict: 'user_id,unlock_key', ignoreDuplicates: true }
      );
    }
  }

  // Daily streak XP
  if (xpEarned > 0) {
    await void supabaseAdmin.rpc('increment_xp', {
      p_user_id: userId,
      p_amount:  xpEarned,
      p_source:  milestone ? `streak_${result.streak}` : 'daily_login',
    });
  }

  return {
    streak:   result.streak,
    broken:   result.broken,
    newDay:   true,
    longest:  result.longest,
    milestone,
    xpEarned,
  };
}

// ── XP + level unlock ─────────────────────────────────────────────────────

export interface XpResult {
  totalXp:   number;
  level:     number;
  leveledUp: boolean;
  xpToNext:  number;
  unlocked?: { key: string; type: string; label: string };
}

export async function awardXp(
  userId: string,
  amount: number,
  source: string,
): Promise<XpResult> {
  const beforeLevel = (
    await supabaseAdmin.from('user_xp').select('level').eq('user_id', userId).maybeSingle()
  ).data?.level ?? 1;

  await supabaseAdmin.rpc('increment_xp', {
    p_user_id: userId,
    p_amount:  amount,
    p_source:  source,
  });

  // increment_xp genuinely RETURNS VOID (see supabase.ts's Functions type
  // and 20240101_production.sql) — there is no row to read back from the
  // RPC call itself. Fetch the resulting state directly and derive
  // leveled_up by comparing against beforeLevel, rather than trusting a
  // return value the function never provides.
  const { data: after } = await supabaseAdmin
    .from('user_xp')
    .select('total_xp,level,xp_to_next')
    .eq('user_id', userId)
    .single();

  const result = {
    total_xp:   after?.total_xp ?? 0,
    level:      after?.level ?? beforeLevel,
    leveled_up: (after?.level ?? beforeLevel) > beforeLevel,
    xp_to_next: after?.xp_to_next ?? 100,
  };
  let unlocked: XpResult['unlocked'];

  if (result.leveled_up) {
    const levelUnlock = LEVEL_UNLOCKS[result.level];
    if (levelUnlock) {
      await void supabaseAdmin.from('user_unlockables').upsert(
        { user_id: userId, unlock_key: levelUnlock.key, unlock_type: levelUnlock.type, source: 'xp_level' },
        { onConflict: 'user_id,unlock_key', ignoreDuplicates: true }
      );
      unlocked = levelUnlock;
    }
  }

  return {
    totalXp:   result.total_xp,
    level:     result.level,
    leveledUp: result.leveled_up,
    xpToNext:  result.xp_to_next,
    unlocked,
  };
}

// ── Load user XP state ────────────────────────────────────────────────────

export async function getUserXpState(userId: string): Promise<{
  total_xp: number; level: number; xp_to_next: number;
  current_streak: number; longest_streak: number;
}> {
  const [xpRow, streakRow] = await Promise.all([
    supabaseAdmin.from('user_xp').select('total_xp,level,xp_to_next').eq('user_id', userId).single(),
    supabaseAdmin.from('user_streaks').select('current_streak,longest_streak').eq('user_id', userId).single(),
  ]);

  return {
    total_xp:        xpRow.data?.total_xp ?? 0,
    level:           xpRow.data?.level ?? 1,
    xp_to_next:      xpRow.data?.xp_to_next ?? 100,
    current_streak:  streakRow.data?.current_streak ?? 0,
    longest_streak:  streakRow.data?.longest_streak ?? 0,
  };
}
