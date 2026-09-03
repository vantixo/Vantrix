/**
 * Plan-aware rate limiting.
 *
 * TWO-TIER MODEL: exactly two tiers — free and premium — with separate
 * limits for chat, image generation, and a shared AI budget pool.
 *
 * All limiters use Upstash sliding window — Redis-backed, horizontally scalable.
 *
 * H-02: CHAT_LIMITS and DAILY_CAP are derived from @/lib/tiers/limits
 * (the single source of truth) instead of being hardcoded here. This closes
 * the false-advertising gap where the pricing page showed 75 msg/day for free
 * users but enforcement capped them at 20.
 */
import { Ratelimit }          from '@upstash/ratelimit';
import { redis }              from '@/lib/redis';
import { getTierLimits }      from '@/lib/tiers/limits';
import { withLocalFallback }  from '@/lib/rate-limit/local-fallback';

// ── Tier definitions ──────────────────────────────────────────────────────
export type Tier = 'free' | 'premium';

// H-02: no longer hardcoded here. Per-minute burst limits and daily caps are
// now derived from @/lib/tiers/limits — the single source of truth that also
// drives the pricing page and stream concurrency guards.
// The old CHAT_LIMITS object (free:20, premium:40 …) drove the per-minute slider;
// it is replaced by getTierLimits(tier).perMinuteBurst at the call site below.
// The old DAILY_CAP object (free:20 …) is replaced by getTierLimits(tier).dailyMessages.

// H-03: this is a per-MINUTE burst limiter only — it does NOT enforce the
// daily image figure shown on the pricing page (tiers/config.ts dailyImages /
// tiers/limits.ts TIER_LIMITS[tier].dailyImages). That daily cap is enforced
// separately by checkDailyImageCap() below. Do not treat IMAGE_LIMITS as the
// source of truth for "images per day" — it never was, despite the misleading
// error message shape shared with the daily-cap functions at some call sites.
// TWO-TIER MODEL: only 'free' is actually gated. 'premium' gets one real
// burst ceiling — a free user's per-minute burst is deliberately close to
// their whole daily allowance (1 image/day) since the daily cap in
// checkDailyImageCap is the real gate for them; the per-minute number here
// just stops one user hammering the endpoint in a tight loop before the
// daily-cap check even lands.
const IMAGE_LIMITS: Record<Tier, number> = {
  free:    2,
  premium: 30,
};

// Per-minute burst limiter for video generation — deliberately far lower
// than IMAGE_LIMITS since Kling generations are much more expensive and
// slower (30s-several min) than an image call. checkDailyVideoCap below
// enforces the actual daily figure from tiers/limits.ts, same split as
// images (H-03).
// TWO-TIER MODEL: free gets 0 (dailyVideos is also 0 for free — belt and
// braces), premium gets one real burst ceiling.
const VIDEO_LIMITS: Record<Tier, number> = {
  free:    0,
  premium: 5,
};

// ── Limiter factories ─────────────────────────────────────────────────────
// One sliding-window limiter per tier+type combination, lazily created
const _limiters = new Map<string, Ratelimit>();

function getLimiter(key: string, windowMs: number, max: number): Ratelimit {
  if (!_limiters.has(key)) {
    const windowStr = `${Math.round(windowMs / 1000)} s` as `${number} s`;
    _limiters.set(key, new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(max, windowStr), analytics: true }));
  }
  return _limiters.get(key)!;
}

// ── General API limiter (all authenticated routes, 30 req/min) ───────────
export const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, '1 m'),
  analytics: true,
});

// NOTE: the auth limiter lives in lib/rate-limit/edge.ts (getEdgeAuthLimiter),
// not here — middleware.ts runs on the Edge runtime, which cannot use the
// default @upstash/redis bundle this file imports. An `authLimiter` export
// used to exist in this file too but was never called anywhere (edge.ts's
// version is what's actually wired into middleware.ts); removed to avoid
// two divergent "auth limiter" implementations existing side by side.

// ── Upload limiter (20 uploads/hour per user) ─────────────────────────────
// Prevents storage abuse by authenticated users. Set lower than the chat
// limit because uploads consume storage and involve more expensive I/O.
export const uploadLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, '1 h'),
  analytics: true,
  prefix: 'rl:upload',
});

export interface RateLimitResult {
  allowed:   boolean;
  remaining: number;
  reset:     number;
  limit:     number;
}

/**
 * Check chat rate limit for a user/tier.
 * Returns richer info including the tier limit so the client can display it.
 * H-02: limit is now sourced from getTierLimits().perMinuteBurst — the single
 * source of truth — instead of the local CHAT_LIMITS constant.
 */
export async function checkChatLimit(userId: string, tier: Tier = 'free'): Promise<RateLimitResult> {
  const max     = getTierLimits(tier).perMinuteBurst;
  const limiter = getLimiter(`chat:${tier}`, 60_000, max);
  try {
    const { success, remaining, reset } = await limiter.limit(userId);
    return { allowed: success, remaining, reset, limit: max };
  } catch (err) {
    // Redis unreachable — degrade to local in-process fallback rather than
    // failing open (see lib/rate-limit/local-fallback.ts).
    const allowed = await withLocalFallback(
      async () => { throw err; },
      `local:chat:${tier}:${userId}`,
      max,
      60_000,
    );
    return { allowed, remaining: allowed ? 0 : 0, reset: Date.now() + 60_000, limit: max };
  }
}

// ── Dating-action limiter (GIFT-RATE-FIX / DATE-RATE-FIX / MOOD-RATE-FIX) ──
// /api/dating/gifts, /api/dating/date/start, and /api/dating/mood all
// previously called checkChatLimit(), which points at the *same* Redis
// bucket + key (`chat:${tier}`, keyed by userId) as ordinary chat messages.
// That meant any of these actions was silently debited from — and blocked
// by — whatever burst budget the user had already spent chatting: on the
// free tier (perMinuteBurst: 10) a completely normal few minutes of
// conversation was enough to exhaust the bucket, after which sending a
// gift, starting a date, or changing scene mood would come back with a
// 429 RATE_LIMIT_EXCEEDED for a user who had done nothing wrong and never
// touched that endpoint before. Each of these actions already has its own
// real economic throttle (token cost via deduct_tokens/start_date_session),
// so this only needs a generous shared anti-automation ceiling of its own —
// same pattern as checkImageLimit/checkVideoLimit, which already don't
// share the chat bucket either.
const DATING_ACTION_LIMITS: Record<Tier, number> = {
  free:    10,
  premium: 30,
};

export async function checkDatingActionLimit(userId: string, tier: Tier = 'free'): Promise<RateLimitResult> {
  const max     = DATING_ACTION_LIMITS[tier];
  const limiter = getLimiter(`dating-action:${tier}`, 60_000, max);
  try {
    const { success, remaining, reset } = await limiter.limit(userId);
    return { allowed: success, remaining, reset, limit: max };
  } catch (err) {
    const allowed = await withLocalFallback(
      async () => { throw err; },
      `local:dating-action:${tier}:${userId}`,
      max,
      60_000,
    );
    return { allowed, remaining: allowed ? 0 : 0, reset: Date.now() + 60_000, limit: max };
  }
}

// HARDEN-FIX: community post/reply creation and character creation had zero
// rate-limit protection — each is a real abuse surface (unmoderated feed
// spam; character creation also triggers an AI moderation call per attempt,
// so unlimited retries are a real cost, not just noise) but neither had a
// dedicated checkXLimit() the way chat/image/video/swipe already do.
// Deliberately NOT applied to daily-choice voting — castVote() already
// enforces one-vote-per-user at the DB level (checks existing + handles the
// unique-violation race), so a rate limiter there would only add friction
// with no real protection gained.
//
// Not tier-aware like the limiters above (no plan differentiates "how many
// community posts/characters per hour" today) — same shape as
// uploadLimiter, a flat per-user ceiling generous enough not to affect any
// real user, tight enough to stop scripted spam.
export async function checkActionLimit(
  userId: string,
  action: 'community_post' | 'community_reply' | 'community_room_chat' | 'character_create' | 'ai_recommend' | 'character_concept_generate',
): Promise<RateLimitResult> {
  const CEILINGS: Record<typeof action, { max: number; windowMs: number }> = {
    community_post:    { max: 10, windowMs: 60 * 60_000 }, // 10/hour
    community_reply:   { max: 30, windowMs: 60 * 60_000 }, // 30/hour
    // Single shared per-character room, all users posting into one feed —
    // needs a tighter per-minute ceiling than the post/reply actions above
    // (those are 1 write per page load; a room is a live chat surface
    // someone could script into a flood). 20/min is generous for a real
    // human typing, tight enough to stop a scripted spam loop.
    community_room_chat: { max: 20, windowMs: 60_000 }, // 20/minute
    character_create:  { max: 5,  windowMs: 60 * 60_000 }, // 5/hour
    // Cheap read (candidate fetch + one /rerank call) but still worth a
    // ceiling since it's reachable without auth (see recommend route) —
    // generous enough for real use (a person trying a few different
    // descriptions), tight enough to stop it being used as a free-form
    // scraping/embedding endpoint against the character catalog.
    ai_recommend:       { max: 20, windowMs: 60_000 },     // 20/minute
    // Character Concept stage (generate-concept route) — a real POWER-tier
    // LLM call, more expensive than ai_recommend but a creator legitimately
    // wants a few regenerations while drafting one character. Generous
    // enough for iterating on a single concept, tight enough that it can't
    // be looped into a free bulk-generation endpoint.
    character_concept_generate: { max: 15, windowMs: 60 * 60_000 }, // 15/hour
  };
  const { max, windowMs } = CEILINGS[action];
  const limiter = getLimiter(`action:${action}`, windowMs, max);
  try {
    const { success, remaining, reset } = await limiter.limit(userId);
    return { allowed: success, remaining, reset, limit: max };
  } catch (err) {
    const allowed = await withLocalFallback(
      async () => { throw err; },
      `local:action:${action}:${userId}`,
      max,
      windowMs,
    );
    return { allowed, remaining: allowed ? 0 : 0, reset: Date.now() + windowMs, limit: max };
  }
}

/**
 * Check image generation rate limit.
 */
export async function checkImageLimit(userId: string, tier: Tier = 'free'): Promise<RateLimitResult> {
  const max     = IMAGE_LIMITS[tier] ?? IMAGE_LIMITS.free;
  const limiter = getLimiter(`image:${tier}`, 60_000, max);
  try {
    const { success, remaining, reset } = await limiter.limit(userId);
    return { allowed: success, remaining, reset, limit: max };
  } catch (err) {
    const allowed = await withLocalFallback(
      async () => { throw err; },
      `local:image:${tier}:${userId}`,
      max,
      60_000,
    );
    return { allowed, remaining: allowed ? 0 : 0, reset: Date.now() + 60_000, limit: max };
  }
}

/**
 * Check video generation rate limit (per-minute burst — see checkDailyVideoCap
 * for the actual daily cap). Modeled directly on checkImageLimit.
 */
export async function checkVideoLimit(userId: string, tier: Tier = 'free'): Promise<RateLimitResult> {
  const max     = VIDEO_LIMITS[tier] ?? VIDEO_LIMITS.free;
  const limiter = getLimiter(`video:${tier}`, 60_000, Math.max(max, 1));
  try {
    const { success, remaining, reset } = await limiter.limit(userId);
    // max can be 0 (free tier) — the underlying limiter needs a positive
    // window size, so force-deny here instead of ever allowing a 0-tier user.
    return { allowed: max > 0 && success, remaining, reset, limit: max };
  } catch (err) {
    if (max === 0) return { allowed: false, remaining: 0, reset: Date.now() + 60_000, limit: max };
    const allowed = await withLocalFallback(
      async () => { throw err; },
      `local:video:${tier}:${userId}`,
      max,
      60_000,
    );
    return { allowed, remaining: allowed ? 0 : 0, reset: Date.now() + 60_000, limit: max };
  }
}

/**
 * Character tier gate. TWO-TIER MODEL: characters.min_tier is only ever
 * 'free' or 'premium' now. A character with min_tier = 'premium' is
 * genuinely VIP-exclusive: Spark, Basic, and Premium subscribers are all
 * blocked, same as Free.
 *
 * `characterIsPremium` is accepted as a fallback for any character row that
 * has no min_tier set (legacy data, or a race with the backfill migration):
 * in that case an is_premium=true character is treated as 'premium'-gated,
 * matching the old behavior, rather than silently allowing everyone through.
 */
// PRODUCT DECISION (this revision): no character is tier-locked anymore —
// every character is reachable by every account, paid or not. Kept as a
// function (rather than removed) so existing call sites still compile;
// characterMinTier/characterIsPremium are accepted but intentionally
// ignored.
export function checkCharacterTierAccess(
  _tier: Tier,
  _characterMinTier: Tier | null | undefined,
  _characterIsPremium = false,
): { allowed: boolean; reason?: string } {
  return { allowed: true };
}

/**
 * Shared core of the midnight-UTC-aligned daily counters below
 * (checkDailyMessageCap, checkPerCharacterMessageCap, checkDailyImageCap,
 * checkDailyVideoCap, checkSwipeLimit). Atomically increments `key` and
 * expires it at the next UTC midnight rather than +86400s from first use.
 *
 * ARCH-01: a flat 86400s window would slide — a user who first hits the
 * counter at 23:59 would get a full extra day before the midnight cron
 * resets the corresponding *_used column. Aligning to midnight UTC keeps
 * the Redis counter in sync with the cron for all five callers.
 *
 * Deliberately does NOT catch errors and does NOT decide fail-open vs.
 * fail-closed — each caller has its own, intentionally-different Redis
 * outage behavior (see each function's own comment), so that decision
 * stays at the call site.
 */
async function checkMidnightAlignedCap(
  key: string,
  limit: number,
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const pipe = redis.pipeline();
  pipe.incr(key);

  const now      = new Date();
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  const ttlSeconds = Math.ceil((midnight.getTime() - now.getTime()) / 1000);
  pipe.expire(key, ttlSeconds);

  const [count] = await pipe.exec() as [number, unknown];

  return count > limit
    ? { allowed: false, used: count, limit }
    : { allowed: true, used: count, limit };
}

/**
 * Hard daily message cap check via Redis counter.
 * Uses a key that expires at midnight UTC so the count resets daily.
 * This is a second layer on top of the sliding-window limiter — prevents
 * any user from going beyond their daily limit by any means, including
 * retries, queue jobs, or streaming connections.
 *
 * H-02: limit is now sourced from getTierLimits().dailyMessages instead of
 * the local DAILY_CAP object, closing the false-advertising gap where the
 * pricing page showed 75 msg/day for free users but enforcement capped at 20.
 * C-02: this function also increments the counter atomically — the streaming
 * route now calls it as a gate before emitting any SSE bytes.
 */
export async function checkDailyMessageCap(
  userId: string,
  tier: Tier,
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const limit = getTierLimits(tier).dailyMessages;

  const day      = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  const key      = `vantrix:daily:${userId}:${day}`;

  try {
    return await checkMidnightAlignedCap(key, limit);
  } catch {
    // COST-HARDENING: previously pure fail-open ("Redis down → allow
    // everything"). During an extended Redis outage that meant zero
    // enforcement of the daily message cap — the one backstop on total
    // per-user LLM spend — for as long as the outage lasted, across every
    // instance. Chat messages are real, metered OpenRouter cost, not a
    // cheap DB write, so this now degrades to the same in-process
    // sliding-window fallback checkChatLimit already uses for its
    // per-minute burst check (see local-fallback.ts) instead of allowing
    // unconditionally. This is per-instance only (no cross-instance
    // coordination) and resets on cold start, so it's a bridge, not a
    // replacement for Redis — but it means a Redis outage no longer
    // removes the daily cap entirely, only degrades its precision.
    const allowed = await withLocalFallback(
      async () => { throw new Error('redis-unavailable'); },
      `local:daily:msg:${userId}`,
      limit,
      24 * 60 * 60 * 1000,
    );
    return { allowed, used: allowed ? 0 : limit, limit };
  }
}

/**
 * Hard per-character daily message cap — a second, tighter constraint that
 * sits *inside* checkDailyMessageCap's total. Free/verified users get 30
 * messages/day total but at most getTierLimits(tier).perCharacterMessages
 * (5 for free) of those on any single character.
 *
 * Same midnight-UTC-aligned Redis counter pattern as checkDailyMessageCap /
 * checkSwipeLimit, keyed per (user, character) pair instead of just per user.
 * Call this in addition to, not instead of, checkDailyMessageCap — a user
 * hitting the per-character cap on one companion should still be free to
 * message a different character up to their remaining daily total.
 */
export async function checkPerCharacterMessageCap(
  userId: string,
  characterId: string,
  tier: Tier,
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const limit = getTierLimits(tier).perCharacterMessages;

  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  const key = `vantrix:daily:char:${userId}:${characterId}:${day}`;

  try {
    return await checkMidnightAlignedCap(key, limit);
  } catch {
    // COST-HARDENING: same reasoning as checkDailyMessageCap above — this
    // gates the same underlying LLM spend, just scoped per-character, so
    // it gets the same in-process fallback instead of unconditional allow.
    const allowed = await withLocalFallback(
      async () => { throw new Error('redis-unavailable'); },
      `local:daily:char:${userId}:${characterId}`,
      limit,
      24 * 60 * 60 * 1000,
    );
    return { allowed, used: allowed ? 0 : limit, limit };
  }
}

/**
 * Hard daily image-generation cap via Redis counter — H-03.
 *
 * Previously the ONLY image limiter was checkImageLimit/IMAGE_LIMITS above,
 * which is a per-MINUTE sliding-window burst limiter (free: 5/min), not a
 * daily cap at all. Meanwhile tiers/config.ts and the pricing page have
 * always promised a *daily* figure ("3 image generations/day" for free).
 * Nothing enforced that number — a free user could hit the per-minute
 * burst limiter's ceiling every minute, all day, for up to 7,200 images
 * against a 3/day promise. Same false-advertising class as H-02, and with
 * zero enforcement rather than merely mismatched enforcement.
 *
 * Modeled directly on checkDailyMessageCap: midnight-UTC-aligned Redis
 * counter, atomic increment. COST-HARDENING: on Redis outage this degrades
 * to the same in-process fallback as checkDailyMessageCap (see that
 * function's comment) rather than failing open — image generation is real,
 * metered provider spend (HotAPI/Atlas/Fal), same risk class as chat.
 * Call this in addition to checkImageLimit, not instead of it — the burst
 * limiter still protects against a tight-loop hammering the endpoint within
 * a single minute; this one protects the daily promise on the pricing page.
 */
export async function checkDailyImageCap(
  userId: string,
  tier: Tier,
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const limit = getTierLimits(tier).dailyImages;

  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  const key = `vantrix:daily:img:${userId}:${day}`;

  try {
    return await checkMidnightAlignedCap(key, limit);
  } catch {
    // COST-HARDENING: see checkDailyMessageCap's comment — same fallback
    // instead of unconditional fail-open, since image generation is real
    // metered provider spend.
    const allowed = await withLocalFallback(
      async () => { throw new Error('redis-unavailable'); },
      `local:daily:img:${userId}`,
      limit,
      24 * 60 * 60 * 1000,
    );
    return { allowed, used: allowed ? 0 : limit, limit };
  }
}

/**
 * Hard daily video-generation cap via Redis counter — modeled directly on
 * checkDailyImageCap (H-03's pattern), with one deliberate divergence:
 *
 * COST-HARDENING: unlike the message/image daily caps, this fails CLOSED
 * (denies) rather than open when Redis is unreachable. Video is the single
 * most expensive per-generation action in the app — a real, metered Kling
 * charge per call, an order of magnitude above an image generation — and
 * checkVideoLimit's per-minute burst limiter degrades to a local in-process
 * fallback on the same outage (see local-fallback.ts), which still lets
 * requests through per-instance. Failing this daily cap open too would mean
 * a Redis outage removes the *only* backstop on total daily Kling spend per
 * user, for however long the outage lasts, across every instance. A denied
 * video request during a Redis blip is a bad but recoverable UX moment
 * ("try again shortly"); unmetered video spend during an outage is not.
 */
export async function checkDailyVideoCap(
  userId: string,
  tier: Tier,
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const limit = getTierLimits(tier).dailyVideos;

  if (limit === 0) return { allowed: false, used: 0, limit };

  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  const key = `vantrix:daily:vid:${userId}:${day}`;

  try {
    return await checkMidnightAlignedCap(key, limit);
  } catch {
    // Redis down → fail CLOSED. See cost-hardening note above; this is
    // intentionally the opposite of checkDailyImageCap/checkDailyMessageCap.
    return { allowed: false, used: 0, limit };
  }
}

/**
 * Check (and atomically increment) a user's daily swipe count.
 *
 * Previously dating/swipe called checkChatLimit() — a swipe and a chat
 * message shared the exact same per-minute counter, despite being entirely
 * unrelated actions with unrelated cost profiles (a swipe is a cheap DB
 * write; a chat message is an LLM call). A user burning through their swipe
 * stack could lock themselves out of chatting, and vice versa.
 *
 * Modeled directly on checkDailyMessageCap: same midnight-UTC TTL alignment
 * (ARCH-01 — a flat +86400s window would let a 23:59 swiper get a free extra
 * day before the cron resets), same fail-open-on-Redis-outage behavior.
 */
export async function checkSwipeLimit(
  userId: string,
  tier: Tier,
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const limit = getTierLimits(tier).dailySwipes;

  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  const key = `vantrix:swipe:${userId}:${day}`;

  try {
    return await checkMidnightAlignedCap(key, limit);
  } catch {
    // Redis down → fail open (availability > protection at the margin)
    return { allowed: true, used: 0, limit };
  }
}

/** Normalize any legacy/unrecognized tier string down to the two real tiers. */
export function normalizeTier(raw?: string | null): Tier {
  const v = raw?.toLowerCase() ?? '';
  return v && v !== 'free' ? 'premium' : 'free';
}

/**
 * ADMIN-FREE-TIER: resolve the tier a request should actually be gated
 * against — 'premium' (effectively unlimited under the two-tier model) for
 * any profile with role='admin', regardless of whatever value sits in
 * profiles.tier (which tracks billing/subscription state and is irrelevant
 * to staff access).
 *
 * This is intentionally a function of the live profile row, not a one-time
 * "set tier='premium' in the DB" fix — an admin's paid tier can lapse,
 * change, or simply never have been set, and access shouldn't depend on
 * remembering to also bump a second column whenever admin role is granted.
 * Every route that gates on tier should call this instead of normalizeTier()
 * directly whenever it also has the profile's role available.
 */
export function resolveEffectiveTier(profile: { tier?: string | null; role?: string | null; is_admin?: boolean | null }): Tier {
  if (profile.role === 'admin' || profile.is_admin === true) return 'premium';
  return normalizeTier(profile.tier);
}
