/**
 * POST /api/auth/login-guard
 *
 * FEATURE (2026-08-21): thin, deliberately unauthenticated wrapper around
 * lib/auth/login-guard.ts — see that file's header for the full
 * rationale. Unauthenticated by necessity: this runs *before* a sign-in
 * has succeeded, so there's no session to check yet. Also picked up by
 * middleware.ts's existing "Auth-route rate limit" (10 req/15min/IP,
 * matches any /api/auth/* path) as a second, coarser layer on top of the
 * scoped lockout below — that limiter's own comment names this exact
 * path pattern as the kind of route it was written for.
 *
 * Body: { action: "check" | "record-failure" | "record-success", email: string }
 *   - "check"           -> called before signInWithPassword()
 *   - "record-failure"  -> called after Supabase returns invalid credentials
 *   - "record-success"  -> called after a successful sign-in
 *
 * Never returns an error status for a malformed/missing email beyond 400 —
 * this must never become a way to probe which emails have accounts
 * (anti-enumeration, same posture as the sign-up flow's own handling of
 * Supabase's identities:[] signal).
 */
import { NextRequest, NextResponse } from "next/server";
import { checkLoginLockout, recordLoginFailure, clearLoginFailures } from "@/lib/auth/login-guard";
import { getClientIp } from "@/lib/network/get-client-ip";

export const dynamic = "force-dynamic";

const ACTIONS = ["check", "record-failure", "record-success"] as const;
type Action = (typeof ACTIONS)[number];

function isValidBody(body: unknown): body is { action: Action; email: string } {
  if (typeof body !== "object" || body === null) return false;
  const { action, email } = body as Record<string, unknown>;
  return (
    typeof action === "string" &&
    (ACTIONS as readonly string[]).includes(action) &&
    typeof email === "string" &&
    email.length > 0 &&
    email.length < 320
  );
}

export async function POST(req: NextRequest) {
  const body: unknown = await req.json().catch(() => null);
  if (!isValidBody(body)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const ip = getClientIp(req);

  if (body.action === "check") {
    const status = await checkLoginLockout(body.email, ip);
    return NextResponse.json(status);
  }

  if (body.action === "record-failure") {
    await recordLoginFailure(body.email, ip);
    return NextResponse.json({ ok: true });
  }

  await clearLoginFailures(body.email, ip);
  return NextResponse.json({ ok: true });
}
