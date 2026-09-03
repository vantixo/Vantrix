// src/lib/tiers/limits.ts
//
// NEW FILE — H-02 (also resolves M-05)
//
// Previously three places defined tier limits with three different numbers:
//   - CHAT_LIMITS in rate-limit/index.ts (per-minute sliding window, mislabeled
//     as if it were the daily figure)
//   - DAILY_CAP inside checkDailyMessageCap (the actual Redis-enforced cap)
//   - TierConfig.limits.dailyMessages in tiers/config.ts (pricing page numbers)
//
// The pricing page promised free users 75 messages/day; enforcement capped
// them at 20/day. That's a real false-advertising exposure under UK/EU
// consumer protection law, plus the obvious support ticket volume.
//
// This file is now the single source of truth. Everything else — the Redis
// daily cap, the per-minute burst limiter, the pricing page, and the stream
// concurrency limiter (M-05) — imports from here.
//
// ⚠️  PRODUCT DECISION: dailyMessages values below use the PRICING PAGE numbers
// as ground truth (since that's the customer-facing commitment). spark/basic
// are filled in proportionally. Confirm against whatever your team has actually
// promised before shipping.

export type Tier = 'free' | 'premium';

// Single source of truth for the Premium free-trial length. Must match
// trial_period_days in @/lib/payments/stripe.ts (createStripeCheckoutSession)
// and is imported directly by the onboarding UI so the trial-offer step
// can't drift from what Stripe actually grants.
export const PREMIUM_TRIAL_DAYS = 3;

export interface TierLimits {
  /** Hard daily message cap, enforced via Redis in checkDailyMessageCap.
   *  Must match what the pricing page shows. */
  dailyMessages: number;
  /** Per-minute sliding window — separate concern from dailyMessages.
   *  Prevents burst abuse within a day. Keep this generous relative to
   *  dailyMessages so it's never the binding constraint by accident. */
  perMinuteBurst: number;
  /** Hard daily swipe cap, enforced via Redis in checkSwipeLimit.
   *  Previously dating/swipe used checkChatLimit, so every swipe consumed a
   *  message quota slot — completely unrelated actions sharing one counter.
   *  Now its own dedicated limiter, sourced from here so the pricing page
   *  (tiers/config.ts dailySwipes) and enforcement can't drift apart. */
  dailySwipes: number;
  /** Hard per-character daily message cap, enforced via Redis in
   *  checkPerCharacterMessageCap (rate-limit/index.ts). A second, tighter
   *  constraint that sits *inside* dailyMessages: a free user can spend at
   *  most this many of their daily total on any single character, which
   *  forces exploration across characters and keeps any one companion from
   *  absorbing the whole daily allowance. Paid tiers set this equal to (or
   *  above) dailyMessages so it never binds in practice. */
  perCharacterMessages: number;
  /** Hard daily image-generation cap, enforced via Redis in
   *  checkDailyImageCap (rate-limit/index.ts). Must match what the pricing
   *  page shows ("3 image generations/day" etc — the same false-advertising
   *  risk H-02 fixed for messages).
   *
   *  H-03: previously the ONLY image limiter was IMAGE_LIMITS in
   *  rate-limit/index.ts — a per-MINUTE burst limiter (free: 5/min) with
   *  numbers that didn't match dailyImages in tiers/config.ts (free: 3/day)
   *  at all, and no daily cap was ever enforced. A free user could generate
   *  5 images every minute indefinitely (7,200/day) against a pricing page
   *  that promised 3/day — worse than the messages bug, since there wasn't
   *  even a wrong daily number being enforced, just no daily enforcement.
   *  This field is now the single source of truth for the daily figure;
   *  IMAGE_LIMITS remains, but only as the burst limiter and is documented
   *  as such. */
  dailyImages: number;
  /** Hard daily video-generation cap, enforced via Redis in
   *  checkDailyVideoCap (rate-limit/index.ts). Video (Kling) is materially
   *  more expensive per generation than an image, so this is deliberately a
   *  much smaller number than dailyImages at every tier, including 0 for
   *  free — confirm against actual Kling per-second pricing before treating
   *  these as final. */
  dailyVideos: number;
}

// CONCURRENCY-SCOPE FIX: concurrentStreams used to live here and gate how
// many simultaneous SSE streams a user could have across ALL characters
// combined. That's now handled per-conversation in security.ts
// (acquireStreamSlot/releaseStreamSlot, MAX_STREAMS_PER_CONVERSATION) —
// it stops the same conversation from double-generating, and no longer
// limits how many different characters a user can chat with at once. See
// security.ts for details.
// PRODUCT DECISION (this revision): free/verified tier is 5 messages/day
// total across all characters combined, capped at 5 messages per individual
// character (the per-character cap never binds below the total at this
// size — it exists so a future increase to dailyMessages doesn't let one
// character silently absorb the whole allowance again). Unauthenticated
// guests never go through this tier system at all (no account => no
// checkDailyMessageCap call) — they're gated separately by their own
// per-session counter in /api/chat/guest, capped at GUEST_MESSAGE_LIMIT
// (env.ts; defaults to 7, not 0 — see that var's own comment for the
// default-mismatch bug this file used to describe as intentional).
// PRODUCT DECISION (this revision): all tiers unlocked. Every account —
// paid or not — gets the same unmetered access. Tier ids are kept only as
// a billing-plan label (see tiers/config.ts); they no longer gate features,
// characters, or usage caps. This single unlocked row is what every Tier
// key resolves to via getTierLimits() below.
// TWO-TIER MODEL (this revision): the product only sells one thing —
// "Premium". Legacy tier ids (spark/basic/elite/enterprise/ultra) have been
// fully removed from the type system. getTierLimits() below still tolerates
// an unrecognized string on old DB rows by falling back to 'free' — see the
// PlanGateError-style normalisation in lib/auth/plan.ts for the equivalent
// runtime fallback used for gating decisions.
//
// Premium is genuinely UNGATED but NOT literally infinite: real accounts
// hitting 99999 msgs/min was never "rate limiting", it was a paywall with
// the door left open. perMinuteBurst is the actual binding constraint here
// (abuse/cost protection); dailyMessages/dailyImages are set high enough
// that no legitimate user ever notices them — the point is Premium users
// are throttled, never blocked or feature-gated.
const PREMIUM_TIER: TierLimits = {
  dailyMessages: 2000,
  perMinuteBurst: 60,
  dailySwipes: 1000,
  perCharacterMessages: 2000, // never binds below dailyMessages — no per-character wall for paid users
  dailyImages: 300,
  dailyVideos: 50,
};

// Free tier: hard gate, not a rate limit. 5 messages/day total (also capped
// at 5 on any single character, which never binds first at this total — see
// the PRODUCT DECISION comment above), 1 image generation/day, then the
// paywall. Character *selection* itself is never restricted — free users
// can talk to any character, they just run out of messages fast. No bonus
// or top-up grants extra messages beyond this — dailyMessages here is the
// single source of truth for the free daily total; there is no separate
// "daily bonus" allowance anywhere else in the app. dailySwipes/dailyVideos
// are similarly tight since those are paid-feature adjacent actions.
const FREE_TIER: TierLimits = {
  dailyMessages: 5,
  perMinuteBurst: 10,
  dailySwipes: 10,
  perCharacterMessages: 5,
  dailyImages: 1,
  dailyVideos: 0,
};

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  free:    FREE_TIER,
  premium: PREMIUM_TIER,
};

export function getTierLimits(tier: string): TierLimits {
  return TIER_LIMITS[tier as Tier] ?? TIER_LIMITS.free;
}
