/**
 * Next.js Middleware — Production
 *
 * Edge Runtime safe. Imports only Web Crypto API and Edge-compatible modules.
 *
 * Responsibilities:
 *   1. Auth session refresh (Supabase SSR cookie rotation)
 *   2. Auth route rate-limiting (Upstash Ratelimit — Edge compatible)
 *   3. Per-request security headers (CSP nonce, HSTS, CORP, etc.)
 *   4. Dynamic CORS for allowed origins
 *
 * Age verification is collected once at signup (see auth/login/page.tsx +
 * auth/callback/page.tsx) and is not re-checked or gated anywhere else in
 * the app — there is no middleware-level age gate.
 */

import { NextResponse }    from "next/server";
import type { NextRequest } from "next/server";
import type { User }        from "@supabase/supabase-js";
import { updateSession }   from "@/lib/supabase/middleware";
import { getEdgeAuthLimiter, getEdgeApiLimiter } from "@/lib/rate-limit/edge";
import { edgeLogger } from "@/lib/logger.edge";
import {
  isBlockedAutomationUA,
  isExemptWebhookPath,
  scoreBotLikelihood,
} from "@/lib/security-guards/bot-shield.edge";
import { generateNonce } from "@/lib/security.edge";
import { edgeEnv } from "@/env.edge";

// ── Client IP resolution ────────────────────────────────────────────────────
// BUG FIX (2026-08-08): both blanket rate limiters below used to fall back to
// the hardcoded string "127.0.0.1" whenever no reverse-proxy header
// (x-real-ip / cf-connecting-ip / x-forwarded-for) was present — which is
// exactly what happens for any deployment not sitting behind Vercel/
// Cloudflare/etc. (e.g. a plain `next build && next start`, or a bare
// container). That silently turned a *per-client* limiter into one shared
// global bucket: every request from every user/tab/page-load drew from the
// same 120-req/min (or 10-req/15min for auth) allowance. Normal browsing
// exhausts that almost immediately, after which every subsequent request —
// from everyone — gets a blanket 429 until the window rolls over. That is
// "the whole app just stops," not the limiter doing its job.
//
// Fix: distinguish "we resolved a real per-client IP" from "no proxy header
// was present, we cannot tell clients apart." Only the first case is safe to
// rate-limit — punishing every client identically because we can't tell them
// apart provides zero actual abuse protection (a real attacker would still
// look identical to every real user) while breaking the app for everyone.
// In the second case we log it (so a misconfigured production deploy that's
// missing expected proxy headers is still visible) and skip this blanket
// limiter, the same "fail open rather than fail everyone closed" policy
// already used elsewhere in this file for limiter-backend outages. Per-route
// limiters (chat, uploads, swipes, etc.), which key on the authenticated
// user id rather than IP, are completely unaffected by any of this.
function resolveClientIp(request: NextRequest): string | null {
  const ip =
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return ip && ip.length > 0 ? ip : null;
}

const ALLOWED_ORIGINS = [
  edgeEnv.NEXT_PUBLIC_APP_URL,
  "https://www.vantrix.ink",
  "https://vantrix.ink",
].filter((o): o is string => Boolean(o));

// ── Main middleware ───────────────────────────────────────────────────────────

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestId    = request.headers.get("x-request-id") ?? globalThis.crypto.randomUUID();
  const nonce        = generateNonce();

  // No HTTPS enforcement: plain http:// is served identically to https://,
  // in both production and local dev. (There is deliberately no HSTS header
  // and no CSP `upgrade-insecure-requests` directive either — either one
  // would have browsers silently rewrite future http:// requests to https://
  // on their own, which defeats plain-HTTP support.)
  const isDev = process.env.NODE_ENV === "development";
  const csp = buildCsp(nonce, isDev);

  const isApiRoute = pathname.startsWith("/api/");
  const isWebhook  = isApiRoute && isExemptWebhookPath(pathname);

  // PERF: kick off the Supabase session refresh immediately, in parallel
  // with the rate-limit checks below, instead of waiting for them to
  // finish first. Both are independent network round-trips (Redis vs
  // Supabase Auth) on every request this middleware matches — almost
  // every page and API call in the app — so running them sequentially
  // paid the full cost of both, back to back, on the critical path of
  // every navigation. They don't depend on each other's result, so there's
  // nothing unsafe about overlapping them; a request that ends up
  // rate-limited just wastes one Supabase round-trip we don't use, which
  // is a fine trade for shaving a full network hop off every request that
  // isn't rate-limited (the overwhelming majority). Caught here so a
  // rejected promise nobody awaits (e.g. on an early 403/413/429 return
  // below) never surfaces as an unhandled rejection.
  const sessionPromise = updateSession(request).catch(
    (err): { response: NextResponse; user: null; error: unknown } => ({
      response: NextResponse.next({ request: { headers: request.headers } }),
      user: null,
      error: err,
    }),
  );

  // ── Bot shield: hard block + body cap + blanket rate limit (all /api/*) ────
  // Runs before auth/session work so obviously-automated or oversized
  // requests never reach a route handler at all. Webhook paths (Stripe,
  // Paystack, NOWPayments, Fal) are exempt from the UA check — those are
  // legitimate server-to-server callers with non-browser user agents.
  if (isApiRoute) {
    const method = request.method;
    const ua     = request.headers.get("user-agent");

    // Hard block: unambiguous scripted clients on state-changing calls.
    // GETs are left alone (read-only scraping is a rate-limit problem, not
    // a hard-block one — blocking GET too risks breaking legitimate
    // monitoring/health-check tooling that also lacks a browser UA).
    if (!isWebhook && method !== "GET" && method !== "HEAD" && isBlockedAutomationUA(ua)) {
      return NextResponse.json(
        { error: "Forbidden", code: "AUTOMATED_CLIENT_BLOCKED" },
        { status: 403 },
      );
    }

    // Body size cap. Upload/image/voice endpoints legitimately send large
    // payloads and have their own per-route limiter (uploadLimiter etc.);
    // everything else is JSON and has no business being large.
    const isLargePayloadRoute =
      pathname.startsWith("/api/upload") ||
      pathname.startsWith("/api/images/") ||
      pathname.startsWith("/api/characters/generate-image") ||
      pathname.startsWith("/api/voice/") ||
      pathname.startsWith("/api/admin/characters/");
    const maxBytes = isLargePayloadRoute ? 20 * 1024 * 1024 : 512 * 1024;
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > maxBytes) {
      return NextResponse.json(
        { error: "Payload too large", code: "PAYLOAD_TOO_LARGE" },
        { status: 413 },
      );
    }

    // Blanket per-IP rate limit across all API routes — fails open on
    // limiter outage, same policy as the auth limiter below. Also fails
    // open (skips) when we can't resolve a real per-client IP at all —
    // see resolveClientIp() above for why that case must not share one
    // global bucket across every client.
    const ip = resolveClientIp(request);
    if (ip === null) {
      edgeLogger.warn("middleware:api-rate-limit-no-client-ip", { pathname });
    } else {
      try {
        const { success } = await getEdgeApiLimiter().limit(ip);
        if (!success) {
          return NextResponse.json(
            { error: "Too many requests", code: "RATE_LIMIT_EXCEEDED" },
            { status: 429, headers: { "Retry-After": "60" } },
          );
        }
      } catch (err) {
        edgeLogger.error("middleware:api-rate-limit-error", { error: String(err), ip });
        // fail open — see the identical rationale on the auth limiter below
      }
    }
  }

  // Soft bot-suspicion score — never blocks by itself. Forwarded downstream
  // via headers so route handlers can flag it for review (see
  // src/lib/security/bot-shield.ts / flagIfSuspicious()). No CAPTCHA at
  // signup/login by design — suspicious traffic is queued for human/AI
  // review, not gated at the door.
  const botScore = scoreBotLikelihood(request.headers);


  // ── Auth-route rate limit ─────────────────────────────────────────────────
  // NOTE: this matches /auth/callback and any /api/auth/* route (currently
  // just /api/auth/login-guard, added 2026-08-21) — it does NOT match
  // /login, /forgot-password, or /reset-password themselves, since those
  // pages call supabase.auth.signInWithPassword()/signUp()/
  // resetPasswordForEmail() directly from the browser against Supabase's
  // own Auth API, never through our Next.js server. That's fine: Supabase's
  // hosted Auth API applies its own server-side rate limiting to those
  // calls independently of anything here (full brute-force protection,
  // e.g. CAPTCHA on suspicious attempts, is a Supabase dashboard setting —
  // Authentication → Attack Protection — not something this repo can
  // enable). This limiter exists for the case where our own server-side
  // code IS in the request path for an auth-adjacent action:
  // /auth/callback's PKCE code exchange (exempted below, see its own
  // per-route handling) and now /api/auth/login-guard's failed-attempt
  // lockout tracking (lib/auth/login-guard.ts) — neither does the actual
  // credential check itself, but both sit close enough to auth that this
  // coarse per-IP ceiling is a reasonable second layer on top of
  // login-guard's own scoped (per-email/per-IP) limits.
  const isAuthRoute    = pathname.includes("/auth/") || pathname.includes("/api/auth/");
  const isAuthCallback = pathname.endsWith("/auth/callback") || pathname.endsWith("/auth/callback/");

  if (isAuthRoute && !isAuthCallback) {
    const ip = resolveClientIp(request);

    // FIX: previously unguarded — if Upstash Redis is unreachable or
    // misconfigured, .limit() rejects and the thrown error was never
    // caught, so Next.js returned an unhandled-exception 500 to every
    // request matching this middleware's matcher (i.e. almost the whole
    // site, since rate limiting itself ran before any other logic could
    // respond). Rate limiting is a defense-in-depth control, not a
    // critical-path dependency: if the limiter backend is unavailable we
    // fail OPEN (allow the request through) rather than fail the entire
    // site closed. The outage is still observable via logs.
    //
    // Also fails open when no real per-client IP is resolvable at all
    // (see resolveClientIp() above) — same reasoning as the blanket API
    // limiter: a shared fallback identity means every client fails
    // together for no actual security benefit.
    if (ip === null) {
      edgeLogger.warn("middleware:auth-rate-limit-no-client-ip", { pathname });
    } else {
      try {
        const { success } = await getEdgeAuthLimiter().limit(ip);
        if (!success) {
          return NextResponse.json(
            { error: "Too many requests", code: "RATE_LIMIT_EXCEEDED" },
            { status: 429, headers: { "Retry-After": "900" } }
          );
        }
      } catch (err) {
        edgeLogger.error("middleware:rate-limit-error", { error: String(err), ip });
        // fall through — do not block the request on a limiter outage
      }
    }
  }

  // ── Refresh Supabase session ──────────────────────────────────────────────
  // updateSession() already calls supabase.auth.getUser() once per request
  // (needed to refresh the session cookie). We forward that verified user id
  // to downstream route handlers via a request header so they don't have to
  // pay for a second auth.getUser() round-trip to Supabase's Auth server —
  // see src/lib/auth/get-authed-user.ts for the consumer side.
  //
  // FIX: previously unguarded — any failure here (missing/invalid
  // NEXT_PUBLIC_SUPABASE_URL or ANON_KEY, Supabase outage, network error,
  // malformed session cookie causing the SSR client to throw) propagated
  // as an unhandled exception out of middleware. Since this matcher covers
  // virtually every route, that turned a single dependency hiccup into a
  // site-wide 500 on all traffic. We now degrade to "unauthenticated" on
  // failure: the request still gets a response with security headers, and
  // route handlers / the age gate make the call on what an unauthenticated
  // request is allowed to do (fail closed at the authorization layer, not
  // by taking the whole site down).
  let sessionResponse = NextResponse.next({ request: { headers: request.headers } });
  let user: User | null = null;
  const sessionResult = await sessionPromise;
  if ("error" in sessionResult) {
    edgeLogger.error("middleware:session-refresh-error", { error: String(sessionResult.error), pathname });
    // fall through with user = null, sessionResponse = a plain pass-through
  } else {
    sessionResponse = sessionResult.response;
    user = sessionResult.user;
  }

  const forwardedHeaders = new Headers(request.headers);
  // CSP-NONCE-FIX (2026-08-20): x-nonce and Content-Security-Policy were
  // previously only ever set on the outgoing `response` (see applyHeaders
  // below), never on the request. That means Next's App Router — which
  // extracts the nonce by parsing the Content-Security-Policy header it
  // sees on the *incoming* request during SSR, then auto-applies it to the
  // inline `<script>` tags it injects itself for RSC/streaming payloads —
  // never saw a nonce at all. Those framework-injected inline scripts had
  // no nonce attribute and would be silently blocked by our nonce-based
  // script-src (there's no 'unsafe-inline' or 'strict-dynamic' fallback
  // configured), breaking hydration on every page. Setting both headers
  // here, before NextResponse.next() is constructed below, is the pattern
  // Next's own docs use. This also happens to close a related Next.js
  // advisory (CSP2XSS): overwriting any client-supplied
  // Content-Security-Policy request header with our own trusted value,
  // rather than trusting whatever the client sent.
  forwardedHeaders.set("x-nonce", nonce);
  forwardedHeaders.set("Content-Security-Policy", csp);
  if (user) {
    forwardedHeaders.set("x-verified-user-id", user.id);
  } else {
    // Always strip any client-supplied value — never trust it unverified.
    forwardedHeaders.delete("x-verified-user-id");
  }
  // Always strip any client-supplied bot-score headers before setting our
  // own — same trust boundary as x-verified-user-id above.
  forwardedHeaders.set("x-bot-suspicion-score", String(botScore.score));
  forwardedHeaders.set("x-bot-suspicion-reasons", botScore.reasons.join("|"));
  // Forwarded so server components (e.g. the (app) layout's auth guard) can
  // build a `?redirect=<path>` back-link without Next exposing pathname to
  // RSCs directly — see src/app/(app)/layout.tsx.
  forwardedHeaders.set("x-pathname", pathname);

  // ── Geo country detection ────────────────────────────────────────────────
  // Used for lightweight copy targeting (e.g. the US-tailored login page),
  // not for anything security- or access-relevant, so trusting the edge
  // network's own geo header is fine here — worst case is wrong marketing
  // copy, never an authorization decision.
  // Always strip any client-supplied value first — same trust boundary as
  // x-verified-user-id/x-bot-suspicion-* above.
  forwardedHeaders.delete("x-user-country");
  // NOTE: NextRequest.geo was removed in Next.js 15 (Vercel now exposes
  // geolocation via `@vercel/functions` in Node runtimes, not on the
  // request object at the Edge) — the ip-country header below is the
  // supported source on this Next version.
  const country =
    request.headers.get("x-vercel-ip-country") ||
    request.headers.get("cf-ipcountry") ||
    "";
  if (country) forwardedHeaders.set("x-user-country", country);

  const response = NextResponse.next({ request: { headers: forwardedHeaders } });
  // Carry over the session cookies that updateSession() may have rotated.
  for (const cookie of sessionResponse.cookies.getAll()) {
    response.cookies.set(cookie);
  }

  // Readable (non-httpOnly) cookie so client components can render
  // country-tailored copy without a network round trip. Non-sensitive,
  // best-effort — a stale or missing value just falls back to default copy.
  if (country && request.cookies.get("vx_country")?.value !== country) {
    response.cookies.set("vx_country", country, {
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
      sameSite: "lax",
    });
  }

  applyHeaders(response, requestId, nonce, csp, request);

  // No progressive-disclosure route gate — every page is reachable to an
  // authenticated user from first login; per-user_action authorization
  // (age gate, plan/tier checks, admin checks, etc.) still applies as
  // normal further down the stack.

  return response;
}

// ── Security headers ──────────────────────────────────────────────────────────

// Builds the CSP header value. Pulled out of applyHeaders() so the exact
// same string (and nonce) can be set on the *request* headers (for Next's
// SSR nonce auto-extraction — see the CSP-NONCE-FIX comment above) as well
// as the outgoing response the browser enforces against — mirroring the
// nonce with a different CSP string between the two would defeat the point.
function buildCsp(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://js.stripe.com https://api.paystack.co${isDev ? " 'unsafe-eval'" : ""}`,
    // No nonce here — nonces only gate <style> elements per the CSP spec,
    // never inline style="" attributes (which is what Radix UI's portal
    // positioning and Framer Motion's transform/opacity animations both
    // write directly via element.style.* at runtime — there's no server
    // render to attach a nonce to). Worse: per spec, style-src's
    // 'unsafe-inline' is silently ignored whenever a nonce OR hash is also
    // present in the same directive, so having both here didn't add
    // security — it just quietly disabled 'unsafe-inline' and blocked
    // every Radix/Framer Motion inline style, which is exactly what the
    // "Note that 'unsafe-inline' is ignored..." console warning was
    // reporting. No component in this codebase renders a nonce'd <style>
    // tag, so dropping the nonce from style-src costs nothing.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    [
      "connect-src 'self'",
      "https://*.supabase.co",
      "https://*.supabase.in",
      "https://openrouter.ai",
      "https://api.groq.com",
      "https://api.together.xyz",
      "https://api.anthropic.com",
      "wss://*.supabase.co",
      isDev ? "ws://localhost:* wss://localhost:*" : "",
    ].filter(Boolean).join(" "),
    "frame-src https://js.stripe.com https://hooks.paystack.co",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].filter(Boolean).join("; ");
}

function applyHeaders(
  response:  NextResponse,
  requestId: string,
  nonce:     string,
  csp:       string,
  request:   NextRequest,
): void {
  const { pathname } = request.nextUrl;

  response.headers.set("x-nonce",      nonce);
  response.headers.set("X-Request-ID", requestId);

  response.headers.set("Content-Security-Policy",         csp);
  response.headers.set("X-Frame-Options",                 "DENY");
  response.headers.set("X-Content-Type-Options",          "nosniff");
  response.headers.set("Referrer-Policy",                 "strict-origin-when-cross-origin");
  response.headers.set("Cross-Origin-Opener-Policy",      "same-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(self), payment=(), usb=(), serial=()"
  );
  response.headers.set("X-Permitted-Cross-Domain-Policies", "none");
  response.headers.set(
    "Cross-Origin-Resource-Policy",
    pathname.startsWith("/api/") ? "same-origin" : "same-site"
  );

  if (pathname.startsWith("/api/")) {
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    response.headers.set("Pragma",        "no-cache");
  }

  const origin = request.headers.get("origin") ?? "";
  if (ALLOWED_ORIGINS.includes(origin)) {
    response.headers.set("Access-Control-Allow-Origin",      origin);
    response.headers.set("Access-Control-Allow-Credentials", "true");
    response.headers.set("Access-Control-Allow-Methods",     "GET,POST,PUT,DELETE,OPTIONS");
    response.headers.set("Access-Control-Allow-Headers",     "Content-Type, Authorization, X-Request-ID, X-Idempotency-Key");
    response.headers.set("Vary", "Origin");
  }
}

// ── Matcher ───────────────────────────────────────────────────────────────────

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|eot)$).*)",
  ],
};
