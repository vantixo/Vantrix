/**
 * Event Engine — World Event Generation
 *
 * "Events happen. The world doesn't wait for users."
 *
 * Generates season-appropriate and mood-appropriate world events
 * (festivals, crises, discoveries, political shifts) and makes them
 * available for prompt context injection.
 *
 * Events are distinct from political_events / economic_events:
 *   - world_events: ambient things happening in the world (festivals,
 *     disasters, cultural moments, weather phenomena, rumors)
 *   - political_events / economic_events: systemic tick outputs
 *     from governance.ts and economy.ts respectively
 */

import { supabaseAdmin }  from '@/lib/supabase/admin';
import { logger }         from '@/lib/logger';
import type { WorldEvent, WorldSeason, WorldMood } from '@/types/world-expansion';

// ── Public: Tick ───────────────────────────────────────────────────────────────

/**
 * Generate new world events appropriate for the current season and mood.
 * Expires stale events older than 14 days.
 * Called by the world worker on 'event_generate' jobs.
 */
export async function tickEvents(ctx: {
  season:    WorldSeason | string;
  mood:      WorldMood | string;
  tickCount: number;
}): Promise<{ generated: number; expired: number }> {
  // Expire old events
  const { count: expiredCount } = await supabaseAdmin
    .from('world_events')
    .update({ is_active: false }, { count: 'exact' })
    .lt('expires_at', new Date().toISOString())
    .eq('is_active', true);

  const expired = expiredCount ?? 0;

  // How many active events do we have right now?
  const { count: activeCount } = await supabaseAdmin
    .from('world_events')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true);

  // Keep 3–7 active events at all times
  const TARGET = 5;
  const current = activeCount ?? 0;
  const toGenerate = Math.max(0, TARGET - current);

  if (toGenerate === 0) {
    return { generated: 0, expired };
  }

  const pool = buildEventPool(ctx.season, ctx.mood);
  const picked = shuffle(pool).slice(0, toGenerate);

  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const inserts = picked.map((ev) => ({
    event_type:       ev.type,
    title:            ev.title,
    description:      ev.description,
    emotional_weight: ev.weight,
    is_active:        true,
    expires_at:       expiresAt,
  }));

  const { error } = await supabaseAdmin.from('world_events').insert(inserts);

  if (error) {
    logger.warn('event-engine:tick:insert-failed', { error });
    return { generated: 0, expired };
  }

  logger.info('event-engine:tick:complete', { generated: toGenerate, expired });
  return { generated: toGenerate, expired };
}

// ── Public: Read ───────────────────────────────────────────────────────────────

/**
 * Get currently active world events, most emotionally weighty first.
 * Read-only counterpart to formatActiveEventsForPrompt — returns full
 * structured rows instead of a prompt-formatted string, for frontend use.
 */
export async function getActiveWorldEvents(limit = 20): Promise<WorldEvent[]> {
  const { data, error } = await supabaseAdmin
    .from('world_events')
    .select('*')
    .eq('is_active', true)
    .order('emotional_weight', { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data ?? []) as WorldEvent[];
}

// ── Public: Prompt Formatter ───────────────────────────────────────────────────

export async function formatActiveEventsForPrompt(
  _characterId: string,
): Promise<string> {
  const { data: events, error } = await supabaseAdmin
    .from('world_events')
    .select('title, description')
    .eq('is_active', true)
    .order('emotional_weight', { ascending: false })
    .limit(3);

  if (error || !events || events.length === 0) return '';

  const lines = events.map((e: { title: string; description: string }) => `- ${e.title}: ${e.description}`).join('\n');
  return `[Current World Events]\n${lines}`;
}

// ── Internal: Event Library ────────────────────────────────────────────────────

interface EventTemplate {
  type:        string;
  title:       string;
  description: string;
  weight:      number;
  seasons?:    string[];
  moods?:      string[];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function buildEventPool(season: string, mood: string): EventTemplate[] {
  return EVENT_LIBRARY.filter((ev) => {
    if (ev.seasons && !ev.seasons.includes(season)) return false;
    if (ev.moods   && !ev.moods.includes(mood))     return false;
    return true;
  });
}

const EVENT_LIBRARY: EventTemplate[] = [
  // ── Universal ──────────────────────────────────────────────────────────────
  {
    type: 'cultural',
    title: 'The Night Markets',
    description: 'Vendors have set up along the lower quarter. They\'ll be there until the cold drives them away.',
    weight: 3,
  },
  {
    type: 'social',
    title: 'A Rumour Going Around',
    description: 'Someone prominent is said to have made a decision that changes things. Details are unclear. Everyone has a version.',
    weight: 4,
  },
  {
    type: 'discovery',
    title: 'Something Found in the Archives',
    description: 'Records from two generations back have surfaced. People who care about history are very interested.',
    weight: 3,
  },

  // ── Spring ─────────────────────────────────────────────────────────────────
  {
    type: 'cultural',
    title: 'First Bloom Festival',
    description: 'The annual gathering around the old quarter. Louder than it looks from a distance.',
    weight: 4,
    seasons: ['spring'],
  },
  {
    type: 'economic',
    title: 'New Trade Season',
    description: 'Supply lines are reopening after the winter slowdown. Prices are adjusting.',
    weight: 3,
    seasons: ['spring'],
  },

  // ── Summer ─────────────────────────────────────────────────────────────────
  {
    type: 'cultural',
    title: 'The Long Evening Gatherings',
    description: 'People are staying out late. The city feels more social than usual.',
    weight: 3,
    seasons: ['summer'],
  },
  {
    type: 'social',
    title: 'A Heatwave',
    description: 'Three weeks of heat. Tempers and temperatures tracking together.',
    weight: 5,
    seasons: ['summer'],
    moods: ['tense', 'volatile'],
  },

  // ── Autumn ─────────────────────────────────────────────────────────────────
  {
    type: 'cultural',
    title: 'Harvest Gala',
    description: 'The formal event of the year. Invitation-only. Everyone talks about who was or wasn\'t there.',
    weight: 5,
    seasons: ['autumn'],
  },
  {
    type: 'political',
    title: 'End-of-Year Review',
    description: 'Institutions are assessing their year. Some heads will roll. Some positions are opening.',
    weight: 4,
    seasons: ['autumn'],
  },

  // ── Winter ─────────────────────────────────────────────────────────────────
  {
    type: 'social',
    title: 'The Quiet Month',
    description: 'Traffic through the main quarter is down. People are staying in. The city moves at a different pace.',
    weight: 3,
    seasons: ['winter'],
  },
  {
    type: 'cultural',
    title: 'Midwinter Memorial',
    description: 'The ceremony for those lost in the past year. Quiet, public, attended by people from very different walks of life.',
    weight: 6,
    seasons: ['winter'],
  },

  // ── Mood-specific ──────────────────────────────────────────────────────────
  {
    type: 'political',
    title: 'Public Protest in the Central Quarter',
    description: 'Several hundred people have been gathering at midday. Police presence is visible but not escalating.',
    weight: 7,
    moods: ['tense', 'volatile'],
  },
  {
    type: 'economic',
    title: 'Investment Announcement',
    description: 'A significant development project has been confirmed. The mood around the announcement is complicated.',
    weight: 5,
    moods: ['prosperous', 'hopeful'],
  },
  {
    type: 'social',
    title: 'A Collective Loss',
    description: 'Someone significant to a lot of people has died. The city is processing it in its own way.',
    weight: 6,
    moods: ['melancholic', 'grim'],
  },
];
