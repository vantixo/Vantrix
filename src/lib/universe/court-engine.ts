/**
 * Court Engine — Verdicts
 *
 * Polls unresolved crime_incident world_events (from crime-engine.ts) and
 * disposes of a portion of them each tick: convicted, acquitted, or
 * dismissed. Disposition odds are weighted by that location's
 * enforcement posture (law-engine.ts) and, for higher-severity cases,
 * city_governance.corruption (a corrupt court convicts less on the
 * merits and more on leverage — reflected narratively, not mechanically
 * exploitable).
 *
 * Resolving an incident flips its world_events row to is_active=false
 * (so it drops out of crime-engine's "unresolved" read) and inserts a
 * companion 'court_verdict' event carrying the outcome, so the verdict
 * is visible in prompt context independent of the original incident.
 */

import { supabaseAdmin }     from '@/lib/supabase/admin';
import { logger }            from '@/lib/logger';
import { getJusticePostures } from './law-engine';

const RESOLVE_BATCH_LIMIT = 15;
const VERDICT_EXPIRY_DAYS = 14;

type Verdict = 'convicted' | 'acquitted' | 'dismissed';

const POSTURE_RESOLVE_CHANCE: Record<string, number> = {
  lax:            0.25,
  balanced:       0.45,
  strict:         0.65,
  authoritarian:  0.7,
};

// ── Public: Tick ─────────────────────────────────────────────────────────────

export async function tickCourt(): Promise<{ resolved: number; convicted: number; acquitted: number; dismissed: number }> {
  const tally = { resolved: 0, convicted: 0, acquitted: 0, dismissed: 0 };

  const { data: incidents, error } = await supabaseAdmin
    .from('world_events')
    .select('id, title, description, location_id, emotional_weight, created_at')
    .eq('event_type', 'crime_incident')
    .eq('is_active', true)
    .limit(RESOLVE_BATCH_LIMIT * 2); // over-fetch; not every incident resolves this tick

  if (error || !incidents || incidents.length === 0) {
    if (error) logger.warn('court-engine:tick:fetch-failed', { error });
    return tally;
  }

  const { data: governanceRows } = await supabaseAdmin
    .from('city_governance')
    .select('location_id, corruption');
  const corruptionByLocation = new Map((governanceRows ?? []).map((g: { location_id: string; corruption: number }) => [g.location_id, g.corruption]));

  // Batched: one query for every incident's location instead of one
  // per-incident round trip (was N+1 via getJusticePosture() in this loop).
  const postures = await getJusticePostures(incidents.map((i) => i.location_id).filter((id): id is string => Boolean(id)));

  let processed = 0;

  for (const incident of incidents) {
    if (processed >= RESOLVE_BATCH_LIMIT) break;
    if (!incident.location_id) continue;

    const posture = postures.get(incident.location_id) ?? 'balanced';
    const resolveChance = POSTURE_RESOLVE_CHANCE[posture] ?? 0.45;

    // Older, higher-weight cases are more likely to finally reach a docket this tick.
    const ageDays = (Date.now() - new Date(incident.created_at).getTime()) / (24 * 60 * 60 * 1000);
    const urgency = Math.min(0.3, ageDays * 0.03) + (incident.emotional_weight >= 5 ? 0.15 : 0);

    if (Math.random() > resolveChance + urgency) continue;

    const corruption = corruptionByLocation.get(incident.location_id) ?? 30;
    const verdict = rollVerdict(posture, corruption, incident.emotional_weight ?? 3);

    await supabaseAdmin.from('world_events').update({ is_active: false }).eq('id', incident.id);

    const { title, description, weight } = buildVerdictNarration(incident.title, verdict, corruption);

    const { error: insertError } = await supabaseAdmin.from('world_events').insert({
      event_type:       'court_verdict',
      title,
      description,
      location_id:      incident.location_id,
      emotional_weight: weight,
      is_active:        true,
      expires_at:       new Date(Date.now() + VERDICT_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    });

    if (insertError) {
      logger.warn('court-engine:tick:verdict-insert-failed', { incidentId: incident.id, error: insertError });
    }

    tally.resolved++;
    tally[verdict]++;
    processed++;
  }

  logger.info('court-engine:tick:complete', tally);
  return tally;
}

// ── Public: Read ───────────────────────────────────────────────────────────────

export async function getRecentVerdicts(locationId?: string, limit = 10) {
  let query = supabaseAdmin
    .from('world_events')
    .select('id, title, description, location_id, emotional_weight, created_at')
    .eq('event_type', 'court_verdict')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (locationId) query = query.eq('location_id', locationId);

  const { data, error } = await query;
  if (error) return [];
  return data ?? [];
}

// ── Internal ─────────────────────────────────────────────────────────────────

function rollVerdict(posture: string, corruption: number, severity: number): Verdict {
  // Base convict odds rise with posture strictness and severity, fall with corruption
  // once the case is high-profile enough for money/influence to matter.
  let convictOdds = posture === 'authoritarian' ? 0.65 : posture === 'strict' ? 0.55 : posture === 'lax' ? 0.35 : 0.45;
  convictOdds += (severity - 3) * 0.05;
  if (corruption > 60 && severity >= 5) convictOdds -= 0.2; // the powerful buy their way out of the big cases

  const roll = Math.random();
  if (roll < convictOdds) return 'convicted';

  const dismissOdds = corruption > 60 ? 0.5 : 0.3;
  return Math.random() < dismissOdds ? 'dismissed' : 'acquitted';
}

function buildVerdictNarration(incidentTitle: string, verdict: Verdict, corruption: number): { title: string; description: string; weight: number } {
  if (verdict === 'convicted') {
    return {
      title: `Verdict Reached: "${incidentTitle}"`,
      description: `The case has concluded with a conviction. Sentencing follows in the coming weeks.`,
      weight: 4,
    };
  }
  if (verdict === 'acquitted') {
    return {
      title: `Acquittal in "${incidentTitle}"`,
      description: `The court found insufficient grounds to convict. Reactions in the community are mixed.`,
      weight: 3,
    };
  }
  const dismissalFlavor = corruption > 60
    ? `dropped under circumstances nobody in the courthouse wants to discuss on the record`
    : `dismissed on procedural grounds`;
  return {
    title: `Case Dismissed: "${incidentTitle}"`,
    description: `The matter was ${dismissalFlavor}.`,
    weight: corruption > 60 ? 5 : 2,
  };
}
