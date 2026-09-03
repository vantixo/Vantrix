-- ─────────────────────────────────────────────────────────────────────────────
-- Paddle Billing: schema additions
--
-- Adds Paddle as a third card/Merchant-of-Record payment rail alongside
-- Stripe and Paystack. Same shape as the 20260630 Paystack recurring-
-- billing migration this mirrors:
--
--   - profiles.paddle_customer_id: Paddle's own stable customer id
--     (ctm_xxx), captured on first checkout and used to resolve renewal
--     webhooks that may not carry custom_data. Paddle does not document a
--     guarantee that custom_data set on the initial checkout transaction
--     survives onto a later subscription-driven renewal transaction — same
--     caveat as Paystack's metadata (see 20260630's header) — so the same
--     customer-id-first resolution pattern is used defensively (see
--     resolveUserId() in api/payments/paddle/webhook/route.ts).
--   - subscriptions.paddle_subscription_id: Paddle's subscription id
--     (sub_xxx). Needed to fetch management_urls (Paddle's equivalent of
--     Stripe's Billing Portal — see api/billing/paddle/manage/route.ts).
--   - 'paddle' added to subscriptions.provider and processed_webhooks.provider
--     CHECK constraints.
--
-- No renewal-safety-net cron is added for Paddle (unlike Paystack's
-- api/cron/paystack-renewal) — Paddle Billing manages recurring billing and
-- dunning natively (automatic retries over several days on a failed
-- charge), matching Stripe's behavior rather than Paystack's.
--
-- FLAG FOR TAMARA: Paddle, like Stripe and Paystack, is a card-rail /
-- Merchant of Record and its Acceptable Use Policy restricts adult/sexual
-- content — in some respects Paddle's policy is stricter than Stripe's,
-- since Paddle is the seller of record on every transaction and carries
-- direct reputational/compliance exposure for what it processes. The
-- existing NSFW gate (lib/payments/provider-gate.ts,
-- assertCardPaymentAllowed) now also covers Paddle checkout by default —
-- verify the specific Paddle account's approved content classification
-- with Paddle directly before relying on this in production; this
-- migration and the code that follows assume Paddle is gated exactly like
-- Stripe/Paystack, never a crypto-style universal rail.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS paddle_customer_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_paddle_customer
  ON profiles(paddle_customer_id) WHERE paddle_customer_id IS NOT NULL;

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS paddle_subscription_id TEXT;

CREATE INDEX IF NOT EXISTS idx_subscriptions_paddle
  ON subscriptions(provider, expires_at)
  WHERE provider = 'paddle' AND status = 'active';

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_provider_check;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_provider_check
    CHECK (provider IN ('stripe', 'paystack', 'nowpayments', 'paddle'));

ALTER TABLE processed_webhooks DROP CONSTRAINT IF EXISTS processed_webhooks_provider_check;
ALTER TABLE processed_webhooks
  ADD CONSTRAINT processed_webhooks_provider_check
    CHECK (provider IN ('stripe', 'paystack', 'nowpayments', 'fal_lora', 'paddle'));
