/**
 * Housing Engine — Property & Rental Market
 *
 * Location-level price/rent indices (driven by the same GDP/employment
 * signals as everything else in this layer), plus per-character housing
 * status: whether she rents, owns, or is between places, and what it
 * costs her monthly. banking-engine.ts's accounts are what monthly_cost
 * actually gets drawn from; employment-engine.ts's wage levels are what
 * housing affordability gets compared against.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import { withdraw }      from './banking-engine';

export type HousingStatus = 'renting' | 'owns' | 'unhoused';

export interface HousingMarket {
  location_id:   string;
  price_index:   number;
  rent_index:    number;
  vacancy_rate:  number;
}

export interface CharacterHousing {
  character_id:  string;
  location_id:   string | null;
  status:        HousingStatus;
  monthly_cost:  number;
}

// ── Public: Tick ───────────────────────────────────────────────────────────────

/**
 * Drift the location's price/rent indices. Tight labor markets and low
 * unemployment (employment-engine.ts / economy.ts) push both up; a glut of
 * vacancies pulls rent down toward what tenants can actually pay.
 */
export async function runHousingTick(locationId: string): Promise<HousingMarket> {
  const market = await getOrInitHousingMarket(locationId);

  const { data: econ } = await supabaseAdmin
    .from('location_economy')
    .select('unemployment')
    .eq('location_id', locationId)
    .maybeSingle();

  const laborHealth = (50 - (econ?.unemployment ?? 8)) / 50;
  const vacancyPressure = (0.06 - market.vacancy_rate) * 2; // low vacancy pushes rent up

  const priceDrift = round2(market.price_index * (laborHealth * 0.01 + (Math.random() - 0.5) * 0.01));
  const rentDrift  = round2(market.rent_index * (vacancyPressure * 0.5 + (Math.random() - 0.5) * 0.008));
  const vacancyDrift = round4((Math.random() - 0.5) * 0.01 - laborHealth * 0.002);

  const updated: HousingMarket = {
    location_id:  locationId,
    price_index:  Math.max(30, market.price_index + priceDrift),
    rent_index:   Math.max(30, market.rent_index + rentDrift),
    vacancy_rate: clamp(market.vacancy_rate + vacancyDrift, 0.01, 0.25),
  };

  await supabaseAdmin
    .from('housing_market')
    .update({
      price_index:  round2(updated.price_index),
      rent_index:   round2(updated.rent_index),
      vacancy_rate: round4(updated.vacancy_rate),
      updated_at:   new Date().toISOString(),
    })
    .eq('location_id', locationId);

  if (Math.abs(rentDrift) / market.rent_index >= 0.03) {
    const { data: loc } = await supabaseAdmin.from('world_locations').select('name').eq('id', locationId).maybeSingle();
    await supabaseAdmin.from('economic_events').insert({
      event_type:  rentDrift > 0 ? 'rent_spike' : 'rent_relief',
      title:       rentDrift > 0 ? 'Rent Climbs Sharply' : 'Rent Eases Up',
      description: rentDrift > 0
        ? `Rent in ${loc?.name ?? 'the area'} has jumped noticeably — tenants are feeling squeezed.`
        : `Rent in ${loc?.name ?? 'the area'} has eased a bit — a rare break for tenants.`,
      location_id: locationId,
      severity: 2,
    }).then(({ error }) => {
      if (error) logger.warn('housing-engine:log-event-failed', { locationId, error });
    });
  }

  return updated;
}

// ── Public: Character housing ─────────────────────────────────────────────────

export async function getOrInitCharacterHousing(characterId: string, locationId?: string): Promise<CharacterHousing> {
  const { data: existing } = await supabaseAdmin
    .from('character_housing')
    .select('*')
    .eq('character_id', characterId)
    .maybeSingle();

  if (existing) return existing as CharacterHousing;

  const market = locationId ? await getOrInitHousingMarket(locationId) : null;
  const monthlyCost = market ? Math.round(market.rent_index * 12) : 1400;

  const { data: created } = await supabaseAdmin
    .from('character_housing')
    .upsert(
      { character_id: characterId, location_id: locationId ?? null, status: 'renting', monthly_cost: monthlyCost },
      { onConflict: 'character_id' },
    )
    .select('*')
    .maybeSingle();

  return (created as CharacterHousing) ?? { character_id: characterId, location_id: locationId ?? null, status: 'renting', monthly_cost: monthlyCost };
}

/** Charge monthly housing cost against a character's bank account. Falling behind can eventually flip them to unhoused. */
export async function chargeMonthlyHousing(characterId: string): Promise<{ paid: boolean }> {
  const housing = await getOrInitCharacterHousing(characterId);
  if (housing.status === 'unhoused' || housing.monthly_cost <= 0) return { paid: true };

  const paid = await withdraw(characterId, housing.monthly_cost);
  if (!paid) {
    logger.info('housing-engine:missed-payment', { characterId });
  }
  return { paid };
}

export async function setHousingStatus(
  characterId: string,
  status: HousingStatus,
  monthlyCost: number,
): Promise<void> {
  await supabaseAdmin
    .from('character_housing')
    .update({ status, monthly_cost: monthlyCost, updated_at: new Date().toISOString() })
    .eq('character_id', characterId)
    .then(({ error }) => {
      if (error) logger.warn('housing-engine:set-status-failed', { characterId, error });
    });
}

// ── Public: Prompt Formatter ───────────────────────────────────────────────────

export async function formatHousingForPrompt(characterId: string): Promise<string> {
  const housing = await getOrInitCharacterHousing(characterId);

  if (housing.status === 'unhoused') {
    return '[Housing]\nHousing is genuinely unstable right now — this colors a lot more than it gets mentioned directly.';
  }
  if (housing.status === 'owns') return '';

  const market = housing.location_id ? await getHousingMarket(housing.location_id) : null;
  if (market && housing.monthly_cost > market.rent_index * 15) {
    return '[Housing]\nRent takes a real bite out of the budget most months — it\'s a quiet, ongoing pressure.';
  }
  return '';
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function getHousingMarket(locationId: string): Promise<HousingMarket | null> {
  const { data, error } = await supabaseAdmin
    .from('housing_market')
    .select('*')
    .eq('location_id', locationId)
    .maybeSingle();

  if (error || !data) return null;
  return data as HousingMarket;
}

async function getOrInitHousingMarket(locationId: string): Promise<HousingMarket> {
  const existing = await getHousingMarket(locationId);
  if (existing) return existing;

  const fresh: HousingMarket = { location_id: locationId, price_index: 100, rent_index: 100, vacancy_rate: 0.06 };
  await supabaseAdmin
    .from('housing_market')
    .upsert({ ...fresh, updated_at: new Date().toISOString() }, { onConflict: 'location_id', ignoreDuplicates: true });

  return fresh;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

function round4(val: number): number {
  return Math.round(val * 10000) / 10000;
}
