/**
 * Relationship Milestones — Vantrix Silicon Valley
 *
 * Sits on top of memory-graph.ts. That table already stores every memory
 * node with an emotional_weight. This module answers a narrower question
 * memory-graph doesn't: "what are the five defining moments of THIS
 * relationship?" — the things a real partner/friend would bring up
 * unprompted, not just the highest-weighted items in a list.
 *
 *   first_vulnerable_moment  — first confession/deep_talk node
 *   favorite_topic           — topic with the most recurring positive engagement
 *   biggest_disagreement     — highest-weight argument node (reconciled or not)
 *   most_emotional_moment    — single highest emotional_weight node, any type
 *   shared_jokes             — up to 3 shared_joke nodes, most recent first
 *
 * These are cached per user+character (relationship_milestones table) and
 * recomputed incrementally on write rather than rescanning memory_graph on
 * every chat turn — cheap to read, cheap to keep fresh.
 *
 * Weighting rule: milestone-tagged memories get +20 emotional_weight when
 * injected into the prompt relative to plain factual memory (see
 * MILESTONE_WEIGHT_BONUS), so a character reliably reaches for "the time
 * you told me about your dad" over "you mentioned you like pasta."
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import type { Json }     from '@/types/supabase';
import type { MemoryNode, MemoryEventType } from './memory-graph';

export const MILESTONE_WEIGHT_BONUS = 20;

export interface RelationshipMilestones {
  first_vulnerable_moment: MemoryNode | null;
  favorite_topic:          { topic: string; mentions: number } | null;
  biggest_disagreement:    MemoryNode | null;
  most_emotional_moment:   MemoryNode | null;
  shared_jokes:            MemoryNode[];
  updated_at:               string;
}

// ── Recompute from the full memory graph ───────────────────────────────────
// Called after any addMemory() write that could change a category leader —
// cheap enough to run on every write since memory_graph per relationship
// stays in the low hundreds of rows.

export async function recomputeMilestones(
  userId:      string,
  characterId: string,
): Promise<RelationshipMilestones | null> {
  const { data: nodes } = await supabaseAdmin
    .from('memory_graph')
    .select('*')
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .order('created_at', { ascending: true });

  const all = (nodes ?? []) as unknown as MemoryNode[];
  if (!all.length) return null;

  const byType = (t: MemoryEventType) => all.filter(n => n.event_type === t);

  const firstVulnerable = [...byType('confession'), ...byType('deep_talk')]
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0] ?? null;

  const disagreements = byType('argument')
    .sort((a, b) => b.emotional_weight - a.emotional_weight);
  const biggestDisagreement = disagreements[0] ?? null;

  const mostEmotional = [...all]
    .sort((a, b) => b.emotional_weight - a.emotional_weight)[0] ?? null;

  const sharedJokes = byType('shared_joke')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 3);

  const favoriteTopic = deriveFavoriteTopic(all);

  const milestones: RelationshipMilestones = {
    first_vulnerable_moment: firstVulnerable,
    favorite_topic:          favoriteTopic,
    biggest_disagreement:    biggestDisagreement,
    most_emotional_moment:   mostEmotional,
    shared_jokes:            sharedJokes,
    updated_at:               new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from('relationship_milestones')
    .upsert({
      user_id:      userId,
      character_id: characterId,
      data:         milestones as unknown as Json,
      updated_at:   milestones.updated_at,
    }, { onConflict: 'user_id,character_id' });

  if (error) logger.warn('relationship-milestones: upsert failed', { userId, characterId, error: error.message });

  return milestones;
}

// Topic frequency from memory tags — "favorite" = most-tagged topic that
// also skews toward positively-weighted memories (weight >= 50), so a
// topic that only ever came up during arguments doesn't win.
function deriveFavoriteTopic(nodes: MemoryNode[]): { topic: string; mentions: number } | null {
  const counts = new Map<string, { count: number; weightSum: number }>();
  const SKIP = new Set(['emotion', 'first', 'beginning', 'ambition', 'daily_life', 'lore', 'secret', 'personal']);

  for (const n of nodes) {
    for (const tag of n.tags ?? []) {
      if (SKIP.has(tag)) continue;
      const entry = counts.get(tag) ?? { count: 0, weightSum: 0 };
      entry.count += 1;
      entry.weightSum += n.emotional_weight;
      counts.set(tag, entry);
    }
  }

  let best: { topic: string; mentions: number; avgWeight: number } | null = null;
  for (const [topic, { count, weightSum }] of counts) {
    if (count < 2) continue; // needs to have come up more than once
    const avgWeight = weightSum / count;
    if (avgWeight < 50) continue; // skew positive
    if (!best || count > best.mentions) best = { topic, mentions: count, avgWeight };
  }

  return best ? { topic: best.topic, mentions: best.mentions } : null;
}

// ── Read cached milestones ──────────────────────────────────────────────────

export async function getMilestones(
  userId:      string,
  characterId: string,
): Promise<RelationshipMilestones | null> {
  const { data } = await supabaseAdmin
    .from('relationship_milestones')
    .select('data')
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .single();

  return (data?.data as unknown as RelationshipMilestones) ?? null;
}

// ── Prompt injection ────────────────────────────────────────────────────────
// This is the "relationship memories weighted higher than factual memories"
// mechanism: it's injected as its own labeled block ABOVE the generic
// formatMemoryGraphForPrompt() output, and the general memory formatter
// should exclude nodes already surfaced here to avoid duplication.

export function formatMilestonesForPrompt(m: RelationshipMilestones | null): string {
  if (!m) return '';
  const lines = ['── Defining Moments (these matter more than anything else you remember) ──'];

  if (m.first_vulnerable_moment) {
    lines.push(`The first time real vulnerability showed up: ${m.first_vulnerable_moment.description}`);
  }
  if (m.favorite_topic) {
    lines.push(`A topic you both keep coming back to, happily: ${m.favorite_topic.topic} (${m.favorite_topic.mentions} times)`);
  }
  if (m.biggest_disagreement) {
    lines.push(`The biggest friction point you've had: ${m.biggest_disagreement.description}`);
  }
  if (m.most_emotional_moment) {
    lines.push(`The single most emotionally significant moment between you: ${m.most_emotional_moment.description}`);
  }
  if (m.shared_jokes.length) {
    lines.push(`Inside jokes you can call back to: ${m.shared_jokes.map(j => j.title).join('; ')}`);
  }

  if (lines.length === 1) return '';
  return lines.join('\n');
}

/** Set of memory node IDs already surfaced via milestones, so the generic
 *  memory formatter can skip them and avoid saying the same thing twice. */
export function milestoneNodeIds(m: RelationshipMilestones | null): Set<string> {
  if (!m) return new Set();
  return new Set(
    [m.first_vulnerable_moment, m.biggest_disagreement, m.most_emotional_moment, ...m.shared_jokes]
      .filter((n): n is MemoryNode => !!n)
      .map(n => n.id),
  );
}
