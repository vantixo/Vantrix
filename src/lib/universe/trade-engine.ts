/**
 * Trade Engine — Cities & Companies
 *
 * "Cities trade. Companies trade." Vantrix's schema has no separate
 * "country" table (see supabase/migrations/20260910_resource_trade_engine.sql
 * for why) — only world_locations (cities/districts) and companies. So
 * trade here is location <-> location, location <-> company, and
 * company <-> company, unified through the ResourceHolder shape from
 * resource-engine.ts. If a country/nation layer gets added later, it
 * should be able to slot in as a third HolderType without changing
 * executeTrade()'s shape.
 *
 * Currency is whatever the holder already has: location_economy.gdp for
 * locations, companies.capital for companies. No new wallet/ledger table.
 *
 * Two entry points:
 *   - executeTrade()  — one explicit trade between two named holders.
 *     Called directly (e.g. an admin tool, or a future player-facing
 *     "broker a deal" feature), not on a fixed tick.
 *   - runTradeTick()  — the automatic pass: for every resource, matches
 *     holders with a surplus against holders with a shortfall and settles
 *     trades between them. This is what 'trade_process' jobs run (see
 *     src/app/api/workers/run/route.ts — that job type currently no-ops,
 *     "folded into economy_tick"; this file is the real implementation,
 *     the worker route just needs its case updated to call runTradeTick(),
 *     see INTEGRATION_CHANGELOG note at the bottom of this pass).
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import {
  RESOURCE_TYPES, RESOURCE_DEFINITIONS, quoteValue,
  getQuantity, adjustQuantity, hasQuantity, applyProductionTick, applyDecay,
  profileFor,
} from './resource-engine';
import type { ResourceHolder, ResourceType, HolderType } from './resource-engine';

// ── Currency helpers ─────────────────────────────────────────────────────────
// Locations spend/earn against location_economy.gdp, companies against
// companies.capital. Both tables already exist and are updated elsewhere
// (economy.ts, company-engine.ts) — trade-engine.ts only nudges the same
// column, it doesn't own it.

async function getBalance(holder: ResourceHolder): Promise<number> {
  if (holder.holderType === 'location') {
    const { data } = await supabaseAdmin
      .from('location_economy').select('gdp').eq('location_id', holder.holderId).maybeSingle();
    return data?.gdp ?? 0;
  }
  const { data } = await supabaseAdmin
    .from('companies').select('capital').eq('id', holder.holderId).maybeSingle();
  return data?.capital ?? 0;
}

async function adjustBalance(holder: ResourceHolder, delta: number): Promise<void> {
  const current = await getBalance(holder);
  const next = Math.max(0, Math.round(current + delta));

  if (holder.holderType === 'location') {
    await supabaseAdmin.from('location_economy').update({ gdp: next }).eq('location_id', holder.holderId);
  } else {
    await supabaseAdmin.from('companies').update({ capital: next }).eq('id', holder.holderId);
  }
}

// ── Explicit trade ───────────────────────────────────────────────────────────

export interface TradeRequest {
  from: ResourceHolder;
  to:   ResourceHolder;
  resourceType: ResourceType;
  quantity: number;
  /** Price per unit paid by `to` to `from`. Defaults to RESOURCE_DEFINITIONS base value. */
  unitPrice?: number;
}

export interface TradeOutcome {
  success: boolean;
  reason?: string;
  totalValue: number;
}

/**
 * Moves `quantity` of `resourceType` from `from` to `to`, paying `to`'s
 * balance into `from`'s balance at unitPrice (default: base market value).
 * Fails cleanly (no partial writes) if either the resource or the funds
 * aren't there.
 */
export async function executeTrade(req: TradeRequest): Promise<TradeOutcome> {
  const unitPrice = req.unitPrice ?? RESOURCE_DEFINITIONS[req.resourceType].baseValue;
  const totalValue = Math.round(unitPrice * req.quantity);

  const hasResource = await hasQuantity(req.from, req.resourceType, req.quantity);
  if (!hasResource) {
    return { success: false, reason: `seller lacks sufficient ${req.resourceType}`, totalValue };
  }

  const buyerBalance = await getBalance(req.to);
  if (buyerBalance < totalValue) {
    return { success: false, reason: 'buyer lacks sufficient funds', totalValue };
  }

  await adjustQuantity(req.from, req.resourceType, -req.quantity);
  await adjustQuantity(req.to, req.resourceType, req.quantity);
  await adjustBalance(req.from, totalValue);
  await adjustBalance(req.to, -totalValue);

  await supabaseAdmin.from('resource_trades').insert({
    from_type: req.from.holderType,
    from_id:   req.from.holderId,
    to_type:   req.to.holderType,
    to_id:     req.to.holderId,
    resource_type: req.resourceType,
    quantity:  req.quantity,
    unit_price: unitPrice,
    total_value: totalValue,
  });

  return { success: true, totalValue };
}

// ── Automatic tick ───────────────────────────────────────────────────────────

export interface TradeTickResult {
  trades_executed: number;
  trades_failed:   number;
  total_value:     number;
}

interface HolderRow {
  holder: ResourceHolder;
  industry: string;
  scale: number; // population/1000 for locations, employee_count (min 1) for companies
}

/**
 * Runs one automatic trade pass across the whole world:
 *   1. Production/consumption tick for every location and active company
 *      (so surpluses/shortages actually exist before we try to match them).
 *   2. Perishable decay.
 *   3. For each resource type, holders with more than a comfortable buffer
 *      sell down to holders below a shortage threshold, cheapest/neediest
 *      matched first. Zero-sum by construction — nothing is created here,
 *      only moved (production/consumption is what actually creates supply).
 *
 * Called by the world worker on 'trade_process' jobs.
 */
export async function runTradeTick(): Promise<TradeTickResult> {
  const holders = await loadHolders();

  // Step 1 + 2: production, consumption, decay — same order as economy.ts's
  // single-location tick, just applied to every holder in the pass.
  for (const row of holders) {
    await applyProductionTick(row.holder, row.industry, row.scale);
    await applyDecay(row.holder);
  }

  let trades_executed = 0;
  let trades_failed = 0;
  let total_value = 0;

  // Step 3: per-resource surplus/shortage matching.
  for (const resourceType of RESOURCE_TYPES) {
    const levels = await Promise.all(
      holders.map(async (row) => ({
        row,
        quantity: await getQuantity(row.holder, resourceType),
      })),
    );

    const comfortable = comfortableBuffer(resourceType);
    const shortageThreshold = comfortable * 0.3;

    const sellers = levels
      .filter((l) => l.quantity > comfortable)
      .sort((a, b) => b.quantity - a.quantity);
    const buyers = levels
      .filter((l) => l.quantity < shortageThreshold)
      .sort((a, b) => a.quantity - b.quantity);

    let si = 0;
    let bi = 0;
    while (si < sellers.length && bi < buyers.length) {
      const seller = sellers[si]!;
      const buyer = buyers[bi]!;

      const available = seller.quantity - comfortable;
      const needed = shortageThreshold - buyer.quantity;
      const quantity = Math.floor(Math.min(available, needed));

      if (quantity <= 0) {
        if (available <= 0) si++;
        else bi++;
        continue;
      }

      const outcome = await executeTrade({
        from: seller.row.holder,
        to:   buyer.row.holder,
        resourceType,
        quantity,
      });

      if (outcome.success) {
        trades_executed++;
        total_value += outcome.totalValue;
        seller.quantity -= quantity;
        buyer.quantity += quantity;
      } else {
        trades_failed++;
      }

      if (seller.quantity <= comfortable) si++;
      if (buyer.quantity >= shortageThreshold) bi++;
    }
  }

  logger.info('trade-engine:tick-complete', { trades_executed, trades_failed, total_value });
  return { trades_executed, trades_failed, total_value };
}

function comfortableBuffer(resourceType: ResourceType): number {
  // Rough buffer size per resource — tuned off the starting-inventory
  // amounts in resource-engine.ts's bootstrapInventory(). Not meant to be
  // exact economics, just enough to keep trades from firing on noise.
  const buffers: Record<ResourceType, number> = {
    iron: 150, food: 300, water: 300, energy: 150, technology: 30,
  };
  return buffers[resourceType];
}

async function loadHolders(): Promise<HolderRow[]> {
  const [{ data: locations }, { data: companies }] = await Promise.all([
    supabaseAdmin.from('world_locations').select('id, population, location_economy(primary_industry)'),
    supabaseAdmin.from('companies').select('id, industry, employee_count').eq('status', 'active'),
  ]);

  type LocationHolderSelect = {
    id: string;
    population: number | null;
    location_economy: { primary_industry: string | null } | null;
  };
  type CompanyHolderSelect = {
    id: string;
    industry: string | null;
    employee_count: number | null;
  };

  const locationRows: HolderRow[] = (locations ?? []).map((loc: LocationHolderSelect) => ({
    holder: { holderType: 'location' as HolderType, holderId: loc.id },
    industry: loc.location_economy?.primary_industry ?? 'services',
    scale: Math.max(1, Math.round((loc.population ?? 50_000) / 1000)),
  }));

  const companyRows: HolderRow[] = (companies ?? []).map((co: CompanyHolderSelect) => ({
    holder: { holderType: 'company' as HolderType, holderId: co.id },
    industry: co.industry ?? 'services',
    scale: Math.max(1, co.employee_count ?? 1),
  }));

  return [...locationRows, ...companyRows];
}

// Re-exported for convenience so callers only need one import for the
// common case (e.g. an admin tool quoting a trade before executing it).
export { profileFor, quoteValue };
