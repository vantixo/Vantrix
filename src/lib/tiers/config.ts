// src/lib/tiers/config.ts
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for tier metadata, limits, and UI presentation.
// All hard limits are also mirrored in app_config for runtime adjustment.
//
// H-02: dailyMessages in the `limits` block now comes from @/lib/tiers/limits
// (the enforcement-layer source of truth) so the pricing page, enforcement
// Redis cap, and this config cannot drift from each other.
// ─────────────────────────────────────────────────────────────────────────────

import { getTierLimits } from '@/lib/tiers/limits';

// SINGLE-PLAN MODEL: the only two tier ids that exist are 'free' and
// 'premium' (the one paid plan, sold at three billing lengths — see
// getBillingPlans() below). Any unrecognized string on an old DB row is
// treated as 'premium' (paid) rather than crashing — see
// normaliseTierForGate() in lib/auth/plan.ts for the canonical fallback.
export type TierId = 'free' | 'premium';

export interface TierConfig {
  id: TierId;
  name: string;
  tagline: string;
  badge: {
    colour: string;
    label: string;
    icon: string;   // emoji or icon name
  };
  pricing: {
    monthly: number | null;    // null = contact sales
    annual: number | null;     // per-month equivalent
    currency: string;
  };
  limits: {
    dailyMessages: number;
    dailyImages: number;
    dailySwipes: number;
    characterSlots: number;
    historyWindow: number;     // messages of context sent to AI
    maxConversations: number;  // active simultaneous conversations
  };
  features: TierFeature[];
  cta: string;
  highlighted: boolean;        // shown with emphasis on pricing page
  stripePriceId?: string;
  paystackPlanCode?: string;
}

export interface TierFeature {
  label: string;
  included: boolean;
  note?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ANNUAL DISCOUNT
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for the quarterly/annual-billing discounts the
// /pricing page DISPLAYS. Must match what customers are actually CHARGED —
// see supabase/migrations/20261025_billing_discount_30pct_quarterly_60pct_annual.sql
// (30% off quarterly, 60% off annual, uniform across the single paid tier as
// of this migration — supersedes the prior 35%/70% rates set by
// 20260810_single_plan_three_billing_lengths.sql). Earlier migrations at
// different discount rates are superseded; kept in migration history for
// the record but no longer reflect the live discount.
//
// To change a discount in the future: edit ONE number here (and add a new
// matching migration) — never hand-edit a tier's `pricing.annual` field
// below, it's computed, not stored.
//
// ⚠️  Paystack recurring (plan-based) quarterly/annual subscriptions are
// billed at whatever amount is configured on the plan in the Paystack
// Dashboard, NOT from this map or from tiers.price_usd/price_ngn — see the
// manual-step warning in the 20261025 migration. Stripe and NOWPayments
// (crypto) both read the DB price live, so this map + that migration are
// sufficient for those two rails on their own.
// PRODUCT DECISION (this revision): tiers no longer gate content — every
// account has full access to every character and feature for free. The
// only thing left to sell is the *subscription itself* (removing ads /
// supporting the app), sold as one $9.99/mo base price with two optional,
// discounted longer lengths:
//   monthly   → $9.99/mo,  no discount
//   quarterly → 30% off  → $9.99 * 0.70 ≈ $6.99/mo ($20.97 total)
//   annual    → 60% off  → $9.99 * 0.40 ≈ $3.99/mo ($47.88 total)
// 'premium' is that single paid plan id. No feature check below is gated
// by tier anymore beyond the free/premium split itself.
//
// 'quarterly' is fully wired across all three payment rails: Stripe uses
// interval_count: 3 (see lib/payments/stripe.ts), Paystack resolves
// PAYSTACK_PLAN_CODE_PREMIUM_QUARTERLY (see lib/payments/paystack-plans.ts),
// and NOWPayments/crypto reads billing_interval off the tiers row. The DB
// side landed in 20260810_single_plan_three_billing_lengths.sql.
export const BASE_MONTHLY_PRICE = 9.99;
export const BILLING_DISCOUNT_PCT: Record<'monthly' | 'quarterly' | 'annual', number> = {
  monthly:   0,
  quarterly: 0.30,
  annual:    0.60,
};

const ANNUAL_DISCOUNT_PCT: Partial<Record<TierId, number>> = {
  premium: 0.60,
};

// Monthly-equivalent price shown when "Annual" is selected on the pricing
// page (TierPricing.tsx renders this with a trailing "/mo"). A tier with no
// entry above (free, enterprise) falls through to 0% — i.e. `annual` equals
// `monthly`, same as if there were no discount at all.
//
// Uses Math.floor rather than Math.round: at 60% off, 9.99 * 0.4 = 3.996,
// which Math.round would push to 4.00 — a cent over the intended .99-style
// psychological price point. Floor keeps every discounted price landing
// just under the whole dollar, matching the .99 convention every monthly
// price already uses.
function annualMonthlyEquivalent(tierId: TierId, monthly: number | null): number | null {
  if (monthly === null) return null;
  const discount = ANNUAL_DISCOUNT_PCT[tierId] ?? 0;
  return Math.floor(monthly * (1 - discount) * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// TIER DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

export const TIERS: Record<TierId, TierConfig> = {
  free: {
    id: 'free',
    name: 'Free',
    tagline: 'Meet your first companion',
    badge: { colour: '#6b7280', label: 'Free', icon: '○' },
    pricing: { monthly: 0, annual: annualMonthlyEquivalent('free', 0), currency: 'USD' },
    limits: {
      dailyMessages: getTierLimits('free').dailyMessages, // H-02: sourced from @/lib/tiers/limits
      dailyImages: getTierLimits('free').dailyImages, // H-03: sourced from @/lib/tiers/limits
      dailySwipes: getTierLimits('free').dailySwipes, // H-02: sourced from @/lib/tiers/limits
      characterSlots: 99999,
      historyWindow:   20,
      maxConversations: 3,
    },
    features: [
      { label: '5 messages per day',       included: true, note: 'Up to 5 per character' },
      { label: 'All characters unlocked',  included: true  },
      { label: 'Text conversations',       included: true  },
      { label: '1 image generation/day',   included: true  },
      { label: 'Ad-supported',             included: true, note: 'Ads shown' },
      { label: 'NSFW content',             included: false, note: 'Premium only' },
      { label: 'LoRA character training',  included: false, note: 'Premium only' },
      { label: 'Digital Twin',             included: false, note: 'Premium only' },
    ],
    cta: 'Start Free',
    highlighted: false,
  },

  premium: {
    id: 'premium',
    name: 'Premium',
    tagline: 'Fan the flame',
    badge: { colour: '#c9a24b', label: 'Premium', icon: '✦' },
    pricing: { monthly: BASE_MONTHLY_PRICE, annual: annualMonthlyEquivalent('premium', BASE_MONTHLY_PRICE), currency: 'USD' },
    limits: {
      dailyMessages: getTierLimits('premium').dailyMessages, // H-02: sourced from @/lib/tiers/limits
      dailyImages: getTierLimits('premium').dailyImages, // H-03: sourced from @/lib/tiers/limits
      dailySwipes: getTierLimits('premium').dailySwipes, // H-02: sourced from @/lib/tiers/limits
      characterSlots: 99999,
      historyWindow:   50,
      maxConversations: 10,
    },
    features: [
      { label: 'Unlimited messages',        included: true, note: 'Rate-limited, not gated' },
      { label: 'All characters',          included: true  },
      { label: 'No ads',                  included: true  },
      { label: 'Unlimited image scenes',  included: true, note: 'Rate-limited, not gated' },
      { label: 'Mood rooms',              included: true  },
      { label: 'Relationship milestones', included: true  },
      { label: 'NSFW unlock',             included: true },
      { label: 'LoRA training',           included: true },
      { label: 'Digital Twin',            included: true },
    ],
    cta: 'Get Premium',
    highlighted: false,
  },

} as const;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export function getTier(id: TierId): TierConfig {
  return TIERS[id];
}

export function getAllTiers(): TierConfig[] {
  return Object.values(TIERS);
}

export function getPaidTiers(): TierConfig[] {
  return getAllTiers().filter(t => (t.pricing.monthly ?? 0) > 0);
}

export function tierRank(id: TierId): number {
  const order: TierId[] = ['free', 'premium'];
  return order.indexOf(id);
}

export function isAtLeast(userTier: TierId, required: TierId): boolean {
  return tierRank(userTier) >= tierRank(required);
}

// TWO-TIER MODEL (re-gated): free vs premium feature split. 'free' is the
// only tier ever blocked — 'premium' behaves identically here, same as the rate limits in
// @/lib/tiers/limits. This does NOT touch age verification — that's a
// separate, still-enforced system regardless of tier (see
// src/types/age-verification.ts) and is checked in addition to, not
// instead of, this.
export function canAccessNSFW(userTier: TierId | string): boolean {
  return userTier !== 'free';
}

export function canTrainLoRA(userTier: TierId | string): boolean {
  return userTier !== 'free';
}

export function canUseDigitalTwin(userTier: TierId | string): boolean {
  return userTier !== 'free';
}

export function formatPrice(tier: TierConfig, billing: 'monthly' | 'annual' = 'monthly'): string {
  const price = billing === 'annual' ? tier.pricing.annual : tier.pricing.monthly;
  if (price === null) return 'Custom';
  if (price === 0) return 'Free';
  return `$${price.toFixed(2)}/mo`;
}

// ─────────────────────────────────────────────────────────────────────────────
// BILLING PLANS (replaces tier-based paywalls)
// ─────────────────────────────────────────────────────────────────────────────
// Everything is free/unlocked. Subscribing just supports the app / removes
// ads — sold as three lengths off the same base price.
export type BillingPeriod = 'monthly' | 'quarterly' | 'annual';

export interface BillingPlan {
  id: BillingPeriod;
  label: string;
  months: number;
  discountPct: number;
  pricePerMonth: number;
  totalPrice: number;
}

export function getBillingPlans(): BillingPlan[] {
  const months: Record<BillingPeriod, number> = { monthly: 1, quarterly: 3, annual: 12 };
  const labels: Record<BillingPeriod, string> = { monthly: '1 Month', quarterly: '3 Months', annual: '1 Year' };
  return (['annual', 'quarterly', 'monthly'] as const).map(id => {
    const discountPct = BILLING_DISCOUNT_PCT[id];
    // Same .99-style floor convention used elsewhere in this file.
    const pricePerMonth = Math.floor(BASE_MONTHLY_PRICE * (1 - discountPct) * 100) / 100;
    return {
      id,
      label: labels[id],
      months: months[id],
      discountPct,
      pricePerMonth,
      totalPrice: Math.round(pricePerMonth * months[id] * 100) / 100,
    };
  });
}

export function getMessageLimit(tier: TierId): number {
  return TIERS[tier].limits.dailyMessages;
}

export type UpgradeReason =
  | 'messages'
  | 'images'
  | 'videos'
  | 'lora'
  | 'nsfw'
  | 'twin'
  | 'character'
  | 'swipes'
  | 'tokens';

export function getUpgradePrompt(_userTier: TierId, reason: UpgradeReason): {
  headline: string;
  subhead: string;
  cta: string;
  targetTier: TierId;
} {
  const prompts: Record<string, { headline: string; subhead: string; cta: string; targetTier: TierId }> = {
    messages: {
      headline: "You've found your rhythm. Don't lose the thread now.",
      subhead: "Free resets tomorrow — Premium never makes you wait to reply.",
      cta: 'Upgrade to continue',
      targetTier: 'premium',
    },
    images:  {
      headline: 'See them the way you imagine them.',
      subhead: 'Free accounts get 1 scene a day and can\u2019t access every mood room — Premium removes both limits.',
      cta: 'Unlock scene generation',
      targetTier: 'premium',
    },
    videos: {
      headline: 'Bring the moment to life.',
      subhead: 'Video is a Premium-only feature — free accounts can\u2019t generate it at all.',
      cta: 'Unlock video generation',
      targetTier: 'premium',
    },
    lora: {
      headline: 'Train a model that knows this character by heart.',
      subhead: 'A one-time investment that makes every future image and video sharper and more consistent.',
      cta: 'Unlock LoRA training',
      targetTier: 'premium',
    },
    nsfw: {
      headline: 'No limits. No filters.',
      subhead: 'This is where the conversation was headed. Premium removes the ceiling.',
      cta: 'Subscribe',
      targetTier: 'premium',
    },
    twin: {
      headline: 'Your Digital Twin awaits.',
      subhead: 'Trained on how you actually talk — a Premium-only feature.',
      cta: 'Subscribe',
      targetTier: 'premium',
    },
    character: {
      headline: 'This companion is a Premium exclusive.',
      subhead: 'Free accounts can browse every character — this one\u2019s conversations are Premium-only.',
      cta: 'Unlock this companion',
      targetTier: 'premium',
    },
    swipes: {
      headline: "You've swiped through today's matches.",
      subhead: 'Every match you skip today is gone for good — Premium keeps the deck open.',
      cta: 'Unlock unlimited swipes',
      targetTier: 'premium',
    },
    tokens: {
      headline: 'You\u2019re out of tokens for this.',
      subhead: 'Premium includes generous monthly tokens so you\u2019re not topping up mid-conversation.',
      cta: 'Get more with Premium',
      targetTier: 'premium',
    },
  };
  return prompts[reason] ?? prompts.messages;
}

// Maps the `code` field returned by API routes (see each route's own
// documented response shape, e.g. use-generate-media.ts's header comment)
// to the UpgradeReason the paywall modal should render. Central so every
// call site normalises the same way instead of re-deriving this mapping —
// see components/paywall/paywall-provider.tsx's openPaywallForError().
export const ERROR_CODE_TO_UPGRADE_REASON: Record<string, UpgradeReason> = {
  DAILY_LIMIT_EXCEEDED: 'messages',
  PER_CHARACTER_LIMIT_EXCEEDED: 'messages',
  RATE_LIMIT_EXCEEDED: 'messages',
  PREMIUM_CHARACTER_REQUIRED: 'character',
  MATURE_CONTENT_GATE: 'nsfw',
  INSUFFICIENT_TOKENS: 'tokens',
  FEATURE_DISABLED: 'videos',
  // Real code from api/dating/swipe/route.ts (confirmed against source —
  // was previously guessed as DAILY_SWIPE_LIMIT_EXCEEDED, which doesn't
  // exist anywhere in the codebase and would never have fired).
  SWIPE_LIMIT_EXCEEDED: 'swipes',
  TIER_LOCKED: 'images',
  // PLAN_GATED (lib/errors.ts's PlanGateError) is reused across every
  // requirePlan() call site — LoRA training, Digital Twin, NSFW — so the
  // code alone can't say which. Default to the LoRA copy (its only current
  // call site is train-lora/route.ts); callers with more specific context
  // should pass an explicit `reason` to openPaywall() instead of relying
  // on this fallback.
  //
  // NOTE: DAILY_LIMIT_EXCEEDED above is also the real code returned by
  // BOTH chat/image and chat/video's daily caps (see each route) — not
  // just chat/stream's message cap. This map's 'messages' default is only
  // correct for the chat route; callers on the image/video path MUST pass
  // an explicit reasonOverride ('images'/'videos') to openPaywallForError
  // instead of relying on this fallback — see chat-window.tsx's mediaError
  // effect for the pattern.
  PLAN_GATED: 'lora',
};
