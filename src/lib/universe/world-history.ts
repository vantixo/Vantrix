/**
 * World History Engine — Vantrix Legacy Systems
 *
 * "Nothing is forgotten." Rather than duplicating storage, this engine
 * aggregates the universe's existing systems of record — universe_memory,
 * political_events, economic_events, world_events, and the companion
 * offline log — into unified, queryable timelines via the
 * `get_world_timeline` and `get_character_biography` SQL functions.
 *
 * This is the read layer that makes years of accumulated simulation feel
 * like an actual history rather than a pile of disconnected logs.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import type { TimelineEntry, BiographyEntry } from '@/types/legacy-systems';
import { redis }              from '@/lib/redis';

const CACHE = {
  global:   'vantrix:history:global',
  city:     (locId: string) => `vantrix:history:city:${locId}`,
  bio:      (charId: string) => `vantrix:history:bio:${charId}`,
};
const TTL = { global: 300, city: 300, bio: 300 };

// ── Read ───────────────────────────────────────────────────────────────────────

export async function getWorldTimeline(limit = 50): Promise<TimelineEntry[]> {
  try {
    const cached = await redis.get<TimelineEntry[]>(CACHE.global);
    if (cached) return cached.slice(0, limit);
  } catch { /* ok */ }

  const { data, error } = await supabaseAdmin.rpc('get_world_timeline', { p_limit: limit, p_location_id: undefined });
  if (error) return [];

  const timeline = (data ?? []) as TimelineEntry[];
  try { await redis.set(CACHE.global, timeline, { ex: TTL.global }); } catch { /* ok */ }
  return timeline;
}

export async function getCityTimeline(locationId: string, limit = 30): Promise<TimelineEntry[]> {
  try {
    const cached = await redis.get<TimelineEntry[]>(CACHE.city(locationId));
    if (cached) return cached.slice(0, limit);
  } catch { /* ok */ }

  const { data, error } = await supabaseAdmin.rpc('get_world_timeline', { p_limit: limit, p_location_id: locationId });
  if (error) return [];

  const timeline = (data ?? []) as TimelineEntry[];
  try { await redis.set(CACHE.city(locationId), timeline, { ex: TTL.city }); } catch { /* ok */ }
  return timeline;
}

export async function getCharacterBiography(characterId: string, limit = 40): Promise<BiographyEntry[]> {
  try {
    const cached = await redis.get<BiographyEntry[]>(CACHE.bio(characterId));
    if (cached) return cached.slice(0, limit);
  } catch { /* ok */ }

  const { data, error } = await supabaseAdmin.rpc('get_character_biography', { p_character_id: characterId, p_limit: limit });
  if (error) return [];

  const bio = (data ?? []) as BiographyEntry[];
  try { await redis.set(CACHE.bio(characterId), bio, { ex: TTL.bio }); } catch { /* ok */ }
  return bio;
}

export async function getMostSignificantEvents(limit = 10): Promise<TimelineEntry[]> {
  const timeline = await getWorldTimeline(200);
  return [...timeline].sort((a, b) => b.significance - a.significance).slice(0, limit);
}

export async function getHistoryAroundDate(date: string, windowDays = 7): Promise<TimelineEntry[]> {
  const target = new Date(date).getTime();
  const windowMs = windowDays * 86_400_000;
  const timeline = await getWorldTimeline(300);

  return timeline.filter(e => Math.abs(new Date(e.occurred_at).getTime() - target) <= windowMs);
}

/**
 * Recent universe_memory records — the permanent, weighted "headline"
 * records written by the deep world tick (lib/universe/deep-tick.ts).
 * Distinct from getMostSignificantEvents(), which ranks across ALL
 * timeline sources (including ambient world_events); this reads only
 * the deliberate, high-visibility headline layer.
 */
export async function getRecentHeadlines(limit = 5): Promise<TimelineEntry[]> {
  const { data, error } = await supabaseAdmin
    .from('universe_memory')
    .select('memory_type, title, description, location_id, emotional_weight, occurred_at')
    .order('occurred_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return data.map((d) => ({
    source:       'universe_memory',
    event_type:   d.memory_type,
    title:        d.title,
    description:  d.description,
    location_id:  d.location_id,
    significance: d.emotional_weight,
    occurred_at:  d.occurred_at,
  }));
}

// ── Invalidation (call after writing new history-bearing records) ─────────────

export async function invalidateHistoryCache(locationId?: string, characterId?: string): Promise<void> {
  try {
    await redis.del(CACHE.global);
    if (locationId)  await redis.del(CACHE.city(locationId));
    if (characterId) await redis.del(CACHE.bio(characterId));
  } catch { /* ok */ }
}

// ── Tick: periodic cache refresh + significance scan ───────────────────────────
// The timeline itself needs no "advancing" (it's a read-time aggregation),
// but this job warms caches and can be extended to promote especially
// significant clusters of events into universe_memory "legendary" records.

export async function tickHistoryAggregate(): Promise<{ refreshed: boolean; notable_events: number }> {
  await invalidateHistoryCache();
  const significant = await getMostSignificantEvents(20);

  const veryNotable = significant.filter(e => e.significance >= 85);

  // Promote standout events into permanent universe_memory if not already recorded
  let notable_events = 0;
  for (const event of veryNotable.slice(0, 3)) {
    const { data: exists } = await supabaseAdmin
      .from('universe_memory')
      .select('id')
      .eq('title', event.title)
      .maybeSingle();

    if (!exists) {
      await supabaseAdmin.rpc('record_universe_memory', {
        p_type:        'milestone',
        p_title:       event.title,
        p_description: event.description,
        p_participants: [],
        p_location_id:  event.location_id ?? undefined,
        p_weight:       event.significance,
        p_legendary:    event.significance >= 90,
      });
      notable_events++;
    }
  }

  return { refreshed: true, notable_events };
}
