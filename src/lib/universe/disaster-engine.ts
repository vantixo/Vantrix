/**
 * Disaster Engine — Catastrophic Events
 *
 * Unlike the other new engines in this batch, disasters have a real
 * mechanical footprint: a triggered disaster writes a city_crises row
 * (same table crisis.ts uses, crisis_type: 'disaster') and knocks down
 * city_governance.stability, so it's visible to governance/law/crime
 * downstream, not just flavor text. Resolution reuses crisis.ts's own
 * recovery logic — this engine only triggers, tryResolve in crisis.ts
 * (run every city_crisis job) resolves it once stability recovers.
 *
 * Two entry points:
 *  - tickDisaster(): rare, low-probability spontaneous disasters
 *    (independent of weather) across the location roster.
 *  - triggerWeatherDisaster(): called by weather-engine.ts when a severe
 *    weather roll escalates. Higher severity than a spontaneous roll,
 *    since it's already been building.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import { narrate }       from './narrator';

const LOCATION_SAMPLE_LIMIT   = 12;
const SPONTANEOUS_CHANCE      = 0.02; // per location, per tick — deliberately rare
const EXPIRY_DAYS             = 21;

type DisasterKind = 'fire' | 'flood' | 'earthquake' | 'plague' | 'famine' | 'structural_collapse' | 'storm_damage' | 'blizzard_damage' | 'heat_emergency' | 'cold_emergency';

interface DisasterLocation {
  id:   string;
  name: string;
}

const DISASTER_TEMPLATES: Record<DisasterKind, { title: string; description: (name: string) => string; severity: number }> = {
  fire:                 { title: 'Fire Sweeps a District',       description: (n) => `A fast-moving fire has torn through part of ${n}. Crews are still working to contain it.`, severity: 4 },
  flood:                { title: 'Flooding Overwhelms Low Ground', description: (n) => `Rising water has flooded the lower districts of ${n}. Several families have been displaced.`, severity: 4 },
  earthquake:           { title: 'Tremors Shake the City',        description: (n) => `A significant tremor struck ${n}. Damage assessments are still coming in.`, severity: 5 },
  plague:               { title: 'Illness Spreads Quickly',       description: (n) => `A fast-spreading illness is moving through ${n}. Healers are overwhelmed.`, severity: 4 },
  famine:               { title: 'Food Shortage Turns Severe',    description: (n) => `What began as a shortage in ${n} has become a genuine famine risk in the poorer districts.`, severity: 4 },
  structural_collapse:  { title: 'Building Collapse',             description: (n) => `A structure gave way in ${n} with people inside. Rescue efforts are underway.`, severity: 5 },
  storm_damage:         { title: 'Storm Leaves Lasting Damage',   description: (n) => `The recent storm did more damage than first thought — parts of ${n} are without shelter or power.`, severity: 4 },
  blizzard_damage:      { title: 'Blizzard Cuts Off Districts',   description: (n) => `Snow has cut off entire districts of ${n}. Supply runs are struggling to get through.`, severity: 4 },
  heat_emergency:       { title: 'Heat Emergency Declared',       description: (n) => `Sustained extreme heat in ${n} has led to a formal emergency declaration.`, severity: 3 },
  cold_emergency:       { title: 'Cold Emergency Declared',       description: (n) => `A dangerous cold snap in ${n} has triggered an emergency shelter response.`, severity: 3 },
};

const SPONTANEOUS_POOL: DisasterKind[] = ['fire', 'flood', 'earthquake', 'plague', 'famine', 'structural_collapse'];

// ── Public: Tick (spontaneous) ───────────────────────────────────────────────

export async function tickDisaster(): Promise<{ triggered: number }> {
  const { data: locations, error } = await supabaseAdmin
    .from('world_locations')
    .select('id, name')
    .limit(LOCATION_SAMPLE_LIMIT);

  if (error || !locations || locations.length === 0) {
    logger.warn('disaster-engine:tick:no-locations', { error });
    return { triggered: 0 };
  }

  let triggered = 0;

  for (const loc of locations as DisasterLocation[]) {
    if (Math.random() > SPONTANEOUS_CHANCE) continue;

    const hasActive = await hasActiveDisaster(loc.id);
    if (hasActive) continue;

    const kind = SPONTANEOUS_POOL[Math.floor(Math.random() * SPONTANEOUS_POOL.length)]!;
    await trigger(loc.id, loc.name, kind);
    triggered++;
  }

  logger.info('disaster-engine:tick:complete', { triggered });
  return { triggered };
}

// ── Public: Weather escalation entry point ──────────────────────────────────

/** Called by weather-engine.ts when a severe weather roll escalates. */
export async function triggerWeatherDisaster(
  locationId: string,
  locationName: string,
  weatherCondition: string,
): Promise<{ triggered: boolean }> {
  const hasActive = await hasActiveDisaster(locationId);
  if (hasActive) return { triggered: false };

  const kind: DisasterKind =
    weatherCondition === 'storm'     ? 'storm_damage' :
    weatherCondition === 'blizzard'  ? 'blizzard_damage' :
    weatherCondition === 'heatwave'  ? 'heat_emergency' :
    weatherCondition === 'cold_snap' ? 'cold_emergency' : 'storm_damage';

  await trigger(locationId, locationName, kind);
  return { triggered: true };
}

// ── Public: Read ───────────────────────────────────────────────────────────────

export async function getActiveDisasters(locationId?: string) {
  let query = supabaseAdmin
    .from('city_crises')
    .select('id, location_id, title, description, severity, started_at')
    .eq('crisis_type', 'disaster')
    .eq('status', 'active')
    .order('started_at', { ascending: false });

  if (locationId) query = query.eq('location_id', locationId);

  const { data, error } = await query;
  if (error) return [];
  return data ?? [];
}

// ── Internal ─────────────────────────────────────────────────────────────────

async function hasActiveDisaster(locationId: string): Promise<boolean> {
  const { count } = await supabaseAdmin
    .from('city_crises')
    .select('id', { count: 'exact', head: true })
    .eq('location_id', locationId)
    .eq('crisis_type', 'disaster')
    .eq('status', 'active');
  return (count ?? 0) > 0;
}

async function trigger(locationId: string, locationName: string, kind: DisasterKind): Promise<void> {
  const template = DISASTER_TEMPLATES[kind];

  const { error: crisisError } = await supabaseAdmin.from('city_crises').insert({
    location_id: locationId,
    crisis_type: 'disaster',
    severity:    template.severity,
    title:       template.title,
    description: template.description(locationName),
  });

  if (crisisError) {
    logger.warn('disaster-engine:trigger:crisis-insert-failed', { locationId, kind, error: crisisError });
    return;
  }

  const { data: gov } = await supabaseAdmin
    .from('city_governance')
    .select('stability')
    .eq('location_id', locationId)
    .maybeSingle();

  if (gov) {
    await supabaseAdmin
      .from('city_governance')
      .update({ stability: Math.max(0, gov.stability - template.severity * 3) })
      .eq('location_id', locationId);
  }

  await supabaseAdmin.from('political_events').insert({
    event_type:  'disaster_strikes',
    title:       template.title,
    description: narrate.crisisBegins(template.title),
    location_id: locationId,
    severity:    Math.min(5, template.severity),
  }).then(({ error }) => {
    if (error) logger.warn('disaster-engine:trigger:political-event-failed', { locationId, error });
  });

  await supabaseAdmin.from('world_events').insert({
    event_type:       'disaster',
    title:            template.title,
    description:      template.description(locationName),
    location_id:      locationId,
    emotional_weight: Math.min(10, template.severity + 2),
    is_active:        true,
    expires_at:        new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  });

  logger.info('disaster-engine:trigger:complete', { locationId, kind, severity: template.severity });
}
