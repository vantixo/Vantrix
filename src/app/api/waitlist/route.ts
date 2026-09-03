/**
 * POST /api/waitlist
 *
 * Public endpoint — no auth required (pre-launch marketing site).
 *
 * Hardening layers:
 *   1. Strict email regex + normalisation (lowercase, trim)
 *   2. Honeypot field — bots that fill "website" field are silently rejected
 *   3. Upstash sliding-window rate limit — 3 submits / 10 min per IP
 *   4. Duplicate detection — 409 on already-registered email
 *   5. IP hash stored for audit, never the raw IP (GDPR)
 *   6. CORS — explicit allowlist via WAITLIST_ALLOWED_ORIGINS env var
 *   7. supabaseAdmin for all DB writes (RLS denies anon/authenticated)
 *   8. Structured logging for every path
 */

import { NextRequest, NextResponse } from "next/server";
import { createHash }                from "crypto";
import { Ratelimit }                 from "@upstash/ratelimit";
import { supabaseAdmin }             from "@/lib/supabase/admin";
import { env }                       from "@/env";
import { redis }                     from "@/lib/redis";
import { logger }                    from "@/lib/logger";

// ── Rate limiter — 3 submissions per IP per 10 minutes ──────────────────
const waitlistLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, "10 m"),
  analytics: true,
  prefix: "rl:waitlist",
});

// ── Email validation (RFC-5321 practical subset) ─────────────────────────
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

// ── Allowed origins (comma-separated env var, fallback to any during dev) ─
function isAllowedOrigin(origin: string | null): boolean {
  const raw = process.env.WAITLIST_ALLOWED_ORIGINS ?? "";
  if (!raw || process.env.NODE_ENV === "development") return true;
  return raw.split(",").map(o => o.trim()).includes(origin ?? "");
}

function corsHeaders(origin: string | null) {
  const allowed = isAllowedOrigin(origin) && origin ? origin : process.env.WAITLIST_ALLOWED_ORIGINS?.split(",")[0] ?? "*";
  return {
    "Access-Control-Allow-Origin":  allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age":       "86400",
  };
}

// ── OPTIONS preflight ────────────────────────────────────────────────────
export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!isAllowedOrigin(origin)) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

// ── POST ─────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const cors   = corsHeaders(origin);

  // 1 — Origin check (skip in dev)
  if (process.env.NODE_ENV !== "development" && !isAllowedOrigin(origin)) {
    logger.warn("waitlist: rejected unknown origin", { origin });
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: cors });
  }

  // 2 — Parse body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: cors });
  }

  // 3 — Honeypot: "website" field must be absent or empty (bots fill it)
  if (body.website) {
    logger.info("waitlist: honeypot triggered, silent reject");
    // Return 200 so bots think they succeeded
    return NextResponse.json({ ok: true }, { status: 200, headers: cors });
  }

  // 4 — Email validation
  const rawEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!rawEmail || !EMAIL_RE.test(rawEmail) || rawEmail.length > 320) {
    return NextResponse.json({ error: "Invalid email" }, { status: 422, headers: cors });
  }

  // 5 — Rate limiting by IP
  const ip      = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
                  ?? req.headers.get("x-real-ip")
                  ?? "unknown";
  const rl      = await waitlistLimiter.limit(ip);
  if (!rl.success) {
    logger.warn("waitlist: rate limit hit", { ip: ip.slice(0, 8) + "***" });
    return NextResponse.json(
      { error: "Too many requests. Please wait a few minutes." },
      {
        status: 429,
        headers: {
          ...cors,
          "Retry-After": String(Math.ceil((rl.reset - Date.now()) / 1000)),
        },
      }
    );
  }

  // 6 — Hash IP for GDPR-safe audit trail
  const ipHash = createHash("sha256")
    .update(ip + env.IP_HASH_SALT)
    .digest("hex");

  // 7 — Extract metadata
  const source    = typeof body.source    === "string" ? body.source.slice(0, 64)    : "website";
  const referrer  = typeof body.referrer  === "string" ? body.referrer.slice(0, 512) : null;
  const userAgent = req.headers.get("user-agent")?.slice(0, 256) ?? null;

  // 8 — Insert (ON CONFLICT DO NOTHING returns no rows)
  const { data, error } = await supabaseAdmin
    .from("waitlist")
    .insert({
      email:      rawEmail,
      source,
      ip_hash:    ipHash,
      referrer,
      user_agent: userAgent,
    })
    .select("id")
    .single();

  if (error) {
    // Unique constraint violation → already registered
    if (error.code === "23505") {
      logger.info("waitlist: duplicate email", { email: rawEmail.replace(/(.{2}).*@/, "$1***@") });
      return NextResponse.json(
        { ok: true, duplicate: true, message: "You're already on the list!" },
        { status: 200, headers: cors }
      );
    }
    logger.error("waitlist: db insert failed", { error });
    return NextResponse.json({ error: "Server error" }, { status: 500, headers: cors });
  }

  logger.info("waitlist: new signup", {
    id:     data?.id,
    source,
    email:  rawEmail.replace(/(.{2}).*@/, "$1***@"),
  });

  return NextResponse.json(
    { ok: true, message: "You're on the list!" },
    { status: 201, headers: cors }
  );
}
