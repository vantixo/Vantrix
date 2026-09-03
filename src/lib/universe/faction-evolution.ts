/**
 * Faction Evolution Engine
 *
 * Separate from tickCompanionCareers() (companion-jobs.ts), which the
 * 'faction_evolve' job also drives for historical reasons — this adds the
 * actual faction-level dynamics that name implies: influence drifts each
 * tick, and a faction can overtake the ruling faction in a location when
 * its influence pulls far enough ahead.
 *
 * Ruling-faction changes are logged to both political_events (visible in
 * city history / prompts) and faction_evolution_log (structured, for the
 * faction detail view).
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import { narrate }       from './narrator';

const OVERTAKE_MARGIN = 15; // influence points a challenger must lead by to take over

export async function runFactionEvolution(): Promise<{ locations_processed: number; ruling_changes: number }> {
  const { data: locations } = await supabaseAdmin.from('world_locations').select('id').eq('archetype', 'city');
  if (!locations) return { locations_processed: 0, ruling_changes: 0 };

  let rulingChanges = 0;

  for (const loc of locations) {
    const { data: factions } = await supabaseAdmin
      .from('factions')
      .select('*')
      .eq('location_id', loc.id);

    if (!factions || factions.length === 0) continue;

    for (const faction of factions) {
      const drift = (Math.random() - 0.5) * 8;
      const newInfluence = clamp(faction.influence + drift, 0, 100);
      await supabaseAdmin.from('factions').update({ influence: newInfluence }).eq('id', faction.id);

      if (Math.abs(drift) >= 3) {
        await logEvolution(faction.id, 'influence_shift', drift, `${faction.name}'s influence ${drift > 0 ? 'grew' : 'waned'}.`);
      }
      faction.influence = newInfluence; // for the overtake check below
    }

    const ranked = [...factions].sort((a, b) => b.influence - a.influence);
    const topFaction = ranked[0]!;
    const currentRuling = factions.find((f) => f.is_ruling);

    if (
      currentRuling &&
      topFaction.id !== currentRuling.id &&
      topFaction.influence - currentRuling.influence >= OVERTAKE_MARGIN
    ) {
      await supabaseAdmin.from('factions').update({ is_ruling: false }).eq('id', currentRuling.id);
      await supabaseAdmin.from('factions').update({ is_ruling: true }).eq('id', topFaction.id);

      await logEvolution(topFaction.id, 'ruling_change', topFaction.influence - currentRuling.influence, `${topFaction.name} displaced ${currentRuling.name} as the ruling faction.`);
      await logPoliticalEvent(loc.id, narrate.rulingFactionChange(topFaction.name, currentRuling.name), 4);
      rulingChanges++;
    }
  }

  return { locations_processed: locations.length, ruling_changes: rulingChanges };
}

async function logEvolution(factionId: string, changeType: string, delta: number, note: string): Promise<void> {
  await supabaseAdmin.from('faction_evolution_log').insert({
    faction_id:  factionId,
    change_type: changeType,
    delta:       Math.round(delta * 10) / 10,
    note,
  }).then(({ error }) => {
    if (error) logger.warn('faction-evolution:log-failed', { factionId, error });
  });
}

async function logPoliticalEvent(locationId: string, description: string, severity: number): Promise<void> {
  await supabaseAdmin.from('political_events').insert({
    event_type:  'ruling_faction_change',
    title:       'Power Shifts',
    description,
    location_id: locationId,
    severity,
  }).then(({ error }) => {
    if (error) logger.warn('faction-evolution:log-event-failed', { locationId, error });
  });
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
