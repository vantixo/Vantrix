-- ============================================================================
-- Vantrix Referral System — schema
-- Powers three referrer classes with deliberately different economics:
--   'user'       — everyday users sharing their code. No cash. Token bonus only.
--   'dev'        — verified developers/technical affiliates. Cash, capped, decaying.
--   'influencer' — invite/apply-only. Cash, front-loaded, decaying, capped, + bonuses.
-- All cash tiers use a DECAYING window (not lifetime recurring) to protect
-- margin — see lib/referral-config.ts for the actual percentages/durations.
-- ============================================================================

-- Referrer classes and their commission rules live in code
-- (lib/referral-config.ts), not the DB, so a rate change doesn't need a
-- migration. This table stores WHICH class each referrer is in, plus
-- verification/application state for the gated tiers.
CREATE TABLE IF NOT EXISTS referral_partners (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  class              text NOT NULL CHECK (class IN ('user','dev','influencer')) DEFAULT 'user',
  status             text NOT NULL CHECK (status IN ('active','pending_review','rejected','suspended')) DEFAULT 'active',
  code               text NOT NULL UNIQUE,               -- e.g. "MIRA20" or a vanity handle
  vanity_slug        text UNIQUE,                          -- influencer-only: vantrix.ink/r/<slug>
  application_note   text,                                  -- why they think they qualify (dev/influencer apply flow)
  social_proof_url   text,                                  -- portfolio / social handle for verification
  follower_count     integer,                                -- self-reported at application, spot-checked manually
  payout_method      text CHECK (payout_method IN ('paystack_transfer','manual')) DEFAULT 'paystack_transfer',
  payout_bank_code   text,
  payout_account_no  text,
  payout_account_name text,
  paystack_recipient_code text,        -- cached from Paystack's /transferrecipient — avoids re-registering the same bank account every payout run
  created_at         timestamptz NOT NULL DEFAULT now(),
  approved_at        timestamptz,
  approved_by        uuid REFERENCES profiles(id),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_referral_partners_code ON referral_partners (code);
CREATE INDEX IF NOT EXISTS idx_referral_partners_user  ON referral_partners (user_id);

-- Every click/visit on a referral link, before we know if it converts.
-- Used for attribution (last-touch, 30-day cookie window) and for partners
-- to see funnel drop-off, not just final conversions.
CREATE TABLE IF NOT EXISTS referral_clicks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id    uuid NOT NULL REFERENCES referral_partners(id) ON DELETE CASCADE,
  visitor_hash  text NOT NULL,        -- hashed IP+UA, never raw PII (matches IP_HASH_SALT pattern already in the app)
  landing_path  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_clicks_partner ON referral_clicks (partner_id, created_at);

-- One row per successfully-attributed signup. This is the anchor row that
-- referral_commissions hang off of — a referred user can only be attributed
-- to ONE partner, ever (first-touch OR last-touch depending on config, see
-- lib/referral-config.ts ATTRIBUTION_MODEL).
CREATE TABLE IF NOT EXISTS referral_conversions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id         uuid NOT NULL REFERENCES referral_partners(id) ON DELETE CASCADE,
  referred_user_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  fraud_flag         text,             -- set by lib/referral-engine.ts fraud checks; null = clean
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (referred_user_id)   -- a user can only ever be referred once, permanently
);

CREATE INDEX IF NOT EXISTS idx_referral_conversions_partner ON referral_conversions (partner_id);

-- One row per batch payout run (weekly/monthly cron). Groups many
-- referral_commissions rows into a single Paystack transfer per partner.
-- (Created before referral_commissions because that table has a FK to it.)
CREATE TABLE IF NOT EXISTS referral_payouts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id     uuid NOT NULL REFERENCES referral_partners(id) ON DELETE CASCADE,
  total_ngn      numeric NOT NULL,
  status         text NOT NULL CHECK (status IN ('queued','sent','failed','reversed')) DEFAULT 'queued',
  paystack_transfer_code text,
  failure_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  sent_at        timestamptz
);

CREATE INDEX IF NOT EXISTS idx_referral_payouts_partner ON referral_payouts (partner_id, status);

-- One row per commission-eligible payment event from the referred user.
-- Amount is computed at write time from lib/referral-config.ts's decay
-- table for that partner's class and the payment's "month number" since
-- conversion — so historical commission amounts never retroactively change
-- if the rate table is edited later.
CREATE TABLE IF NOT EXISTS referral_commissions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversion_id     uuid NOT NULL REFERENCES referral_conversions(id) ON DELETE CASCADE,
  partner_id        uuid NOT NULL REFERENCES referral_partners(id) ON DELETE CASCADE,
  source_payment_id text NOT NULL,      -- Paystack/Stripe/NOWPayments transaction reference
  payment_amount_ngn numeric NOT NULL,
  commission_pct     numeric NOT NULL,   -- the % actually applied, snapshotted
  commission_ngn     numeric NOT NULL,
  month_number       integer NOT NULL,   -- 1 = referred user's first paid month, 2 = second, etc.
  status             text NOT NULL CHECK (status IN ('pending','clawed_back','payable','paid')) DEFAULT 'pending',
  -- pending: inside the refund-risk hold window (see HOLD_DAYS)
  -- clawed_back: referred user refunded/charged back within the hold window
  -- payable: hold window passed clean, ready for next payout run
  -- paid: included in a completed referral_payouts row
  payout_id         uuid REFERENCES referral_payouts(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_payment_id)   -- a given payment can only generate one commission row, ever
);

CREATE INDEX IF NOT EXISTS idx_referral_commissions_partner_status ON referral_commissions (partner_id, status);

-- Token-only rewards for the free 'user' class (no cash, no clawback
-- complexity — credited instantly on conversion, not on a payout schedule).
CREATE TABLE IF NOT EXISTS referral_token_rewards (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversion_id    uuid NOT NULL REFERENCES referral_conversions(id) ON DELETE CASCADE UNIQUE,
  partner_id       uuid NOT NULL REFERENCES referral_partners(id) ON DELETE CASCADE,
  tokens_awarded   integer NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- RLS: partners can read only their own rows. Service role (server-side
-- code) bypasses RLS as usual for writes.
ALTER TABLE referral_partners        ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_clicks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_conversions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_commissions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_payouts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_token_rewards   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "partners read own"           ON referral_partners;
DROP POLICY IF EXISTS "partners read own conversions" ON referral_conversions;
DROP POLICY IF EXISTS "partners read own commissions" ON referral_commissions;
DROP POLICY IF EXISTS "partners read own payouts"     ON referral_payouts;
DROP POLICY IF EXISTS "partners read own token rewards" ON referral_token_rewards;

CREATE POLICY "partners read own" ON referral_partners
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "partners read own conversions" ON referral_conversions
  FOR SELECT USING (partner_id IN (SELECT id FROM referral_partners WHERE user_id = auth.uid()));

CREATE POLICY "partners read own commissions" ON referral_commissions
  FOR SELECT USING (partner_id IN (SELECT id FROM referral_partners WHERE user_id = auth.uid()));

CREATE POLICY "partners read own payouts" ON referral_payouts
  FOR SELECT USING (partner_id IN (SELECT id FROM referral_partners WHERE user_id = auth.uid()));

CREATE POLICY "partners read own token rewards" ON referral_token_rewards
  FOR SELECT USING (partner_id IN (SELECT id FROM referral_partners WHERE user_id = auth.uid()));

-- Track which partner a user was referred by, directly on profiles, for
-- fast lookups (denormalized on top of referral_conversions being the
-- source of truth).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referred_by_partner_id uuid REFERENCES referral_partners(id);
