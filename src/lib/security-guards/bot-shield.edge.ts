/**
 * bot-shield.edge.ts — Edge-safe request heuristics for middleware.
 *
 * Two jobs, deliberately separated:
 *   1. HARD BLOCK: unambiguous non-browser automation tools calling
 *      state-changing endpoints (curl, python-requests, scrapy, wget, bare
 *      Go/Java HTTP clients). These strings are never sent by a real
 *      browser, so the false-positive rate is effectively zero. Legit
 *      server-to-server callers (Stripe/Paystack/NOWPayments/Fal webhooks)
 *      are exempted by path — see WEBHOOK_PATHS.
 *   2. SOFT SCORE: everything else gets a 0-100 "looks automated" score
 *      from header shape (missing Accept-Language, no Sec-Fetch-* on a
 *      UA that claims to be a browser, empty Accept, etc.) forwarded
 *      downstream via x-bot-suspicion-score / x-bot-suspicion-reasons
 *      headers. Route handlers decide what to do with that — per product
 *      direction, that's "flag for review", never an automatic block.
 *
 * No DB writes happen here — this file runs in the Edge Runtime, which
 * cannot use the service-role Supabase client (see admin.ts). Actual
 * abuse_signals rows are written by bot-shield.ts from Node route handlers,
 * reading the headers this file sets.
 */

const BLOCKED_UA_SIGNATURES = [
  "curl/", "wget/", "python-requests", "python-urllib", "scrapy",
  "go-http-client", "okhttp", "java/", "libwww-perl", "httpclient",
  "axios/0", // legit apps pin real versions; bare axios/0.x default UA is almost always a script
] as const;

const WEBHOOK_PATH_PREFIXES = [
  "/api/payments/stripe/webhook",
  "/api/payments/paystack",
  "/api/payments/nowpayments/webhook",
  "/api/payments/paddle/webhook",
  "/api/webhooks/",
] as const;

export function isExemptWebhookPath(pathname: string): boolean {
  return WEBHOOK_PATH_PREFIXES.some((p) => pathname.startsWith(p));
}

/** True if this looks like an unambiguous scripted client, not a browser. */
export function isBlockedAutomationUA(userAgent: string | null): boolean {
  if (!userAgent) return true; // real browsers always send one
  const ua = userAgent.toLowerCase();
  return BLOCKED_UA_SIGNATURES.some((sig) => ua.includes(sig));
}

export interface BotScoreResult {
  score:   number;    // 0-100
  reasons: string[];
}

/**
 * Soft heuristic score. Intentionally conservative — this never blocks by
 * itself, so it's fine to be a bit trigger-happy; false positives just mean
 * an extra row in the review queue, not a denied request.
 */
export function scoreBotLikelihood(headers: Headers): BotScoreResult {
  const reasons: string[] = [];
  let score = 0;

  const ua = headers.get("user-agent") ?? "";
  const claimsBrowser = /mozilla|chrome|safari|firefox|edg\//i.test(ua);

  if (!headers.get("accept-language")) {
    score += 20;
    reasons.push("missing accept-language");
  }
  if (!headers.get("accept")) {
    score += 10;
    reasons.push("missing accept header");
  }
  if (claimsBrowser && !headers.get("sec-fetch-site")) {
    // Every modern real browser sends Sec-Fetch-* on same-origin fetches.
    // A UA that claims to be Chrome/Firefox but omits this is very often a
    // scripted client replaying a captured browser User-Agent string.
    score += 35;
    reasons.push("browser UA without sec-fetch-site");
  }
  if (!ua) {
    score += 40;
    reasons.push("no user-agent");
  } else if (ua.length < 15) {
    score += 15;
    reasons.push("suspiciously short user-agent");
  }
  if (!headers.get("referer") && !headers.get("origin")) {
    score += 10;
    reasons.push("no referer or origin");
  }

  return { score: Math.min(score, 100), reasons };
}
