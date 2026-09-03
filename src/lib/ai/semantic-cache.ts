/**
 * Semantic Cache — Generic-Opener Response Caching
 *
 * RE-SCOPED (2026-08-23, cost audit) — see the comment on checkSemanticCache()
 * below. Previously DISABLED (2026-08-08) outright after the original design
 * (any near-duplicate message, matched via MinHash/Jaccard, shared across
 * *any* two users on the same character) served one user's cached reply to
 * another as their companion's own words — see git history / AUDIT_FINDINGS_LOG
 * for the original bug.
 *
 * Re-enabled here, but scoped much narrower than before: only messages that
 * normalize to an entry in GENERIC_OPENERS (below) — greetings, farewells,
 * acks, "thanks", "how are you" — are eligible to be cached and reused
 * across users. These are the messages where a shared, non-personal reply
 * is already the norm for a chat product (nobody expects "hi" to get a
 * bespoke response), and they're also disproportionately common as a
 * conversation's first message — which is where the cost actually is. The
 * broader MinHash/LSH near-duplicate layer (Layer 2/3 below) that caused
 * the original bug is left in place, unused, rather than wired back in —
 * it matched arbitrary messages, not just generic ones, which is
 * specifically the behavior that got this disabled.
 *
 * Original three-layer design (Layer 2/3 currently unused — see above):
 *
 * Problem with SHA-256 exact-match caching:
 *   "How are you?" and "How are u doing?" are semantically identical but hash
 *   differently → wasteful model call on the second request.
 *
 * Solution — three-layer semantic equivalence:
 *
 *   Layer 1 — Canonical normalization (LIVE):
 *     Punctuation removal, case folding, whitespace collapse, and a
 *     curated synonym table for common short phrases (greetings, acks,
 *     farewells). Zero-cost, zero-latency. Only this layer runs today,
 *     and only for messages that land in GENERIC_OPENERS.
 *
 *   Layer 2 — Word-level MinHash (64 hash functions, 8 LSH bands × 8 values):
 *     For messages > 4 words we compute a MinHash signature and write the
 *     signature's LSH bucket keys into Redis. On a query we probe those
 *     same buckets to find candidate cache keys quickly. UNUSED — this is
 *     what let arbitrary (non-generic) messages match and share replies.
 *
 *   Layer 3 — Jaccard similarity gating:
 *     For each LSH candidate we compute the true Jaccard similarity from the
 *     stored word set. We only return the cached reply if similarity ≥ 0.82.
 *     UNUSED, same reason as Layer 2.
 *
 * Bypassed for:
 *   - premium tier (freshness guarantee — was elite/enterprise under the
 *     old multi-tier model; see TWO-TIER MODEL note at BYPASS_TIERS below)
 *   - dating mode (emotionally dynamic)
 *   - memory-enriched prompts (personalised, never generic)
 *   - messages > 400 chars (likely unique)
 *   - anything that doesn't normalize to a GENERIC_OPENERS entry
 */

import { createHash } from 'crypto';
import type { Tier }  from '@/lib/rate-limit';
import { redis }              from '@/lib/redis';
import { bg }                 from '@/lib/logger';


// ── Config ────────────────────────────────────────────────────────────────────

const SIMILARITY_THRESHOLD = 0.82;
const MAX_CACHEABLE_CHARS   = 400;
const LSH_BANDS             = 8;
const LSH_ROWS              = 8;    // rows per band; signature length = 64
const CACHE_TTL             = 300;  // 5 minutes
const LSH_TTL               = 360;  // slightly longer so we can probe after write
// TWO-TIER MODEL FIX: this was `new Set(['elite', 'enterprise'])`. Tier is
// now typed as 'free' | 'premium' (lib/rate-limit), so 'elite'/'enterprise'
// could never match isCacheable()'s `BYPASS_TIERS.has(tier)` check below —
// premium (paying) users were silently getting cached, potentially stale,
// replies instead of the freshness guarantee this set exists to provide.
const BYPASS_TIERS: Set<Tier> = new Set<Tier>(['premium']);

// ── Synonym / canonical table ─────────────────────────────────────────────────

const CANONICAL_MAP: Record<string, string> = {
  // greetings
  hi: 'hello', hey: 'hello', heya: 'hello', hiya: 'hello', sup: 'hello',
  howdy: 'hello', 'hey there': 'hello', 'hi there': 'hello',
  // farewells
  bye: 'goodbye', 'bye bye': 'goodbye', cya: 'goodbye', 'see ya': 'goodbye',
  later: 'goodbye', 'talk later': 'goodbye',
  // acks
  ok: 'okay', k: 'okay', yep: 'yes', yup: 'yes', yeah: 'yes', nope: 'no',
  nah: 'no', sure: 'yes', alright: 'okay',
  // common check-ins
  'how are you': 'how are you', 'how r u': 'how are you',
  'how are u': 'how are you', 'hows it going': 'how are you',
  'whats up': 'how are you', "what's up": 'how are you',
  'how have you been': 'how are you',
  // thanks
  thx: 'thanks', ty: 'thanks', 'thank you': 'thanks', 'ty so much': 'thanks',
  'thanks a lot': 'thanks',
};

// ── Generic-opener allowlist ──────────────────────────────────────────────────
// The only normalized messages eligible for a cross-user cached reply — every
// entry here is one of CANONICAL_MAP's *output* values, so this stays in sync
// with the synonym table by construction rather than needing a second list
// hand-maintained alongside it.
const GENERIC_OPENERS: Set<string> = new Set(Object.values(CANONICAL_MAP));



const cacheDayKey = (type: 'hits' | 'misses') =>
  `vantrix:metrics:cache_${type}:${new Date().toISOString().slice(0, 10)}`;

async function trackCacheMetric(type: 'hit' | 'miss'): Promise<void> {
  // Metrics are non-critical — a Redis hiccup here must never fail the
  // chat request itself (checkSemanticCache() awaits this inline before
  // returning a hit). Same "optimization, not a dependency" contract as
  // storeSemanticCache()'s own try/catch below.
  try {
    const key = type === 'hit' ? cacheDayKey('hits') : cacheDayKey('misses');
    // Expire at end of day UTC
    const eod = new Date(); eod.setUTCHours(23, 59, 59, 0);
    const pipe = redis.pipeline();
    pipe.incr(key);
    pipe.expireat(key, Math.floor(eod.getTime() / 1000));
    await pipe.exec();
  } catch { /* non-critical */ }
}

// ── Normalize ─────────────────────────────────────────────────────────────────

function normalize(text: string): string {
  let s = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Try full canonical match first
  if (CANONICAL_MAP[s]) return CANONICAL_MAP[s];

  // Partial: replace known short substrings
  for (const [pat, canon] of Object.entries(CANONICAL_MAP)) {
    if (s === pat || s.startsWith(pat + ' ')) {
      s = s.replace(pat, canon);
      break;
    }
  }
  return s;
}

function wordSet(text: string): Set<string> {
  return new Set(text.split(/\s+/).filter(w => w.length > 1));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

// ── MinHash (64 hash functions) ───────────────────────────────────────────────

// Pre-computed large primes for universal hashing: h_i(x) = (a_i * x + b_i) mod p
const PRIME = 2_147_483_647; // Mersenne prime 2^31-1
const HASH_PARAMS: [number, number][] = Array.from({ length: 64 }, (_, i) => [
  (1_664_525 + i * 1_013_904_223) >>> 0,
  (1_013_904_223 + i * 1_664_525) >>> 0,
]);

function minhashSignature(words: Set<string>): number[] {
  const sig = new Array<number>(64).fill(Number.MAX_SAFE_INTEGER);
  for (const word of words) {
    let h = 0;
    for (let j = 0; j < word.length; j++) h = (Math.imul(31, h) + word.charCodeAt(j)) | 0;
    const x = Math.abs(h);
    for (let i = 0; i < 64; i++) {
      const [a, b] = HASH_PARAMS[i];
      const hv = ((Math.imul(a, x) + b) % PRIME + PRIME) % PRIME;
      if (hv < sig[i]) sig[i] = hv;
    }
  }
  return sig;
}

/** LSH band keys: 8 bands × 8 rows → 8 Redis keys per signature */
function lshBandKeys(sig: number[], systemHash: string): string[] {
  const keys: string[] = [];
  for (let b = 0; b < LSH_BANDS; b++) {
    const band = sig.slice(b * LSH_ROWS, (b + 1) * LSH_ROWS).join('|');
    const bh   = createHash('sha256').update(`${systemHash}:${b}:${band}`).digest('hex').slice(0, 16);
    keys.push(`ai:slsh:${bh}`);
  }
  return keys;
}

// ── Cache key (exact match, reused from response-cache.ts) ───────────────────

function exactKey(systemPrompt: string, normalized: string): string {
  const h = createHash('sha256').update(systemPrompt + '\n\n' + normalized).digest('hex').slice(0, 24);
  return `ai:sresp:${h}`;
}

function systemHash(systemPrompt: string): string {
  return createHash('sha256').update(systemPrompt).digest('hex').slice(0, 16);
}

// ── Public types ──────────────────────────────────────────────────────────────

export type SemanticCacheResult =
  | {
      hit:   true;
      reply: string;
      key:   string;
      mode:  'exact' | 'canonical' | 'semantic';
    }
  | {
      hit:   false;
      key:   string | null;
      words: Set<string>;
      sig:   number[] | null;
      bandKeys: string[] | null;
    };

// ── Cacheable predicate ───────────────────────────────────────────────────────
// Tier/mode/length gates are unchanged from the original design. The
// GENERIC_OPENERS check happens separately in checkSemanticCache() (it needs
// the *normalized* message, computed there) rather than here.
function isCacheable(tier: Tier, msg: string, datingMode: boolean, hasMemory: boolean): boolean {
  if (BYPASS_TIERS.has(tier)) return false;
  if (datingMode)              return false;
  if (hasMemory)               return false;
  if (msg.length > MAX_CACHEABLE_CHARS) return false;
  return true;
}

// ── Check ─────────────────────────────────────────────────────────────────────

export async function checkSemanticCache(params: {
  tier:         Tier;
  systemPrompt: string;
  userMsg:  string;
  datingMode:   boolean;
  hasMemory:    boolean;
}): Promise<SemanticCacheResult> {
  const { tier, systemPrompt, userMsg, datingMode, hasMemory } = params;
  const miss = (key: string | null = null, words: Set<string> = new Set()): SemanticCacheResult =>
    ({ hit: false, key, words, sig: null, bandKeys: null });

  if (!isCacheable(tier, userMsg, datingMode, hasMemory)) return miss();

  const normalized = normalize(userMsg);

  // RE-SCOPED (2026-08-23): the only thing that changed from the fully
  // disabled version is this one check. Everything that isn't a fully
  // generic opener (see GENERIC_OPENERS / the file header for why) is a
  // guaranteed miss with a null key, same as when this was disabled
  // outright — storeSemanticCache() no-ops on a null key, so nothing built
  // from an actual personal exchange is ever written to a cross-user-
  // readable slot. Layer 2/3 (MinHash/LSH near-duplicate matching) stay
  // unused — wiring them back in would defeat the point of this allowlist,
  // since they're built to match messages *outside* it.
  if (!GENERIC_OPENERS.has(normalized)) return miss();

  const words = wordSet(normalized);
  const key   = exactKey(systemPrompt, normalized);

  try {
    const cached = await redis.get<string>(key);
    if (cached) {
      await trackCacheMetric('hit');
      return { hit: true, reply: cached, key, mode: 'canonical' };
    }
  } catch (err) {
    // Redis unavailable — fail open to a miss rather than blocking the
    // request; same "cache is an optimization, never a dependency" contract
    // as storeSemanticCache()'s own try/catch below.
    bg('semantic-cache.check')(err);
    return miss();
  }

  await trackCacheMetric('miss');
  return miss(key, words);
}

// ── Store ─────────────────────────────────────────────────────────────────────

export async function storeSemanticCache(params: {
  key:      string | null;
  words:    Set<string>;
  sig:      number[] | null;
  bandKeys: string[] | null;
  reply:    string;
}): Promise<void> {
  const { key, words, sig, bandKeys, reply } = params;
  if (!key || !reply) return;

  try {
    const pipe = redis.pipeline();

    // Store reply
    pipe.set(key, reply, { ex: CACHE_TTL });

    // Store word set for Jaccard comparison
    pipe.set(`${key}:words`, JSON.stringify(Array.from(words)), { ex: CACHE_TTL });

    // Register key in LSH band buckets so future queries can find it
    if (sig && bandKeys) {
      for (const bk of bandKeys) {
        pipe.sadd(bk, key);
        pipe.expire(bk, LSH_TTL);
      }
    }

    await pipe.exec();
  } catch { /* non-critical */ }
}

/** Remove stale band entries (cleanup on explicit cache invalidation) */
export async function evictSemanticCache(key: string): Promise<void> {
  try {
    await redis.del(key, `${key}:words`);
  } catch { /* non-critical */ }
}
