/**
 * GET /api/user/usage
 *
 * Consolidated snapshot of the signed-in user's monetisation state:
 *   messages  — daily cap usage (Redis, read-only — no INCR side-effect)
 *   xp        — level + progress within level
 *   streak    — current streak + shield count
 *   quests    — today's quest completion state
 *   tier      — active subscription tier
 *   tokens    — credit token balance
 *
 * All reads are either Redis GET (no INCR) or Supabase select on
 * RLS-protected tables the user already owns.
 *
 * All five sub-requests run in parallel (Promise.allSettled) so a single
 * slow table never blocks the whole response. Each falls back gracefully.
 */

import { NextResponse }    from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { supabaseAdmin }   from '@/lib/supabase/admin';
import { redis }           from '@/lib/redis';
import { getTierLimits }   from '@/lib/tiers/limits';
import type { TierId }     from '@/lib/tiers/config';
// QUEST-MERGE-FIX: this route used to hand-roll a second, simpler read of
// the `daily_quests` table (see getDailyQuests below) — a parallel
// implementation to the real one in streak-rewards-engine.ts. Two problems
// that caused: (1) it never created today's row if missing, so a user's
// first request of the day got an empty quest list instead of the day's 3
// quests, and (2) its bonus-XP amount (widget hardcoded 100) didn't match
// the engine's actual bonus (200), so the UI promised the wrong reward.
// Now this route defers entirely to the real engine.
import { getDailyQuests }  from '@/lib/growth/streak-rewards-engine';

export const dynamic = 'force-dynamic';

// XP within the current level: threshold is level * 100 (from streak-rewards-engine.ts)
function xpProgress(level: number, xpToNext: number) {
  const threshold   = level * 100;
  const accumulated = Math.max(0, threshold - xpToNext);
  return { accumulated, threshold, pct: Math.round((accumulated / threshold) * 100) };
}

export async function GET() {
  // ── Auth ────────────────────────────────────────────────────────────────
  const { user } = await getAuthedUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = user.id;
  const today  = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC

  // ── Parallel fetch ───────────────────────────────────────────────────────
  // Redis key mirrors the pattern in checkDailyMessageCap — read-only GET.
  const redisKey = `vantrix:daily:${userId}:${today}`;

  const [
    profileRes,
    xpRes,
    streakRes,
    questsRes,
    rawCount,
  ] = await Promise.allSettled([
    supabaseAdmin
      .from('profiles')
      .select('tier, tokens')
      .eq('id', userId)
      .single(),

    supabaseAdmin
      .from('user_xp')
      .select('total_xp, level, xp_to_next')
      .eq('user_id', userId)
      .single(),

    supabaseAdmin
      .from('user_streaks')
      .select('current_streak, longest_streak, streak_shield')
      .eq('user_id', userId)
      .single(),

    // Delegates to the real quest engine (auto-creates today's row on
    // first read, computes completed_count/bonus_xp consistently with
    // progressQuest()) instead of hand-reading the table.
    getDailyQuests(userId),

    // Read-only: GET does not increment the counter
    redis.get<number>(redisKey),
  ]);

  // ── Shape results with safe fallbacks ───────────────────────────────────
  const profile      = profileRes.status  === 'fulfilled' ? profileRes.value.data   : null;
  const xpRow        = xpRes.status       === 'fulfilled' ? xpRes.value.data         : null;
  const streakRow    = streakRes.status   === 'fulfilled' ? streakRes.value.data     : null;
  const dailyQuests  = questsRes.status   === 'fulfilled' ? questsRes.value           : null;
  const dailyUsed    = rawCount.status    === 'fulfilled' ? (rawCount.value ?? 0)    : 0;

  const tier  = (profile?.tier ?? 'free') as TierId;
  const limit = getTierLimits(tier).dailyMessages;
  const used  = typeof dailyUsed === 'number' ? dailyUsed : 0;
  const remaining = Math.max(0, limit - used);
  const pct       = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));

  const level   = xpRow?.level     ?? 1;
  const xpToNext = xpRow?.xp_to_next ?? 100;
  const { accumulated: xpAccumulated, threshold: xpThreshold, pct: xpPct } =
    xpProgress(level, xpToNext);

  return NextResponse.json({
    tier,
    tokens:   profile?.tokens ?? 0,

    messages: {
      used,
      limit,
      remaining,
      pct,
      // Semantic urgency level consumed by the HUD to pick the right visual state
      urgency: pct >= 90 ? 'critical' : pct >= 70 ? 'warning' : pct >= 50 ? 'caution' : 'ok',
    },

    xp: {
      level,
      total:       xpRow?.total_xp ?? 0,
      accumulated: xpAccumulated,
      threshold:   xpThreshold,
      toNext:      xpToNext,
      pct:         xpPct,
    },

    streak: {
      days:    streakRow?.current_streak  ?? 0,
      longest: streakRow?.longest_streak  ?? 0,
      // WIRE-FIX: streak_shield is a boolean column (single banked
      // shield, on/off — not an accumulating inventory), but this field
      // is typed and consumed downstream as a number. Passing the raw
      // boolean through meant `shields` was actually `true`/`false`, and
      // a naive pluralization check (`shields !== 1 ? 's' : ''`) on the
      // consuming side would render "true shields" — `true !== 1` is a
      // type+value strict inequality, so it's always true regardless of
      // the actual boolean value.
      shields: streakRow?.streak_shield ? 1 : 0,
    },

    quests: {
      completed:    dailyQuests?.completed_count ?? 0,
      total:        3,
      bonusClaimed: dailyQuests?.bonus_claimed    ?? false,
      bonusXp:      dailyQuests?.bonus_xp         ?? 0,
      // Flatten engine's { quest, progress, completed } shape into the
      // flat QuestItem shape the widget renders.
      items: (dailyQuests?.quests ?? []).map(q => ({
        id:          q.quest.id,
        title:       q.quest.title,
        description: q.quest.description,
        xpReward:    q.quest.xpReward,
        target:      q.quest.target,
        type:        q.quest.type,
        progress:    q.progress,
        completed:   q.completed,
      })),
    },
  });
}
