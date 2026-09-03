/**
 * Culture Engine — Ambient Cultural Life
 *
 * "A world with characters but no culture is just a roster."
 *
 * Generates culture-flavored world_events (art movements, fashion,
 * cuisine trends, festivals, subcultures, generational shifts) scoped to
 * individual locations, using each location's `culture` field as seed
 * material so output differs city to city rather than reading generic.
 *
 * Mirrors event-engine.ts's shape (world_events table, active-count
 * targeting, expiry sweep) but is location-scoped and keeps its own
 * target count independent of the ambient event pool so the two engines
 * don't compete for the same "5 active events" budget.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';

const TARGET_ACTIVE_PER_LOCATION = 2;
const LOCATION_SAMPLE_LIMIT      = 12;
const EXPIRY_DAYS                = 10;

interface CultureLocation {
  id:      string;
  name:    string;
  culture: string;
}

// ── Public: Tick ─────────────────────────────────────────────────────────────

export async function tickCulture(): Promise<{ generated: number; expired: number; locationsTouched: number }> {
  const { count: expiredCount } = await supabaseAdmin
    .from('world_events')
    .update({ is_active: false }, { count: 'exact' })
    .eq('event_type', 'cultural_trend')
    .lt('expires_at', new Date().toISOString())
    .eq('is_active', true);

  const expired = expiredCount ?? 0;

  const { data: locations, error } = await supabaseAdmin
    .from('world_locations')
    .select('id, name, culture')
    .limit(LOCATION_SAMPLE_LIMIT);

  if (error || !locations || locations.length === 0) {
    logger.warn('culture-engine:tick:no-locations', { error });
    return { generated: 0, expired, locationsTouched: 0 };
  }

  let generated = 0;
  let touched   = 0;
  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  for (const loc of locations as CultureLocation[]) {
    const { count: activeCount } = await supabaseAdmin
      .from('world_events')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'cultural_trend')
      .eq('location_id', loc.id)
      .eq('is_active', true);

    const deficit = TARGET_ACTIVE_PER_LOCATION - (activeCount ?? 0);
    if (deficit <= 0) continue;

    const picks = shuffle(buildTrendPool(loc)).slice(0, deficit);
    if (picks.length === 0) continue;

    const { error: insertError } = await supabaseAdmin.from('world_events').insert(
      picks.map((t) => ({
        event_type:       'cultural_trend',
        title:            t.title,
        description:      t.description,
        location_id:      loc.id,
        emotional_weight: t.weight,
        is_active:        true,
        expires_at:       expiresAt,
      })),
    );

    if (insertError) {
      logger.warn('culture-engine:tick:insert-failed', { locationId: loc.id, error: insertError });
      continue;
    }

    generated += picks.length;
    touched++;
  }

  logger.info('culture-engine:tick:complete', { generated, expired, locationsTouched: touched });
  return { generated, expired, locationsTouched: touched };
}

// ── Public: Read ───────────────────────────────────────────────────────────────

export async function getActiveCulturalTrends(locationId?: string, limit = 10) {
  let query = supabaseAdmin
    .from('world_events')
    .select('id, title, description, location_id, emotional_weight, created_at')
    .eq('event_type', 'cultural_trend')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (locationId) query = query.eq('location_id', locationId);

  const { data, error } = await query;
  if (error) return [];
  return data ?? [];
}

export async function formatCultureForPrompt(locationId: string): Promise<string> {
  const trends = await getActiveCulturalTrends(locationId, 2);
  if (trends.length === 0) return '';
  const lines = trends.map((t) => `- ${t.title}: ${t.description}`).join('\n');
  return `[Local Culture]\n${lines}`;
}

// ── Internal ─────────────────────────────────────────────────────────────────

interface TrendTemplate { title: string; description: string; weight: number }

function buildTrendPool(loc: CultureLocation): TrendTemplate[] {
  const culture = (loc.culture || 'a distinct local identity').trim();
  return [
    {
      title: `A New Sound Out of ${loc.name}`,
      description: `Musicians drawing on ${culture} are filling the smaller venues. Nobody's agreed what to call the genre yet.`,
      weight: 3,
    },
    {
      title: `Street Style Shift`,
      description: `A new silhouette is spreading through ${loc.name}, loosely rooted in ${culture}, tightened up for everyday wear.`,
      weight: 2,
    },
    {
      title: `The Pop-Up Kitchens`,
      description: `Cooks in ${loc.name} are reworking dishes tied to ${culture} into something faster, cheaper, and unexpectedly popular.`,
      weight: 3,
    },
    {
      title: `A Generational Split`,
      description: `Younger residents of ${loc.name} are pulling away from older customs around ${culture}. Family dinners have gotten tense.`,
      weight: 4,
    },
    {
      title: `Revival of an Old Custom`,
      description: `A tradition tied to ${culture} that had mostly died out is being brought back, half sincerely, half as spectacle.`,
      weight: 3,
    },
    {
      title: `Underground Art Scene`,
      description: `An unlicensed gallery circuit has formed in ${loc.name}, showing work that pushes hard against ${culture}'s usual boundaries.`,
      weight: 3,
    },
    {
      title: `Language Drift`,
      description: `Slang specific to ${loc.name} is spreading faster than anyone can track, mixing in references from ${culture}.`,
      weight: 2,
    },
    {
      title: `A Festival Gets Bigger`,
      description: `What used to be a small neighborhood gathering rooted in ${culture} has outgrown its original space.`,
      weight: 4,
    },
  ];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
