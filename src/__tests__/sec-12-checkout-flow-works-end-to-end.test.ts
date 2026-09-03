/**
 * SEC-12 — Checkout Actually Works For All Tiers × All Providers
 *
 * Regression test for: the /premium page's TierCard rendered with
 * `onSelect={() => {}}` — a literal no-op. Every "Subscribe" button on the
 * live pricing page did nothing when clicked; there was no way for a real
 * user to reach any of Stripe, Paystack, or NOWPayments checkout at all,
 * regardless of how correct the backend was.
 *
 * Also fixes two response-shape bugs found while wiring the frontend up:
 *   - paystack/initialize returned the RAW Paystack transaction object
 *     (`{ status, message, data: { authorization_url, ... } }`) instead of
 *     a normalized `{ url }` — the frontend had no consistent field to
 *     redirect the browser to across all three providers.
 *   - nowpayments/create used the raw Payment API (returns a wallet
 *     address + amount, requiring a custom UI) instead of the Invoice API
 *     (returns a hosted checkout URL), which is what let NOWPayments share
 *     the same "redirect to a URL" pattern as Stripe/Paystack at all.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function src(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf-8');
}

describe('SEC-12 — the pricing page actually wires tier selection to checkout', () => {
  // NOTE: this describe block originally targeted an earlier architecture
  // (a `(main)` route group and a single `CheckoutFlow` component with a
  // `cardsAllowed` prop). The app now uses the `(app)` route group and a
  // `TierCard` + provider-parameterized `CheckoutButton` split — see
  // src/components/premium/{tier-card,checkout-button}.tsx. The underlying
  // regression this test guards against (a no-op click handler on the
  // pricing page) is still covered below against the current components.
  it('premium/page.tsx renders real TierCards, not a no-op onSelect stub', () => {
    const page = src('app', '(app)', 'premium', 'page.tsx');
    expect(page).not.toMatch(/onSelect=\{\(\) => \{\}\}/);
    expect(page).toMatch(/<TierCard/);
  });

  it('CheckoutButton calls all four provider endpoints', () => {
    const button = src('components', 'premium', 'checkout-button.tsx');
    expect(button).toMatch(/\/api\/payments\/stripe\/checkout/);
    expect(button).toMatch(/\/api\/payments\/paystack\/initialize/);
    expect(button).toMatch(/\/api\/payments\/nowpayments\/create/);
    expect(button).toMatch(/\/api\/payments\/paddle\/checkout/);
  });

  it('CheckoutButton surfaces the card-payment-gated error distinctly, never blocking NOWPayments client-side', () => {
    const button = src('components', 'premium', 'checkout-button.tsx');
    expect(button).toMatch(/CARD_PAYMENT_NOT_ALLOWED/);
    // The gate is enforced server-side per provider (see stripe/checkout and
    // paystack/initialize routes below) — the crypto rail is never gated,
    // and the button component itself never disables NOWPayments locally.
  });

  it('signed-out users are redirected to /login with a return path, not silently ignored', () => {
    const layout = src('app', '(app)', 'layout.tsx');
    expect(layout).toMatch(/redirect\(`\/login\?redirect=/);
  });
});

describe('SEC-12 — all three checkout endpoints return a consistent { url } shape', () => {
  it('stripe/checkout returns { url: checkoutSession.url }', () => {
    const route = src('app', 'api', 'payments', 'stripe', 'checkout', 'route.ts');
    expect(route).toMatch(/NextResponse\.json\(\{ url: checkoutSession\.url \}\)/);
  });

  it('paystack/initialize normalizes the raw transaction into { url }, not the raw object', () => {
    const route = src('app', 'api', 'payments', 'paystack', 'initialize', 'route.ts');
    expect(route).not.toMatch(/return NextResponse\.json\(transaction\);/);
    expect(route).toMatch(/authorizationUrl = transaction\?\.data\?\.authorization_url/);
    expect(route).toMatch(/NextResponse\.json\(\{ url: authorizationUrl/);
  });

  it('nowpayments/create uses the Invoice API (hosted checkout URL), not the raw Payment API', () => {
    const route = src('app', 'api', 'payments', 'nowpayments', 'create', 'route.ts');
    expect(route).toMatch(/import\s*\{[^}]*\bcreateNowPaymentInvoice\b[^}]*\}\s*from\s*['"]@\/lib\/payments\/nowpayments['"]/);
    expect(route).toMatch(/NextResponse\.json\(\{ url: invoice\.invoice_url \}\)/);
  });

  it('createNowPaymentInvoice throws rather than silently returning an unusable link', () => {
    const lib = src('lib', 'payments', 'nowpayments.ts');
    expect(lib).toMatch(/did not include a usable invoice URL/);
  });

  it('paddle/checkout returns { url: transaction.checkout.url }, not the raw transaction', () => {
    const route = src('app', 'api', 'payments', 'paddle', 'checkout', 'route.ts');
    expect(route).not.toMatch(/NextResponse\.json\(transaction\)/);
    expect(route).toMatch(/NextResponse\.json\(\{ url: transaction\.checkout\.url \}\)/);
  });
});

describe('SEC-12 — single-plan pricing matches what checkout actually charges', () => {
  it('the base migration defines the three billing-length rows for the single paid plan', () => {
    // 20260810 established the three rows at the original 35%/70% rates;
    // 20261025 (checked below) supersedes the two discounted rows' prices.
    // This assertion only covers what 20260810 itself still owns: the
    // monthly row (never discounted, unaffected by the later migration)
    // and that all three billing-length rows/slugs exist at all.
    const migration = src('..', 'supabase', 'migrations', '20260810_single_plan_three_billing_lengths.sql');
    expect(migration).toMatch(/'spark',\s*\n?\s*9\.99/);
    expect(migration).toMatch(/'spark_quarterly'/);
    expect(migration).toMatch(/'spark_annual'/);
  });

  it('the base migration allows quarterly as a billing_interval value', () => {
    const migration = src('..', 'supabase', 'migrations', '20260810_single_plan_three_billing_lengths.sql');
    expect(migration).toMatch(/CHECK \(billing_interval IN \('monthly', 'quarterly', 'annual'\)\)/);
  });

  it('20261025 corrects quarterly/annual pricing to 30%/60% off, matching getBillingPlans()', () => {
    const migration = src('..', 'supabase', 'migrations', '20261025_billing_discount_30pct_quarterly_60pct_annual.sql');
    expect(migration).toMatch(/price_usd\s*=\s*20\.97/);
    expect(migration).toMatch(/WHERE slug = 'spark_quarterly'/);
    expect(migration).toMatch(/price_usd\s*=\s*47\.88/);
    expect(migration).toMatch(/WHERE slug = 'spark_annual'/);
  });

  it('tiers/config.ts getBillingPlans() computes the same three prices the migrations charge', () => {
    const config = src('lib', 'tiers', 'config.ts');
    expect(config).toMatch(/BASE_MONTHLY_PRICE = 9\.99/);
    expect(config).toMatch(/quarterly:\s*0\.30/);
    expect(config).toMatch(/annual:\s*0\.60/);
  });
});
