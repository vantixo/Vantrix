/**
 * World Engine — Universe State & Prompt Context
 *
 * Maintains a singleton universe_state row (season, world_mood, tick_count)
 * and exposes buildUniversePromptContext() — a lightweight context string
 * describing the current state of the world, injected into every character's
 * prompt as ambient atmosphere.
 *
 * "The world should feel like it exists independently of the user."
 */

import { supabaseAdmin }  from '@/lib/supabase/admin';
import { logger, bg }         from '@/lib/logger';
import type { UniverseState, WorldSeason, WorldMood } from '@/types/world-expansion';
import { redis }              from '@/lib/redis';
import { cachedPromptFormat } from './prompt-cache';

const CACHE_K = 'vantrix:universe:state';
const CACHE_S = 120; // 2 min

// ── Public: Read State ─────────────────────────────────────────────────────────

export async function getUniverseState(): Promise<UniverseState> {
  // 1. Try Redis cache
  try {
    const cached = await redis.get<UniverseState>(CACHE_K);
    if (cached) return cached;
  } catch { /* fall through */ }

  // 2. Fetch from Supabase
  const { data, error } = await supabaseAdmin
    .from('universe_state')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    // BOOTSTRAP-FIX: this used to bootstrap (INSERT a fresh row) on *any*
    // error here — including transient ones (connection blip, pool
    // exhaustion under load, a momentary Supabase outage). Under real
    // traffic, every one of those transient failures would silently insert
    // another universe_state row and reset season/mood/tick_count back to
    // defaults, since the next read just picks up whichever row has the
    // newest updated_at — the table would accumulate a new row per hiccup.
    // PGRST116 is PostgREST's code for "0 rows returned" on .single() — the
    // only case that actually means "no state exists yet, safe to
    // bootstrap." For anything else, log it and hand back an unpersisted
    // in-memory default instead: callers across the app (deep-tick,
    // world-atlas, workers/run) all assume this function never throws, so
    // this keeps that contract intact while guaranteeing a transient error
    // can never write a duplicate row.
    if (error && error.code !== 'PGRST116') {
      logger.error('world-engine:get-state:read-failed-using-transient-fallback', {
        error: error.message, code: error.code,
      });
      return TRANSIENT_FALLBACK_STATE();
    }
    return bootstrapUniverseState();
  }

  const state = data as UniverseState;

  // Warm cache
  void redis.set(CACHE_K, state, { ex: CACHE_S }).catch(bg('worldEngine.cacheWarm.read'));

  return state;
}

/**
 * Build a concise universe context string for injection into AI prompts.
 * Kept deliberately short — this appears in every message's system prompt.
 */
export async function buildUniversePromptContext(
  characterId: string,
): Promise<string> {
  try {
    const [state, locationBlock] = await Promise.all([
      getUniverseState(),
      formatCharacterLocationForPrompt(characterId),
    ]);
    const globalLine = formatUniverseStateForPrompt(state);
    return locationBlock ? `${globalLine}\n\n${locationBlock}` : globalLine;
  } catch (err) {
    logger.warn('world-engine:build-context:failed', { error: String(err) });
    return '';
  }
}

// ── Public: Per-Character Location Context ──────────────────────────────────
//
// A character's "location" is anchored on companion_occupations.location_id
// (set when their job/occupation is assigned — see companion-jobs.ts). This
// is the only place characters presently get a location, so it doubles as
// "where this character lives/works." If a character has no occupation row
// yet, this returns '' and the prompt just falls back to the global
// [World Atmosphere] line, same as before this fix.
//
// Cached per-character via the same short-TTL Redis pattern as the other
// ~11 universe-prompt formatters (see prompt-cache.ts) — this adds one more
// DB round-trip (location_id lookup) plus a handful of small joins on cache
// miss, which is the same shape of cost the other formatters already pay.

export interface CharacterLocationContext {
  location:   { id: string; name: string; archetype: string; description: string; culture: string; population: number; is_capital: boolean; seal_motto: string | null };
  governance: { approval_rating: number; stability: number; corruption: number; government_type: string; laws: string[] } | null;
  economy:    { gdp: number; unemployment: number; primary_industry: string } | null;
  factions:   { name: string; ideology: string; influence: number; is_ruling: boolean; motto: string | null }[];
}

export async function getCharacterLocationContext(
  characterId: string,
): Promise<CharacterLocationContext | null> {
  const { data: occ, error: occErr } = await supabaseAdmin
    .from('companion_occupations')
    .select('location_id')
    .eq('character_id', characterId)
    .maybeSingle();

  if (occErr || !occ?.location_id) return null;
  const locationId = occ.location_id as string;

  const [{ data: location }, { data: governance }, { data: economy }, { data: factions }] = await Promise.all([
    supabaseAdmin.from('world_locations').select('id, name, archetype, description, culture, population, is_capital, seal_motto').eq('id', locationId).maybeSingle(),
    supabaseAdmin.from('city_governance').select('approval_rating, stability, corruption, government_type, laws').eq('location_id', locationId).maybeSingle(),
    supabaseAdmin.from('location_economy').select('gdp, unemployment, primary_industry').eq('location_id', locationId).maybeSingle(),
    supabaseAdmin.from('factions').select('name, ideology, influence, is_ruling, motto').eq('location_id', locationId).order('influence', { ascending: false }).limit(3),
  ]);

  if (!location) return null;

  return {
    location:   location as CharacterLocationContext['location'],
    governance: (governance as CharacterLocationContext['governance']) ?? null,
    economy:    (economy as CharacterLocationContext['economy']) ?? null,
    factions:   (factions as CharacterLocationContext['factions']) ?? [],
  };
}

function formatLocationContext(ctx: CharacterLocationContext): string {
  const { location, governance, economy, factions } = ctx;
  const lines: string[] = [
    `[Where You Are: ${location.name}]`,
    `${location.archetype === 'city' ? 'City' : location.archetype.charAt(0).toUpperCase() + location.archetype.slice(1)}${location.is_capital ? ' (the capital)' : ''}, population ${location.population.toLocaleString()}. ${location.culture} culture.`,
  ];
  if (location.description) lines.push(location.description);
  if (location.seal_motto) lines.push(`Local motto: "${location.seal_motto}"`);

  const rulingFaction = factions.find((f) => f.is_ruling) ?? factions[0];
  if (rulingFaction) {
    lines.push(`${rulingFaction.is_ruling ? 'Ruling faction' : 'Dominant faction'}: ${rulingFaction.name} (${rulingFaction.ideology})${rulingFaction.motto ? ` — "${rulingFaction.motto}"` : ''}.`);
  }
  if (factions.length > 1) {
    const others = factions.filter((f) => f !== rulingFaction).map((f) => f.name);
    if (others.length) lines.push(`Other factions with influence here: ${others.join(', ')}.`);
  }

  if (governance) {
    if (governance.stability <= 35) lines.push('The political situation here is unstable right now — people feel it.');
    else if (governance.corruption >= 65) lines.push('Corruption is an open secret here; most people have made peace with it.');
    else if (governance.approval_rating >= 75) lines.push('The current leadership is broadly well-regarded.');
  }

  if (economy) {
    if (economy.unemployment >= 50) lines.push(`Work is scarce here — the ${economy.primary_industry} sector has been struggling.`);
    else if (economy.gdp > 0 && economy.unemployment <= 15) lines.push(`The local economy is strong, driven by ${economy.primary_industry}.`);
    else if (economy.primary_industry) lines.push(`The local economy centers on ${economy.primary_industry}.`);
  }

  lines.push('Let this place inform your world naturally — reference it the way someone references their actual city, not as a fact dump.');

  return lines.join('\n');
}

export async function formatCharacterLocationForPrompt(characterId: string): Promise<string> {
  return cachedPromptFormat(`vantrix:prompt:location:${characterId}`, async () => {
    try {
      const ctx = await getCharacterLocationContext(characterId);
      return ctx ? formatLocationContext(ctx) : '';
    } catch (err) {
      logger.warn('world-engine:location-context:failed', { characterId, error: String(err) });
      return '';
    }
  });
}

// ── Public: Advance Tick ───────────────────────────────────────────────────────

/**
 * Advance the universe tick counter. Called by narrative-tick (every 2h —
 * see api/cron/narrative-tick/route.ts) after enqueueing its other filler
 * jobs. Rotates season every 30 ticks; world mood drifts slowly (see
 * driftWorldMood below).
 *
 * Guarded the same way runEconomyTick/runGovernanceTick are (see
 * lib/universe/economy.ts and 20260711_tick_last_ticked_at.sql for the full
 * rationale): the UPDATE only matches a row whose last_ticked_at is NULL or
 * older than the guard window, so a duplicate invocation (narrative-tick's
 * cron-level lock is the cheap first layer, this is the actual guarantee)
 * can't double-advance tick_count/season. universe_state is a singleton
 * row rather than one-per-city, so the collision window is narrower than
 * economy/governance's, but the same class of bug applies whenever two
 * requests race past the cron lock (lock expiry boundary, manual
 * re-trigger) — worth the same guard for the same reason.
 */
export async function advanceUniverseTick(): Promise<UniverseState> {
  const current = await getUniverseState();

  const newTickCount = current.tick_count + 1;
  const seasonRolled  = newTickCount % 30 === 0;
  const newSeason     = rotateSeason(current.season, newTickCount);
  const newMood       = driftWorldMood(current.world_mood);

  // CALENDAR-FIX: year/month previously never advanced past bootstrap
  // (Year 1, Month 9) — only tick_count/season/world_mood were written
  // here, so the UI could show "Year 1" forever no matter how many
  // seasons rotated. Every season rotation now advances the calendar
  // month by one, wrapping year at month 13. This keeps a single
  // authoritative clock (tick -> season -> month -> year) instead of
  // season and year drifting independently.
  let newMonth = current.month;
  let newYear  = current.year;
  if (seasonRolled) {
    newMonth += 1;
    if (newMonth > 12) {
      newMonth = 1;
      newYear += 1;
    }
  }

  const guardCutoff = new Date(Date.now() - 110 * 60 * 1000).toISOString(); // 110min guard, 2h cadence

  const { data, error } = await supabaseAdmin
    .from('universe_state')
    .update({
      tick_count:     newTickCount,
      season:         newSeason,
      world_mood:     newMood,
      month:          newMonth,
      year:           newYear,
      last_ticked_at: new Date().toISOString(),
      updated_at:     new Date().toISOString(),
    })
    .eq('id', current.id)
    .or(`last_ticked_at.is.null,last_ticked_at.lt.${guardCutoff}`)
    .select('*')
    .maybeSingle();

  if (error || !data) {
    // Either a real write failure, or another invocation already ticked
    // this row within the current guard window — in both cases, no-op and
    // hand back the pre-tick state rather than a synthetic "advanced" one.
    if (error) logger.warn('world-engine:advance-tick:no-op', { error: error.message });
    return current;
  }

  const next = data as UniverseState;
  void redis.set(CACHE_K, next, { ex: CACHE_S }).catch(bg('worldEngine.cacheWarm.tick'));
  return next;
}

// ── Internal ───────────────────────────────────────────────────────────────────

function formatUniverseStateForPrompt(state: UniverseState): string {
  const seasonLine = SEASON_LINES[state.season] ?? 'The world turns.';
  const moodLine   = MOOD_LINES[state.world_mood] ?? '';
  return `[World Atmosphere]\nIt is ${state.season}. ${seasonLine}${moodLine ? ' ' + moodLine : ''}`;
}

// Unpersisted fallback for a transient read error — deliberately does NOT
// touch the database (that's the whole point: see the get-state-failed
// branch above). Same default shape as bootstrapUniverseState() so prompt
// formatting/UI code can't tell the difference, it's just never written.
function TRANSIENT_FALLBACK_STATE(): UniverseState {
  return {
    id:         'transient-fallback',
    season:     'autumn',
    world_mood: 'uncertain',
    tick_count: 0,
    year:       1,
    month:      9,
    updated_at: new Date().toISOString(),
    last_ticked_at: null,
  };
}

async function bootstrapUniverseState(): Promise<UniverseState> {
  const defaultState = {
    season:     'autumn' as WorldSeason,
    world_mood: 'uncertain' as WorldMood,
    tick_count: 0,
    year:       1,
    month:      9,
  };

  const { data, error } = await supabaseAdmin
    .from('universe_state')
    .insert(defaultState)
    .select('*')
    .single();

  if (error || !data) {
    return {
      id: 'default',
      ...defaultState,
      updated_at: new Date().toISOString(),
    };
  }

  return data as UniverseState;
}

const SEASONS: WorldSeason[] = ['spring', 'summer', 'autumn', 'winter'];

function rotateSeason(current: WorldSeason, tick: number): WorldSeason {
  if (tick % 30 !== 0) return current;
  const idx = SEASONS.indexOf(current);
  return SEASONS[(idx + 1) % SEASONS.length]!;
}

const MOOD_POOL: WorldMood[] = ['hopeful', 'tense', 'prosperous', 'volatile', 'melancholic', 'celebratory', 'grim', 'uncertain'];

function driftWorldMood(current: WorldMood): WorldMood {
  // 80% chance to keep current mood — world mood is slow-moving
  if (Math.random() > 0.2) return current;
  const others = MOOD_POOL.filter((m) => m !== current);
  return others[Math.floor(Math.random() * others.length)]!;
}

const SEASON_LINES: Record<WorldSeason, string> = {
  spring: 'There\'s something new trying to begin.',
  summer: 'The heat makes everything feel more urgent than it probably is.',
  autumn: 'Things are closing down that were open. People feel it without saying it.',
  winter: 'The city is quieter than it should be.',
};

const MOOD_LINES: Record<WorldMood, string> = {
  hopeful:     'The general mood has lightened in ways nobody fully accounts for.',
  tense:       'There\'s a low-level tension that makes small things feel larger.',
  prosperous:  'Money is moving. People are building. The mood is up.',
  volatile:    'Everything feels slightly unpredictable right now.',
  melancholic: 'There\'s a collective weariness that\'s been settling for weeks.',
  celebratory: 'Something happened recently and people are still in a good mood from it.',
  grim:        'The past few weeks have been difficult. People carry it.',
  uncertain:   'Nobody quite knows what comes next. The waiting is its own kind of weight.',
};
