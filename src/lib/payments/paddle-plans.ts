import { env } from '@/env';

/**
 * Tier slug -> Paddle Price id (pri_xxx), and the reverse lookup.
 *
 * Sourced from env vars rather than hardcoded — Price ids are created
 * per-Paddle-account via the Dashboard (Catalog -> Prices) and are not
 * something this codebase can know in advance or safely assume are stable
 * across environments (sandbox and live each have their own catalog).
 *
 * Mirrors lib/payments/paystack-plans.ts exactly — see that file's header
 * for the reasoning. A tier/interval with no configured price id has no
 * Paddle checkout support yet; the checkout route returns a clear error
 * rather than silently falling back to something incorrect (unlike
 * Paystack's one-off-charge degradation, Paddle transactions require a
 * price id — there's no equivalent ad-hoc-amount fallback for a recurring
 * item, so this is a hard requirement, not a soft one).
 *
 * SINGLE-PLAN MODEL: only 'premium' is a real, sellable tier (see
 * lib/tiers/config.ts) — same constraint as planCodeForTier(). The
 * 20260937 tier-rename backfill migration has shipped and been verified
 * live, so the legacy 'spark' input-acceptance branch that used to sit
 * here has been removed.
 */
export function priceIdForTier(
  tier: string,
  interval: 'monthly' | 'quarterly' | 'annual' = 'monthly',
): string | undefined {
  if (tier !== 'premium') return undefined; // single-plan model — nothing else is sellable
  switch (interval) {
    case 'annual':    return env.PADDLE_PRICE_ID_PREMIUM_ANNUAL;
    case 'quarterly': return env.PADDLE_PRICE_ID_PREMIUM_QUARTERLY;
    default:          return env.PADDLE_PRICE_ID_PREMIUM_MONTHLY;
  }
}

/**
 * Resolves a Paddle Price id (as received on a transaction/subscription
 * webhook's items[].price.id) back to our internal tier slug + billing
 * interval. Returns null for an unrecognized id — callers must treat that
 * as "not a subscription item we manage" rather than guessing a tier.
 *
 * Always returns the BASE tier slug ('premium'), matching
 * tierForPlanCode()'s contract for the same reason: profiles.tier must
 * always be a base slug so every feature gate keeps working.
 */
export function tierForPriceId(
  priceId: string | undefined | null,
): { tier: string; interval: 'monthly' | 'quarterly' | 'annual' } | null {
  if (!priceId) return null;
  const entries: Array<[string, string | undefined, 'monthly' | 'quarterly' | 'annual']> = [
    ['premium', env.PADDLE_PRICE_ID_PREMIUM_MONTHLY,   'monthly'],
    ['premium', env.PADDLE_PRICE_ID_PREMIUM_QUARTERLY, 'quarterly'],
    ['premium', env.PADDLE_PRICE_ID_PREMIUM_ANNUAL,    'annual'],
  ];
  const match = entries.find(([, id]) => id && id === priceId);
  return match ? { tier: match[0], interval: match[2] } : null;
}

// ── Token packs (one-time purchase, not a subscription) ─────────────────────
// Same env-var-sourced contract as priceIdForTier() above, but keyed by
// TOKEN_PACKS' own pack id (see @/lib/economy/token-packs) rather than a
// tier/interval pair — each pack is its own fixed-price, non-recurring
// Paddle Price, since Paddle transactions require a real Price object per
// item (no ad-hoc-amount escape hatch the way Stripe's checkout-tokens route
// builds one inline).
const TOKEN_PACK_PRICE_IDS: Record<string, string | undefined> = {
  tokens_100:  env.PADDLE_PRICE_ID_TOKENS_100,
  tokens_550:  env.PADDLE_PRICE_ID_TOKENS_550,
  tokens_1200: env.PADDLE_PRICE_ID_TOKENS_1200,
  tokens_2500: env.PADDLE_PRICE_ID_TOKENS_2500,
  tokens_7000: env.PADDLE_PRICE_ID_TOKENS_7000,
};

export function priceIdForTokenPack(packId: string): string | undefined {
  return TOKEN_PACK_PRICE_IDS[packId];
}

/** Reverse lookup for the webhook's fallback path — mirrors tierForPriceId()'s
 *  role for subscriptions, in case a token-pack transaction's custom_data
 *  ever fails to round-trip and only the line-item price id is available. */
export function tokenPackForPriceId(priceId: string | undefined | null): string | null {
  if (!priceId) return null;
  const match = Object.entries(TOKEN_PACK_PRICE_IDS).find(([, id]) => id && id === priceId);
  return match ? match[0] : null;
}
