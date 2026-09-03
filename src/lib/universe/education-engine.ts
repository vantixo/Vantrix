/**
 * Education Engine — Schools, Skill Formation, and Learning Culture
 *
 * Generates 'education' world_events per location (enrollment shifts,
 * curriculum disputes, new institutions, standout students) and,
 * occasionally, nudges a randomly chosen active character's skills via
 * character-evolution.gainSkill — treating "a good school year" as
 * something that shows up faintly in the wider population, not just in
 * flavor text.
 *
 * Distinct from learning-engine.ts (per-character personal growth arcs)
 * and skill-engine.ts (per-character skill mechanics) — this is the
 * institutional layer those individual systems sit inside.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';

const LOCATION_SAMPLE_LIMIT = 12;
const EXPIRY_DAYS           = 18;
const TICK_CHANCE           = 0.35;
const SKILL_POOL = ['rhetoric', 'research', 'craftsmanship', 'a second language', 'strategy', 'negotiation'];

interface EduLocation {
  id:   string;
  name: string;
}

// ── Public: Tick ─────────────────────────────────────────────────────────────

export async function tickEducation(): Promise<{ generated: number; expired: number; skillNudges: number }> {
  const { count: expiredCount } = await supabaseAdmin
    .from('world_events')
    .update({ is_active: false }, { count: 'exact' })
    .eq('event_type', 'education')
    .lt('expires_at', new Date().toISOString())
    .eq('is_active', true);

  const expired = expiredCount ?? 0;

  const { data: locations, error } = await supabaseAdmin
    .from('world_locations')
    .select('id, name')
    .limit(LOCATION_SAMPLE_LIMIT);

  if (error || !locations || locations.length === 0) {
    logger.warn('education-engine:tick:no-locations', { error });
    return { generated: 0, expired, skillNudges: 0 };
  }

  let generated    = 0;
  let skillNudges  = 0;
  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  for (const loc of locations as EduLocation[]) {
    if (Math.random() > TICK_CHANCE) continue;

    const template = pick(buildEducationPool(loc.name));

    const { error: insertError } = await supabaseAdmin.from('world_events').insert({
      event_type:       'education',
      title:            template.title,
      description:      template.description,
      location_id:      loc.id,
      emotional_weight: template.weight,
      is_active:        true,
      expires_at:       expiresAt,
    });

    if (insertError) {
      logger.warn('education-engine:tick:insert-failed', { locationId: loc.id, error: insertError });
      continue;
    }
    generated++;

    if (Math.random() < 0.25) {
      const nudged = await nudgeRandomLearner(loc.id);
      if (nudged) skillNudges++;
    }
  }

  logger.info('education-engine:tick:complete', { generated, expired, skillNudges });
  return { generated, expired, skillNudges };
}

// ── Public: Read ───────────────────────────────────────────────────────────────

export async function getActiveEducationEvents(locationId?: string, limit = 10) {
  let query = supabaseAdmin
    .from('world_events')
    .select('id, title, description, location_id, emotional_weight, created_at')
    .eq('event_type', 'education')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (locationId) query = query.eq('location_id', locationId);

  const { data, error } = await query;
  if (error) return [];
  return data ?? [];
}

// ── Internal ─────────────────────────────────────────────────────────────────

async function nudgeRandomLearner(locationId: string): Promise<boolean> {
  try {
    const { data: occ } = await supabaseAdmin
      .from('companion_occupations')
      .select('character_id')
      .eq('location_id', locationId)
      .limit(20);

    if (!occ || occ.length === 0) return false;

    const chosen = occ[Math.floor(Math.random() * occ.length)]!;
    const { gainSkill } = await import('./character-evolution');
    await gainSkill(chosen.character_id, pick(SKILL_POOL), 1);
    return true;
  } catch (err) {
    logger.warn('education-engine:nudge-failed', { locationId, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

interface EduTemplate { title: string; description: string; weight: number }

function buildEducationPool(name: string): EduTemplate[] {
  return [
    {
      title: `Enrollment Surges in ${name}`,
      description: `More families in ${name} are seeking formal instruction than the local schools were built to handle.`,
      weight: 3,
    },
    {
      title: `Curriculum Dispute`,
      description: `Educators in ${name} are publicly disagreeing over what should be taught, and to whom, and how early.`,
      weight: 3,
    },
    {
      title: `A New Institution Opens`,
      description: `A school focused on practical trades has opened in ${name}, drawing students who'd otherwise have gone straight to work.`,
      weight: 3,
    },
    {
      title: `A Standout Student`,
      description: `Word is spreading about a student in ${name} whose work is outpacing their instructors' ability to challenge them.`,
      weight: 3,
    },
    {
      title: `Funding Shortfall`,
      description: `Schools in ${name} are stretched thin. Teachers are covering gaps out of pocket, and it's starting to show.`,
      weight: 4,
    },
    {
      title: `Literacy Push`,
      description: `A community effort in ${name} is teaching reading to adults who missed the chance earlier in life.`,
      weight: 2,
    },
    {
      title: `Apprenticeship Reform`,
      description: `Guilds in ${name} are restructuring how apprentices are trained, over the objections of some longtime masters.`,
      weight: 3,
    },
    {
      title: `A Scandal at the Academy`,
      description: `Allegations of favoritism in admissions are circulating around one of ${name}'s more prestigious institutions.`,
      weight: 4,
    },
  ];
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}
