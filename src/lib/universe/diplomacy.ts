/**
 * Diplomacy Engine — Inter-City Relations
 *
 * Maintains a `diplomatic_relations` row per unordered pair of cities.
 * Each diplomatic_event tick picks a handful of pairs, drifts their
 * standing (mean-reverting, same shape as governance drift), and logs a
 * world event when the relationship crosses a status boundary.
 *
 * Run globally (not per-location) since a relation spans two cities —
 * dispatched once per full_universe_tick / diplomatic_event job rather
 * than fanned out per-city like governance_tick.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import { narrate }       from './narrator';

const PAIRS_PER_TICK = 5;

const STATUS_BANDS: { min: number; status: string }[] = [
  { min: 85, status: 'allied' },
  { min: 65, status: 'friendly' },
  { min: 35, status: 'neutral' },
  { min: 15, status: 'tense' },
  { min: 0,  status: 'hostile' },
];

export async function runDiplomaticEvent(): Promise<{ pairs_ticked: number; status_changes: number }> {
  await ensureRelationsExist();

  const { data: relations } = await supabaseAdmin
    .from('diplomatic_relations')
    .select('*, a:world_locations!diplomatic_relations_location_a_id_fkey(name), b:world_locations!diplomatic_relations_location_b_id_fkey(name)')
    .order('updated_at', { ascending: true })
    .limit(PAIRS_PER_TICK);

  let statusChanges = 0;

  for (const rel of relations ?? []) {
    const drift = (50 - rel.standing) * 0.04 + (Math.random() - 0.5) * 10;
    const newStanding = clamp(rel.standing + drift, 0, 100);
    const newStatus = statusFor(newStanding);

    await supabaseAdmin
      .from('diplomatic_relations')
      .update({ standing: newStanding, status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', rel.id);

    if (newStatus !== rel.status) {
      statusChanges++;
      const nameA = (rel.a as { name?: string } | null)?.name ?? 'a city';
      const nameB = (rel.b as { name?: string } | null)?.name ?? 'a neighboring city';
      const severity = newStatus === 'at_war' || newStatus === 'allied' ? 5 : 3;

      await logDiplomaticEvent(
        rel.location_a_id,
        narrate.diplomaticShift(nameA, nameB, newStatus),
        severity,
      );
      if (newStatus === 'at_war') {
        await logDiplomaticEvent(rel.location_b_id, narrate.diplomaticShift(nameB, nameA, newStatus), severity);
      }
    }
  }

  return { pairs_ticked: relations?.length ?? 0, status_changes: statusChanges };
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function ensureRelationsExist(): Promise<void> {
  const { data: locations } = await supabaseAdmin.from('world_locations').select('id').eq('archetype', 'city');
  if (!locations || locations.length < 2) return;

  const { data: existing } = await supabaseAdmin.from('diplomatic_relations').select('location_a_id, location_b_id');
  const existingPairs = new Set((existing ?? []).map((r) => pairKey(r.location_a_id, r.location_b_id)));

  const toInsert: { location_a_id: string; location_b_id: string; standing: number }[] = [];
  for (let i = 0; i < locations.length; i++) {
    for (let j = i + 1; j < locations.length; j++) {
      const a = locations[i]!.id;
      const b = locations[j]!.id;
      if (!existingPairs.has(pairKey(a, b))) {
        toInsert.push({ location_a_id: a, location_b_id: b, standing: 45 + Math.floor(Math.random() * 20) });
      }
    }
  }

  if (toInsert.length > 0) {
    await supabaseAdmin.from('diplomatic_relations').upsert(toInsert, { onConflict: 'location_a_id,location_b_id', ignoreDuplicates: true });
  }
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join(':');
}

function statusFor(standing: number): string {
  return STATUS_BANDS.find((b) => standing >= b.min)!.status;
}

async function logDiplomaticEvent(locationId: string, description: string, severity: number): Promise<void> {
  await supabaseAdmin.from('political_events').insert({
    event_type:  'diplomatic_shift',
    title:       'Diplomatic Relations Shift',
    description,
    location_id: locationId,
    severity,
  }).then(({ error }) => {
    if (error) logger.warn('diplomacy:log-event:failed', { locationId, error });
  });
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
