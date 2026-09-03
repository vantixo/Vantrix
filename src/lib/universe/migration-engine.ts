/**
 * Migration Engine — Population Flow
 *
 * Models residents moving between world_locations based on relative
 * economic conditions (location_economy.unemployment/gdp), stability
 * (city_governance.stability), and active crises (city_crises). Applies
 * small, bounded population deltas directly to world_locations.population
 * and narrates the movement as 'migration' world_events.
 *
 * Deliberately conservative: this is flavor with a light real effect, not
 * a driver of the economy engine — deltas are capped per tick so a bad
 * governance tick can't hollow out a city in one pass.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';

const MAX_DELTA_FRACTION = 0.002; // up to 0.2% of population moves per tick, per location pair
const EXPIRY_DAYS        = 10;

interface LocationRow {
  id:         string;
  name:       string;
  population: number;
}

interface ScoredLocation extends LocationRow {
  score: number; // higher = more attractive to migrants
}

// ── Public: Tick ─────────────────────────────────────────────────────────────

export async function tickMigration(): Promise<{ moves: number; totalMoved: number }> {
  const { data: locations, error } = await supabaseAdmin
    .from('world_locations')
    .select('id, name, population');

  if (error || !locations || locations.length < 2) {
    logger.warn('migration-engine:tick:insufficient-locations', { error, count: locations?.length ?? 0 });
    return { moves: 0, totalMoved: 0 };
  }

  const { data: economyRows } = await supabaseAdmin.from('location_economy').select('location_id, unemployment, gdp');
  const { data: governanceRows } = await supabaseAdmin.from('city_governance').select('location_id, stability');
  const { count: activeCrisesTotal } = await supabaseAdmin.from('city_crises').select('*', { count: 'exact', head: true }).eq('status', 'active');
  void activeCrisesTotal;

  const { data: crisisRows } = await supabaseAdmin.from('city_crises').select('location_id').eq('status', 'active');
  const crisisLocations = new Set((crisisRows ?? []).map((c: { location_id: string }) => c.location_id));

  const economyByLocation    = new Map((economyRows ?? []).map((e: { location_id: string; unemployment: number | null; gdp: number | null }) => [e.location_id, e]));
  const governanceByLocation = new Map((governanceRows ?? []).map((g: { location_id: string; stability: number | null }) => [g.location_id, g]));

  const scored: ScoredLocation[] = (locations as LocationRow[]).map((loc) => {
    const econ = economyByLocation.get(loc.id);
    const gov  = governanceByLocation.get(loc.id);

    let score = 50;
    if (econ) score += (100 - (econ.unemployment ?? 50)) * 0.3 + Math.log10(Math.max(1, econ.gdp ?? 1)) * 2;
    if (gov)  score += (gov.stability ?? 50) * 0.3;
    if (crisisLocations.has(loc.id)) score -= 25;

    return { ...loc, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const attractive = scored.slice(0, Math.ceil(scored.length / 2));
  const repellent  = scored.slice(Math.ceil(scored.length / 2)).filter((l) => l.score < scored[Math.floor(scored.length / 2)]!.score - 10);

  if (attractive.length === 0 || repellent.length === 0) {
    return { moves: 0, totalMoved: 0 };
  }

  let moves = 0;
  let totalMoved = 0;
  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  for (const from of repellent) {
    if (Math.random() < 0.4) continue; // not every low-scoring city loses people every tick
    const to = pick(attractive.filter((l) => l.id !== from.id));
    if (!to) continue;

    const delta = Math.max(1, Math.floor(from.population * MAX_DELTA_FRACTION * (0.5 + Math.random())));
    const capped = Math.min(delta, Math.floor(from.population * 0.01)); // never drain more than 1% of a location in one tick, hard floor
    if (capped <= 0) continue;

    await supabaseAdmin.from('world_locations').update({ population: Math.max(0, from.population - capped) }).eq('id', from.id);
    await supabaseAdmin.from('world_locations').update({ population: to.population + capped }).eq('id', to.id);

    const reason = reasonFor(from, to, crisisLocations.has(from.id));

    await supabaseAdmin.from('world_events').insert({
      event_type:       'migration',
      title:            `Residents Leaving ${from.name} for ${to.name}`,
      description:      `${capped.toLocaleString()} people have relocated from ${from.name} to ${to.name}. ${reason}`,
      location_id:      to.id,
      emotional_weight: crisisLocations.has(from.id) ? 5 : 3,
      is_active:        true,
      expires_at:       expiresAt,
    });

    // Keep in-memory totals correct if the same location appears as `from` again this loop.
    from.population = Math.max(0, from.population - capped);
    to.population += capped;

    moves++;
    totalMoved += capped;
  }

  logger.info('migration-engine:tick:complete', { moves, totalMoved });
  return { moves, totalMoved };
}

// ── Public: Read ───────────────────────────────────────────────────────────────

export async function getRecentMigrationEvents(locationId?: string, limit = 10) {
  let query = supabaseAdmin
    .from('world_events')
    .select('id, title, description, location_id, emotional_weight, created_at')
    .eq('event_type', 'migration')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (locationId) query = query.eq('location_id', locationId);

  const { data, error } = await query;
  if (error) return [];
  return data ?? [];
}

// ── Internal ─────────────────────────────────────────────────────────────────

function reasonFor(from: LocationRow, to: LocationRow, crisis: boolean): string {
  if (crisis) return `Ongoing trouble in ${from.name} is pushing people out faster than usual.`;
  return `Word has spread that opportunity in ${to.name} is better right now.`;
}

function pick<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}
