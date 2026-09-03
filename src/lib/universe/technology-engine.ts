/**
 * Technology Engine — Innovation & Adoption
 *
 * Generates 'technology' world_events: new tools, infrastructure
 * upgrades, adoption waves, and the occasional backlash. Reads
 * companies (company-engine.ts) in the 'technology' industry as
 * plausible sources of breakthroughs, so tech news sometimes ties back
 * to a real founded company instead of floating free of world state.
 *
 * Complements science-engine.ts: science produces discoveries (why
 * something is true), technology produces applications (what people
 * build with it). A discovery can seed a later technology event, but
 * the two engines don't share mutable state — they're coupled only
 * narratively, via loose keyword echoing.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';

const LOCATION_SAMPLE_LIMIT = 12;
const EXPIRY_DAYS           = 14;
const TICK_CHANCE           = 0.4;

interface TechLocation {
  id:   string;
  name: string;
}

// ── Public: Tick ─────────────────────────────────────────────────────────────

export async function tickTechnology(): Promise<{ generated: number; expired: number }> {
  const { count: expiredCount } = await supabaseAdmin
    .from('world_events')
    .update({ is_active: false }, { count: 'exact' })
    .eq('event_type', 'technology')
    .lt('expires_at', new Date().toISOString())
    .eq('is_active', true);

  const expired = expiredCount ?? 0;

  const { data: locations, error } = await supabaseAdmin
    .from('world_locations')
    .select('id, name')
    .limit(LOCATION_SAMPLE_LIMIT);

  if (error || !locations || locations.length === 0) {
    logger.warn('technology-engine:tick:no-locations', { error });
    return { generated: 0, expired };
  }

  const { data: techCompanies } = await supabaseAdmin
    .from('companies')
    .select('id, name, location_id')
    .eq('industry', 'technology')
    .eq('status', 'active')
    .limit(30);

  const companiesByLocation = new Map<string, { id: string; name: string }[]>();
  for (const c of techCompanies ?? []) {
    const list = companiesByLocation.get(c.location_id) ?? [];
    list.push({ id: c.id, name: c.name });
    companiesByLocation.set(c.location_id, list);
  }

  let generated = 0;
  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  for (const loc of locations as TechLocation[]) {
    if (Math.random() > TICK_CHANCE) continue;

    const localCompanies = companiesByLocation.get(loc.id) ?? [];
    const company = localCompanies.length > 0 && Math.random() < 0.5 ? pick(localCompanies) : null;
    const template = pick(buildTechPool(loc.name, company?.name ?? null));

    const { error: insertError } = await supabaseAdmin.from('world_events').insert({
      event_type:       'technology',
      title:            template.title,
      description:      template.description,
      location_id:      loc.id,
      emotional_weight: template.weight,
      is_active:        true,
      expires_at:       expiresAt,
    });

    if (insertError) {
      logger.warn('technology-engine:tick:insert-failed', { locationId: loc.id, error: insertError });
      continue;
    }
    generated++;
  }

  logger.info('technology-engine:tick:complete', { generated, expired });
  return { generated, expired };
}

// ── Public: Read ───────────────────────────────────────────────────────────────

export async function getActiveTechnologyEvents(locationId?: string, limit = 10) {
  let query = supabaseAdmin
    .from('world_events')
    .select('id, title, description, location_id, emotional_weight, created_at')
    .eq('event_type', 'technology')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (locationId) query = query.eq('location_id', locationId);

  const { data, error } = await query;
  if (error) return [];
  return data ?? [];
}

// ── Internal ─────────────────────────────────────────────────────────────────

interface TechTemplate { title: string; description: string; weight: number }

function buildTechPool(name: string, companyName: string | null): TechTemplate[] {
  const attribution = companyName ? `${companyName} is behind it` : `no single group is taking credit yet`;

  return [
    {
      title: `New Infrastructure Rolls Out in ${name}`,
      description: `A wave of upgraded public systems is going live across ${name}. Reactions range from relief to confusion. ${attribution}.`,
      weight: 3,
    },
    {
      title: `A Tool Everyone's Suddenly Using`,
      description: `Something new spread through ${name} faster than expected. Early users are already calling it essential; skeptics call it a fad.`,
      weight: 3,
    },
    {
      title: `Automation Displaces Local Jobs`,
      description: `Several workshops in ${name} have adopted automated processes, and the workers replaced by them are organizing a response.`,
      weight: 5,
    },
    {
      title: `A Breakthrough Announced`,
      description: `Engineers in ${name} unveiled something that wasn't supposed to be possible for another decade. ${attribution}.`,
      weight: 5,
    },
    {
      title: `Backlash Against the New System`,
      description: `Not everyone in ${name} is happy with the recent technological push. A vocal minority wants it rolled back.`,
      weight: 4,
    },
    {
      title: `Access Divide Widens`,
      description: `The newest tools in ${name} are spreading unevenly — some districts have them, others are being left behind.`,
      weight: 4,
    },
    {
      title: `A Quiet but Useful Improvement`,
      description: `Something small changed in how ${name} runs day to day. Most people won't notice, but it'll save real time.`,
      weight: 2,
    },
  ];
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}
