import { createClient } from '@/lib/supabase/server';

/**
 * Payment-provider gating by content classification.
 *
 * Card processors (Stripe, Paystack) broadly prohibit processing payments
 * for accounts associated with adult/explicit content in their terms of
 * service — this isn't a Vantrix policy choice, it's a real account-
 * termination and chargeback-dispute risk if ignored. Crypto processors
 * (NOWPayments) don't carry the same restriction, which is exactly why
 * they exist as the option here.
 *
 * Paddle is included in "card rail" here too. Paddle is a Merchant of
 * Record — it is the legal seller on every transaction, not a payment
 * facilitator like Stripe/Paystack — which means its Acceptable Use Policy
 * carries at least the same adult-content restrictions, arguably stricter
 * ones, since Paddle takes on direct reputational and compliance exposure
 * for what it processes. FLAG FOR TAMARA: verify the specific Paddle
 * account's approved-content classification with Paddle directly before
 * relying on this gate in production — this file assumes Paddle behaves
 * exactly like Stripe/Paystack here, not a crypto-style universal rail,
 * and that assumption hasn't been confirmed against your actual Paddle
 * account terms.
 *
 * Policy:
 *   - NSFW-enabled accounts: NOWPayments (crypto) ONLY. Stripe, Paystack,
 *     and Paddle checkout must all refuse.
 *   - Everyone else: Stripe, Paystack, Paddle, AND NOWPayments are all
 *     available.
 *   - NOWPayments is never gated by this check in either direction — it's
 *     available to every account regardless of NSFW status.
 *
 * Card-rail routes (stripe/checkout, paystack/initialize,
 * paddle/checkout) call assertCardPaymentAllowed() and let it throw;
 * nowpayments/create calls nothing from here at all, by design.
 */

export class CardPaymentNotAllowedError extends Error {
  constructor() {
    super('Card payment providers are not available for accounts with explicit content enabled. Please use the crypto payment option instead.');
    this.name = 'CardPaymentNotAllowedError';
  }
}

/**
 * Global provider availability — separate from assertCardPaymentAllowed()
 * above, which gates by account (NSFW status). This gates by provider,
 * account-wide.
 *
 * PRODUCT DECISION (2026-08-28): only Paystack (NGN card rail) and
 * NOWPayments (crypto) are live checkout options right now. Stripe and
 * Paddle are temporarily switched off for every account. This is a
 * deliberate, easily-reversible flag — the checkout routes, webhook
 * handlers, and lib code for both providers stay fully intact underneath.
 * To bring one back, remove it from DISABLED_PROVIDERS below; don't delete
 * or rewrite its route.
 *
 * Stripe's free-trial route (api/payments/stripe/trial) is also gated by
 * this, since it's a Stripe Checkout session under the hood with no
 * Paystack/NOWPayments equivalent — see that route and trial-button.tsx's
 * own gating.
 */
export const DISABLED_PROVIDERS = new Set<'stripe' | 'paddle'>(['stripe', 'paddle']);

export type CheckoutProvider = 'stripe' | 'paystack' | 'paddle' | 'nowpayments';

export function isProviderEnabled(provider: CheckoutProvider): boolean {
  return !DISABLED_PROVIDERS.has(provider as 'stripe' | 'paddle');
}

export class ProviderDisabledError extends Error {
  constructor(provider: string) {
    super(`${provider[0].toUpperCase()}${provider.slice(1)} checkout isn't available right now — please use Paystack or Crypto instead.`);
    this.name = 'ProviderDisabledError';
  }
}

/** Throws ProviderDisabledError if this provider is switched off account-wide. */
export function assertProviderEnabled(provider: CheckoutProvider): void {
  if (!isProviderEnabled(provider)) throw new ProviderDisabledError(provider);
}

/**
 * Throws CardPaymentNotAllowedError if this user must pay via crypto only.
 * Call from every card-rail checkout route (Stripe, Paystack) before
 * creating a session. Fails closed: if the NSFW-status lookup itself fails,
 * card payment is refused rather than silently allowed — a user incorrectly
 * blocked for one extra minute is a much smaller problem than a real NSFW
 * account's payment landing on a card processor that prohibits it.
 */
export async function assertCardPaymentAllowed(userId: string): Promise<void> {
  const supabase = await createClient();
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('nsfw_enabled')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new CardPaymentNotAllowedError();
  }
  if (profile?.nsfw_enabled === true) {
    throw new CardPaymentNotAllowedError();
  }
}
