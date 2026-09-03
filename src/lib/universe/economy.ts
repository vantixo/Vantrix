/**
 * Economy Engine — Location Economic Simulation
 *
 * "A city's economy shapes what is possible for the people who live in it.
 * Unemployment is personal. Trade is political. GDP is a story."
 *
 * Each city maintains an economy record: GDP, unemployment, trade volume,
 * and primary industry. Economic ticks apply small stochastic drift tied
 * to the governance stability and world mood.
 *
 * Economic events generated here surface in world history and inform
 * character occupational context.
 */

import { supabaseAdmin }  from '@/lib/supabase/admin';
import { logger }         from '@/lib/logger';
import { resolveLocationChoiceLean } from './daily-choice';

// ── Public: Tick ───────────────────────────────────────────────────────────────

/**
 * Run the economy tick for a specific location.
 * Called by the world worker for each 'economy_tick' job.
 *
 * Guarded against being applied twice within the same ~1h tick window (see
 * api/cron/economy-tick/route.ts's lock for why a duplicate invocation is
 * possible at all): the UPDATE below only matches a row whose
 * last_ticked_at is NULL or older than the guard window. If two job rows
 * for the same location get enqueued and processed close together, both
 * read the same starting values and compute independent deltas, but only
 * the first UPDATE's WHERE clause actually matches — the second fails to
 * match (last_ticked_at was just refreshed by the first) and is treated as
 * a no-op, not an error. This is the real correctness guarantee; the
 * cron-level lock is only the cheap first layer that stops most duplicates
 * before they reach this function at all.
 *
 * last_ticked_at (20260711_tick_last_ticked_at.sql) is a column dedicated
 * to this guard, deliberately separate from `updated_at` — updated_at is
 * refreshed by ANY write to this row, which would silently cause a
 * legitimate due tick to be skipped if it were reused as the guard.
 */
export async function runEconomyTick(
  locationId: string,
): Promise<{ location_id: string; gdp_delta: number; unemployment_delta: number }> {
  const { data: econ, error } = await supabaseAdmin
    .from('location_economy')
    .select('*, location:world_locations(name)')
    .eq('location_id', locationId)
    .maybeSingle();

  if (error || !econ) {
    await bootstrapEconomy(locationId);
    return { location_id: locationId, gdp_delta: 0, unemployment_delta: 0 };
  }

  // Get governance stability to bias economic drift
  const { data: gov } = await supabaseAdmin
    .from('city_governance')
    .select('stability, approval_rating')
    .eq('location_id', locationId)
    .maybeSingle();

  const stability       = gov?.stability ?? 50;
  const stabilityFactor = (stability - 50) / 200; // ±0.25 bias

  const gdpDelta          = gdpDrift(econ.gdp, stabilityFactor);
  let unemploymentDelta = unemploymentDrift(econ.unemployment, stabilityFactor);
  const tradeDelta        = Math.round((Math.random() - 0.5) * econ.trade_volume * 0.05);

  // Apply the outcome of a user-voted daily world choice, if one is
  // waiting to resolve for this location. One-time nudge, consumed once —
  // see resolveLocationChoiceLean's doc comment. gdp and unemployment live
  // on very different scales, so each gets its own magnitude here rather
  // than a shared flat constant.
  const lean = await resolveLocationChoiceLean(locationId, 'economy_pressure');
  let gdpLeanDelta = 0;
  if (lean?.field === 'gdp') {
    gdpLeanDelta = Math.round(econ.gdp * 0.02) * lean.direction; // ~2% of current gdp
  } else if (lean?.field === 'unemployment') {
    unemploymentDelta += lean.direction * 3; // flat, unemployment is a bounded 1-50 scale
  }

  const newGdp          = Math.max(100, econ.gdp + gdpDelta + gdpLeanDelta);
  const newUnemployment = clamp((econ.unemployment ?? 8) + unemploymentDelta, 1, 50);
  const newTrade        = Math.max(0, econ.trade_volume + tradeDelta);

  const guardCutoff = new Date(Date.now() - 55 * 60 * 1000).toISOString(); // 55min guard band, hourly cadence

  const { data: applied } = await supabaseAdmin
    .from('location_economy')
    .update({
      gdp:             newGdp,
      unemployment:    newUnemployment,
      trade_volume:    newTrade,
      last_ticked_at:  new Date().toISOString(),
    })
    .eq('location_id', locationId)
    .or(`last_ticked_at.is.null,last_ticked_at.lt.${guardCutoff}`)
    .select('location_id')
    .maybeSingle();

  if (!applied) {
    // Another invocation already ticked this location within the current
    // window — no-op, not an error. See guard comment above.
    logger.info('economy:tick-skipped-already-applied', { locationId });
    return { location_id: locationId, gdp_delta: 0, unemployment_delta: 0 };
  }

  // Log significant economic events
  if (Math.abs(unemploymentDelta) >= 3) {
    const cityName = (econ.location as { name: string } | null)?.name ?? 'the district';
    const desc = unemploymentDelta > 0
      ? `Unemployment in ${cityName} has ticked upward. Not a crisis yet, but people notice.`
      : `Employment conditions in ${cityName} have improved slightly. Businesses are hiring.`;

    await supabaseAdmin.from('economic_events').insert({
      event_type:  unemploymentDelta > 0 ? 'unemployment_rise' : 'employment_growth',
      title:       unemploymentDelta > 0 ? 'Jobs Growing Scarce' : 'Employment Up',
      description: desc,
      location_id: locationId,
      severity:    unemploymentDelta > 5 ? 4 : 2,
    });
  }

  return { location_id: locationId, gdp_delta: gdpDelta, unemployment_delta: unemploymentDelta };
}

// ── Public: Prompt Formatter ───────────────────────────────────────────────────

export async function formatEconomyForPrompt(characterId: string): Promise<string> {
  const { data: occupation } = await supabaseAdmin
    .from('companion_occupations')
    .select('location_id')
    .eq('character_id', characterId)
    .maybeSingle();

  if (!occupation?.location_id) return '';

  const { data: econ } = await supabaseAdmin
    .from('location_economy')
    .select('gdp, unemployment, primary_industry, location:world_locations(name)')
    .eq('location_id', occupation.location_id)
    .maybeSingle();

  if (!econ) return '';

  const cityName = (econ.location as { name: string } | null)?.name ?? 'the area';
  const econMood = economicMoodLine(econ.unemployment ?? 8, econ.gdp);

  return `[Local Economy]\n${cityName}: ${econMood}`;
}

// ── Internal ───────────────────────────────────────────────────────────────────

async function bootstrapEconomy(locationId: string): Promise<void> {
  await supabaseAdmin
    .from('location_economy')
    .upsert(
      {
        location_id:      locationId,
        gdp:              50_000 + Math.floor(Math.random() * 100_000),
        unemployment:     5 + Math.floor(Math.random() * 15),
        trade_volume:     10_000 + Math.floor(Math.random() * 40_000),
        primary_industry: pick(['finance', 'manufacturing', 'services', 'technology', 'trade', 'culture']),
      },
      { onConflict: 'location_id', ignoreDuplicates: true },
    );
}

function gdpDrift(current: number, stabilityBias: number): number {
  const trend  = current * 0.001 * stabilityBias; // bias toward growth if stable
  const random = (Math.random() - 0.48) * current * 0.02;
  return Math.round(trend + random);
}

function unemploymentDrift(current: number, stabilityBias: number): number {
  const pull   = (8 - current) * 0.03; // mean-revert toward ~8%
  const bias   = -stabilityBias * 2;   // stable gov = lower unemployment
  const random = (Math.random() - 0.5) * 4;
  return Math.round(pull + bias + random);
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function economicMoodLine(unemployment: number, _gdp: number): string {
  if (unemployment > 20) return 'High unemployment. People are struggling to find work.';
  if (unemployment > 12) return 'Jobs are scarce. The economy has been difficult lately.';
  if (unemployment < 4)  return 'Nearly full employment. The economy is genuinely good right now.';
  if (unemployment < 7)  return 'The job market is reasonably healthy.';
  return 'Economic conditions are average — things are neither bad nor particularly good.';
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}
