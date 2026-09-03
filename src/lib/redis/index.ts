// src/lib/redis/index.ts
//
// NEW FILE — M-04
//
// 30+ files across src/lib/ were each calling `Redis.fromEnv()` at module
// load, creating independent singletons per cold start. Upstash REST is
// stateless HTTP so nothing "leaks" in a connection-pool sense, but it:
//   1. Wastes init cost on every cold start.
//   2. Means hardened-client.ts's circuit breaker was only watching ONE of
//      the parallel clients, not the one any given request actually used.
//
// MIGRATION: replace `const redis = Redis.fromEnv()` in every lib file
// with `import { redis } from '@/lib/redis'`. Applied here to billing-dlq,
// rate-limit/index, and security.ts — the files modified in this patch set.
// The remaining ~27 files should be migrated in a follow-up mechanical PR.

import { Redis } from '@upstash/redis';

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      throw new Error('Redis env vars (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN) missing');
    }
    _redis = new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return _redis;
}

// Proxy-based lazy singleton — identical pattern to the existing rate-limit
// singleton, but now shared across all consumers that import from this module.
export const redis = new Proxy({} as Redis, {
  get(_t, prop) {
    return (getRedis() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
