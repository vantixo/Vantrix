// src/lib/economy/token-packs.ts
// ─────────────────────────────────────────────────────────────────────────────
// À la carte token top-up packs — single source of truth for pack pricing.
//
// This replaces the old `lib/economy/coins.ts` draft, which proposed a
// second currency ("coins") with its own gift tiers, tip presets, and
// per-feature spend costs. That duplicated systems that are already live:
//   - Gifting:            GIFT_CATALOGUE in @/lib/dating/engine (21 gift
//                          types, tier-locked) + /api/dating/gifts
//   - Per-feature spend:  hardcoded token costs at each call site (e.g.
//                          characters.tokens_cost, generate-batch's
//                          deduct_tokens amounts)
//   - The currency itself: `profiles.tokens`, credited via
//                          credit_subscription_tokens() / add_tokens() and
//                          spent via deduct_tokens() / spend_tokens()
//
// The one capability that was genuinely missing: tokens could only be
// *earned* via a subscription (see @/lib/payments/subscription-tokens) —
// there was no way to buy tokens directly. TOKEN_PACKS below is exactly
// that: a one-time-purchase top-up, credited through the same
// credit_subscription_tokens() RPC everything else already uses, so there
// is still only one token ledger. See:
//   - /api/payments/stripe/checkout-tokens (creates the Checkout session)
//   - stripe/webhook/route.ts (metadata.type === 'token_pack' branch credits it)
//   - src/app/(app)/profile/tokens/page.tsx (the purchase UI — the old
//     (main)/store route this comment used to point to no longer exists)
// ─────────────────────────────────────────────────────────────────────────────

export interface TokenPack {
  id: string;
  tokens: number;
  bonusTokens: number;   // extra tokens included, already reflected in `tokens`
  priceUsd: number;
  label: string;
  badge?: string;
}

// Same pricing ladder as the original coins.ts draft (kept — the anchoring
// against subscription tiers, ~35% bulk discount curve at the top pack, was
// sound); only the currency it credits has changed, from a new "coins"
// column to the existing `profiles.tokens` balance.
export const TOKEN_PACKS: TokenPack[] = [
  { id: 'tokens_100',  tokens: 100,  bonusTokens: 0,    priceUsd: 1.99,  label: 'Starter Pack' },
  { id: 'tokens_550',  tokens: 550,  bonusTokens: 50,   priceUsd: 4.99,  label: 'Spark Pack' },
  { id: 'tokens_1200', tokens: 1200, bonusTokens: 200,  priceUsd: 9.99,  label: 'Popular Pack', badge: 'Most Popular' },
  { id: 'tokens_2500', tokens: 2500, bonusTokens: 500,  priceUsd: 19.99, label: 'Premium Pack' },
  { id: 'tokens_7000', tokens: 7000, bonusTokens: 1800, priceUsd: 49.99, label: 'Elite Pack', badge: 'Best Value' },
];

export function getTokenPack(packId: string): TokenPack | undefined {
  return TOKEN_PACKS.find(p => p.id === packId);
}
