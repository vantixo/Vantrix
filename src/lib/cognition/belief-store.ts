/**
 * Belief Store — Vantrix Cognition Layer
 *
 * Persistence only. Mirrors src/lib/ai/user-fact-graph.ts's storage
 * pattern exactly (Redis 1-hour cache in front of a Supabase table with
 * RLS locked to service-role) so this doesn't introduce a second
 * infrastructure convention into the codebase. No conflict resolution,
 * no decay math, no reconciliation logic lives here — see
 * belief-update.ts / belief-conflict.ts / belief-decay.ts. This file's
 * only job is: given a Belief, persist it; given a (userId, characterId),
 * load them back reliably and cheaply.
 *
 * Table: user_beliefs (migration
 * supabase/migrations/20260830_belief_engine.sql). One row per belief,
 * including superseded/decayed ones — those are filtered out at read time
 * by getActiveBeliefs() in belief-engine.ts, not deleted, so the audit
 * trail (`supersedes`) stays intact and conflicts are inspectable later.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger, bg }    from '@/lib/logger';
import { redis }         from '@/lib/redis';
import type { Belief }   from '@/lib/cognition/belief-types';

const BELIEFS_CACHE_TTL = 60 * 60; // 1 hour, matches user-fact-graph.ts

// ── Redis key ───────────────────────────────────────────────────────────

function beliefsKey(userId: string, characterId: string): string {
  return `vantrix:beliefs:${userId}:${characterId}`;
}

// ── Row <-> Belief mapping ─────────────────────────────────────────────
// user_beliefs is fully typed in src/types/supabase.ts, field-for-field
// matching BeliefRow — mapped here anyway so the rest of the subsystem
// works against the clean `Belief` shape rather than snake_case rows
// everywhere.

interface BeliefRow {
  id: string;
  user_id: string;
  character_id: string;
  subject: string;
  category: string;
  statement: string;
  polarity: string;
  confidence: number;
  evidence_count: number;
  source: string;
  status: string;
  supersedes: string | null;
  created_at: string;
  last_reinforced_at: string;
  last_used_at: string | null;
}

function fromRow(row: BeliefRow): Belief {
  return {
    id: row.id,
    userId: row.user_id,
    characterId: row.character_id,
    subject: row.subject,
    category: row.category as Belief['category'],
    statement: row.statement,
    polarity: row.polarity as Belief['polarity'],
    confidence: row.confidence,
    evidenceCount: row.evidence_count,
    source: row.source as Belief['source'],
    status: row.status as Belief['status'],
    supersedes: row.supersedes,
    createdAt: row.created_at,
    lastReinforcedAt: row.last_reinforced_at,
    lastUsedAt: row.last_used_at,
  };
}

function toRow(belief: Belief): Omit<BeliefRow, 'id'> & { id?: string } {
  return {
    ...(belief.id ? { id: belief.id } : {}),
    user_id: belief.userId,
    character_id: belief.characterId,
    subject: belief.subject,
    category: belief.category,
    statement: belief.statement,
    polarity: belief.polarity,
    confidence: belief.confidence,
    evidence_count: belief.evidenceCount,
    source: belief.source,
    status: belief.status,
    supersedes: belief.supersedes,
    created_at: belief.createdAt,
    last_reinforced_at: belief.lastReinforcedAt,
    last_used_at: belief.lastUsedAt,
  };
}

// ── Reads ───────────────────────────────────────────────────────────────

/**
 * All beliefs for this (user, character) pair, any status. Callers that
 * only want live ones should filter (belief-engine.ts's
 * getActiveBeliefs() does this) — kept unfiltered here so belief-conflict
 * and belief-decay can still see superseded history when they need it.
 */
export async function getAllBeliefs(userId: string, characterId: string): Promise<Belief[]> {
  try {
    const cached = await redis.get<Belief[]>(beliefsKey(userId, characterId));
    if (cached) return cached;
  } catch (err) {
    logger.warn('[belief-store] Redis cache get failed', { userId, characterId, error: String(err) });
  }

  const { data, error } = await supabaseAdmin
    .from('user_beliefs')
    .select('*')
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .order('confidence', { ascending: false });

  if (error) {
    logger.warn('[belief-store] fetch failed', { userId, characterId, error: error.message });
    return [];
  }

  const beliefs = (data ?? []).map(fromRow);

  redis.set(beliefsKey(userId, characterId), beliefs, { ex: BELIEFS_CACHE_TTL })
    .catch(bg('beliefStore.cacheWrite'));

  return beliefs;
}

// ── Writes ──────────────────────────────────────────────────────────────

/**
 * Insert a brand-new belief row (no existing id). Returns the persisted
 * belief with its generated id, or null on failure — callers should treat
 * a null as "evidence dropped this turn," not throw, matching the rest of
 * this codebase's fire-and-forget posture around secondary-signal writes.
 */
export async function insertBelief(belief: Omit<Belief, 'id'>): Promise<Belief | null> {
  const { data, error } = await supabaseAdmin
    .from('user_beliefs')
    .insert(toRow(belief as Belief))
    .select('*')
    .single();

  if (error || !data) {
    logger.warn('[belief-store] insert failed', { userId: belief.userId, subject: belief.subject, error: error?.message });
    return null;
  }

  await invalidate(belief.userId, belief.characterId);
  return fromRow(data);
}

/**
 * Update an existing belief in place (reinforcement, status change,
 * confidence decay). Requires an id — use insertBelief for new rows.
 */
export async function updateBelief(belief: Belief): Promise<Belief | null> {
  const { data, error } = await supabaseAdmin
    .from('user_beliefs')
    .update(toRow(belief))
    .eq('id', belief.id)
    .select('*')
    .single();

  if (error || !data) {
    logger.warn('[belief-store] update failed', { id: belief.id, error: error?.message });
    return null;
  }

  await invalidate(belief.userId, belief.characterId);
  return fromRow(data);
}

/**
 * Bulk-persist a decay pass's output in one round trip. Best-effort —
 * logs and continues past individual row failures rather than aborting
 * the whole maintenance sweep over one bad row.
 */
export async function updateBeliefsBulk(beliefs: Belief[]): Promise<void> {
  if (beliefs.length === 0) return;

  const results = await Promise.allSettled(
    beliefs.map(b =>
      supabaseAdmin.from('user_beliefs').update(toRow(b)).eq('id', b.id),
    ),
  );

  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed > 0) {
    logger.warn('[belief-store] bulk update had failures', { failed, total: beliefs.length });
  }

  const byScope = new Map<string, { userId: string; characterId: string }>();
  for (const b of beliefs) byScope.set(`${b.userId}::${b.characterId}`, { userId: b.userId, characterId: b.characterId });
  await Promise.all([...byScope.values()].map(({ userId, characterId }) => invalidate(userId, characterId)));
}

export async function invalidate(userId: string, characterId: string): Promise<void> {
  try {
    await redis.del(beliefsKey(userId, characterId));
  } catch (err) {
    logger.warn('[belief-store] cache invalidate failed', { userId, characterId, error: String(err) });
  }
}
