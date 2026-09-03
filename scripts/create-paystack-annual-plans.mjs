#!/usr/bin/env node
/**
 * Creates the four annual Paystack subscription plans (Spark, Basic, Premium,
 * Elite) via the Paystack API and prints the resulting PLN_xxx codes to paste
 * into your .env as PAYSTACK_PLAN_CODE_{TIER}_ANNUAL.
 *
 * Why this exists: Paystack plans are interval-specific — a plan is created
 * as either monthly or annual and can never be both — so the four existing
 * monthly plan codes (PAYSTACK_PLAN_CODE_SPARK etc.) cannot be reused for
 * annual billing. lib/payments/paystack-plans.ts / paystack/initialize/
 * route.ts already know how to look up and use *_ANNUAL codes the moment
 * they exist in your env — this script is the only missing piece, since
 * plan codes can only be minted through Paystack's own API/Dashboard, never
 * invented by this codebase.
 *
 * Amounts are pulled live from your `tiers` table's '_annual' rows (in kobo,
 * i.e. price_ngn * 100) — the exact figures reconciled by
 * supabase/migrations/20260722_reconcile_ngn_crypto_pricing.sql — so this
 * script and your DB can never drift from each other. If those rows are
 * missing (annual billing migration not applied yet), run
 * `supabase db push` first.
 *
 * Usage:
 *   PAYSTACK_SECRET_KEY=sk_live_xxx \
 *   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=xxxx \
 *   node scripts/create-paystack-annual-plans.mjs
 *
 * (All three are already in your .env — this will pick them up automatically
 * if run via `node --env-file=.env scripts/create-paystack-annual-plans.mjs`
 * on Node 20.6+, or export them into your shell first.)
 *
 * Safe to re-run: Paystack has no "get or create" for plans, so re-running
 * will create duplicates if the same tier already has a code — check the
 * printed codes against your existing PAYSTACK_PLAN_CODE_*_ANNUAL env vars
 * before running again.
 */

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY        = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!PAYSTACK_SECRET_KEY) {
  console.error('Missing PAYSTACK_SECRET_KEY in environment.');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in environment.');
  process.exit(1);
}

const TIER_ENV_KEY = {
  spark:   'PAYSTACK_PLAN_CODE_SPARK_ANNUAL',
  basic:   'PAYSTACK_PLAN_CODE_BASIC_ANNUAL',
  premium: 'PAYSTACK_PLAN_CODE_PREMIUM_ANNUAL',
  elite:   'PAYSTACK_PLAN_CODE_ELITE_ANNUAL',
};

async function main() {
  // 1. Pull the four annual tier rows straight from Supabase — this is the
  //    same table paystack/initialize/route.ts charges against, so the
  //    amount we register with Paystack can never drift from what the app
  //    actually charges.
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tiers?billing_interval=eq.annual&select=name,slug,base_tier_slug,price_ngn`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  if (!res.ok) {
    console.error(`Failed to read tiers table: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const annualTiers = await res.json();
  if (!annualTiers.length) {
    console.error(
      "No annual rows found in `tiers`. Run `supabase db push` to apply " +
      "20260716_add_annual_billing.sql (and 20260722_reconcile_ngn_crypto_pricing.sql) first."
    );
    process.exit(1);
  }

  console.log(`Found ${annualTiers.length} annual tier rows. Creating Paystack plans...\n`);

  const results = [];
  for (const tier of annualTiers) {
    const baseSlug = tier.base_tier_slug ?? tier.slug;
    const envKey = TIER_ENV_KEY[baseSlug];
    if (!envKey) {
      console.warn(`Skipping unrecognized tier slug "${baseSlug}"`);
      continue;
    }

    const amountKobo = Math.round(Number(tier.price_ngn) * 100);

    const planRes = await fetch('https://api.paystack.co/plan', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name:        `${tier.name}`,
        amount:      amountKobo,
        interval:    'annually',
        currency:    'NGN',
        description: `Vantrix ${baseSlug} — annual billing, ₦${tier.price_ngn}/year`,
      }),
    });

    const planData = await planRes.json();
    if (!planRes.ok || !planData?.data?.plan_code) {
      console.error(`FAILED for ${baseSlug}: ${planRes.status} ${JSON.stringify(planData)}`);
      continue;
    }

    results.push({ baseSlug, envKey, planCode: planData.data.plan_code, amountKobo });
    console.log(`✓ ${baseSlug.padEnd(8)} → ${planData.data.plan_code}  (₦${tier.price_ngn}/year, ${amountKobo} kobo)`);
  }

  if (!results.length) {
    console.error('\nNo plans were created — see errors above.');
    process.exit(1);
  }

  console.log('\nPaste these into your .env:\n');
  for (const r of results) {
    console.log(`${r.envKey}=${r.planCode}`);
  }
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
