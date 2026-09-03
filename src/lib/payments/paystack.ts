/**
 * Paystack payment helpers.
 *
 * ENV-1 fix: uses env.PAYSTACK_SECRET_KEY (Zod-validated at startup) instead of
 * process.env.PAYSTACK_SECRET_KEY (unvalidated). A missing key now produces a
 * clear startup error rather than an Authorization failure mid-transaction.
 *
 * Recurring billing fix: initializePaystackTransaction now accepts an
 * optional `plan` code. Previously every call omitted it entirely, which
 * means Paystack only ever ran a one-off charge — never an actual managed
 * Subscription. Passing `plan` is what makes Paystack auto-renew the charge
 * going forward (and overrides `amount` with the plan's configured price,
 * per Paystack's own API behavior — see PLAN_CODE_BY_TIER in
 * lib/payments/paystack-plans.ts for where each tier's code is sourced).
 */
import { env } from "@/env";

const PAYSTACK_BASE = 'https://api.paystack.co';
const FETCH_TIMEOUT = 10_000; // 10s — prevents hung Vercel functions

export async function initializePaystackTransaction({
  email,
  amountNgn,
  metadata,
  callback_url,
  plan,
}: {
  email:        string;
  amountNgn:    number;
  metadata:     Record<string, string>;
  callback_url: string;
  /** Paystack Plan code (PLN_xxx). When set, Paystack creates a recurring
   *  Subscription instead of a one-off charge, and overrides `amount` with
   *  the plan's own configured price. */
  plan?:        string;
}) {
  const res = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
    method:  'POST',
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      // Math.round() defensively guards the same float-drift class of bug
      // as the Stripe unit_amount fix (see lib/payments/stripe.ts). price_ngn
      // is currently always a whole-number DB value so this is a no-op today,
      // but it costs nothing and removes the failure mode if that ever changes.
      amount: Math.round(amountNgn * 100),
      metadata,
      callback_url,
      ...(plan ? { plan } : {}),
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });

  if (!res.ok) throw new Error('Paystack initialization failed');
  return res.json();
}

export async function verifyPaystackTransaction(reference: string) {
  const res = await fetch(`${PAYSTACK_BASE}/transaction/verify/${reference}`, {
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });

  if (!res.ok) throw new Error('Paystack verification failed');
  return res.json();
}

/**
 * Manually retry a recurring charge using a stored card authorization.
 * Used by the renewal-safety-net cron (api/cron/paystack-renewal) — Paystack's
 * own docs state subscription charges are NOT automatically retried on
 * failure (unlike Stripe's dunning), so a missed/failed renewal needs an
 * explicit retry or the subscription silently lapses at expires_at.
 */
export async function chargeAuthorization({
  email,
  amountNgn,
  authorizationCode,
}: {
  email:             string;
  amountNgn:         number;
  authorizationCode: string;
}) {
  const res = await fetch(`${PAYSTACK_BASE}/transaction/charge_authorization`, {
    method:  'POST',
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      amount: amountNgn * 100,
      authorization_code: authorizationCode,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });

  if (!res.ok) throw new Error('Paystack charge_authorization failed');
  return res.json();
}

/**
 * Fetch a subscription's current state from Paystack, including its
 * `email_token` — a per-subscription secret Paystack requires (alongside
 * the subscription code) to authorize disabling it. Not something we
 * store ourselves; fetched fresh right before a cancel request rather
 * than persisted, since it's only ever needed at cancel-time and fetching
 * fresh avoids the small risk of an unused stored token going stale.
 */
export async function fetchPaystackSubscription(subscriptionCode: string) {
  const res = await fetch(`${PAYSTACK_BASE}/subscription/${subscriptionCode}`, {
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });

  if (!res.ok) throw new Error('Paystack subscription lookup failed');
  return res.json();
}

/**
 * Cancels a Paystack-managed subscription (self-serve cancel path).
 *
 * Paystack requires both the subscription `code` and its `token`
 * (email_token) to authorize disabling — see fetchPaystackSubscription()
 * above for where the token comes from. This does NOT downgrade the
 * user's tier itself: Paystack's own `subscription.disable` webhook is
 * the single place that happens (see
 * api/payments/paystack/verify/route.ts), so a self-serve cancel and a
 * cancel triggered any other way (support, Paystack dashboard, failed
 * renewal exhausting retries) all converge on the same, already-correct
 * downgrade path instead of duplicating it here.
 */
export async function disablePaystackSubscription({
  subscriptionCode,
  emailToken,
}: {
  subscriptionCode: string;
  emailToken:        string;
}) {
  const res = await fetch(`${PAYSTACK_BASE}/subscription/disable`, {
    method:  'POST',
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code:  subscriptionCode,
      token: emailToken,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });

  if (!res.ok) throw new Error('Paystack disable subscription failed');
  return res.json();
}
