/**
 * GET  /api/user/streak-shield  — returns shield status + streak info
 * POST /api/user/streak-shield  — activate shield to protect broken streak
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { supabaseAdmin }             from '@/lib/supabase/admin';
import { getShieldsForTier }         from '@/lib/growth/streak-rewards-engine';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [streakRow, profileRow] = await Promise.all([
    supabaseAdmin.from('user_streaks').select('current_streak,longest_streak,streak_shield,last_checkin').eq('user_id', user.id).single(),
    supabaseAdmin.from('profiles').select('tier').eq('id', user.id).single(),
  ]);

  const tier            = profileRow.data?.tier ?? 'free';
  const hasShield       = streakRow.data?.streak_shield ?? false;
  const currentStreak   = streakRow.data?.current_streak ?? 0;
  const longestStreak   = streakRow.data?.longest_streak ?? 0;
  const lastCheckin     = streakRow.data?.last_checkin;
  const shieldsMax      = getShieldsForTier(tier);

  // Check if streak is at risk (> 24h since last check-in but < 48h)
  const hoursSinceCheckin = lastCheckin
    ? (Date.now() - new Date(lastCheckin).getTime()) / 3_600_000
    : null;
  const streakAtRisk = hoursSinceCheckin !== null && hoursSinceCheckin > 22;

  return NextResponse.json({
    hasShield,
    shieldsMax,
    currentStreak,
    longestStreak,
    streakAtRisk,
    hoursSinceCheckin: hoursSinceCheckin ? Math.floor(hoursSinceCheckin) : null,
    tier,
  });
}

export async function POST(_req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Atomic, row-locked consume — a double-tap of this button (or a client
  // retry) can no longer race past a separate check-then-update and clear
  // the flag twice for one activation.
  const { data, error } = await supabaseAdmin.rpc('consume_streak_shield', { p_user_id: user.id });
  if (error) {
    return NextResponse.json({ error: 'Failed to activate shield', code: 'SHIELD_ERROR' }, { status: 500 });
  }

  const shieldRow = Array.isArray(data) ? data[0] : data;
  if (!shieldRow?.consumed) {
    return NextResponse.json({ error: 'No streak shield available', code: 'NO_SHIELD' }, { status: 400 });
  }

  return NextResponse.json({
    success:       true,
    streakProtected: shieldRow.restored_streak,
    message:       'Streak shield activated — your streak is safe.',
  });
}
