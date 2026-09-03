/**
 * Feature flags — Vercel Edge Config backed, fail-open.
 *
 * `@vercel/edge-config` has been a dependency since early on but was never
 * wired up — every risky feature shipped as a full deploy with no kill
 * switch and no gradual rollout. This module fixes that.
 *
 * Edit flag values at https://vercel.com/<team>/<project>/stores (Edge
 * Config) or via `vercel edge-config` — this module only ever reads, it
 * never writes. Each key can hold either:
 *   - a plain boolean:                        `true` / `false`
 *   - an object for staged rollout / kill switch:
 *       { "enabled": true, "rolloutPercent": 25 }
 *     `enabled: false` always wins (hard kill switch, ignores percent).
 *     With no `userId` passed to isFeatureEnabled(), a rollout resolves to
 *     "on" only at rolloutPercent >= 100 — percentage rollouts only make
 *     sense when you can bucket a specific user.
 *
 * Every flag has a hardcoded default in FLAG_REGISTRY. If EDGE_CONFIG isn't
 * set (local dev, CI, or a deploy that hasn't linked a store yet) or the
 * read fails for any reason, flags silently resolve to that default — a
 * flags-provider outage must never be able to take the product down. This
 * mirrors the fail-open pattern already used by the circuit breaker
 * (src/lib/circuit-breaker.ts) and the fail-*closed* pattern used by
 * moderation (src/lib/moderation) — flags fail open because leaving a
 * feature ON is the safe direction; moderation fails closed because leaving
 * content unreviewed is not.
 */
import 'server-only';
import { createClient, type EdgeConfigClient } from '@vercel/edge-config';
import { bg } from '@/lib/logger';
import { env } from '@/env';

export type FlagKey = 'chat_video_generation_enabled';

interface FlagDefinition {
  /** Value used when Edge Config is unset, unreachable, or has no entry for this key. */
  default: boolean;
  description: string;
}

type RolloutValue = { enabled?: boolean; rolloutPercent?: number };
type RawFlagValue = boolean | RolloutValue | undefined;

/**
 * Every flag the app reads must be registered here with a safe default —
 * this is what the product falls back to if Edge Config is completely
 * unavailable, so the default should be "how the feature behaves today"
 * (i.e. on), not "off by default and Edge Config turns it on".
 */
export const FLAG_REGISTRY: Record<FlagKey, FlagDefinition> = {
  chat_video_generation_enabled: {
    default: true,
    description:
      'Kill switch for in-chat video generation (HotAPI primary, Atlas fallback — ' +
      'submit + poll routes). Flip off if both providers have an outage, latency ' +
      'spikes, or spend needs to be capped without a redeploy.',
  },
};

const CACHE_TTL_MS = 30_000;
const cache = new Map<FlagKey, { value: boolean | RolloutValue; expiresAt: number }>();

// Lazily resolved once per server instance. `undefined` = not yet resolved,
// `null` = resolved and unavailable (no EDGE_CONFIG env var set).
let client: EdgeConfigClient | null | undefined;

function getClient(): EdgeConfigClient | null {
  if (client !== undefined) return client;
  client = env.EDGE_CONFIG ? createClient(env.EDGE_CONFIG) : null;
  return client;
}

/**
 * Resolve a feature flag. Never throws — any failure (missing env var,
 * network error, malformed value) resolves to the flag's registered
 * default. Results are cached in-memory per server instance for
 * CACHE_TTL_MS so a hot route doesn't hit Edge Config on every request.
 *
 * Pass `userId` for flags that use percentage rollout — the same user
 * always lands in the same bucket for a given key, so they don't flicker
 * in and out of a rollout across requests.
 */
export async function isFeatureEnabled(key: FlagKey, opts: { userId?: string } = {}): Promise<boolean> {
  const def = FLAG_REGISTRY[key];

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return resolveCachedForUser(cached.value, key, opts.userId);
  }

  const edgeClient = getClient();
  if (!edgeClient) return def.default;

  try {
    const raw = await edgeClient.get<RawFlagValue>(key);
    cache.set(key, { value: normalizeRaw(raw, def), expiresAt: Date.now() + CACHE_TTL_MS });
    return resolveFlagValue(raw, def, key, opts.userId);
  } catch (err) {
    bg(`flags.${key}.read`)(err);
    return def.default;
  }
}

// The cache stores the flat resolved-or-rollout state; percentage rollout
// bucketing still needs to be re-applied per user even on a cache hit.
function resolveCachedForUser(cachedValue: boolean | RolloutValue, key: FlagKey, userId?: string): boolean {
  if (typeof cachedValue === 'boolean') return cachedValue;
  return resolveFlagValue(cachedValue, FLAG_REGISTRY[key], key, userId);
}

function normalizeRaw(raw: RawFlagValue, def: FlagDefinition): boolean | RolloutValue {
  if (raw === undefined) return def.default;
  return raw;
}

function resolveFlagValue(raw: RawFlagValue, def: FlagDefinition, key: string, userId?: string): boolean {
  if (raw === undefined) return def.default;
  if (typeof raw === 'boolean') return raw;

  if (raw.enabled === false) return false;
  if (typeof raw.rolloutPercent === 'number') {
    return userId ? isInRollout(userId, key, raw.rolloutPercent) : raw.rolloutPercent >= 100;
  }
  return raw.enabled ?? def.default;
}

// Deterministic bucketing via a small string hash — no crypto needed, this
// only has to be stable and roughly uniform, not unguessable.
function isInRollout(userId: string, key: string, percent: number): boolean {
  const bucket = hashToBucket(`${key}:${userId}`);
  return bucket < Math.max(0, Math.min(100, percent));
}

function hashToBucket(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 100;
}

/** Test/ops helper — clears the in-memory cache so a changed flag takes effect immediately. */
export function __clearFlagCache(): void {
  cache.clear();
}
