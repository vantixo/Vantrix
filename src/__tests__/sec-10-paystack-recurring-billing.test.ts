/**
 * SEC-10 — Paystack Recurring Billing
 *
 * Regression tests for: initializePaystackTransaction() never passed a
 * `plan` parameter, so Paystack only ever ran one-off charges — never an
 * actual managed Subscription. expires_at was hand-set to now()+30 days at
 * payment time and nothing ever extended it; there was no automatic renewal
 * mechanism at all (confirmed by reading the code directly, not assumed).
 *
 * Fix has three parts, each tested below:
 *   1. initializePaystackTransaction now accepts and forwards `plan`.
 *   2. Renewal charges are resolved via customer_code (Paystack's own
 *      stable identifier), never via app-supplied metadata — Paystack does
 *      not document or guarantee metadata survives onto subscription-driven
 *      renewal charges.
 *   3. A cron safety net (api/cron/paystack-renewal) exists as the
 *      authoritative renewal mechanism, since Paystack's own docs confirm
 *      subscriptions are never auto-retried on a failed charge attempt.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function src(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf-8');
}

describe('SEC-10 — checkout creates a real Paystack Subscription, not a one-off charge', () => {
  it('initializePaystackTransaction forwards an optional plan code to Paystack', () => {
    const lib = src('lib', 'payments', 'paystack.ts');
    expect(lib).toMatch(/plan\?:\s*string/);
    expect(lib).toMatch(/\.\.\.\(plan \? \{ plan \} : \{\}\)/);
  });

  it('the initialize route passes planCodeForTier() through to checkout', () => {
    const route = src('app', 'api', 'payments', 'paystack', 'initialize', 'route.ts');
    expect(route).toMatch(/import\s*\{[^}]*\bplanCodeForTier\b[^}]*\}\s*from\s*['"]@\/lib\/payments\/paystack-plans['"]/);
    expect(route).toMatch(/plan:\s*planCodeForTier\(baseTierSlug/);
  });

  it('plan codes are sourced from env vars, not hardcoded', () => {
    // SINGLE-PLAN MODEL: only one paid plan ('spark') exists now, sold at
    // three billing lengths — was one env var per tier (spark/basic/
    // premium/elite), now one per billing length.
    const plans = src('lib', 'payments', 'paystack-plans.ts');
    expect(plans).toMatch(/env\.PAYSTACK_PLAN_CODE_SPARK\b/);
    expect(plans).toMatch(/env\.PAYSTACK_PLAN_CODE_SPARK_QUARTERLY/);
    expect(plans).toMatch(/env\.PAYSTACK_PLAN_CODE_SPARK_ANNUAL/);
  });
});

describe('SEC-10 — renewals resolve via customer_code, never via fragile metadata', () => {
  it('resolveUserId() tries metadata first, then falls back to a customer_code DB lookup', () => {
    const route = src('app', 'api', 'payments', 'paystack', 'verify', 'route.ts');
    expect(route).toMatch(/async function resolveUserId/);
    expect(route).toMatch(/eq\('paystack_customer_code', customerCode\)/);
  });

  it('customer_code is captured onto the profile on every successful charge', () => {
    const route = src('app', 'api', 'payments', 'paystack', 'verify', 'route.ts');
    expect(route).toMatch(/paystack_customer_code:\s*customerCode/);
  });

  it('charge.success handling does not require metadata to be present (renewals may lack it)', () => {
    const route = src('app', 'api', 'payments', 'paystack', 'verify', 'route.ts');
    // The old buggy version explicitly required metadata.userId/tier and
    // no-op'd otherwise — that's exactly what made renewals silently fail.
    expect(route).not.toMatch(/if \(!reference \|\| !metadata\?\.userId \|\| !metadata\?\.tier\)/);
  });

  it('field extraction is defensive against multiple possible Paystack payload shapes', () => {
    const route = src('app', 'api', 'payments', 'paystack', 'verify', 'route.ts');
    expect(route).toMatch(/function extractPlanAndSubscriptionCodes/);
    // Checks at least: plan as a string, plan as an object with plan_code,
    // and plan_object.plan_code — not a single assumed shape.
    expect(route).toMatch(/typeof data\.plan === 'string'/);
    expect(route).toMatch(/data\.plan_object\?\.plan_code/);
  });
});

describe('SEC-10 — subscription.disable downgrades the user (explicit cancellation)', () => {
  it('the webhook handles subscription.disable, mirroring Stripe customer.subscription.deleted', () => {
    const route = src('app', 'api', 'payments', 'paystack', 'verify', 'route.ts');
    expect(route).toMatch(/event\.event === 'subscription\.disable'/);
    expect(route).toMatch(/tier: 'free'/);
  });
});

describe('SEC-10 — cron safety net is the authoritative renewal mechanism', () => {
  it('the cron exists and requires CRON_SECRET auth', () => {
    const cron = src('app', 'api', 'cron', 'paystack-renewal', 'route.ts');
    expect(cron).toMatch(/requireCronAuth\(req, env\.CRON_SECRET\)/);
  });

  it('the cron renews via stored authorization_code, independent of webhook field-shape guessing', () => {
    const cron = src('app', 'api', 'cron', 'paystack-renewal', 'route.ts');
    expect(cron).toMatch(/import\s*\{[^}]*\bchargeAuthorization\b[^}]*\}\s*from\s*['"]@\/lib\/payments\/paystack['"]/);
    expect(cron).toMatch(/paystack_authorization_code/);
  });

  it('the cron is registered — natively on CRON_TIER=pro, or via the free-tier GitHub Actions workflow otherwise', () => {
    // CRON_TIERS.md: paystack-renewal runs every 6h, which is sub-daily —
    // on CRON_TIER=free (this repo's checked-in default, see that doc)
    // scripts/generate-vercel-json.mjs deliberately excludes anything
    // more frequent than once/day from vercel.json's crons array (Vercel
    // Hobby's own hard cap) and instead emits it into
    // .github/workflows/vantrix-free-tier-crons.yml, hitting the same
    // requireCronAuth()-gated route on the same schedule from an external
    // caller. Checking vercel.json alone made this test tier-blind and
    // false-failing on a correctly-generated free-tier build; it should
    // pass on whichever of the two the current tier actually produces.
    const vercelJson = JSON.parse(src('..', 'vercel.json'));
    const cronPaths = (vercelJson.crons as Array<{ path: string }>).map(c => c.path);
    const inVercelJson = cronPaths.includes('/api/cron/paystack-renewal');

    const workflow = readFileSync(
      join(__dirname, '..', '..', '.github', 'workflows', 'vantrix-free-tier-crons.yml'),
      'utf-8'
    );
    const inFreeTierWorkflow = workflow.includes('/api/cron/paystack-renewal');

    expect(inVercelJson || inFreeTierWorkflow).toBe(true);
  });

  it('a subscription with no stored authorization_code is skipped, not crashed on', () => {
    const cron = src('app', 'api', 'cron', 'paystack-renewal', 'route.ts');
    expect(cron).toMatch(/if \(!sub\.paystack_authorization_code\)/);
  });
});

describe('SEC-10b — annual billing does not silently downgrade to a 30-day expiry', () => {
  it('activatePaystackSubscription sets expires_at from an interval-aware map, not a hardcoded 30 days', () => {
    const route = src('app', 'api', 'payments', 'paystack', 'verify', 'route.ts');
    expect(route).toMatch(/EXPIRY_DAYS.*Record<'monthly' \| 'quarterly' \| 'annual', number>/);
    expect(route).toMatch(/annual:\s*365/);
    expect(route).toMatch(/quarterly:\s*90/);
    expect(route).not.toMatch(/new Date\(Date\.now\(\) \+ 30 \* 24 \* 60 \* 60 \* 1000\)/);
  });

  it('tierForPlanCode returns both tier and interval, never a bare tier string', () => {
    const plans = src('lib', 'payments', 'paystack-plans.ts');
    expect(plans).toMatch(/tier: string; interval: 'monthly' \| 'quarterly' \| 'annual' \}/);
  });

  it('planCodeForTier resolves separate quarterly and annual plan codes, sourced from env vars', () => {
    const plans = src('lib', 'payments', 'paystack-plans.ts');
    expect(plans).toMatch(/env\.PAYSTACK_PLAN_CODE_SPARK_QUARTERLY/);
    expect(plans).toMatch(/env\.PAYSTACK_PLAN_CODE_SPARK_ANNUAL/);
  });

  it('the renewal cron charges the price matching the subscription\'s actual billing_interval', () => {
    const cron = src('app', 'api', 'cron', 'paystack-renewal', 'route.ts');
    // Old bug: always looked up `sub.tier` (the base/monthly slug) even for
    // annual subscribers, which would retry-charge them the monthly price.
    expect(cron).toMatch(/priceSlug/);
    expect(cron).toMatch(/interval === 'annual' \? `\$\{sub\.tier\}_annual` : interval === 'quarterly' \? `\$\{sub\.tier\}_quarterly` : sub\.tier/);
  });

  it('the renewal cron sets a 365-day expiry for annual subscriptions, not 30', () => {
    const cron = src('app', 'api', 'cron', 'paystack-renewal', 'route.ts');
    expect(cron).toMatch(/renewalDays\s*=\s*interval === 'annual' \? 365 : interval === 'quarterly' \? 90 : 30/);
  });

  it('checkout metadata carries the base tier slug (never a "_annual" suffixed one) so profiles.tier stays a valid gating value', () => {
    const route = src('app', 'api', 'payments', 'paystack', 'initialize', 'route.ts');
    expect(route).toMatch(/baseTierSlug/);
    expect(route).toMatch(/tier:\s*baseTierSlug/);
  });
});
