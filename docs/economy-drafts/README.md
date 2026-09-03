# Economy drafts (archived, not part of the build)

`coins-draft.ts.txt` is the original `src/lib/economy/coins.ts` — zero
importers anywhere in the codebase.

It proposed a second in-app currency ("coins") with its own gift tiers,
tip presets, and per-feature spend costs. Building it out as written would
have created a **second, competing currency** alongside the one Vantrix
already has live:

- Currency: `profiles.tokens`, credited by `credit_subscription_tokens()` /
  `add_tokens()`, spent by `deduct_tokens()` / `spend_tokens()`
- Gifting: `GIFT_CATALOGUE` in `@/lib/dating/engine` (21 tier-locked gift
  types) via `/api/dating/gifts`
- Per-feature spend: costs set per call site (`characters.tokens_cost`,
  `deduct_tokens` amounts in `generate-batch`, `chat/image`, etc.)

The one real gap — tokens could only be *earned* via a subscription, never
bought directly — is now filled by `@/lib/economy/token-packs.ts`, which
kept this file's pack-pricing ladder but credits it into the same
`profiles.tokens` balance via a one-time Stripe Checkout
(`/api/payments/stripe/checkout-tokens` → webhook → `credit_subscription_tokens()`)
instead of a new ledger. See `src/app/(main)/store/page.tsx` for the
purchase UI.

Kept here for reference on the original pricing rationale, not as
something to resurrect.
