/**
 * SEC-15 — Paddle As A Second Rail For Token-Pack Purchases
 *
 * Token packs (@/lib/economy/token-packs) previously had exactly one
 * checkout rail: Stripe (checkout-tokens/route.ts). This adds Paddle as a
 * second one-time-purchase option, mirroring the Stripe/Paddle pairing
 * already offered for subscriptions (tier-card.tsx, checkout-button.tsx) —
 * see paddle/checkout-tokens/route.ts's header for the full mapping.
 *
 * Guards the same bug classes SEC-14 guards for subscription billing, this
 * time for the one-time-purchase path:
 *   - the NSFW card-rail gate must run before a Paddle transaction is created
 *   - a pack with no configured Paddle price id must degrade to a clear 400,
 *     never proceed with a wrong/missing charge
 *   - the webhook must credit token-pack transactions BEFORE falling into
 *     subscription-resolution logic, since a token-pack transaction has no
 *     tier to resolve
 *   - the backend stays ready even though the frontend doesn't currently
 *     call it — see the last describe block's own comment for the
 *     2026-08-28 provider-gate decision this predates
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function src(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf-8');
}

describe('SEC-15 — paddle/checkout-tokens is gated identically to paddle/checkout', () => {
  it('calls assertCardPaymentAllowed before creating a Paddle transaction', () => {
    const route = src('app', 'api', 'payments', 'paddle', 'checkout-tokens', 'route.ts');
    expect(route).toMatch(/import\s*\{[^}]*\bassertCardPaymentAllowed\b[^}]*\}\s*from\s*['"]@\/lib\/payments\/provider-gate['"]/);
    const gateIdx = route.indexOf('assertCardPaymentAllowed(user.id)');
    expect(gateIdx).toBeGreaterThan(-1);
    const txIdx = route.indexOf('createPaddleTokenPackCheckoutTransaction(', gateIdx);
    expect(txIdx).toBeGreaterThan(gateIdx);
  });

  it('reuses profile.paddle_customer_id before creating a new Paddle customer, same as paddle/checkout', () => {
    const route = src('app', 'api', 'payments', 'paddle', 'checkout-tokens', 'route.ts');
    expect(route).toMatch(/paddle_customer_id/);
    expect(route).toMatch(/getOrCreatePaddleCustomer\(/);
  });

  it('requires an email on the user, same guard as paddle/checkout', () => {
    const route = src('app', 'api', 'payments', 'paddle', 'checkout-tokens', 'route.ts');
    expect(route).toMatch(/code: 'EMAIL_REQUIRED'/);
  });
});

describe('SEC-15 — an unconfigured Paddle token-pack price degrades to a clear 400', () => {
  it('priceIdForTokenPack returns undefined rather than throwing for an unrecognized pack', () => {
    const lib = src('lib', 'payments', 'paddle-plans.ts');
    expect(lib).toMatch(/export function priceIdForTokenPack/);
    expect(lib).toMatch(/TOKEN_PACK_PRICE_IDS\[packId\]/);
  });

  it('checkout-tokens route returns PADDLE_PRICE_NOT_CONFIGURED rather than proceeding without a price id', () => {
    const route = src('app', 'api', 'payments', 'paddle', 'checkout-tokens', 'route.ts');
    const priceIdx = route.indexOf('priceIdForTokenPack(');
    const errIdx   = route.indexOf("code:  'PADDLE_PRICE_NOT_CONFIGURED'");
    expect(priceIdx).toBeGreaterThan(-1);
    expect(errIdx).toBeGreaterThan(priceIdx);
  });

  it('a pack not found in TOKEN_PACKS still 404s before any Paddle call is made', () => {
    const route = src('app', 'api', 'payments', 'paddle', 'checkout-tokens', 'route.ts');
    const notFoundIdx = route.indexOf("code: 'NOT_FOUND'");
    // The call site, not the import line — priceIdForTokenPack( also
    // appears earlier in the import statement.
    const priceCallIdx = route.indexOf('priceIdForTokenPack(pack.id)');
    expect(notFoundIdx).toBeGreaterThan(-1);
    expect(priceCallIdx).toBeGreaterThan(notFoundIdx);
  });
});

describe('SEC-15 — Paddle webhook credits token packs before touching subscription-resolution logic', () => {
  it('checks custom_data.type === "token_pack" before calling resolveTierAndInterval', () => {
    const route = src('app', 'api', 'payments', 'paddle', 'webhook', 'route.ts');
    const typeCheckIdx = route.indexOf("data.custom_data?.type === 'token_pack'");
    const resolveIdx   = route.indexOf('resolveTierAndInterval(data)');
    expect(typeCheckIdx).toBeGreaterThan(-1);
    expect(resolveIdx).toBeGreaterThan(typeCheckIdx);
  });

  it('credits tokens via the same credit_subscription_tokens RPC the Stripe token-pack branch uses', () => {
    const route = src('app', 'api', 'payments', 'paddle', 'webhook', 'route.ts');
    expect(route).toMatch(/rpc\('credit_subscription_tokens', \{\s*\n\s*p_user_id:\s*userId,\s*\n\s*p_amount:\s*tokens,/);
  });

  it('releases the claim rather than silently dropping the credit if userId cannot be resolved', () => {
    const route = src('app', 'api', 'payments', 'paddle', 'webhook', 'route.ts');
    const typeCheckIdx = route.indexOf("data.custom_data?.type === 'token_pack'");
    const releaseIdx   = route.indexOf('releaseWebhookEvent(event.event_id)', typeCheckIdx);
    expect(releaseIdx).toBeGreaterThan(typeCheckIdx);
  });

  it('emits a token_purchase notification, same notification type the Stripe branch uses', () => {
    const route = src('app', 'api', 'payments', 'paddle', 'webhook', 'route.ts');
    expect(route).toMatch(/type: 'token_purchase'/);
  });
});

describe('SEC-15 — Paddle transaction custom_data round-trips the same fields the webhook reads', () => {
  it("createPaddleTokenPackCheckoutTransaction sets custom_data.type to 'token_pack'", () => {
    const lib = src('lib', 'payments', 'paddle.ts');
    const fnIdx = lib.indexOf('export async function createPaddleTokenPackCheckoutTransaction');
    expect(fnIdx).toBeGreaterThan(-1);
    const customDataIdx = lib.indexOf("type: \"token_pack\"", fnIdx);
    expect(customDataIdx).toBeGreaterThan(fnIdx);
  });
});

describe('SEC-15 — the purchase UI reflects the current provider gate, not a stale assumption', () => {
  // This originally asserted the frontend wires up both Stripe and Paddle.
  // Superseded by the account-wide PROVIDER GATE product decision
  // (2026-08-28, see lib/payments/provider-gate.ts's DISABLED_PROVIDERS and
  // this same comment on tier-card.tsx's identical subscription gating):
  // Stripe and Paddle checkout are switched off everywhere in the UI right
  // now, token packs included — the backend routes/webhook/lib code this
  // file's other describe blocks test stay fully intact underneath, ready
  // to re-enable, but the component deliberately doesn't call them while
  // they're disabled (calling a disabled route 503s — see the card's own
  // TOKEN-PACK FIX comment for the bug that caused, before this gate
  // existed). Asserts the *current*, live rails instead, and guards
  // against the disabled ones silently creeping back into this component
  // before DISABLED_PROVIDERS says they're ready.
  it('TokenPackCard posts to the currently-live paystack and nowpayments endpoints, not the disabled stripe/paddle ones', () => {
    const component = src('components', 'premium', 'token-pack-card.tsx');
    expect(component).toMatch(/\/api\/payments\/paystack\/checkout-tokens/);
    expect(component).toMatch(/\/api\/payments\/nowpayments\/create-tokens/);
    expect(component).not.toMatch(/\/api\/payments\/stripe\/checkout-tokens/);
    expect(component).not.toMatch(/\/api\/payments\/paddle\/checkout-tokens/);
  });
});
