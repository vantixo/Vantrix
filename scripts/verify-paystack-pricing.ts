/**
 * verify-paystack-pricing.ts
 *
 * WHY THIS EXISTS:
 * initializePaystackTransaction() passes `amount` (sourced from the DB
 * `tiers.price_ngn` column, shown to users on the pricing/checkout page)
 * AND `plan` (a Paystack Plan code) in the same request. Per Paystack's own
 * documented behavior, when `plan` is present Paystack silently IGNORES the
 * `amount` field and charges whatever price is configured on that Plan in
 * the Paystack Dashboard instead.
 *
 * That means: if someone edits a tier's price in Supabase (or in the
 * Dashboard) without also updating the matching Paystack Plan's amount (or
 * vice versa), the price shown pre-checkout and the price actually charged
 * silently diverge. No error, no log — the user just gets charged a
 * different number than what they saw. This script catches that drift
 * before it reaches a real customer.
 *
 * USAGE:
 *   npx tsx scripts/verify-paystack-pricing.ts
 *
 * Requires PAYSTACK_SECRET_KEY, NEXT_PUBLIC_SUPABASE_URL, and
 * SUPABASE_SERVICE_ROLE_KEY in the environment (same as production).
 * Safe to run against production — read-only on both sides.
 */

import { createClient } from '@supabase/supabase-js';

const PAYSTACK_BASE = 'https://api.paystack.co';

const TIER_ENV_MAP: Record<string, string | undefined> = {
  spark:   process.env.PAYSTACK_PLAN_CODE_SPARK,
  basic:   process.env.PAYSTACK_PLAN_CODE_BASIC,
  premium: process.env.PAYSTACK_PLAN_CODE_PREMIUM,
  elite:   process.env.PAYSTACK_PLAN_CODE_ELITE,
  spark_annual:   process.env.PAYSTACK_PLAN_CODE_SPARK_ANNUAL,
  basic_annual:   process.env.PAYSTACK_PLAN_CODE_BASIC_ANNUAL,
  premium_annual: process.env.PAYSTACK_PLAN_CODE_PREMIUM_ANNUAL,
  elite_annual:   process.env.PAYSTACK_PLAN_CODE_ELITE_ANNUAL,
};

async function fetchPaystackPlan(planCode: string) {
  const res = await fetch(`${PAYSTACK_BASE}/plan/${planCode}`, {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
  });
  if (!res.ok) throw new Error(`Paystack plan fetch failed for ${planCode}: ${res.status}`);
  const json = await res.json();
  return json.data as { amount: number; name: string; currency: string };
}

async function main() {
  const missingEnv = ['PAYSTACK_SECRET_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
    .filter(k => !process.env[k]);
  if (missingEnv.length) {
    console.error(`Missing required env vars: ${missingEnv.join(', ')}`);
    process.exit(1);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );

  const { data: tiers, error } = await supabase
    .from('tiers')
    .select('slug,price_ngn,billing_interval,base_tier_slug');
  if (error) {
    console.error('Failed to read tiers table:', error.message);
    process.exit(1);
  }

  let mismatches = 0;
  let skipped = 0;

  for (const tier of tiers ?? []) {
    const planCode = TIER_ENV_MAP[tier.slug];
    if (!planCode) {
      console.log(`SKIP  ${tier.slug.padEnd(16)} — no Paystack plan code configured (one-off charge fallback)`);
      skipped++;
      continue;
    }

    try {
      const plan = await fetchPaystackPlan(planCode);
      const dbAmountKobo = Math.round((tier.price_ngn as number) * 100);
      if (plan.amount !== dbAmountKobo) {
        console.error(
          `MISMATCH ${tier.slug.padEnd(16)} DB=₦${tier.price_ngn} (${dbAmountKobo} kobo)  ` +
          `Paystack Plan(${planCode})=₦${plan.amount / 100} (${plan.amount} kobo)`
        );
        mismatches++;
      } else {
        console.log(`OK    ${tier.slug.padEnd(16)} ₦${tier.price_ngn} matches Paystack plan ${planCode}`);
      }
    } catch (err) {
      console.error(`ERROR ${tier.slug.padEnd(16)} — ${(err as Error).message}`);
      mismatches++;
    }
  }

  console.log(`\n${mismatches} mismatch(es), ${skipped} skipped (no plan code).`);
  if (mismatches > 0) {
    console.log(
      '\nFix by either updating the tier price in Supabase to match the ' +
      'Paystack Plan amount, or updating the Plan amount in the Paystack ' +
      'Dashboard to match the DB — whichever is the source of truth for ' +
      'your pricing. Do NOT leave them mismatched: users will always be ' +
      'charged the Plan amount, not the DB amount, whenever a plan code exists.'
    );
    process.exit(1);
  }
}

main();
