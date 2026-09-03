/**
 * SEC-14 — Paddle Billing Wiring: Signature Verification, Idempotency,
 * Soft-Degradation On Unconfigured Prices, Schema
 *
 * Paddle is the second card/Merchant-of-Record rail (alongside Stripe),
 * offered specifically for international subscribers — see
 * components/premium/tier-card.tsx and lib/payments/paddle.ts's header for
 * the rationale. This file guards the specific bugs a Paddle integration is
 * most likely to introduce:
 *
 *   - a webhook signature check that isn't actually constant-time /
 *     actually verifies the HMAC before trusting the payload
 *   - a duplicate-delivery race (see webhook-claim.ts — same class of bug
 *     the atomic claim pattern was introduced to fix for Stripe/Paystack)
 *   - a missing price id silently falling through to an incorrect charge
 *     instead of a clear 400
 *   - the DB schema not actually accepting 'paddle' as a provider value
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function src(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf-8');
}

describe('SEC-14 — Paddle webhook signature verification', () => {
  it('verifyPaddleWebhookSignature parses the ts=...;h1=... header format', () => {
    const lib = src('lib', 'payments', 'paddle.ts');
    expect(lib).toMatch(/ts=\(\\d\+\)\;h1=/);
  });

  it('verifyPaddleWebhookSignature signs `${ts}:${rawBody}`, not the raw body alone', () => {
    const lib = src('lib', 'payments', 'paddle.ts');
    expect(lib).toMatch(/`\$\{ts\}:\$\{rawBody\}`/);
  });

  it('verifyPaddleWebhookSignature uses a constant-time comparison, not ===', () => {
    const lib = src('lib', 'payments', 'paddle.ts');
    expect(lib).toMatch(/timingSafeEqual\(/);
    // regression guard against the obvious insecure shortcut
    expect(lib).not.toMatch(/expected === h1/);
    expect(lib).not.toMatch(/h1 === expected/);
  });

  it('verifyPaddleWebhookSignature rejects a stale timestamp rather than trusting HMAC alone', () => {
    const lib = src('lib', 'payments', 'paddle.ts');
    expect(lib).toMatch(/toleranceSeconds/);
  });

  it('the webhook route verifies the signature before JSON.parse-ing the body', () => {
    const route = src('app', 'api', 'payments', 'paddle', 'webhook', 'route.ts');
    const verifyIdx = route.indexOf('verifyPaddleWebhookSignature(');
    const parseIdx  = route.indexOf('JSON.parse(rawBody)');
    expect(verifyIdx).toBeGreaterThan(-1);
    expect(parseIdx).toBeGreaterThan(verifyIdx);
  });
});

describe('SEC-14 — Paddle webhook idempotency uses the atomic claim, not select-then-insert', () => {
  it('imports claimWebhookEvent/releaseWebhookEvent from the shared helper', () => {
    const route = src('app', 'api', 'payments', 'paddle', 'webhook', 'route.ts');
    expect(route).toMatch(/import\s*\{[^}]*\bclaimWebhookEvent\b[^}]*\breleaseWebhookEvent\b[^}]*\}\s*from\s*['"]@\/lib\/payments\/webhook-claim['"]/);
  });

  it('claims the event before running any business logic', () => {
    const route = src('app', 'api', 'payments', 'paddle', 'webhook', 'route.ts');
    const claimIdx     = route.indexOf('claimWebhookEvent(event.event_id');
    const activateIdx  = route.indexOf('await activatePaddleSubscription({');
    expect(claimIdx).toBeGreaterThan(-1);
    expect(activateIdx).toBeGreaterThan(claimIdx);
  });

  it('a duplicate claim short-circuits with { duplicate: true } rather than reprocessing', () => {
    const route = src('app', 'api', 'payments', 'paddle', 'webhook', 'route.ts');
    expect(route).toMatch(/if \(!claim\.claimed\) \{\s*\n\s*return NextResponse\.json\(\{ received: true, duplicate: true \}\)/);
  });

  it('releases the claim on processing failure so a legitimate Paddle retry can re-enter', () => {
    const route = src('app', 'api', 'payments', 'paddle', 'webhook', 'route.ts');
    expect(route).toMatch(/catch \(err: unknown\) \{[\s\S]*releaseWebhookEvent\(event\.event_id\)/);
  });

  it("WebhookProvider's union includes 'paddle'", () => {
    const lib = src('lib', 'payments', 'webhook-claim.ts');
    expect(lib).toMatch(/export type WebhookProvider = [^;]*'paddle'/);
  });
});

describe('SEC-14 — an unconfigured Paddle price degrades to a clear 400, never a wrong charge', () => {
  it('priceIdForTier returns undefined rather than throwing or guessing for an unrecognized tier', () => {
    const lib = src('lib', 'payments', 'paddle-plans.ts');
    expect(lib).toMatch(/return undefined/);
  });

  it('paddle/checkout returns PADDLE_PRICE_NOT_CONFIGURED (400) rather than proceeding without a price id', () => {
    const route = src('app', 'api', 'payments', 'paddle', 'checkout', 'route.ts');
    const priceIdx  = route.indexOf('priceIdForTier(');
    const errIdx    = route.indexOf("code:  'PADDLE_PRICE_NOT_CONFIGURED'");
    expect(priceIdx).toBeGreaterThan(-1);
    expect(errIdx).toBeGreaterThan(priceIdx);
    expect(route).toMatch(/status: 400 \}\);\s*\n\s*\}\s*\n\s*\n\s*\/\/ Paddle requires an email/);
  });
});

describe('SEC-14 — Paddle checkout is gated identically to Stripe/Paystack, and the referral-discount gap is explicit', () => {
  it('checkout route checks for a stored profile.paddle_customer_id before creating a new Paddle customer', () => {
    const route = src('app', 'api', 'payments', 'paddle', 'checkout', 'route.ts');
    expect(route).toMatch(/paddle_customer_id/);
    expect(route).toMatch(/getOrCreatePaddleCustomer\(/);
  });

  it('does NOT silently apply a referral discount it has not actually implemented', () => {
    const route = src('app', 'api', 'payments', 'paddle', 'checkout', 'route.ts');
    // Flags the gap in a comment rather than calling an unverified/guessed
    // Paddle Discounts API — see this file's own header for the reasoning.
    expect(route).toMatch(/NOT yet wired for\s*\n\s*\/\/ Paddle/);
    expect(route).not.toMatch(/createPaddleDiscount/);
  });
});

describe('SEC-14 — schema actually accepts Paddle as a provider', () => {
  // Filename carries a "01" sequence suffix, not the plain YYYYMMDD form —
  // 20260820 already had 2026082000_fix_can_send_message_rpc.sql, so this
  // one was numbered 2026082001 to avoid a same-day collision. Renamed
  // here (not the migration file) since this migration is already applied
  // to the live project — Supabase tracks applied migrations by filename,
  // so renaming it after the fact would make `supabase db push` treat a
  // real, already-applied migration as new.
  it('the Paddle migration adds paddle to the subscriptions.provider CHECK constraint', () => {
    const migration = src('..', 'supabase', 'migrations', '2026082001_paddle_billing_schema.sql');
    expect(migration).toMatch(/CHECK \(provider IN \('stripe', 'paystack', 'nowpayments', 'paddle'\)\)/);
  });

  it('the Paddle migration adds paddle to the processed_webhooks.provider CHECK constraint', () => {
    const migration = src('..', 'supabase', 'migrations', '2026082001_paddle_billing_schema.sql');
    expect(migration).toMatch(/CHECK \(provider IN \('stripe', 'paystack', 'nowpayments', 'fal_lora', 'paddle'\)\)/);
  });

  it('adds profiles.paddle_customer_id and subscriptions.paddle_subscription_id columns', () => {
    const migration = src('..', 'supabase', 'migrations', '2026082001_paddle_billing_schema.sql');
    expect(migration).toMatch(/ALTER TABLE profiles\s*\n\s*ADD COLUMN IF NOT EXISTS paddle_customer_id TEXT/);
    expect(migration).toMatch(/ALTER TABLE subscriptions\s*\n\s*ADD COLUMN IF NOT EXISTS paddle_subscription_id TEXT/);
  });

  it('types/supabase.ts declares the two new columns on profiles and subscriptions', () => {
    const types = src('types', 'supabase.ts');
    expect(types).toMatch(/paddle_customer_id: string \| null/);
    expect(types).toMatch(/paddle_subscription_id: string \| null/);
  });
});

describe('SEC-14 — Paddle billing management (Stripe-portal equivalent)', () => {
  it('the manage route resolves management_urls rather than exposing the raw Paddle subscription object', () => {
    const route = src('app', 'api', 'billing', 'paddle', 'manage', 'route.ts');
    expect(route).toMatch(/manageUrl: subscription\.management_urls\.update_payment_method/);
    expect(route).toMatch(/cancelUrl: subscription\.management_urls\.cancel/);
  });

  it('subscription-management.tsx branches on provider === "paddle" with its own manage/cancel actions', () => {
    const component = src('components', 'profile', 'subscription-management.tsx');
    expect(component).toMatch(/subscription\.provider === "paddle"/);
    expect(component).toMatch(/\/api\/billing\/paddle\/manage/);
  });
});
