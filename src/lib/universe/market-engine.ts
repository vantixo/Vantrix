/**
 * Market Engine — Consumer Goods Pricing
 *
 * Sits above resource-engine.ts (raw wholesale inventories held by a city
 * or company) as the retail layer people actually feel: what does bread,
 * rent-adjacent everyday spending, a night out actually cost right now.
 * Distinct from market-value.ts, which is an unrelated platform metric
 * (character popularity/rarity) and shares nothing with this file.
 *
 * Prices drift on a simple supply/demand model each tick, and this is the
 * feed inflation-engine.ts reads to compute a location's CPI — market-engine
 * owns per-good prices, inflation-engine owns the aggregate index over time.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import { narrate }       from './narrator';

export const GOOD_TYPES = ['groceries', 'dining', 'transport', 'utilities', 'leisure', 'goods'] as const;
export type GoodType = (typeof GOOD_TYPES)[number];

const BASE_PRICES: Record<GoodType, number> = {
  groceries: 12, dining: 28, transport: 8, utilities: 15, leisure: 20, goods: 25,
};

export interface MarketGood {
  location_id:    string;
  good_type:      GoodType;
  base_price:     number;
  current_price:  number;
  demand_index:   number;
  supply_index:   number;
}

// ── Public: Tick ───────────────────────────────────────────────────────────────

/**
 * Drift prices for every good in a location based on demand/supply
 * pressure plus a small random walk. Called by the world worker on the
 * same cadence as economy_tick.
 */
export async function runMarketTick(
  locationId: string,
): Promise<{ location_id: string; goods_updated: number; avg_price_delta_pct: number }> {
  const { data: goods, error } = await supabaseAdmin
    .from('market_goods')
    .select('*')
    .eq('location_id', locationId);

  if (error || !goods || goods.length === 0) {
    await bootstrapMarket(locationId);
    return { location_id: locationId, goods_updated: 0, avg_price_delta_pct: 0 };
  }

  let totalPctDelta = 0;

  for (const good of goods) {
    const demandDrift = (Math.random() - 0.48) * 6;
    const supplyDrift = (Math.random() - 0.5) * 6;
    const demandIndex = clamp(good.demand_index + demandDrift, 10, 95);
    const supplyIndex = clamp(good.supply_index + supplyDrift, 10, 95);

    // Price pressure: demand above supply pushes price up, and vice versa.
    const pressure = (demandIndex - supplyIndex) / 100; // -0.85..0.85
    const targetPrice = good.base_price * (1 + pressure * 0.4);
    const newPrice = good.current_price + (targetPrice - good.current_price) * 0.25;

    const pctDelta = ((newPrice - good.current_price) / good.current_price) * 100;
    totalPctDelta += pctDelta;

    await supabaseAdmin
      .from('market_goods')
      .update({
        current_price:  round2(newPrice),
        demand_index:   Math.round(demandIndex),
        supply_index:   Math.round(supplyIndex),
        last_ticked_at: new Date().toISOString(),
        updated_at:     new Date().toISOString(),
      })
      .eq('id', good.id);

    if (Math.abs(pctDelta) >= 8) {
      const { data: loc } = await supabaseAdmin.from('world_locations').select('name').eq('id', locationId).maybeSingle();
      const cityName = loc?.name ?? 'the area';
      await supabaseAdmin.from('economic_events').insert({
        event_type:  pctDelta > 0 ? 'price_spike' : 'price_drop',
        title:       pctDelta > 0 ? `${capitalize(good.good_type)} Prices Jump` : `${capitalize(good.good_type)} Gets Cheaper`,
        description: narrate.marketDemand(pctDelta, good.good_type, cityName),
        location_id: locationId,
        severity:    Math.abs(pctDelta) > 15 ? 3 : 2,
      }).then(({ error: insErr }) => {
        if (insErr) logger.warn('market-engine:log-event-failed', { locationId, error: insErr });
      });
    }
  }

  return {
    location_id: locationId,
    goods_updated: goods.length,
    avg_price_delta_pct: round2(totalPctDelta / goods.length),
  };
}

// ── Public: Read ───────────────────────────────────────────────────────────────

export async function getMarketGoods(locationId: string): Promise<MarketGood[]> {
  const { data, error } = await supabaseAdmin
    .from('market_goods')
    .select('*')
    .eq('location_id', locationId)
    .order('good_type');

  if (error) return [];
  return (data ?? []) as MarketGood[];
}

/** Aggregate basket price (mean of all goods) — the raw number inflation-engine.ts consumes each tick. */
export async function getBasketPrice(locationId: string): Promise<number | null> {
  const goods = await getMarketGoods(locationId);
  if (goods.length === 0) return null;
  return goods.reduce((sum, g) => sum + g.current_price, 0) / goods.length;
}

// ── Public: Prompt Formatter ───────────────────────────────────────────────────

export async function formatMarketForPrompt(locationId: string): Promise<string> {
  const goods = await getMarketGoods(locationId);
  if (goods.length === 0) return '';

  const notable = goods
    .map((g) => ({ ...g, pctFromBase: ((g.current_price - g.base_price) / g.base_price) * 100 }))
    .filter((g) => Math.abs(g.pctFromBase) >= 10)
    .sort((a, b) => Math.abs(b.pctFromBase) - Math.abs(a.pctFromBase))
    .slice(0, 2);

  if (notable.length === 0) return '';

  const lines = notable.map((g) =>
    `- ${capitalize(g.good_type)} ${g.pctFromBase > 0 ? 'costs noticeably more' : 'is noticeably cheaper'} than usual right now.`,
  );

  return `[Prices Around Here]\n${lines.join('\n')}`;
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function bootstrapMarket(locationId: string): Promise<void> {
  const rows = GOOD_TYPES.map((goodType) => ({
    location_id:    locationId,
    good_type:      goodType,
    base_price:     BASE_PRICES[goodType],
    current_price:  BASE_PRICES[goodType],
    demand_index:   50,
    supply_index:   50,
  }));

  await supabaseAdmin.from('market_goods').upsert(rows, { onConflict: 'location_id,good_type', ignoreDuplicates: true });
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
