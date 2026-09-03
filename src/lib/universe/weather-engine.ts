/**
 * Weather Engine — Daily Conditions
 *
 * Rolls a per-location weather condition each tick, biased by the
 * current world season (world-engine.ts's universe_state.season), and
 * writes it as a 'weather' world_event with a short expiry (roughly one
 * in-world day) so it always reflects "right now" rather than
 * accumulating like slower-moving culture/religion events.
 *
 * Severe rolls (storm, heatwave, blizzard) have a small chance to spawn
 * a matching disaster-engine.ts crisis instead of just narrating —
 * disaster-engine owns that escalation path; weather-engine only calls
 * into it, never writes to city_crises directly.
 */

import { supabaseAdmin }   from '@/lib/supabase/admin';
import { logger }          from '@/lib/logger';
import { getUniverseState } from './world-engine';

const LOCATION_SAMPLE_LIMIT = 12;
const EXPIRY_HOURS          = 30;
const SEVERE_ESCALATION_CHANCE = 0.08;

type WeatherCondition = 'clear' | 'overcast' | 'rain' | 'storm' | 'heatwave' | 'cold_snap' | 'snow' | 'blizzard' | 'fog' | 'windy';

interface WeatherLocation {
  id:   string;
  name: string;
}

const SEASON_WEIGHTS: Record<string, Partial<Record<WeatherCondition, number>>> = {
  spring: { clear: 20, overcast: 20, rain: 25, storm: 10, fog: 10, windy: 12 },
  summer: { clear: 35, overcast: 10, storm: 12, heatwave: 15, windy: 8, fog: 5 },
  autumn: { overcast: 25, rain: 20, storm: 10, windy: 20, fog: 15, clear: 10 },
  winter: { overcast: 20, snow: 20, cold_snap: 15, blizzard: 8, fog: 12, clear: 15 },
};

const SEVERE: WeatherCondition[] = ['storm', 'heatwave', 'blizzard', 'cold_snap'];

// ── Public: Tick ─────────────────────────────────────────────────────────────

export async function tickWeather(): Promise<{ generated: number; escalated: number }> {
  const { data: locations, error } = await supabaseAdmin
    .from('world_locations')
    .select('id, name')
    .limit(LOCATION_SAMPLE_LIMIT);

  if (error || !locations || locations.length === 0) {
    logger.warn('weather-engine:tick:no-locations', { error });
    return { generated: 0, escalated: 0 };
  }

  const state = await getUniverseState();
  const weights = SEASON_WEIGHTS[state.season] ?? SEASON_WEIGHTS.spring!;

  let generated  = 0;
  let escalated  = 0;
  const expiresAt = new Date(Date.now() + EXPIRY_HOURS * 60 * 60 * 1000).toISOString();

  for (const loc of locations as WeatherLocation[]) {
    const condition = rollWeighted(weights);
    const template = describeWeather(loc.name, condition);

    const { error: insertError } = await supabaseAdmin.from('world_events').insert({
      event_type:       'weather',
      title:            template.title,
      description:      template.description,
      location_id:      loc.id,
      emotional_weight: template.weight,
      is_active:        true,
      expires_at:       expiresAt,
    });

    if (insertError) {
      logger.warn('weather-engine:tick:insert-failed', { locationId: loc.id, error: insertError });
      continue;
    }
    generated++;

    if (SEVERE.includes(condition) && Math.random() < SEVERE_ESCALATION_CHANCE) {
      try {
        const { triggerWeatherDisaster } = await import('./disaster-engine');
        await triggerWeatherDisaster(loc.id, loc.name, condition);
        escalated++;
      } catch (err) {
        logger.warn('weather-engine:tick:escalation-failed', { locationId: loc.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  logger.info('weather-engine:tick:complete', { generated, escalated, season: state.season });
  return { generated, escalated };
}

// ── Public: Read ───────────────────────────────────────────────────────────────

export async function getCurrentWeather(locationId: string) {
  const { data, error } = await supabaseAdmin
    .from('world_events')
    .select('title, description, created_at')
    .eq('event_type', 'weather')
    .eq('location_id', locationId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data;
}

export async function formatWeatherForPrompt(locationId: string): Promise<string> {
  const weather = await getCurrentWeather(locationId);
  if (!weather) return '';
  return `[Weather] ${weather.description}`;
}

// ── Internal ─────────────────────────────────────────────────────────────────

function rollWeighted(weights: Partial<Record<WeatherCondition, number>>): WeatherCondition {
  const entries = Object.entries(weights) as [WeatherCondition, number][];
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let roll = Math.random() * total;
  for (const [cond, w] of entries) {
    roll -= w;
    if (roll <= 0) return cond;
  }
  return entries[0]![0];
}

function describeWeather(name: string, condition: WeatherCondition): { title: string; description: string; weight: number } {
  const copy: Record<WeatherCondition, { title: string; description: string; weight: number }> = {
    clear:     { title: `Clear Skies Over ${name}`, description: `A clear, mild day in ${name}. Nothing to report, which is its own kind of news.`, weight: 1 },
    overcast:  { title: `Overcast in ${name}`, description: `Grey skies have settled over ${name} for the day. No rain yet, but it feels close.`, weight: 1 },
    rain:      { title: `Steady Rain in ${name}`, description: `Rain has been falling over ${name} since morning. Streets are slower than usual.`, weight: 2 },
    storm:     { title: `Storm Warning for ${name}`, description: `A serious storm is moving through ${name}. Residents are being advised to stay indoors.`, weight: 5 },
    heatwave:  { title: `Heatwave Grips ${name}`, description: `Temperatures in ${name} have climbed well past comfortable. Tempers are shortening with them.`, weight: 4 },
    cold_snap: { title: `Cold Snap Hits ${name}`, description: `A sudden drop in temperature has caught ${name} underprepared. Heating costs are already a complaint.`, weight: 4 },
    snow:      { title: `Snowfall Over ${name}`, description: `Snow is settling over ${name}, slowing travel but drawing plenty of people outside to look at it.`, weight: 2 },
    blizzard:  { title: `Blizzard Conditions in ${name}`, description: `Visibility in ${name} has dropped close to nothing. Travel is being discouraged citywide.`, weight: 5 },
    fog:       { title: `Heavy Fog Rolls Into ${name}`, description: `A thick fog has settled over ${name} overnight and shows no sign of lifting soon.`, weight: 2 },
    windy:     { title: `Strong Winds Across ${name}`, description: `Wind has been battering ${name} all day, rattling shutters and grounding anything not tied down.`, weight: 2 },
  };
  return copy[condition];
}
