-- Wires up two previously-defined-but-never-applied pieces of the referral
-- economics config (lib/referral-config.ts):
--   1. REFEREE_FIRST_MONTH_DISCOUNT_PCT — needs a flag so we only ever
--      apply it once, to the referred user's genuinely first payment.
--   2. INFLUENCER_VOLUME_BONUSES_NGN — needs a table to record which
--      bonus tiers have already been paid, per partner per rolling
--      window, so the payout cron doesn't double-pay the same tier.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS referral_discount_used boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS referral_volume_bonuses (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id            uuid NOT NULL REFERENCES referral_partners(id) ON DELETE CASCADE,
  min_paying_referrals  integer NOT NULL,
  window_days           integer NOT NULL,
  bonus_ngn             numeric NOT NULL,
  awarded_at            timestamptz NOT NULL DEFAULT now(),
  -- A given partner can only be paid a specific bonus tier once ever.
  -- (Tiers are cumulative thresholds, not repeatable weekly rewards.)
  UNIQUE (partner_id, min_paying_referrals)
);

CREATE INDEX IF NOT EXISTS idx_referral_volume_bonuses_partner
  ON referral_volume_bonuses (partner_id);

ALTER TABLE referral_volume_bonuses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "partners read own volume bonuses" ON referral_volume_bonuses;
CREATE POLICY "partners read own volume bonuses" ON referral_volume_bonuses
  FOR SELECT USING (partner_id IN (SELECT id FROM referral_partners WHERE user_id = auth.uid()));
