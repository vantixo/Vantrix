/**
 * getAuthedUser — single-round-trip auth for API route handlers.
 *
 * PERF: `middleware.ts` already calls `supabase.auth.getUser()` once per
 * request (to refresh the session cookie) and forwards the verified user id
 * via the `x-verified-user-id` request header. Before this helper, every
 * route handler called `supabase.auth.getUser()` again — a *second* network
 * round-trip to Supabase's Auth server (typically 80-300ms) on top of the
 * one middleware already paid for, on every single API request.
 *
 * This helper trusts that header when present (it cannot be spoofed: the
 * root middleware always overwrites or strips any client-supplied value
 * before the request reaches a route handler — see middleware.ts). When the
 * header is absent (e.g. a route outside the middleware matcher, or local
 * testing), it falls back to a real `getUser()` call so auth is never
 * silently skipped.
 *
 * BUG FIX (this revision): the fast path previously returned the
 * cookie-bound `supabase` client without ever calling an auth method on
 * THIS specific instance. Trusting the forwarded header satisfies the
 * *identity* check, but the client itself still needs a local session
 * hydration for its own PostgREST requests to carry the user's JWT —
 * without it, `auth.uid()` is NULL inside any RLS policy, and
 * RLS-protected queries made with the returned `supabase` client (e.g. the
 * `profiles` lookup in /api/chat) silently return no rows for every single
 * request, on every route using this helper — not a spoofing risk, but a
 * correctness bug that broke ~55 routes at once. `getSession()` reads from
 * the cookie-backed local storage adapter (no extra network round-trip) and
 * is enough to attach the Authorization header correctly, preserving the
 * single-round-trip performance goal this helper exists for.
 */
import { cache } from 'react';
import { headers } from 'next/headers';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { breakers } from '@/lib/circuit-breaker';
import { CircuitOpenError } from '@/lib/errors';

export const VERIFIED_USER_HEADER = 'x-verified-user-id';

/**
 * Fallback-path-only timeout for supabase.auth.getUser(). The Supabase JS
 * client does not expose an AbortSignal/timeout option on this call, so a
 * hung network request would otherwise block the entire route handler
 * indefinitely — there's no other backstop. 8s is generous relative to
 * getUser()'s normal 80-300ms, while still failing well before typical
 * platform request timeouts (Vercel's default is 10s/60s depending on
 * plan/runtime).
 */
const AUTH_FALLBACK_TIMEOUT_MS = 8_000;

async function getUserWithTimeout(
  supabase: Awaited<ReturnType<typeof createClient>>,
): ReturnType<typeof supabase.auth.getUser> {
  return Promise.race([
    supabase.auth.getUser(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('supabase.auth.getUser() timed out')), AUTH_FALLBACK_TIMEOUT_MS),
    ),
  ]);
}

/**
 * PERF (2026-08-26, whole-app pass): wrapped with React's `cache()` so
 * multiple calls within the same request tree collapse into one. This
 * was already cheap per-call (see the header-trust fast path above), but
 * "cheap" isn't "free" — the match detail page alone now calls this from
 * 7 independent places in a single Promise.all (getDatingMatch,
 * getGiftShop, getChemistry, getForecast, getCompatibility,
 * getPrestigeStatus, getActiveDateSession — see
 * lib/dating/get-match-detail.ts), each doing its own createClient() +
 * headers() + getSession(). cache() is React's documented mechanism for
 * exactly this — request-scoped memoization of a zero-argument data
 * function — and Next's Route Handlers get the same request-scoped
 * dedup, so this is also safe (a no-op, not a correctness risk) for the
 * 133 API routes that each already call it once per request.
 */
async function getAuthedUserUncached(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: User | null;
  error: { message: string } | null;
}> {
  const supabase = await createClient();
  const forwardedUserId = (await headers()).get(VERIFIED_USER_HEADER);

  if (forwardedUserId) {
    // Middleware already verified the JWT for this request — but that
    // verification happened on a DIFFERENT client instance. This client's
    // own PostgREST requests still need a hydrated session to attach the
    // Authorization header; without it, auth.uid() is NULL inside any
    // RLS-protected query run with this `supabase` client (e.g. the
    // `profiles` lookup in /api/chat), and every such query silently
    // returns no rows — not an auth error, just an empty result — which
    // routes then (correctly, per their own logic) treat as "not found".
    // getSession() reads from the cookie-backed local storage adapter (no
    // extra network round trip) and is enough to attach it correctly. This
    // was previously missing entirely, breaking every RLS-protected query
    // made via the fast path on every request, for every signed-in user —
    // not a tier-specific or occasional issue.
    const { data: { session } } = await supabase.auth.getSession();

    // BUG FIX: this used to return `{ id: forwardedUserId } as User`, a
    // fake User object with every other field (email, user_metadata,
    // app_metadata, etc.) undefined. Middleware only forwards the id, not
    // the full user — but several callers (e.g.
    // /api/payments/paystack/initialize, which reads `user.email` and
    // rejects the request with "Email address required" if it's falsy)
    // assume the object returned here is a real Supabase User. On the fast
    // path that assumption silently broke: every signed-in user hit that
    // branch since `user.email` was never populated, regardless of whether
    // their account actually had an email. getSession() already gives us
    // the real, full user object for free (no extra round trip — same
    // local cookie read as above) — use it, and only fall through to the
    // synthetic id-only object if the session's user id doesn't match what
    // middleware forwarded (defense in depth against a stale/mismatched
    // cookie, not the expected path).
    if (session?.user && session.user.id === forwardedUserId) {
      return {
        supabase,
        user: session.user,
        error: null,
      };
    }

    // Session cookie missing/stale/mismatched despite middleware having
    // verified the id — fall back to a real getUser() check rather than
    // silently trusting an unverified partial object.
    try {
      const { data: { user }, error } = await breakers.supabaseAuth().execute(
        () => getUserWithTimeout(supabase),
      );
      if (user && user.id === forwardedUserId) {
        return { supabase, user, error: null };
      }
      return {
        supabase,
        user: null,
        error: { message: error?.message ?? 'session mismatch' },
      };
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        return { supabase, user: null, error: { message: 'auth service temporarily unavailable' } };
      }
      return {
        supabase,
        user: null,
        error: { message: err instanceof Error ? err.message : 'auth check failed' },
      };
    }
  }

  // Fallback path — no header (route not covered by the middleware matcher,
  // or running in a context middleware doesn't see). Do the real check,
  // guarded by a timeout (Supabase's client exposes no signal/timeout
  // option of its own) and a circuit breaker (so a degraded Auth service
  // fails fast for subsequent requests instead of every one of them
  // separately waiting out the same timeout).
  try {
    const { data: { user }, error } = await breakers.supabaseAuth().execute(
      () => getUserWithTimeout(supabase),
    );
    return { supabase, user, error };
  } catch (err) {
    if (err instanceof CircuitOpenError) {
      return { supabase, user: null, error: { message: 'auth service temporarily unavailable' } };
    }
    return {
      supabase,
      user: null,
      error: { message: err instanceof Error ? err.message : 'auth check failed' },
    };
  }
}

export const getAuthedUser = cache(getAuthedUserUncached);
