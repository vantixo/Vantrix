-- ─────────────────────────────────────────────────────────────────────────────
-- Paystack recurring billing: schema additions
--
-- Root cause this fixes: the integration only ever called POST
-- /transaction/initialize with no `plan` parameter — a one-off charge, not a
-- Paystack-managed Subscription. expires_at was hand-set to now()+30 days at
-- payment time and nothing ever extended it. There was no automatic renewal
-- mechanism at all; the nightly cron would eventually downgrade every NGN
-- subscriber exactly 30 days after they paid, paying or not.
--
-- Fix (see initialize/route.ts and webhook handling in verify/route.ts):
-- pass a real `plan` code so Paystack creates an actual Subscription that
-- bills automatically. Paystack's own docs state subscriptions are NOT
-- retried on a failed charge attempt — unlike Stripe's dunning — so renewal
-- identification must not depend on Stripe-style retry semantics, and a
-- cron safety net (api/cron/paystack-renewal) is added as defense-in-depth
-- using the stored authorization_code to manually retry a failed/missed
-- renewal before expires_at, complementing rather than replacing the native
-- subscription.
--
-- customer_code is the key piece: Paystack's charge.success payload for a
-- subscription-driven renewal is not guaranteed to carry forward the
-- `metadata` object set on the original transaction (this is genuinely
-- undocumented/inconsistent behavior on Paystack's side, not something safe
-- to depend on for identifying which user a renewal belongs to). customer_code
-- is Paystack's own stable identifier and IS always present on every charge
-- — so renewals are resolved through it, not through metadata.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS paystack_customer_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_paystack_customer
  ON profiles(paystack_customer_code) WHERE paystack_customer_code IS NOT NULL;

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS paystack_subscription_code TEXT,
  ADD COLUMN IF NOT EXISTS paystack_authorization_code TEXT,
  ADD COLUMN IF NOT EXISTS last_charged_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_subscriptions_paystack_renewal
  ON subscriptions(provider, expires_at)
  WHERE provider = 'paystack' AND status = 'active';
