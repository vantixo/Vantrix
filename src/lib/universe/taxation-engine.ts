/**
 * Taxation Engine — Tax Policy, Collection, Treasury
 *
 * Tax rates live per-location (set here, nudged occasionally by governance
 * approval the way real policy responds to political pressure), and every
 * collection writes both a tax_records row (auditable, per-character) and
 * increments the location's treasury — which governance.ts / economy.ts
 * can eventually spend down, though that spending isn't modeled here.
 * banking-engine.ts's accounts are the source pulled from for income tax;
 * market-engine.ts's prices are what sales tax is computed against.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import { withdraw, deposit } from './banking-engine';

export interface TaxPolicy {
  location_id:       string;
  income_tax_rate:   number;
  sales_tax_rate:    number;
  treasury:          number;
}

// ── Public: Policy ─────────────────────────────────────────────────────────────

export async function getOrInitTaxPolicy(locationId: string): Promise<TaxPolicy> {
  const { data: existing } = await supabaseAdmin
    .from('tax_policies')
    .select('*')
    .eq('location_id', locationId)
    .maybeSingle();

  if (existing) return existing as TaxPolicy;

  const { data: created } = await supabaseAdmin
    .from('tax_policies')
    .upsert({ location_id: locationId }, { onConflict: 'location_id' })
    .select('*')
    .maybeSingle();

  return (created as TaxPolicy) ?? { location_id: locationId, income_tax_rate: 0.18, sales_tax_rate: 0.07, treasury: 0 };
}

/**
 * Nudge rates toward whatever governance's approval rating implies —
 * unpopular governments under pressure tend to cut visible taxes; stable,
 * high-approval ones can afford small increases. Called on the same slow
 * cadence as governance_tick, not every economy tick.
 */
export async function runTaxPolicyTick(locationId: string): Promise<TaxPolicy> {
  const policy = await getOrInitTaxPolicy(locationId);
  const { data: gov } = await supabaseAdmin
    .from('city_governance')
    .select('approval_rating')
    .eq('location_id', locationId)
    .maybeSingle();

  const approval = gov?.approval_rating ?? 55;
  const pressure = (approval - 50) / 1000; // small, slow effect

  const incomeTaxRate = clamp(policy.income_tax_rate + pressure, 0.05, 0.45);
  const salesTaxRate  = clamp(policy.sales_tax_rate + pressure * 0.5, 0.02, 0.20);

  const { data: updated } = await supabaseAdmin
    .from('tax_policies')
    .update({ income_tax_rate: round4(incomeTaxRate), sales_tax_rate: round4(salesTaxRate), updated_at: new Date().toISOString() })
    .eq('location_id', locationId)
    .select('*')
    .maybeSingle();

  return (updated as TaxPolicy) ?? policy;
}

// ── Public: Collection ───────────────────────────────────────────────────────

/** Collect income tax on a wage/income event for a character. Returns the net amount after tax. */
export async function collectIncomeTax(
  characterId: string,
  locationId:  string,
  grossAmount: number,
): Promise<{ net: number; taxPaid: number }> {
  const policy = await getOrInitTaxPolicy(locationId);
  const taxPaid = round2(grossAmount * policy.income_tax_rate);
  const net = round2(grossAmount - taxPaid);

  await recordCollection(characterId, locationId, 'income', taxPaid);
  return { net, taxPaid };
}

/** Collect sales tax on a purchase. Withdraws price + tax from the character's account if funds allow. */
export async function collectSalesTax(
  characterId: string,
  locationId:  string,
  purchaseAmount: number,
): Promise<{ success: boolean; taxPaid: number }> {
  const policy = await getOrInitTaxPolicy(locationId);
  const taxPaid = round2(purchaseAmount * policy.sales_tax_rate);
  const total = purchaseAmount + taxPaid;

  const success = await withdraw(characterId, total);
  if (!success) return { success: false, taxPaid: 0 };

  await recordCollection(characterId, locationId, 'sales', taxPaid);
  return { success: true, taxPaid };
}

// ── Public: Read ───────────────────────────────────────────────────────────────

export async function getTaxHistory(characterId: string, limit = 12): Promise<
  { tax_type: string; amount: number; period: string }[]
> {
  const { data, error } = await supabaseAdmin
    .from('tax_records')
    .select('tax_type, amount, period')
    .eq('character_id', characterId)
    .order('recorded_at', { ascending: false })
    .limit(limit);

  if (error) return [];
  return data ?? [];
}

// ── Public: Prompt Formatter ───────────────────────────────────────────────────

export async function formatTaxationForPrompt(locationId: string): Promise<string> {
  const policy = await getOrInitTaxPolicy(locationId);
  if (policy.income_tax_rate < 0.25 && policy.sales_tax_rate < 0.10) return '';

  return `[Local Taxes]\nTaxes here run ${policy.income_tax_rate >= 0.3 ? 'notably high' : 'a bit above average'} — it's a real topic people grumble about.`;
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function recordCollection(
  characterId: string,
  locationId:  string,
  taxType:     'income' | 'sales',
  amount:      number,
): Promise<void> {
  if (amount <= 0) return;

  const period = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

  await supabaseAdmin.from('tax_records').insert({
    character_id: characterId,
    location_id:  locationId,
    tax_type:     taxType,
    amount,
    period,
  }).then(({ error }) => {
    if (error) logger.warn('taxation-engine:record-failed', { characterId, locationId, error });
  });

  const { data: policy } = await supabaseAdmin.from('tax_policies').select('treasury').eq('location_id', locationId).maybeSingle();
  await supabaseAdmin
    .from('tax_policies')
    .update({ treasury: round2((policy?.treasury ?? 0) + amount) })
    .eq('location_id', locationId)
    .then(({ error }) => {
      if (error) logger.warn('taxation-engine:treasury-update-failed', { locationId, error });
    });
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

// deposit is re-exported indirectly via collectIncomeTax's callers, who are
// expected to deposit the net amount themselves (income tax here only
// computes the split — it doesn't assume the gross amount already sat in
// the account, unlike sales tax which withdraws directly).
export { deposit };
