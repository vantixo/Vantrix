/**
 * Season Engine — Seasonal Effects
 *
 * world-engine.ts's advanceUniverseTick() already owns the season *value*
 * (rotateSeason, every 30 ticks) — this engine doesn't duplicate that. It
 * reacts to whatever the current season is and applies its downstream
 * effects: a light, bounded nudge to each location's trade_volume
 * (location_economy) reflecting seasonal demand, plus narrated
 * 'seasonal' world_events. Detects the transition itself (by diffing
 * against the last season it saw, cached in a single sentinel
 * world_events row) so the "season just changed" narration only fires
 * once per rotation instead of every tick.
 */

import { supabaseAdmin }    from '@/lib/supabase/admin';
import { logger }           from '@/lib/logger';
import { getUniverseState } from './world-engine';

const SENTINEL_TITLE = '__season_engine_sentinel__';
const LOCATION_SAMPLE_LIMIT = 20;
const TRANSITION_EXPIRY_DAYS = 30;
const AMBIENT_EXPIRY_DAYS    = 7;

const SEASON_TRADE_MODIFIER: Record<string, number> = {
  spring: 1.05,
  summer: 1.1,
  autumn: 1.08,
  winter: 0.9,
};

// ── Public: Tick ─────────────────────────────────────────────────────────────

export async function tickSeason(): Promise<{ transitioned: boolean; locationsAdjusted: number; ambientGenerated: number }> {
  const state = await getUniverseState();
  const lastSeen = await getLastSeenSeason();

  let transitioned = false;
  let locationsAdjusted = 0;

  if (lastSeen !== state.season) {
    transitioned = true;
    await setLastSeenSeason(state.season);
    locationsAdjusted = await applySeasonalEconomyShift(state.season);
    await narrateTransition(state.season);
  }

  const ambientGenerated = await maybeAmbientSeasonalEvent(state.season);

  logger.info('season-engine:tick:complete', { season: state.season, transitioned, locationsAdjusted, ambientGenerated });
  return { transitioned, locationsAdjusted, ambientGenerated };
}

// ── Public: Read ───────────────────────────────────────────────────────────────

export async function formatSeasonEffectsForPrompt(): Promise<string> {
  const state = await getUniverseState();
  const line = SEASON_EFFECT_LINES[state.season] ?? '';
  return line ? `[Season] ${line}` : '';
}

// ── Internal: sentinel tracking (avoids a new table for one string) ────────────

async function getLastSeenSeason(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('world_events')
    .select('description')
    .eq('event_type', 'season_sentinel')
    .eq('title', SENTINEL_TITLE)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.description ?? null;
}

async function setLastSeenSeason(season: string): Promise<void> {
  // Deactivate any prior sentinel rows, then write the current one — keeps exactly one live sentinel.
  await supabaseAdmin.from('world_events').update({ is_active: false }).eq('event_type', 'season_sentinel').eq('title', SENTINEL_TITLE);
  await supabaseAdmin.from('world_events').insert({
    event_type:  'season_sentinel',
    title:       SENTINEL_TITLE,
    description: season,
    is_active:   true,
    emotional_weight: 1,
  });
}

// ── Internal: effects ────────────────────────────────────────────────────────

async function applySeasonalEconomyShift(season: string): Promise<number> {
  const modifier = SEASON_TRADE_MODIFIER[season] ?? 1;

  const { data: rows, error } = await supabaseAdmin
    .from('location_economy')
    .select('id, trade_volume')
    .limit(LOCATION_SAMPLE_LIMIT);

  if (error || !rows) return 0;

  let adjusted = 0;
  for (const row of rows) {
    const newVolume = Math.max(0, Math.round((row.trade_volume ?? 0) * modifier));
    const { error: updateError } = await supabaseAdmin
      .from('location_economy')
      .update({ trade_volume: newVolume })
      .eq('id', row.id);
    if (!updateError) adjusted++;
  }
  return adjusted;
}

async function narrateTransition(season: string): Promise<void> {
  const { title, description } = TRANSITION_COPY[season] ?? TRANSITION_COPY.spring!;
  await supabaseAdmin.from('world_events').insert({
    event_type:       'seasonal',
    title,
    description,
    emotional_weight: 3,
    is_active:        true,
    expires_at:        new Date(Date.now() + TRANSITION_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  }).then(({ error }) => {
    if (error) logger.warn('season-engine:narrate-transition-failed', { error });
  });
}

async function maybeAmbientSeasonalEvent(season: string): Promise<number> {
  if (Math.random() > 0.3) return 0;

  const pool = AMBIENT_COPY[season] ?? AMBIENT_COPY.spring!;
  const chosen = pool[Math.floor(Math.random() * pool.length)]!;

  const { error } = await supabaseAdmin.from('world_events').insert({
    event_type:       'seasonal',
    title:            chosen.title,
    description:      chosen.description,
    emotional_weight: chosen.weight,
    is_active:        true,
    expires_at:        new Date(Date.now() + AMBIENT_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  });

  if (error) {
    logger.warn('season-engine:ambient-failed', { error });
    return 0;
  }
  return 1;
}

// ── Copy ─────────────────────────────────────────────────────────────────────

const SEASON_EFFECT_LINES: Record<string, string> = {
  spring: 'Trade is picking up as supply lines reopen after winter.',
  summer: 'Markets are at their most active of the year.',
  autumn: 'Harvest season has trade running strong before the winter slowdown.',
  winter: 'Trade has slowed; travel and commerce move at a more careful pace.',
};

const TRANSITION_COPY: Record<string, { title: string; description: string }> = {
  spring: { title: 'Spring Arrives', description: 'The thaw has set in. Trade routes are reopening and the markets are stirring back to life.' },
  summer: { title: 'Summer Settles In', description: 'Long days have brought the busiest stretch of the year — commerce, festivals, and travel all peaking together.' },
  autumn: { title: 'Autumn Turns', description: 'The harvest is in. Trade is brisk as everyone stocks up before the season turns colder.' },
  winter: { title: 'Winter Sets In', description: 'The cold has arrived in earnest. Trade is slowing and the world is turning inward for the season.' },
};

const AMBIENT_COPY: Record<string, { title: string; description: string; weight: number }[]> = {
  spring: [
    { title: 'First Thaw', description: 'The last of the ice has finally cleared from the lower roads.', weight: 1 },
    { title: 'Planting Season Underway', description: 'Farmers across the region are back in their fields, earlier than some expected.', weight: 2 },
  ],
  summer: [
    { title: 'Peak Travel Season', description: 'Roads and waterways are busier than any other point in the year.', weight: 2 },
    { title: 'Drought Concerns', description: 'A dry stretch has some farmers worried, though nobody is panicking yet.', weight: 3 },
  ],
  autumn: [
    { title: 'Harvest Underway', description: 'Fields across the region are being brought in before the weather turns.', weight: 2 },
    { title: 'Stockpiling Begins', description: 'Households and merchants alike are laying in supplies ahead of winter.', weight: 2 },
  ],
  winter: [
    { title: 'Roads Grow Treacherous', description: 'Ice on the outer roads is slowing trade caravans to a crawl.', weight: 3 },
    { title: 'Fuel Prices Climb', description: 'Demand for heating fuel is outpacing supply in several districts.', weight: 3 },
  ],
};
