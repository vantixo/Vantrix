/**
 * SEC-09 — NSFW Accounts Are Card-Payment-Gated, NOWPayments Is Universal
 *
 * Policy: card processors (Stripe, Paystack) broadly prohibit payments for
 * accounts associated with adult content in their terms of service — a real
 * account-termination/chargeback risk, not a Vantrix-specific preference.
 * NOWPayments (crypto) carries no such restriction.
 *
 *   - profiles.nsfw_enabled = true  -> Stripe and Paystack refuse (403)
 *   - everyone, regardless of nsfw_enabled -> NOWPayments is available
 *
 * assertCardPaymentAllowed() fails closed: if the NSFW-status lookup itself
 * errors, card payment is refused rather than silently allowed.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function src(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf-8');
}

describe('SEC-09 — card rails check the NSFW gate, crypto never does', () => {
  it('stripe/checkout calls assertCardPaymentAllowed before creating a session', () => {
    const route = src('app', 'api', 'payments', 'stripe', 'checkout', 'route.ts');
    expect(route).toMatch(/import\s*\{[^}]*\bassertCardPaymentAllowed\b[^}]*\}\s*from\s*['"]@\/lib\/payments\/provider-gate['"]/);
    const gateIdx     = route.indexOf('assertCardPaymentAllowed(user.id)');
    expect(gateIdx).toBeGreaterThan(-1);
    const sessionIdx  = route.indexOf('createStripeCheckoutSession(', gateIdx);
    expect(sessionIdx).toBeGreaterThan(gateIdx);
  });

  it('stripe/trial calls assertCardPaymentAllowed before creating a trial session (BUG FIX: previously an inline nsfw_enabled check that failed OPEN on a DB lookup error, unlike the fail-closed shared helper)', () => {
    const route = src('app', 'api', 'payments', 'stripe', 'trial', 'route.ts');
    expect(route).toMatch(/import\s*\{[^}]*\bassertCardPaymentAllowed\b[^}]*\}\s*from\s*['"]@\/lib\/payments\/provider-gate['"]/);
    const gateIdx    = route.indexOf('assertCardPaymentAllowed(user.id)');
    expect(gateIdx).toBeGreaterThan(-1);
    const sessionIdx = route.indexOf('createFreeTrialSession(', gateIdx);
    expect(sessionIdx).toBeGreaterThan(gateIdx);
    // regression guard: the old fail-open inline check must not come back
    expect(route).not.toMatch(/profile\?\.nsfw_enabled === true/);
  });

  it('paystack/initialize calls assertCardPaymentAllowed before creating a transaction', () => {
    const route = src('app', 'api', 'payments', 'paystack', 'initialize', 'route.ts');
    expect(route).toMatch(/import\s*\{[^}]*\bassertCardPaymentAllowed\b[^}]*\}\s*from\s*['"]@\/lib\/payments\/provider-gate['"]/);
    const gateIdx = route.indexOf('assertCardPaymentAllowed(user.id)');
    expect(gateIdx).toBeGreaterThan(-1);
    const txIdx    = route.indexOf('initializePaystackTransaction(', gateIdx);
    expect(txIdx).toBeGreaterThan(gateIdx);
  });

  it('paddle/checkout calls assertCardPaymentAllowed before creating a checkout transaction (Paddle is a Merchant of Record and its AUP is treated as at least as restrictive as Stripe/Paystack — see provider-gate.ts header)', () => {
    const route = src('app', 'api', 'payments', 'paddle', 'checkout', 'route.ts');
    expect(route).toMatch(/import\s*\{[^}]*\bassertCardPaymentAllowed\b[^}]*\}\s*from\s*['"]@\/lib\/payments\/provider-gate['"]/);
    const gateIdx = route.indexOf('assertCardPaymentAllowed(user.id)');
    expect(gateIdx).toBeGreaterThan(-1);
    const txIdx    = route.indexOf('createPaddleCheckoutTransaction(', gateIdx);
    expect(txIdx).toBeGreaterThan(gateIdx);
  });

  it('nowpayments/create has no NSFW gate at all — available to everyone', () => {
    const route = src('app', 'api', 'payments', 'nowpayments', 'create', 'route.ts');
    expect(route).not.toMatch(/nsfw_enabled/);
    expect(route).not.toMatch(/assertCardPaymentAllowed/);
  });

  it('the gate fails closed if the profile lookup errors', () => {
    const gate = src('lib', 'payments', 'provider-gate.ts');
    expect(gate).toMatch(/if \(error\) \{\s*\n\s*throw new CardPaymentNotAllowedError/);
  });
});
