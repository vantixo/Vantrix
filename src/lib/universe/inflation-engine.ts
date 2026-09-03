/**
 * Inflation Engine — Location CPI & Inflation Rate
 *
 * Reads market-engine.ts's basket price each tick, converts it into a CPI
 * relative to a fixed base period, and derives an annualized inflation
 * rate from the trailing history. This is the number banking-engine.ts
 * reads to set interest rates, taxation-engine.ts implicitly benefits from
 * (bracket effects aren't modeled, but treasury real value is), and
 * employment-engine.ts reads to keep real wages from drifting too far from
 * reality.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import { getBasketPrice } from './market-engine';

const HISTORY_WINDOW_FOR_RATE = 12; // ~12 ticks of history used to compute trailing inflation

export interface InflationSnapshot {
  location_id:     string;
  cpi:             number;
  inflation_rate:  number; // annualized, e.g. 0.032 = 3.2%
  recorded_at:     string;
}

// ── Public: Tick ───────────────────────────────────────────────────────────────

/**
 * Compute and record the current CPI for a location from market-engine's
 * basket price, then derive an inflation rate from how CPI has moved over
 * the trailing window. Called right after runMarketTick for the same
 * location so the basket price is fresh.
 */
export async function runInflationTick(locationId: string): Promise<InflationSnapshot | null> {
  const basketPrice = await getBasketPrice(locationId);
  if (basketPrice === null) return null;

  const { data: basePeriod } = await supabaseAdmin
    .from('price_index_history')
    .select('basket_price')
    .eq('location_id', locationId)
    .order('recorded_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  // First-ever tick for this location: it becomes the base period, CPI = 100 by definition.
  const basePrice = basePeriod?.basket_price ?? basketPrice;
  const cpi = round2((basketPrice / basePrice) * 100);

  const { data: history } = await supabaseAdmin
    .from('price_index_history')
    .select('cpi, recorded_at')
    .eq('location_id', locationId)
    .order('recorded_at', { ascending: false })
    .limit(HISTORY_WINDOW_FOR_RATE);

  const inflationRate = computeInflationRate(cpi, history ?? []);

  const { error } = await supabaseAdmin.from('price_index_history').insert({
    location_id:    locationId,
    basket_price:   round2(basketPrice),
    cpi,
    inflation_rate: inflationRate,
  });

  if (error) {
    logger.warn('inflation-engine:record-failed', { locationId, error });
    return null;
  }

  if (Math.abs(inflationRate) >= 0.08) {
    await supabaseAdmin.from('economic_events').insert({
      event_type:  inflationRate > 0 ? 'inflation_surge' : 'deflation_risk',
      title:       inflationRate > 0 ? 'Cost of Living Rising Fast' : 'Prices Falling Across the Board',
      description: inflationRate > 0
        ? 'Prices have climbed noticeably faster than usual. People are feeling it at checkout.'
        : 'Prices are falling broadly — good for buyers short-term, but a warning sign for the local economy.',
      location_id: locationId,
      severity:    Math.abs(inflationRate) >= 0.15 ? 4 : 3,
    }).then(({ error: insErr }) => {
      if (insErr) logger.warn('inflation-engine:log-event-failed', { locationId, error: insErr });
    });
  }

  return { location_id: locationId, cpi, inflation_rate: inflationRate, recorded_at: new Date().toISOString() };
}

// ── Public: Read ───────────────────────────────────────────────────────────────

export async function getCurrentInflation(locationId: string): Promise<InflationSnapshot | null> {
  const { data, error } = await supabaseAdmin
    .from('price_index_history')
    .select('*')
    .eq('location_id', locationId)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return {
    location_id: locationId,
    cpi: data.cpi,
    inflation_rate: data.inflation_rate,
    recorded_at: data.recorded_at,
  };
}

// ── Public: Prompt Formatter ───────────────────────────────────────────────────

export async function formatInflationForPrompt(locationId: string): Promise<string> {
  const snapshot = await getCurrentInflation(locationId);
  if (!snapshot) return '';

  const line = inflationLine(snapshot.inflation_rate);
  if (!line) return '';

  return `[Cost of Living]\n${line}`;
}

// ── Internal ──────────────────────────────────────────────────────────────────

function computeInflationRate(currentCpi: number, history: { cpi: number }[]): number {
  const yearAgoProxy = history[history.length - 1]?.cpi ?? currentCpi;
  if (yearAgoProxy <= 0) return 0.02;
  return round4((currentCpi - yearAgoProxy) / yearAgoProxy);
}

function inflationLine(rate: number): string | null {
  if (rate >= 0.08) return 'Prices have been climbing fast lately — everyday costs are a real topic of conversation.';
  if (rate >= 0.04) return 'The cost of living has crept up noticeably over the past while.';
  if (rate <= -0.03) return 'Prices have actually been falling — unusual, and not entirely reassuring to locals.';
  return '';
}

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

function round4(val: number): number {
  return Math.round(val * 10000) / 10000;
}
