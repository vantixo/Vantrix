/**
 * Resource Engine — Location & Company Resource Inventories
 *
 * "The narrative economy (economy.ts) tells you a city's GDP went up.
 * This tells you why: someone there is short on Energy again."
 *
 * Sits underneath economy.ts (GDP/unemployment aggregate, unchanged) and
 * company-engine.ts (capital/market_share, unchanged) as a literal
 * resource layer: Iron, Food, Water, Energy, Technology, held either by
 * a world_locations row (a city/district) or a companies row.
 *
 * Two holder kinds share one shape (ResourceHolder) so trade-engine.ts can
 * treat "a city" and "a company" identically at the trade call site. There
 * is no separate "country" table in Vantrix's schema — see trade-engine.ts's
 * file header for how that's handled.
 *
 * Called by the world worker on 'trade_process' jobs, same cadence as
 * economy_tick (see src/app/api/workers/run/route.ts).
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';

// ── Resource types ────────────────────────────────────────────────────────────

export const RESOURCE_TYPES = ['iron', 'food', 'water', 'energy', 'technology'] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export interface ResourceDefinition {
  type: ResourceType;
  baseValue: number;    // reference price per unit, used when no better market signal exists
  perishable: boolean;  // if true, decays a little each tick (see applyDecay below)
  decayRate: number;    // fraction lost per tick, only relevant if perishable
}

export const RESOURCE_DEFINITIONS: Record<ResourceType, ResourceDefinition> = {
  iron:       { type: 'iron',       baseValue: 10, perishable: false, decayRate: 0 },
  food:       { type: 'food',       baseValue: 4,  perishable: true,  decayRate: 0.05 },
  water:      { type: 'water',      baseValue: 2,  perishable: true,  decayRate: 0.02 },
  energy:     { type: 'energy',     baseValue: 8,  perishable: true,  decayRate: 0.1 },
  technology: { type: 'technology', baseValue: 25, perishable: false, decayRate: 0 },
};

// ── Holder abstraction ────────────────────────────────────────────────────────

export type HolderType = 'location' | 'company';

export interface ResourceHolder {
  holderType: HolderType;
  holderId:   string;
}

export interface ResourceStock {
  resourceType: ResourceType;
  quantity:     number;
}

// TYPE-NARROWING FIX: every function below used to call a shared
// `table(holderType)` helper returning `PostgrestQueryBuilder<location_resources>
// | PostgrestQueryBuilder<company_resources>`, then chain `.eq(idColumnFor(holderType), ...)`
// with idColumnFor ALSO returning a union (`'location_id' | 'company_id'`).
// Two independently-computed unions don't narrow each other — the compiler
// can only accept column names common to *both* tables' Row types, which
// excludes each table's own FK column entirely, and .upsert() specifically
// stops being callable at all once its overload set can't resolve against
// a builder union. That old code's own comment said the point was to "keep
// every query on the fully-typed builder instead of bypassing the compiler
// with `as unknown as any`" — a real goal, just not one a shared `table()`
// helper can actually deliver, since building the union is precisely what
// breaks it. An explicit `if (holderType === 'location') {…} else {…}` at
// each call site below is the only way supabase-js's generic client
// narrows a two-table polymorphic write correctly — more repetition, but
// every branch is on the real, fully-typed single-table builder, no `as
// never` escape hatch anywhere in this file anymore. The old `table()` /
// `tableFor()` / `idColumnFor()` helpers are gone with it — nothing calls
// them once every site branches for itself, and keeping unused indirection
// around "for later" is exactly how the union bug got introduced in the
// first place.

// ── Read ───────────────────────────────────────────────────────────────────────

export async function getInventory(holder: ResourceHolder): Promise<ResourceStock[]> {
  const { data, error } =
    holder.holderType === 'location'
      ? await supabaseAdmin
          .from('location_resources')
          .select('resource_type, quantity')
          .eq('location_id', holder.holderId)
      : await supabaseAdmin
          .from('company_resources')
          .select('resource_type, quantity')
          .eq('company_id', holder.holderId);

  if (error) {
    logger.warn('resource-engine:getInventory:error', { holder, error });
    return [];
  }

  return (data ?? []).map((row: { resource_type: string; quantity: number }) => ({
    resourceType: row.resource_type as ResourceType,
    quantity:     Number(row.quantity),
  }));
}

export async function getQuantity(holder: ResourceHolder, resourceType: ResourceType): Promise<number> {
  const { data, error } =
    holder.holderType === 'location'
      ? await supabaseAdmin
          .from('location_resources')
          .select('quantity')
          .eq('location_id', holder.holderId)
          .eq('resource_type', resourceType)
          .maybeSingle()
      : await supabaseAdmin
          .from('company_resources')
          .select('quantity')
          .eq('company_id', holder.holderId)
          .eq('resource_type', resourceType)
          .maybeSingle();

  if (error || !data) return 0;
  return Number(data.quantity);
}

// ── Write ──────────────────────────────────────────────────────────────────────

/**
 * Adds (or subtracts, via a negative delta) a quantity of a resource for a
 * holder. Upserts the row if it doesn't exist yet. Never lets quantity go
 * negative — callers that need to know whether a full amount was available
 * should check getQuantity() first (see trade-engine.ts's executeTrade,
 * which does exactly that before calling this).
 */
export async function adjustQuantity(
  holder: ResourceHolder,
  resourceType: ResourceType,
  delta: number,
): Promise<number> {
  const current = await getQuantity(holder, resourceType);
  const next = Math.max(0, current + delta);

  const { error } =
    holder.holderType === 'location'
      ? await supabaseAdmin
          .from('location_resources')
          .upsert(
            { location_id: holder.holderId, resource_type: resourceType, quantity: next },
            { onConflict: 'location_id,resource_type' },
          )
      : await supabaseAdmin
          .from('company_resources')
          .upsert(
            { company_id: holder.holderId, resource_type: resourceType, quantity: next },
            { onConflict: 'company_id,resource_type' },
          );

  if (error) {
    logger.error('resource-engine:adjustQuantity:error', { holder, resourceType, delta, error });
    return current;
  }

  return next;
}

export async function hasQuantity(
  holder: ResourceHolder,
  resourceType: ResourceType,
  amount: number,
): Promise<boolean> {
  return (await getQuantity(holder, resourceType)) >= amount;
}

// ── Bootstrap ──────────────────────────────────────────────────────────────────

/** Seeds a starting inventory for a location or company that has none yet. */
export async function bootstrapInventory(holder: ResourceHolder): Promise<void> {
  const quantities = RESOURCE_TYPES.map((type) => ({
    type,
    quantity: startingQuantity(holder.holderType, type),
  }));

  const { error } =
    holder.holderType === 'location'
      ? await supabaseAdmin.from('location_resources').upsert(
          quantities.map(({ type, quantity }) => ({
            location_id: holder.holderId,
            resource_type: type,
            quantity,
          })),
          { onConflict: 'location_id,resource_type', ignoreDuplicates: true },
        )
      : await supabaseAdmin.from('company_resources').upsert(
          quantities.map(({ type, quantity }) => ({
            company_id: holder.holderId,
            resource_type: type,
            quantity,
          })),
          { onConflict: 'company_id,resource_type', ignoreDuplicates: true },
        );

  if (error) {
    logger.error('resource-engine:bootstrap:error', { holder, error });
  }
}

function startingQuantity(holderType: HolderType, type: ResourceType): number {
  // Locations start with modest general stock; companies start empty except
  // for whatever their industry naturally produces (set by
  // industryProfile() below, applied on the first production tick instead).
  if (holderType === 'company') return 0;
  const base: Record<ResourceType, number> = {
    iron: 200, food: 500, water: 500, energy: 300, technology: 50,
  };
  return base[type];
}

// ── Production & consumption ────────────────────────────────────────────────
// Rates are driven off the same `industry` / `primary_industry` strings
// already used by company-engine.ts and economy.ts, so no new taxonomy is
// introduced — a "technology" company or location just produces more
// Technology, a "manufacturing" one more Iron, etc.

export interface IndustryProfile {
  produces: Partial<Record<ResourceType, number>>;
  consumes: Partial<Record<ResourceType, number>>;
}

export const INDUSTRY_PROFILES: Record<string, IndustryProfile> = {
  technology:    { produces: { technology: 6 }, consumes: { energy: 5, iron: 1 } },
  manufacturing: { produces: { iron: 8 },        consumes: { energy: 6, water: 1 } },
  trade:         { produces: {},                 consumes: { energy: 2 } },
  services:      { produces: { food: 2 },        consumes: { energy: 2, water: 2 } },
  culture:       { produces: {},                 consumes: { energy: 1 } },
  scavenging:    { produces: { iron: 2 },         consumes: { water: 1 } },
  government:    { produces: { energy: 4 },       consumes: { iron: 1, technology: 1 } },
};

const DEFAULT_PROFILE: IndustryProfile = { produces: { food: 1, water: 1 }, consumes: { energy: 1 } };

export function profileFor(industry: string): IndustryProfile {
  return INDUSTRY_PROFILES[industry] ?? DEFAULT_PROFILE;
}

/**
 * Applies one tick of production then consumption for a single holder,
 * scaled by `scale` (e.g. population/1000 for a location, employee_count
 * for a company) so a bigger city or company moves bigger numbers.
 * Consumption is capped at whatever is on hand — a shortage just means
 * production/consumption net out lower, it never goes negative.
 */
export async function applyProductionTick(
  holder: ResourceHolder,
  industry: string,
  scale: number,
): Promise<{ produced: ResourceStock[]; consumed: ResourceStock[] }> {
  const profile = profileFor(industry);
  const produced: ResourceStock[] = [];
  const consumed: ResourceStock[] = [];

  for (const [type, rate] of Object.entries(profile.produces) as [ResourceType, number][]) {
    const amount = Math.round(rate * scale);
    if (amount <= 0) continue;
    await adjustQuantity(holder, type, amount);
    produced.push({ resourceType: type, quantity: amount });
  }

  for (const [type, rate] of Object.entries(profile.consumes) as [ResourceType, number][]) {
    const amount = Math.round(rate * scale);
    if (amount <= 0) continue;
    const before = await getQuantity(holder, type);
    const after = await adjustQuantity(holder, type, -amount);
    consumed.push({ resourceType: type, quantity: before - after });
  }

  return { produced, consumed };
}

/** Applies decay to perishable resources for a holder. Call once per tick. */
export async function applyDecay(holder: ResourceHolder): Promise<void> {
  const stock = await getInventory(holder);
  for (const { resourceType, quantity } of stock) {
    const def = RESOURCE_DEFINITIONS[resourceType];
    if (!def.perishable || quantity <= 0) continue;
    const loss = Math.round(quantity * def.decayRate);
    if (loss > 0) await adjustQuantity(holder, resourceType, -loss);
  }
}

export function quoteValue(resourceType: ResourceType, quantity: number): number {
  return RESOURCE_DEFINITIONS[resourceType].baseValue * quantity;
}
