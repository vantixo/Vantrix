/**
 * Crime Engine — Incidents
 *
 * Generates crime_incident world_events per location, with frequency and
 * severity modulated by that city's enforcement posture (law-engine.ts)
 * and stability (city_governance). Feeds court-engine.ts, which polls
 * unresolved crime_incident events and resolves a portion of them into
 * verdicts.
 *
 * "Resolved" here means an incident has been picked up by the courts —
 * tracked via emotional_weight sign: a crime_incident event is flipped
 * is_active=false once court-engine disposes of it, exactly like any
 * other expiring world_event, so no schema changes are needed.
 */

import { supabaseAdmin }     from '@/lib/supabase/admin';
import { logger }            from '@/lib/logger';
import { getJusticePostures } from './law-engine';

const LOCATION_SAMPLE_LIMIT = 12;
const EXPIRY_DAYS           = 21; // long window so court-engine has time to catch them before auto-expiry

const POSTURE_INCIDENT_CHANCE: Record<string, number> = {
  lax:            0.55,
  balanced:       0.35,
  strict:         0.22,
  authoritarian:  0.28, // fewer petty incidents, more severe/political ones
};

interface CrimeLocation {
  id:         string;
  name:       string;
  population: number;
}

// ── Public: Tick ─────────────────────────────────────────────────────────────

export async function tickCrime(): Promise<{ generated: number; locationsTouched: number }> {
  const { data: locations, error } = await supabaseAdmin
    .from('world_locations')
    .select('id, name, population')
    .limit(LOCATION_SAMPLE_LIMIT);

  if (error || !locations || locations.length === 0) {
    logger.warn('crime-engine:tick:no-locations', { error });
    return { generated: 0, locationsTouched: 0 };
  }

  let generated = 0;
  let touched   = 0;
  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Batched: one city_governance query for every location instead of one
  // per-location round trip (was N+1 via getJusticePosture() in this loop).
  const postures = await getJusticePostures((locations as CrimeLocation[]).map((l) => l.id));

  for (const loc of locations as CrimeLocation[]) {
    const posture = postures.get(loc.id) ?? 'balanced';
    const chance  = POSTURE_INCIDENT_CHANCE[posture] ?? 0.35;

    if (Math.random() > chance) continue;

    const scale = loc.population > 500000 ? 'large' : loc.population > 50000 ? 'mid' : 'small';
    const template = pick(buildIncidentPool(loc.name, posture, scale));

    const { error: insertError } = await supabaseAdmin.from('world_events').insert({
      event_type:       'crime_incident',
      title:            template.title,
      description:      template.description,
      location_id:      loc.id,
      emotional_weight: template.weight,
      is_active:        true,
      expires_at:       expiresAt,
    });

    if (insertError) {
      logger.warn('crime-engine:tick:insert-failed', { locationId: loc.id, error: insertError });
      continue;
    }

    generated++;
    touched++;
  }

  logger.info('crime-engine:tick:complete', { generated, locationsTouched: touched });
  return { generated, locationsTouched: touched };
}

// ── Public: Read ───────────────────────────────────────────────────────────────

/** Unresolved incidents awaiting court disposition — consumed by court-engine.ts. */
export async function getUnresolvedIncidents(locationId?: string, limit = 20) {
  let query = supabaseAdmin
    .from('world_events')
    .select('id, title, description, location_id, emotional_weight, created_at')
    .eq('event_type', 'crime_incident')
    .eq('is_active', true)
    .order('emotional_weight', { ascending: false })
    .limit(limit);

  if (locationId) query = query.eq('location_id', locationId);

  const { data, error } = await query;
  if (error) return [];
  return data ?? [];
}

export async function formatCrimeForPrompt(locationId: string): Promise<string> {
  const incidents = await getUnresolvedIncidents(locationId, 2);
  if (incidents.length === 0) return '';
  const lines = incidents.map((i) => `- ${i.title}: ${i.description}`).join('\n');
  return `[Recent Crime]\n${lines}`;
}

// ── Internal ─────────────────────────────────────────────────────────────────

interface IncidentTemplate { title: string; description: string; weight: number }

function buildIncidentPool(name: string, posture: string, scale: 'small' | 'mid' | 'large'): IncidentTemplate[] {
  const pool: IncidentTemplate[] = [
    { title: `Break-In on the Lower Quarter`, description: `A string of burglaries in ${name} has residents installing locks they didn't think they'd need.`, weight: 3 },
    { title: `Marketplace Pickpocketing Spree`, description: `Merchants in ${name} are warning customers to watch their belongings after a rash of thefts.`, weight: 2 },
    { title: `Fraud Ring Uncovered`, description: `Investigators in ${name} say a scheme targeting new arrivals has been running for months.`, weight: 4 },
    { title: `Warehouse Theft`, description: `A significant shipment went missing from a ${name} storage yard overnight. No witnesses came forward.`, weight: 4 },
    { title: `Brawl Turns Serious`, description: `A dispute outside a tavern in ${name} escalated further than anyone expected.`, weight: 3 },
    { title: `Smuggling Operation Suspected`, description: `Customs officers in ${name} flagged irregular shipments moving through the docks.`, weight: 5 },
    { title: `Vandalism Wave`, description: `Public property across ${name} has been hit by a coordinated string of vandalism.`, weight: 2 },
    { title: `Blackmail Allegations`, description: `Someone prominent in ${name} is reportedly being extorted over a secret they'd rather keep buried.`, weight: 5 },
  ];

  if (scale === 'large') {
    pool.push(
      { title: `Organized Racket Exposed`, description: `A syndicate operating across several districts of ${name} was partially exposed by an internal leak.`, weight: 6 },
      { title: `High-Value Heist`, description: `A brazen theft from a secured vault in ${name} has the city's wealthiest residents nervous.`, weight: 6 },
    );
  }

  if (posture === 'authoritarian') {
    pool.push({
      title: `Arrest Without Clear Charges`,
      description: `Someone in ${name} was taken into custody with no public explanation. Neighbors are trading theories, quietly.`,
      weight: 6,
    });
  }

  if (posture === 'lax') {
    pool.push({
      title: `Repeat Offense, No Response`,
      description: `The same stretch of ${name} has been hit for the third time this season. Residents say reports go nowhere.`,
      weight: 4,
    });
  }

  return pool;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}
