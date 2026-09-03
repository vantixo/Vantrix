/**
 * Edge-safe rate limiter for Next.js Middleware.
 *
 * WHY THIS FILE EXISTS:
 * @upstash/redis ships two bundles: the default (fetch-based, Edge-compatible)
 * and /nodejs.mjs (uses process.version, EventEmitter, etc.). When webpack
 * bundles `rate-limit/index.ts` into the middleware Edge bundle it resolves
 * Redis.fromEnv() through the Node.js conditional export, triggering:
 *   "A Node.js API is used (process.version) which is not supported in the
 *    Edge Runtime."
 *
 * Fix: instantiate Redis lazily inside the function (not at module scope),
 * using the explicit {url, token} constructor which only calls fetch() — 
 * fully Edge-compatible. This module is ONLY imported by middleware.ts.
 */

import { Ratelimit } from '@upstash/ratelimit';
// FIX: @upstash/redis v1.30 maps "." → nodejs.mjs (uses process.version at
// module-eval time), which triggers an Edge Runtime warning and *will* throw
// at Vercel Edge because process is not defined there.  The /cloudflare entry
// ships an identical API built on fetch() + Web Crypto — fully Edge-safe.
import { Redis }     from '@upstash/redis/cloudflare';

function getAuthLimiter(): Ratelimit {
  // Lazy construction: process.env is read at call time (inside a request),
  // not at bundle evaluation time, so webpack never sees process.* usage.
  const redis = new Redis({
    url:   process.env.UPSTASH_REDIS_REST_URL   ?? '',
    token: process.env.UPSTASH_REDIS_REST_TOKEN ?? '',
  });
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, '15 m'),
    analytics: false,          // analytics require extra Redis calls; skip in middleware
    prefix: 'rl:auth',
  });
}

// General blanket limiter for ALL /api/* traffic (not just auth). This is
// intentionally coarse and generous — its job is to shed obvious floods
// (bot scripts, misbehaving clients retrying in a tight loop) before they
// reach any route handler, not to enforce per-feature business limits.
// Per-route limiters in rate-limit/index.ts (chat, images, uploads, etc.)
// still apply on top of this for routes that use them; this just closes
// the gap for the ~90 routes that don't have their own limiter.
function getApiLimiter(): Ratelimit {
  const redis = new Redis({
    url:   process.env.UPSTASH_REDIS_REST_URL   ?? '',
    token: process.env.UPSTASH_REDIS_REST_TOKEN ?? '',
  });
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(120, '1 m'), // 2 req/sec sustained per IP
    analytics: false,
    prefix: 'rl:api',
  });
}

// Singleton — created on first request, reused across warm invocations
let _authLimiter: Ratelimit | null = null;

export function getEdgeAuthLimiter(): Ratelimit {
  if (!_authLimiter) {
    _authLimiter = getAuthLimiter();
  }
  return _authLimiter;
}

let _apiLimiter: Ratelimit | null = null;

export function getEdgeApiLimiter(): Ratelimit {
  if (!_apiLimiter) {
    _apiLimiter = getApiLimiter();
  }
  return _apiLimiter;
}
