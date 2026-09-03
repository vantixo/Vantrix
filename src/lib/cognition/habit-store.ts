/**
 * Habit Store — Vantrix Cognition Layer
 *
 * Persistence only, same rationale as wisdom-store.ts / belief-store.ts:
 * mirrors belief-store.ts's Redis-cache-in-front-of-Supabase pattern
 * rather than inventing a third one. No reinforcement/decay math lives
 * here — see habit-engine.ts.
 *
 * GAP-FIX: habit-engine.ts previously kept its store as an in-process
 * `Map<string, Map<string, Habit>>` — same dead-in-serverless problem
 * documented in wisdom-store.ts's header, and habit-engine.ts's own
 * header names the same "next step" this module is.
 *
 * Table: user_habits (migration
 * supabase/migrations/20260915_wisdom_habit_engines.sql). Rows are kept
 * until a maintenance sweep drops them (strength bottoms out at
 * MIN_STRENGTH) — deleted at that point, same as the prior in-memory
 * bucket.delete() behavior.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger, bg }    from '@/lib/logger';
import { redis }         from '@/lib/redis';
import type { Habit }    from '@/lib/cognition/habit-engine';

const HABITS_CACHE_TTL = 60 * 60; // 1 hour, matches belief-store.ts

// ── Redis key ───────────────────────────────────────────────────────────

function habitsKey(userId: string, characterId: string): string {
  return `vantrix:habits:${userId}:${characterId}`;
}

// ── Row <-> Habit mapping ───────────────────────────────────────────────

interface HabitRow {
  id: string;
  user_id: string;
  character_id: string;
  cue: string;
  response: string;
  strength: number;
  times_fired: number;
  times_rewarded: number;
  last_fired_turn: number;
}

function fromRow(row: HabitRow): Habit {
  return {
    id: row.id,
    cue: row.cue as Habit['cue'],
    response: row.response,
    strength: row.strength,
    timesFired: row.times_fired,
    timesRewarded: row.times_rewarded,
    lastFiredTurn: row.last_fired_turn,
  };
}

function toRow(userId: string, characterId: string, habit: Habit): Omit<HabitRow, 'id'> & { id?: string } {
  return {
    ...(isRealId(habit.id) ? { id: habit.id } : {}),
    user_id: userId,
    character_id: characterId,
    cue: habit.cue,
    response: habit.response,
    strength: habit.strength,
    times_fired: habit.timesFired,
    times_rewarded: habit.timesRewarded,
    last_fired_turn: habit.lastFiredTurn,
  };
}

// Same rationale as wisdom-store.ts's isRealId: habit-engine.ts's
// recordHabitOutcome() constructs a client-side id
// (`habit-${userId}-${characterId}-${cue}:${response}`) for a habit that
// hasn't been persisted yet.
function isRealId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// ── Reads ───────────────────────────────────────────────────────────────

export async function getAllHabits(userId: string, characterId: string): Promise<Habit[]> {
  try {
    const cached = await redis.get<Habit[]>(habitsKey(userId, characterId));
    if (cached) return cached;
  } catch (err) {
    logger.warn('[habit-store] Redis cache get failed', { userId, characterId, error: String(err) });
  }

  const { data, error } = await supabaseAdmin
    .from('user_habits')
    .select('*')
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .order('strength', { ascending: false });

  if (error) {
    logger.warn('[habit-store] fetch failed', { userId, characterId, error: error.message });
    return [];
  }

  const habits = (data ?? []).map(fromRow);

  redis.set(habitsKey(userId, characterId), habits, { ex: HABITS_CACHE_TTL })
    .catch(bg('habitStore.cacheWrite'));

  return habits;
}

// ── Writes ──────────────────────────────────────────────────────────────

/** Upsert one habit by its (user, character, cue, response) dedup key
 *  (see the migration's idx_user_habits_dedup) — mirrors
 *  wisdom-store.ts's upsertWisdom() ergonomics. */
export async function upsertHabit(userId: string, characterId: string, habit: Habit): Promise<Habit | null> {
  const { data, error } = await supabaseAdmin
    .from('user_habits')
    .upsert(
      { ...toRow(userId, characterId, habit), updated_at: new Date().toISOString() },
      { onConflict: 'user_id,character_id,cue,response' },
    )
    .select('*')
    .single();

  if (error || !data) {
    logger.warn('[habit-store] upsert failed', { userId, characterId, cue: habit.cue, error: error?.message });
    return null;
  }

  await invalidate(userId, characterId);
  return fromRow(data);
}

/** Bulk-persist a maintenance pass's strength updates in one round trip. */
export async function updateHabitsBulk(userId: string, characterId: string, habits: Habit[]): Promise<void> {
  if (habits.length === 0) return;

  const results = await Promise.allSettled(
    habits.map(h =>
      supabaseAdmin
        .from('user_habits')
        .update({ strength: h.strength, last_fired_turn: h.lastFiredTurn, updated_at: new Date().toISOString() })
        .eq('id', h.id),
    ),
  );

  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed > 0) {
    logger.warn('[habit-store] bulk update had failures', { failed, total: habits.length });
  }

  await invalidate(userId, characterId);
}

/** Hard-delete habits a maintenance sweep dropped (strength bottomed out). */
export async function deleteHabits(userId: string, characterId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const { error } = await supabaseAdmin.from('user_habits').delete().in('id', ids);
  if (error) {
    logger.warn('[habit-store] delete failed', { userId, characterId, count: ids.length, error: error.message });
  }

  await invalidate(userId, characterId);
}

export async function invalidate(userId: string, characterId: string): Promise<void> {
  try {
    await redis.del(habitsKey(userId, characterId));
  } catch (err) {
    logger.warn('[habit-store] cache invalidate failed', { userId, characterId, error: String(err) });
  }
}
