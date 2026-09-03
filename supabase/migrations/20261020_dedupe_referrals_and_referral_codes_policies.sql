-- 20261020_dedupe_referrals_and_referral_codes_policies.sql
--
-- Two genuine, zero-behavior-change policy simplifications from the
-- multiple_permissive_policies advisory pass. Everything else flagged by
-- that advisor on this project pairs a FOR ALL service-role policy with a
-- narrower user policy — legitimate design, left alone (see chat).

-- referrals: two SELECT policies covering each side of the relationship
-- (referee sees own rows, referrer sees own rows) merge cleanly into one,
-- since both are plain SELECT-only checks — no command-splitting needed.
DROP POLICY IF EXISTS "referee_select_own" ON public.referrals;
DROP POLICY IF EXISTS "referrer_select_own" ON public.referrals;

CREATE POLICY "referrals_select_own" ON public.referrals
  FOR SELECT
  USING (
    (select auth.uid()) = referee_id
    OR (select auth.uid()) = referrer_id
  );

-- referral_codes: ref_codes_public_read already grants unconditional
-- SELECT to every role (qual = true). ref_codes_own's ownership check can
-- never change that outcome (true OR anything = true), so it's dead
-- weight — drop it, no replacement needed.
DROP POLICY IF EXISTS "ref_codes_own" ON public.referral_codes;
