/**
 * GET /api/cron/wisdom-habit-maintenance — Wisdom + Habit Engine
 * Maintenance Cron
 *
 * GAP-FIX: belief-maintenance/route.ts's own header used to explain, quite
 * reasonably at the time, why wisdom-engine.ts's and habit-engine.ts's
 * maintenance sweeps were deliberately NOT bundled into that cron: both
 * stores were in-process Maps, so a serverless cron invocation almost
 * certainly ran in a different process than any chat request ever did —
 * their buckets would have been empty every time it fired. That's no
 * longer true: wisdom-engine.ts and habit-engine.ts are now backed by
 * wisdom-store.ts / habit-store.ts (Redis-cached Supabase, same pattern
 * belief-store.ts already used), so a real cron here is now meaningful
 * rather than performative. This route is that missing cron.
 *
 * Runs weekly, same cadence belief-maintenance/route.ts already
 * documented as correct for this family of decaying-durable-state sweeps.
 * Kept as its own route rather than folded into belief-maintenance/route.ts
 * itself — three unrelated tables, three unrelated decay curves, and a
 * partial failure in one shouldn't be conflated with the other two in a
 * single heartbeat's pass/fail signal.
 *
 * BUG FIX: this used to pass a shared sinceTurn=0 to both cron entry
 * points, on the theory that 0 was "the correct conservative default."
 * It wasn't — since real turn counters are never negative, `lastAppliedTurn
 * >= 0` (equivalently lastFiredTurn >= 0) is true for every row, every
 * week, so the sweep silently decayed nothing, ever, while still logging
 * a clean success report. distinctPairs() now fetches each pair's actual
 * current turn count (character_psychology.total_interactions) and
 * runWisdomMaintenanceCron()/runHabitMaintenanceCron() use that as each
 * pair's own sinceTurn, restoring the sweep to doing what its own
 * docstrings always claimed it did.
 *
 * Security: requires CRON_SECRET header, same as belief-maintenance.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth }           from '@/lib/security';
import { supabaseAdmin }             from '@/lib/supabase/admin';
import { runWisdomMaintenanceCron }  from '@/lib/cognition/wisdom-engine';
import { runHabitMaintenanceCron }   from '@/lib/cognition/habit-engine';
import { logger }                    from '@/lib/logger';
import { env }                       from '@/env';
import { heartbeatStart, heartbeatSuccess, heartbeatFail } from '@/lib/cron/heartbeat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Dedup pairs client-side, same rationale as belief-engine.ts's
// runBeliefMaintenanceCron(): Supabase's query builder doesn't have a
// clean DISTINCT-on-two-columns without a raw SQL view, and the row
// count for a "which pairs have wisdom/habits" scan is small enough
// (bounded by relationship count, not principle/habit count) that this
// is cheap.
//
// BUG FIX: this used to return just {userId, characterId} and the caller
// passed a shared sinceTurn=0 for every pair. Since real turn counters
// (character_psychology.total_interactions) are never negative, the
// maintenance sweeps' own `if (lastAppliedTurn >= sinceTurn) continue`
// guard was true for every row, every week — the sweep ran successfully
// and logged a clean report, but never actually decayed or dropped a
// single principle or habit. Verified by direct trace: 0 >= 0 is true,
// so even a habit fired on turn 0 was treated as "still current."
//
// Fixed by fetching each pair's actual current turn count and using it
// as that pair's own sinceTurn — "hasn't been reapplied as of this
// week's actual turn count" is the correct, no-extra-tunable-needed
// reading of the sweep's own documented intent ("decays anything not
// reapplied since sinceTurn"). This makes the weekly sweep nudge down
// anything not reinforced in that exact scan (DECAY_PER_SWEEP is
// small — 0.04/0.05 — by design, so this is a gentle, self-correcting
// fade: anything still genuinely relevant keeps getting reinforced by
// real usage and climbs back up faster than the weekly nudge erodes it).
async function distinctPairs(table: 'user_wisdom' | 'user_habits'): Promise<Array<{ userId: string; characterId: string; currentTurn: number }>> {
  const { data, error } = await supabaseAdmin.from(table).select('user_id,character_id');

  if (error || !data) {
    logger.error(`cron:wisdom-habit-maintenance:${table}:fetch-failed`, { error: error?.message });
    return [];
  }

  const pairs = new Map<string, { userId: string; characterId: string }>();
  for (const row of data as Array<{ user_id: string; character_id: string }>) {
    const key = `${row.user_id}:${row.character_id}`;
    if (!pairs.has(key)) pairs.set(key, { userId: row.user_id, characterId: row.character_id });
  }
  const uniquePairs = [...pairs.values()];
  if (uniquePairs.length === 0) return [];

  // Batched turn-count lookup — one query for every pair found above,
  // rather than an N+1 per-pair round trip.
  const { data: psychRows, error: psychError } = await supabaseAdmin
    .from('character_psychology')
    .select('user_id,character_id,total_interactions')
    .in('user_id', uniquePairs.map(p => p.userId))
    .in('character_id', uniquePairs.map(p => p.characterId));

  if (psychError) {
    logger.error(`cron:wisdom-habit-maintenance:${table}:psychology-fetch-failed`, { error: psychError.message });
  }

  const turnByPair = new Map<string, number>();
  for (const row of psychRows ?? []) {
    turnByPair.set(`${row.user_id}:${row.character_id}`, row.total_interactions);
  }

  // A pair with no character_psychology row (shouldn't happen for a pair
  // that already has wisdom/habits, but defensive) falls back to 0 —
  // same as the sweep's old default, but now scoped to just that one
  // pair instead of silently applying to everyone.
  return uniquePairs.map(p => ({
    ...p,
    currentTurn: turnByPair.get(`${p.userId}:${p.characterId}`) ?? 0,
  }));
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await heartbeatStart('WISDOM_HABIT_MAINTENANCE');

  try {
    const [wisdomPairs, habitPairs] = await Promise.all([
      distinctPairs('user_wisdom'),
      distinctPairs('user_habits'),
    ]);

    const [wisdomResult, habitResult] = await Promise.all([
      runWisdomMaintenanceCron(wisdomPairs),
      runHabitMaintenanceCron(habitPairs),
    ]);

    const result = { wisdom: wisdomResult, habit: habitResult };
    logger.info('cron:wisdom-habit-maintenance:complete', result);
    await heartbeatSuccess('WISDOM_HABIT_MAINTENANCE');
    return NextResponse.json({ ok: true, ...result, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('cron:wisdom-habit-maintenance:failed', { error: String(err) });
    await heartbeatFail('WISDOM_HABIT_MAINTENANCE');
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
