/**
 * NOWPayments — Direct fetch() integration.
 *
 * SECURITY: Replaced @nowpaymentsio/nowpayments-api-js SDK which pulled in
 * axios ≤0.31.1 — a package carrying 20+ CVEs including SSRF, prototype
 * pollution, and credential leakage (GHSA-jr5f-v2jv-69x6, GHSA-w9j2-pvgh-6h63,
 * GHSA-3p68-rc4w-qgx5, and many more). The SDK was a thin wrapper over a
 * simple REST API; the replacement is 50 lines with zero additional dependencies.
 *
 * All calls use:
 *   - AbortSignal.timeout() to prevent hung Vercel functions
 *   - Explicit error detail extraction to avoid leaking internal service errors
 *   - env.NOWPAYMENTS_API_KEY (Zod-validated at startup)
 */
import { env } from "@/env";

const NP_BASE       = "https://api.nowpayments.io/v1";
const FETCH_TIMEOUT = 10_000; // 10 s

interface NowPaymentsErrorBody {
  message?: string;
  error?:   string;
}

async function npFetch<T>(
  path:    string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${NP_BASE}${path}`, {
    ...options,
    headers: {
      "x-api-key":    env.NOWPAYMENTS_API_KEY,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json() as NowPaymentsErrorBody;
      detail = body.message ?? body.error ?? detail;
    } catch { /* ignore parse errors */ }
    throw new Error(`NOWPayments API error: ${detail}`);
  }

  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NowPaymentResult {
  payment_id:          string;
  payment_status:      string;
  pay_address:         string;
  price_amount:        number;
  price_currency:      string;
  pay_amount:          number;
  pay_currency:        string;
  order_id:            string;
  order_description:   string;
  ipn_callback_url:    string;
  created_at:          string;
  updated_at:          string;
  purchase_id:         string;
}

// ── API calls ─────────────────────────────────────────────────────────────────

/**
 * Create a new crypto payment.
 *
 * NOTE: no route currently calls this — the checkout flow uses
 * createNowPaymentInvoice() below instead, which returns a hosted checkout
 * page URL (consistent with how Stripe/Paystack checkout works). This
 * function is kept as a documented, working alternate integration path for
 * a fully custom wallet-address/QR-code widget, should that ever be wanted
 * instead of NOWPayments' own hosted page.
 *
 * @param priceUsd    Amount in USD (converted to selected crypto by NOWPayments)
 * @param orderId     Your internal order ID (userId|tier|timestamp)
 * @param successUrl  Redirect after confirmed payment
 * @param cancelUrl   Redirect on cancellation
 * @param payCurrency Crypto currency code (default: USDT)
 */
export async function createNowPayment({
  priceUsd,
  orderId,
  successUrl,
  cancelUrl,
  payCurrency = "USDT",
}: {
  priceUsd:     number;
  orderId:      string;
  successUrl:   string;
  cancelUrl:    string;
  payCurrency?: string;
}): Promise<NowPaymentResult> {
  return npFetch<NowPaymentResult>("/payment", {
    method: "POST",
    body:   JSON.stringify({
      price_amount:      priceUsd,
      price_currency:    "usd",
      pay_currency:      payCurrency.toLowerCase(),
      order_id:          orderId,
      order_description: "Vantrix Premium Subscription",
      ipn_callback_url:  `${env.NEXT_PUBLIC_APP_URL}/api/payments/nowpayments/webhook`,
      success_url:       successUrl,
      cancel_url:        cancelUrl,
    }),
  });
}

export interface NowPaymentInvoiceResult {
  id:                string;
  order_id:          string;
  order_description: string;
  price_amount:      string | number;
  price_currency:    string;
  invoice_url:       string;
  success_url:       string;
  cancel_url:        string;
  created_at:        string;
  updated_at:        string;
}

/**
 * Create a hosted-checkout crypto invoice — the user is redirected to
 * invoice_url (a NOWPayments-hosted page with a wallet address + QR code)
 * and back to success_url/cancel_url afterward, same redirect-based flow as
 * Stripe Checkout and Paystack's transaction/initialize.
 *
 * Deliberately NOT using POST /v1/payment (createNowPayment above) for the
 * checkout UI: that endpoint returns a raw pay_address/pay_amount pair and
 * requires building a custom wallet-address-plus-QR-code widget in-house.
 * The Invoice API gives NOWPayments' own hosted page instead, so all three
 * payment providers (Stripe, Paystack, NOWPayments) share one consistent
 * "redirect to a URL, come back on success/cancel" integration pattern.
 */
export async function createNowPaymentInvoice({
  priceUsd,
  orderId,
  successUrl,
  cancelUrl,
  // Optional — defaults to the original subscription copy so every
  // pre-existing call site (tier checkout) is unaffected. Token-pack
  // checkout (create-tokens/route.ts) passes its own label instead.
  orderDescription = "Vantrix Premium Subscription",
}: {
  priceUsd:          number;
  orderId:           string;
  successUrl:        string;
  cancelUrl:         string;
  orderDescription?: string;
}): Promise<NowPaymentInvoiceResult> {
  const result = await npFetch<Record<string, unknown>>("/invoice", {
    method: "POST",
    body:   JSON.stringify({
      price_amount:      priceUsd,
      price_currency:    "usd",
      order_id:          orderId,
      order_description: orderDescription,
      ipn_callback_url:  `${env.NEXT_PUBLIC_APP_URL}/api/payments/nowpayments/webhook`,
      success_url:       successUrl,
      cancel_url:        cancelUrl,
    }),
  });

  // Documented field name is invoice_url (NOWPayments' own integration guide:
  // "UI - display the invoice url or redirect the user to the generated
  // link"). Falls back to a plain `url` key defensively in case of a naming
  // difference between API versions, but never silently returns an invoice
  // object with no usable link — that would hand the frontend a dead end
  // with no error to act on.
  const invoiceUrl = (result.invoice_url ?? result.url) as string | undefined;
  if (!invoiceUrl) {
    throw new Error("NOWPayments invoice response did not include a usable invoice URL");
  }

  return { ...result, invoice_url: invoiceUrl } as NowPaymentInvoiceResult;
}

/**
 * Check the status of an existing payment.
 * Use in your polling UI or as a secondary verification step.
 */
export async function getNowPaymentStatus(paymentId: string): Promise<NowPaymentResult> {
  return npFetch<NowPaymentResult>(`/payment/${paymentId}`);
}

/**
 * Get the minimum payment amount for a currency pair.
 * Use before creating a payment to validate the user's intent.
 */
export async function getNowMinAmount(currencyFrom: string, currencyTo: string): Promise<{ min_amount: number }> {
  return npFetch<{ min_amount: number }>(
    `/min-amount?currency_from=${currencyFrom.toLowerCase()}&currency_to=${currencyTo.toLowerCase()}`
  );
}
