/**
 * Collective Memory Engine
 *
 * Distinct from per-character memory (handled elsewhere): this is what a
 * *group* remembers — a faction's memory of a betrayal, an organization's
 * memory of who founded it, a location's memory of a disaster. Memories
 * strengthen when reinforced (retold, referenced, voted on) and fade when
 * left alone, so the group's shared narrative drifts realistically instead
 * of being a permanent unweighted log.
 *
 * `agent-communication.ts` feeds this: a rumor that keeps getting relayed
 * within a faction is exactly the kind of thing that should crystallize
 * into a collective memory via `reinforceOrCreate`.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';

export type MemoryScope = 'faction' | 'organization' | 'location';

export interface CollectiveMemory {
  id:                   string;
  scope_type:           MemoryScope;
  scope_id:             string;
  summary:              string;
  detail:               string | null;
  significance:         number;
  source_character_id:  string | null;
  tags:                 string[];
  strength:             number;
  last_reinforced_at:   string;
  created_at:            string;
}

const DECAY_PER_DAY = 0.03;
const REINFORCE_STEP = 0.2;
const FORGOTTEN_THRESHOLD = 0.08;

// ── Public: Write ─────────────────────────────────────────────────────────────

/** Record a brand-new collective memory for a group. */
export async function recordMemory(params: {
  scopeType:          MemoryScope;
  scopeId:            string;
  summary:            string;
  detail?:            string;
  significance?:      number;
  sourceCharacterId?: string;
  tags?:              string[];
}): Promise<CollectiveMemory | null> {
  const { data, error } = await supabaseAdmin
    .from('collective_memories')
    .insert({
      scope_type:           params.scopeType,
      scope_id:              params.scopeId,
      summary:               params.summary,
      detail:                params.detail ?? null,
      significance:          params.significance ?? 3,
      source_character_id:   params.sourceCharacterId ?? null,
      tags:                  params.tags ?? [],
      strength:              1.0,
    })
    .select('*')
    .maybeSingle();

  if (error) {
    logger.warn('collective-memory:record-failed', { error, scopeId: params.scopeId });
    return null;
  }
  return data as CollectiveMemory;
}

/**
 * If a memory with a close-enough summary already exists for this scope,
 * reinforce it instead of duplicating; otherwise create it fresh. This is
 * what lets a repeated rumor or recurring event become a durable memory
 * rather than a pile of near-identical rows.
 */
export async function reinforceOrCreate(params: {
  scopeType:          MemoryScope;
  scopeId:            string;
  summary:            string;
  detail?:            string;
  significance?:      number;
  sourceCharacterId?: string;
  tags?:              string[];
}): Promise<CollectiveMemory | null> {
  const { data: existing } = await supabaseAdmin
    .from('collective_memories')
    .select('*')
    .eq('scope_type', params.scopeType)
    .eq('scope_id', params.scopeId)
    .ilike('summary', params.summary)
    .maybeSingle();

  if (existing) {
    return reinforceMemory(existing.id);
  }
  return recordMemory(params);
}

export async function reinforceMemory(memoryId: string, amount = REINFORCE_STEP): Promise<CollectiveMemory | null> {
  const { data: mem } = await supabaseAdmin
    .from('collective_memories')
    .select('strength')
    .eq('id', memoryId)
    .maybeSingle();

  if (!mem) return null;

  const { data, error } = await supabaseAdmin
    .from('collective_memories')
    .update({
      strength:            clamp(mem.strength + amount, 0, 1),
      last_reinforced_at:  new Date().toISOString(),
    })
    .eq('id', memoryId)
    .select('*')
    .maybeSingle();

  if (error) {
    logger.warn('collective-memory:reinforce-failed', { memoryId, error });
    return null;
  }
  return data as CollectiveMemory;
}

// ── Public: Tick ───────────────────────────────────────────────────────────────

/**
 * Decay all collective memories by time-since-reinforced. Called on a
 * schedule (e.g. daily) rather than per-tick since memory drift is a slow
 * process. Memories that decay past the forgotten threshold are deleted
 * outright — a group that has genuinely forgotten something shouldn't keep
 * a near-zero-strength row lingering in prompts.
 */
export async function decayCollectiveMemories(): Promise<{ decayed: number; forgotten: number }> {
  const { data: memories } = await supabaseAdmin
    .from('collective_memories')
    .select('id, strength, last_reinforced_at, significance');

  if (!memories || memories.length === 0) return { decayed: 0, forgotten: 0 };

  let decayed = 0;
  let forgotten = 0;

  for (const mem of memories) {
    const daysSince = (Date.now() - new Date(mem.last_reinforced_at).getTime()) / 86_400_000;
    // High-significance memories (founding events, betrayals) resist decay.
    const resistance = 1 - (mem.significance - 1) * 0.15;
    const newStrength = clamp(mem.strength - DECAY_PER_DAY * daysSince * resistance, 0, 1);

    if (newStrength <= FORGOTTEN_THRESHOLD) {
      await supabaseAdmin.from('collective_memories').delete().eq('id', mem.id);
      forgotten++;
      continue;
    }

    if (newStrength !== mem.strength) {
      await supabaseAdmin.from('collective_memories').update({ strength: newStrength }).eq('id', mem.id);
      decayed++;
    }
  }

  return { decayed, forgotten };
}

// ── Public: Read / Prompt Formatter ───────────────────────────────────────────

export async function getMemories(
  scopeType: MemoryScope,
  scopeId:   string,
  limit = 10,
): Promise<CollectiveMemory[]> {
  const { data, error } = await supabaseAdmin
    .from('collective_memories')
    .select('*')
    .eq('scope_type', scopeType)
    .eq('scope_id', scopeId)
    .order('strength', { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data ?? []) as CollectiveMemory[];
}

export async function formatCollectiveMemoryForPrompt(
  scopeType: MemoryScope,
  scopeId:   string,
): Promise<string> {
  const memories = await getMemories(scopeType, scopeId, 5);
  if (memories.length === 0) return '';

  const lines = memories
    .filter((m) => m.strength >= 0.3)
    .map((m) => `- ${m.summary}${m.strength < 0.6 ? ' (dimly recalled)' : ''}`);

  if (lines.length === 0) return '';
  return `[What ${scopeType === 'location' ? 'This Place' : 'The Group'} Remembers]\n${lines.join('\n')}`;
}

// ── Internal ──────────────────────────────────────────────────────────────────

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
