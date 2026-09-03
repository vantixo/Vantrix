/**
 * Wisdom Store — Vantrix Cognition Layer
 *
 * Persistence only, for the exact same reason belief-store.ts exists:
 * mirrors its storage pattern (Redis 1-hour cache in front of a Supabase
 * table with RLS locked to service-role) so this doesn't introduce a
 * second infrastructure convention into the codebase. No synthesis math,
 * no decay math lives here — see wisdom-engine.ts. This file's only job
 * is: given a WisdomPrinciple, persist it; given a (userId, characterId),
 * load them back reliably and cheaply.
 *
 * GAP-FIX: wisdom-engine.ts previously kept its store as an in-process
 * `Map<string, Map<string, WisdomPrinciple>>`. That file's own header
 * documented the tradeoff honestly ("if this needs to survive process
 * restarts in production, promoting it to a belief-store.ts-style
 * Supabase-backed module is the natural next step") — this module is
 * that promotion. A serverless chat request and a serverless cron
 * invocation are not guaranteed to share a process, so the Map was empty
 * far more often than not once actually deployed; nothing durable ever
 * accumulated.
 *
 * Table: user_wisdom (migration
 * supabase/migrations/20260915_wisdom_habit_engines.sql). Rows are kept
 * until a maintenance sweep actively retires them (confidence crosses
 * RETIREMENT_THRESHOLD) — deleted at that point, not soft-marked, since
 * unlike belief_engine.ts's superseded/decayed rows there's no
 * conflict-audit reason to keep a retired principle around.
 */

import { supabaseAdmin }        from '@/lib/supabase/admin';
import { logger, bg }           from '@/lib/logger';
import { redis }                from '@/lib/redis';
import type { WisdomPrinciple } from '@/lib/cognition/wisdom-engine';

const WISDOM_CACHE_TTL = 60 * 60; // 1 hour, matches belief-store.ts

// ── Redis key ───────────────────────────────────────────────────────────

function wisdomKey(userId: string, characterId: string): string {
  return `vantrix:wisdom:${userId}:${characterId}`;
}

// ── Row <-> WisdomPrinciple mapping ────────────────────────────────────
// user_wisdom is now typed in src/types/supabase.ts (hand-added ahead of
// the next db:types regen); mapped here anyway so the rest of the
// subsystem works against the clean `WisdomPrinciple` shape rather than
// snake_case rows everywhere.

interface WisdomRow {
  id: string;
  user_id: string;
  character_id: string;
  domain: string;
  principle: string;
  confidence: number;
  times_applied: number;
  last_applied_turn: number;
  derived_from_lesson_ids: string[];
}

function fromRow(row: WisdomRow): WisdomPrinciple {
  return {
    id: row.id,
    principle: row.principle,
    domain: row.domain as WisdomPrinciple['domain'],
    confidence: row.confidence,
    timesApplied: row.times_applied,
    lastAppliedTurn: row.last_applied_turn,
    derivedFromLessonIds: row.derived_from_lesson_ids,
  };
}

function toRow(
  userId: string,
  characterId: string,
  principle: WisdomPrinciple,
): Omit<WisdomRow, 'id'> & { id?: string } {
  return {
    ...(isRealId(principle.id) ? { id: principle.id } : {}),
    user_id: userId,
    character_id: characterId,
    domain: principle.domain,
    principle: principle.principle,
    confidence: principle.confidence,
    times_applied: principle.timesApplied,
    last_applied_turn: principle.lastAppliedTurn,
    derived_from_lesson_ids: principle.derivedFromLessonIds,
  };
}

// wisdom-engine.ts's synthesizeWisdom() constructs a client-side id
// (`wisdom-${userId}-${characterId}-${wisdomKey}`) for a principle that
// hasn't been persisted yet, same shape belief-engine.ts avoids by only
// ever constructing Belief objects without an id until insertBelief
// returns one. Rather than change that call site's ergonomics, treat any
// non-uuid id as "not yet a real row" here at the store boundary.
function isRealId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// ── Reads ───────────────────────────────────────────────────────────────

export async function getAllWisdom(userId: string, characterId: string): Promise<WisdomPrinciple[]> {
  try {
    const cached = await redis.get<WisdomPrinciple[]>(wisdomKey(userId, characterId));
    if (cached) return cached;
  } catch (err) {
    logger.warn('[wisdom-store] Redis cache get failed', { userId, characterId, error: String(err) });
  }

  const { data, error } = await supabaseAdmin
    .from('user_wisdom')
    .select('*')
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .order('confidence', { ascending: false });

  if (error) {
    logger.warn('[wisdom-store] fetch failed', { userId, characterId, error: error.message });
    return [];
  }

  const principles = (data ?? []).map(fromRow);

  redis.set(wisdomKey(userId, characterId), principles, { ex: WISDOM_CACHE_TTL })
    .catch(bg('wisdomStore.cacheWrite'));

  return principles;
}

// ── Writes ──────────────────────────────────────────────────────────────

/**
 * Upsert one principle by its (user, character, domain, principle) dedup
 * key (see the migration's idx_user_wisdom_dedup) — this is what lets
 * synthesizeWisdom() call this once per touched principle per session
 * without first checking insert-vs-update itself, matching the ergonomics
 * its old bucket.get()/bucket.set() call site already had.
 */
export async function upsertWisdom(
  userId: string,
  characterId: string,
  principle: WisdomPrinciple,
): Promise<WisdomPrinciple | null> {
  const { data, error } = await supabaseAdmin
    .from('user_wisdom')
    .upsert(
      { ...toRow(userId, characterId, principle), updated_at: new Date().toISOString() },
      { onConflict: 'user_id,character_id,domain,principle' },
    )
    .select('*')
    .single();

  if (error || !data) {
    logger.warn('[wisdom-store] upsert failed', { userId, characterId, domain: principle.domain, error: error?.message });
    return null;
  }

  await invalidate(userId, characterId);
  return fromRow(data);
}

/** Bulk-persist a maintenance pass's confidence updates in one round trip,
 *  same fail-open-per-row posture as belief-store.ts's updateBeliefsBulk. */
export async function updateWisdomBulk(userId: string, characterId: string, principles: WisdomPrinciple[]): Promise<void> {
  if (principles.length === 0) return;

  const results = await Promise.allSettled(
    principles.map(p =>
      supabaseAdmin
        .from('user_wisdom')
        .update({ confidence: p.confidence, last_applied_turn: p.lastAppliedTurn, updated_at: new Date().toISOString() })
        .eq('id', p.id),
    ),
  );

  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed > 0) {
    logger.warn('[wisdom-store] bulk update had failures', { failed, total: principles.length });
  }

  await invalidate(userId, characterId);
}

/** Hard-delete retired principles (confidence crossed RETIREMENT_THRESHOLD
 *  during a maintenance sweep) — unlike belief_engine.ts there's no
 *  conflict-audit trail that needs a retired principle to stick around. */
export async function deleteWisdom(userId: string, characterId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const { error } = await supabaseAdmin.from('user_wisdom').delete().in('id', ids);
  if (error) {
    logger.warn('[wisdom-store] delete failed', { userId, characterId, count: ids.length, error: error.message });
  }

  await invalidate(userId, characterId);
}

export async function invalidate(userId: string, characterId: string): Promise<void> {
  try {
    await redis.del(wisdomKey(userId, characterId));
  } catch (err) {
    logger.warn('[wisdom-store] cache invalidate failed', { userId, characterId, error: String(err) });
  }
}
