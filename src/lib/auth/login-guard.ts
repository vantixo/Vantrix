/**
 * login-guard.ts
 *
 * FEATURE (2026-08-21): signInWithPassword() calls Supabase's hosted Auth
 * API directly from the browser (see middleware.ts's own "Auth-route
 * rate limit" comment and login-form.tsx's header) — our Next.js server
 * never sees that request, so nothing in this repo could previously slow
 * down a script hammering the login form with password guesses. Supabase
 * does rate-limit its Auth API server-side regardless, but the stronger
 * control — CAPTCHA on suspicious sign-in attempts — is a Supabase project
 * setting (Authentication → Attack Protection), not something enableable
 * from application code; that still needs to be turned on separately.
 *
 * This closes the gap that *is* fixable from here: the client now calls
 * POST /api/auth/login-guard before and after every sign-in attempt, so a
 * failed-password streak against a given account or from a given IP gets
 * locked out for a cooldown window even before Supabase's own API is ever
 * called. Two independent scopes, either one locks the attempt:
 *   - per-email  (5 failures / 15 min -> 15 min lock): stops an attacker
 *     grinding one account's password from many rotating IPs.
 *   - per-IP     (20 failures / 15 min -> 15 min lock): stops one IP
 *     credential-stuffing many different accounts. Deliberately looser
 *     than the email scope — a shared IP (office NAT, campus wifi, mobile
 *     carrier) can otherwise lock out unrelated real users.
 *
 * Same fail-open posture as every other limiter in rate-limit/ — this is
 * defense-in-depth, not the primary authentication check, so a Redis
 * outage must never be able to lock every user out of signing in.
 */
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';

const EMAIL_MAX_FAILURES = 5;
const EMAIL_WINDOW_SECONDS = 15 * 60;
const EMAIL_LOCK_SECONDS = 15 * 60;

const IP_MAX_FAILURES = 20;
const IP_WINDOW_SECONDS = 15 * 60;
const IP_LOCK_SECONDS = 15 * 60;

type Scope = 'email' | 'ip';

const failKey = (scope: Scope, identity: string) => `vantrix:login-guard:fail:${scope}:${identity}`;
const lockKey = (scope: Scope, identity: string) => `vantrix:login-guard:lock:${scope}:${identity}`;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface LoginGuardStatus {
  locked: boolean;
  /** Seconds until the lock clears, only present when locked. */
  retryAfterSeconds?: number;
}

async function checkScope(scope: Scope, identity: string): Promise<LoginGuardStatus> {
  try {
    const ttl = await redis.ttl(lockKey(scope, identity));
    // Upstash returns -2 for "key doesn't exist", -1 for "no expiry set".
    // Either means not locked; only a positive ttl is an active lock.
    if (ttl > 0) return { locked: true, retryAfterSeconds: ttl };
    return { locked: false };
  } catch (err) {
    logger.warn('[login-guard] check failed, failing open', { scope, error: String(err) });
    return { locked: false };
  }
}

/** Call before attempting signInWithPassword. Checks both scopes; the tighter one wins. */
export async function checkLoginLockout(email: string, ip: string | null): Promise<LoginGuardStatus> {
  const [byEmail, byIp] = await Promise.all([
    checkScope('email', normalizeEmail(email)),
    ip ? checkScope('ip', ip) : Promise.resolve<LoginGuardStatus>({ locked: false }),
  ]);
  if (byEmail.locked || byIp.locked) {
    return {
      locked: true,
      retryAfterSeconds: Math.max(byEmail.retryAfterSeconds ?? 0, byIp.retryAfterSeconds ?? 0),
    };
  }
  return { locked: false };
}

async function recordScopeFailure(scope: Scope, identity: string, maxFailures: number, windowSeconds: number, lockSeconds: number): Promise<void> {
  try {
    const key = failKey(scope, identity);
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSeconds);
    if (count >= maxFailures) {
      await redis.set(lockKey(scope, identity), '1', { ex: lockSeconds });
      await redis.del(key);
    }
  } catch (err) {
    logger.warn('[login-guard] record failure failed, failing open', { scope, error: String(err) });
  }
}

/** Call after Supabase returns an invalid-credentials error. */
export async function recordLoginFailure(email: string, ip: string | null): Promise<void> {
  await Promise.all([
    recordScopeFailure('email', normalizeEmail(email), EMAIL_MAX_FAILURES, EMAIL_WINDOW_SECONDS, EMAIL_LOCK_SECONDS),
    ip ? recordScopeFailure('ip', ip, IP_MAX_FAILURES, IP_WINDOW_SECONDS, IP_LOCK_SECONDS) : Promise.resolve(),
  ]);
}

/** Call after a successful sign-in, so a real user's earlier typos don't count against their next login. */
export async function clearLoginFailures(email: string, ip: string | null): Promise<void> {
  try {
    const keys = [
      failKey('email', normalizeEmail(email)),
      lockKey('email', normalizeEmail(email)),
      ...(ip ? [failKey('ip', ip), lockKey('ip', ip)] : []),
    ];
    await Promise.all(keys.map(k => redis.del(k)));
  } catch (err) {
    logger.warn('[login-guard] clear failed', { error: String(err) });
  }
}
