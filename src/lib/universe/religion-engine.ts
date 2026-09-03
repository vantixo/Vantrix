/**
 * Religion Engine — Faith, Doctrine, and Belief at the World Level
 *
 * Note: this is distinct from src/lib/ai/belief-engine.ts and
 * src/lib/cognition/belief-engine.ts, which track an individual
 * character's personal convictions. This engine tracks organized faith
 * as a world-level institution — congregations, doctrine disputes,
 * schisms, revivals — scoped per location, same world_events pattern as
 * culture-engine.ts.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';

const TARGET_ACTIVE_PER_LOCATION = 1;
const LOCATION_SAMPLE_LIMIT      = 12;
const EXPIRY_DAYS                = 14;

interface ReligionLocation {
  id:   string;
  name: string;
}

// ── Public: Tick ─────────────────────────────────────────────────────────────

export async function tickReligion(): Promise<{ generated: number; expired: number; locationsTouched: number }> {
  const { count: expiredCount } = await supabaseAdmin
    .from('world_events')
    .update({ is_active: false }, { count: 'exact' })
    .eq('event_type', 'religious')
    .lt('expires_at', new Date().toISOString())
    .eq('is_active', true);

  const expired = expiredCount ?? 0;

  const { data: locations, error } = await supabaseAdmin
    .from('world_locations')
    .select('id, name')
    .limit(LOCATION_SAMPLE_LIMIT);

  if (error || !locations || locations.length === 0) {
    logger.warn('religion-engine:tick:no-locations', { error });
    return { generated: 0, expired, locationsTouched: 0 };
  }

  let generated = 0;
  let touched   = 0;
  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  for (const loc of locations as ReligionLocation[]) {
    const { count: activeCount } = await supabaseAdmin
      .from('world_events')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'religious')
      .eq('location_id', loc.id)
      .eq('is_active', true);

    if ((activeCount ?? 0) >= TARGET_ACTIVE_PER_LOCATION) continue;
    if (Math.random() < 0.55) continue; // faith moves slower than fashion — not every tick produces news

    const template = pick(buildBeliefPool(loc));

    const { error: insertError } = await supabaseAdmin.from('world_events').insert({
      event_type:       'religious',
      title:            template.title,
      description:      template.description,
      location_id:      loc.id,
      emotional_weight: template.weight,
      is_active:        true,
      expires_at:       expiresAt,
    });

    if (insertError) {
      logger.warn('religion-engine:tick:insert-failed', { locationId: loc.id, error: insertError });
      continue;
    }

    generated++;
    touched++;
  }

  logger.info('religion-engine:tick:complete', { generated, expired, locationsTouched: touched });
  return { generated, expired, locationsTouched: touched };
}

// ── Public: Read ───────────────────────────────────────────────────────────────

export async function getActiveReligiousEvents(locationId?: string, limit = 10) {
  let query = supabaseAdmin
    .from('world_events')
    .select('id, title, description, location_id, emotional_weight, created_at')
    .eq('event_type', 'religious')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (locationId) query = query.eq('location_id', locationId);

  const { data, error } = await query;
  if (error) return [];
  return data ?? [];
}

export async function formatReligionForPrompt(locationId: string): Promise<string> {
  const events = await getActiveReligiousEvents(locationId, 1);
  if (events.length === 0) return '';
  const e = events[0];
  return `[Faith & Belief]\n- ${e.title}: ${e.description}`;
}

// ── Internal ─────────────────────────────────────────────────────────────────

interface BeliefTemplate { title: string; description: string; weight: number }

function buildBeliefPool(loc: ReligionLocation): BeliefTemplate[] {
  return [
    {
      title: `A Doctrinal Dispute in ${loc.name}`,
      description: `Two factions within the same congregation disagree on interpretation. Neither side is backing down, and neither is technically wrong.`,
      weight: 4,
    },
    {
      title: `Revival Meetings Draw Crowds`,
      description: `Attendance at evening services in ${loc.name} has tripled in a month. Longtime members aren't sure what to make of the newcomers.`,
      weight: 4,
    },
    {
      title: `A New Congregation Forms`,
      description: `A small group has broken away to worship independently, citing differences too personal to explain publicly.`,
      weight: 3,
    },
    {
      title: `Restoration of a Sacred Site`,
      description: `Volunteers in ${loc.name} have raised enough to repair a shrine that had fallen into disrepair. Opinion is split on whether it should have been left alone.`,
      weight: 3,
    },
    {
      title: `A Prominent Conversion`,
      description: `Someone well known in ${loc.name} has publicly changed faiths. Their old community is taking it personally.`,
      weight: 5,
    },
    {
      title: `Interfaith Council Convenes`,
      description: `Leaders from several traditions in ${loc.name} met to coordinate relief efforts. Some congregants approve, others call it a compromise.`,
      weight: 3,
    },
    {
      title: `Pilgrimage Season Begins`,
      description: `Travelers are passing through ${loc.name} on their way to a distant holy site, filling the inns and straining the roads.`,
      weight: 2,
    },
    {
      title: `A Question of Succession`,
      description: `The aging head of a major congregation in ${loc.name} hasn't named a successor, and the maneuvering has started early.`,
      weight: 4,
    },
    {
      title: `Skepticism on the Rise`,
      description: `Attendance is quietly declining among younger residents of ${loc.name}, more from indifference than opposition.`,
      weight: 2,
    },
  ];
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}
