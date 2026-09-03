/**
 * Paddle Billing API client.
 *
 * Paddle is a Merchant of Record: unlike Stripe/Paystack (payment
 * facilitators, where Vantrix is the seller), Paddle itself is the seller
 * of record on every transaction. It handles VAT/sales-tax calculation and
 * remittance across 200+ markets and presents checkout in the buyer's
 * local currency — this is the reason to offer it as a second card rail
 * for international subscribers alongside Stripe, not a replacement.
 *
 * Implemented as plain `fetch` calls against Paddle's REST API (no SDK
 * dependency) — same approach as lib/payments/paystack.ts in this
 * codebase, and avoids pinning to a Node-SDK version for a v1 integration.
 *
 * API base URL differs between sandbox and live Paddle accounts — see
 * PADDLE_ENVIRONMENT in env.ts. Sandbox and live each have their own API
 * key, webhook secret, and Price IDs; mixing them across environments is a
 * common integration bug (see PADDLE_PRICE_ID_* env vars).
 */
import { createHmac, timingSafeEqual } from "crypto";
import { env } from "@/env";

const PADDLE_BASE =
  env.PADDLE_ENVIRONMENT === "production"
    ? "https://api.paddle.com"
    : "https://sandbox-api.paddle.com";

const FETCH_TIMEOUT = 10_000; // 10s — prevents hung Vercel functions, mirrors paystack.ts

async function paddleFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${PADDLE_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.PADDLE_API_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });

  if (!res.ok) {
    // Paddle error responses are { error: { code, detail, ... } } — surface
    // the detail where present so failures are debuggable from logs rather
    // than a bare "Paddle request failed".
    const body = await res.json().catch(() => null) as { error?: { code?: string; detail?: string } } | null;
    const detail = body?.error?.detail ?? body?.error?.code;
    throw new Error(`Paddle API error (${res.status})${detail ? `: ${detail}` : ""} [${path}]`);
  }

  return res.json() as Promise<T>;
}

// ── Customers ──────────────────────────────────────────────────────────────

interface PaddleCustomer {
  id: string; // ctm_xxx
  email: string;
  status: string;
}

/**
 * Resolves a stable Paddle customer id for this user: reuses
 * `existingCustomerId` (from profiles.paddle_customer_id) if present and
 * still valid on Paddle's side, otherwise creates a new Paddle Customer.
 *
 * Reusing one customer id across checkouts (rather than letting each
 * transaction create/attach an ad-hoc customer) is what makes the renewal
 * webhook's customer-id-based user resolution possible — see this file's
 * migration header comment and the webhook route's resolveUserId().
 */
export async function getOrCreatePaddleCustomer({
  email,
  existingCustomerId,
}: {
  email: string;
  existingCustomerId?: string | null;
}): Promise<string> {
  if (existingCustomerId) {
    try {
      const { data } = await paddleFetch<{ data: PaddleCustomer }>(
        `/customers/${existingCustomerId}`,
      );
      if (data?.id) return data.id;
    } catch {
      // Stored id no longer resolves (e.g. account reset between sandbox
      // and live) — fall through and create a fresh one rather than
      // failing checkout outright.
    }
  }

  const { data } = await paddleFetch<{ data: PaddleCustomer }>("/customers", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  return data.id;
}

// ── Checkout (Transactions) ──────────────────────────────────────────────

interface PaddleTransaction {
  id: string; // txn_xxx
  status: string;
  customer_id: string | null;
  subscription_id: string | null;
  checkout?: { url?: string | null } | null;
  custom_data?: Record<string, string> | null;
}

/**
 * Creates a Paddle Transaction for a subscription checkout and returns its
 * hosted checkout URL. This mirrors createStripeCheckoutSession()'s
 * redirect-based flow: the frontend does `window.location.href = url`
 * exactly as it does for Stripe/Paystack/NOWPayments (see
 * components/premium/checkout-button.tsx) — no Paddle.js/overlay checkout
 * needed on the client for this integration.
 *
 * UX NOTE: unlike Stripe Checkout, Paddle's hosted checkout page has no
 * separate "cancel_url" concept — an abandoning buyer uses the page's own
 * back control. `successUrl` only governs where Paddle sends the buyer
 * after a *completed* payment.
 */
export async function createPaddleCheckoutTransaction({
  customerId,
  priceId,
  userId,
  tier,
  billingInterval,
  successUrl,
}: {
  customerId: string;
  priceId: string;
  userId: string;
  tier: string;
  billingInterval: "monthly" | "quarterly" | "annual";
  successUrl: string;
}): Promise<PaddleTransaction> {
  const { data } = await paddleFetch<{ data: PaddleTransaction }>("/transactions", {
    method: "POST",
    body: JSON.stringify({
      items: [{ price_id: priceId, quantity: 1 }],
      customer_id: customerId,
      // custom_data round-trips onto this transaction's own webhook events
      // reliably; it's the RENEWAL transaction (subscription_recurring
      // origin) that isn't documented to guarantee it survives — hence the
      // customer-id fallback in the webhook's resolveUserId().
      custom_data: { userId, tier, billingInterval },
      checkout: { url: successUrl },
    }),
  });
  return data;
}

/**
 * Creates a Paddle Transaction for a one-time token-pack purchase. Same
 * shape as createPaddleCheckoutTransaction() above, but custom_data carries
 * `type: 'token_pack'` (the webhook's signal to credit tokens instead of
 * activating a subscription) plus the pack id and token count, mirroring
 * createTokenPackCheckoutSession()'s Stripe metadata contract exactly so
 * both webhook handlers can share the same downstream credit logic.
 */
export async function createPaddleTokenPackCheckoutTransaction({
  customerId,
  priceId,
  userId,
  packId,
  tokens,
  successUrl,
}: {
  customerId: string;
  priceId: string;
  userId: string;
  packId: string;
  tokens: number;
  successUrl: string;
}): Promise<PaddleTransaction> {
  const { data } = await paddleFetch<{ data: PaddleTransaction }>("/transactions", {
    method: "POST",
    body: JSON.stringify({
      items: [{ price_id: priceId, quantity: 1 }],
      customer_id: customerId,
      custom_data: { userId, type: "token_pack", packId, tokens: String(tokens) },
      checkout: { url: successUrl },
    }),
  });
  return data;
}

/** Fetches a transaction by id — used to confirm checkout.url is ready
 *  and, if ever needed, to re-resolve custom_data server-side. */
export async function getPaddleTransaction(transactionId: string): Promise<PaddleTransaction> {
  const { data } = await paddleFetch<{ data: PaddleTransaction }>(`/transactions/${transactionId}`);
  return data;
}

// ── Subscriptions ─────────────────────────────────────────────────────────

interface PaddleManagementUrls {
  update_payment_method: string | null;
  cancel: string | null;
}

interface PaddleSubscription {
  id: string; // sub_xxx
  status: string; // active | trialing | past_due | paused | canceled
  customer_id: string;
  management_urls: PaddleManagementUrls | null;
  current_billing_period: { starts_at: string; ends_at: string } | null;
}

export async function getPaddleSubscription(subscriptionId: string): Promise<PaddleSubscription> {
  const { data } = await paddleFetch<{ data: PaddleSubscription }>(
    `/subscriptions/${subscriptionId}`,
  );
  return data;
}

/**
 * Cancels a Paddle-managed subscription.
 *
 * `effective_from: 'next_billing_period'` (the default) preserves access
 * until the period the customer already paid for ends — mirrors the
 * language used in Paystack's disablePaystackSubscription() self-serve
 * flow ("you'll keep access until the end of the current billing
 * period"). The subscription.canceled webhook is what actually downgrades
 * profiles.tier once it takes effect (see webhook route) — same
 * single-source-of-truth pattern as Stripe/Paystack cancellation.
 */
export async function cancelPaddleSubscription(
  subscriptionId: string,
  effectiveFrom: "next_billing_period" | "immediately" = "next_billing_period",
): Promise<PaddleSubscription> {
  const { data } = await paddleFetch<{ data: PaddleSubscription }>(
    `/subscriptions/${subscriptionId}/cancel`,
    { method: "POST", body: JSON.stringify({ effective_from: effectiveFrom }) },
  );
  return data;
}

// ── Webhook signature verification ───────────────────────────────────────
//
// Paddle-Signature header format: `ts=<unix_seconds>;h1=<hex_hmac_sha256>`.
// Signed payload is the literal string `${ts}:${rawBody}` (colon-joined —
// NOT JSON-parsed/re-stringified, which would change the byte sequence and
// break every signature). HMAC-SHA256 keyed with the notification
// destination's own secret (env.PADDLE_WEBHOOK_SECRET).
//
// A `toleranceSeconds` window rejects stale/replayed signatures even if
// the HMAC itself is valid — same defense-in-depth Stripe's own SDK
// applies via its `tolerance` option.
export function verifyPaddleWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  toleranceSeconds = 300,
): boolean {
  if (!signatureHeader) return false;

  const match = /^ts=(\d+);h1=([0-9a-f]+)$/.exec(signatureHeader.trim());
  if (!match) return false;
  const [, ts, h1] = match;

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(ts));
  if (ageSeconds > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret)
    .update(`${ts}:${rawBody}`)
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  const receivedBuf = Buffer.from(h1, "hex");
  // Length check first: timingSafeEqual throws (not returns false) on
  // mismatched buffer lengths, and a malformed/truncated h1 must not crash
  // the route — same bytesize-guard-before-constant-time-compare pattern
  // flagged as the correct fix in the CVE class this function is written
  // against (non-constant-time comparison on Paddle Billing signatures).
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}
