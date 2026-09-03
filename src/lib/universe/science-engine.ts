/**
 * Science Engine — Discovery & Research
 *
 * Generates 'science' world_events: discoveries, published findings,
 * research disputes, and funding drama. World-scoped rather than
 * per-character (unlike learning-engine.ts / knowledge-engine.ts, which
 * track an individual companion's personal knowledge growth).
 *
 * Occasionally attributes a discovery to a character with a
 * research-flavored occupation, giving that character a small
 * reputation bump via reputation.ts — a light hook, not a dependency
 * science-engine needs to function without characters present.
 */

import { supabaseAdmin }  from '@/lib/supabase/admin';
import { logger }         from '@/lib/logger';

const EXPIRY_DAYS  = 16;
const TICK_TARGET  = 2; // new science events attempted per tick, world-wide (not per-location — research isn't geographically bound the way crime is)

interface ResearcherCandidate {
  id:   string;
  name: string;
}

// ── Public: Tick ─────────────────────────────────────────────────────────────

export async function tickScience(): Promise<{ generated: number; expired: number; attributed: number }> {
  const { count: expiredCount } = await supabaseAdmin
    .from('world_events')
    .update({ is_active: false }, { count: 'exact' })
    .eq('event_type', 'science')
    .lt('expires_at', new Date().toISOString())
    .eq('is_active', true);

  const expired = expiredCount ?? 0;

  const { data: researchers } = await supabaseAdmin
    .from('companion_occupations')
    .select('character_id, employer, characters(id, name, occupation)')
    .limit(100);

  type ResearcherOccupationRow = {
    characters: { id: string; name: string; occupation: string | null } | { id: string; name: string; occupation: string | null }[] | null;
  };
  const candidates: ResearcherCandidate[] = (researchers ?? [])
    .map((r: ResearcherOccupationRow) => r.characters)
    .flatMap((c) => (Array.isArray(c) ? c : c ? [c] : []))
    .filter((c) => typeof c.occupation === 'string' && /research|scien|analyst|scholar/i.test(c.occupation))
    .map((c) => ({ id: c.id, name: c.name }));

  let generated  = 0;
  let attributed = 0;
  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  for (let i = 0; i < TICK_TARGET; i++) {
    if (Math.random() < 0.4) continue;

    const researcher = candidates.length > 0 && Math.random() < 0.4 ? pick(candidates) : null;
    const template = pick(buildSciencePool(researcher?.name ?? null));

    const { error: insertError } = await supabaseAdmin.from('world_events').insert({
      event_type:       'science',
      title:            template.title,
      description:      template.description,
      location_id:      null,
      emotional_weight: template.weight,
      is_active:        true,
      expires_at:       expiresAt,
    });

    if (insertError) {
      logger.warn('science-engine:tick:insert-failed', { error: insertError });
      continue;
    }

    generated++;

    if (researcher) {
      try {
        const { applyFameEvent } = await import('./reputation');
        await applyFameEvent(researcher.id, 2);
        attributed++;
      } catch (err) {
        logger.warn('science-engine:tick:attribution-failed', { researcherId: researcher.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  logger.info('science-engine:tick:complete', { generated, expired, attributed });
  return { generated, expired, attributed };
}

// ── Public: Read ───────────────────────────────────────────────────────────────

export async function getActiveScienceEvents(limit = 10) {
  const { data, error } = await supabaseAdmin
    .from('world_events')
    .select('id, title, description, emotional_weight, created_at')
    .eq('event_type', 'science')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return [];
  return data ?? [];
}

export async function formatScienceForPrompt(): Promise<string> {
  const events = await getActiveScienceEvents(2);
  if (events.length === 0) return '';
  const lines = events.map((e) => `- ${e.title}: ${e.description}`).join('\n');
  return `[Recent Discoveries]\n${lines}`;
}

// ── Internal ─────────────────────────────────────────────────────────────────

interface ScienceTemplate { title: string; description: string; weight: number }

function buildSciencePool(researcherName: string | null): ScienceTemplate[] {
  const byline = researcherName ? `led by ${researcherName}` : `from a team that's kept a low profile until now`;

  return [
    {
      title: `Unexpected Result Published`,
      description: `A study ${byline} produced a result that contradicts years of assumptions in the field. Peer review is already contentious.`,
      weight: 4,
    },
    {
      title: `Funding Cut Threatens Long-Running Project`,
      description: `A research effort ${byline} may be shut down after losing its primary backer. Colleagues are calling it shortsighted.`,
      weight: 4,
    },
    {
      title: `A Discovery With Immediate Uses`,
      description: `Research ${byline} yielded something with obvious practical applications, and industry interest followed within days.`,
      weight: 4,
    },
    {
      title: `Dispute Over Credit`,
      description: `Two research groups are both claiming to have gotten there first. The evidence is genuinely ambiguous.`,
      weight: 3,
    },
    {
      title: `A Quiet Breakthrough`,
      description: `Work ${byline} confirmed something long suspected but never proven. It won't make headlines, but it changes the baseline.`,
      weight: 2,
    },
    {
      title: `Replication Attempt Fails`,
      description: `A widely cited earlier result couldn't be reproduced by a second team. The original researchers are standing by their work.`,
      weight: 4,
    },
    {
      title: `Ethics Committee Raises Concerns`,
      description: `A proposed line of research ${byline} was flagged before it could begin. The debate has gotten personal.`,
      weight: 4,
    },
  ];
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}
