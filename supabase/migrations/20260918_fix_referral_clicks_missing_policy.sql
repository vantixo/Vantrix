-- Bug fix: referral_clicks was enabled for RLS in 20260717_referral_system.sql
-- alongside five sibling tables (referral_partners, referral_conversions,
-- referral_commissions, referral_payouts, referral_token_rewards), but the
-- "partners read own X" policy was written for every sibling except this
-- one — an apparent copy-paste omission, not a deliberate admin-only
-- lockdown (contrast with the 20 tables in 20260917_rls_gap_internal_tables.sql,
-- which are genuinely admin-only and documented as such).
--
-- Effect of the gap: GET /api/referrals/me queries referral_clicks through
-- the request-scoped (RLS-bound, authenticated) Supabase client, not
-- supabaseAdmin. With RLS enabled and zero policies, Postgres denies all
-- access by default — so `clickCount` silently returned 0 for every user,
-- every time, regardless of actual click volume, instead of erroring.
--
-- Fix: add the same policy shape as referral_conversions/commissions/
-- token_rewards.

DROP POLICY IF EXISTS "partners read own clicks" ON referral_clicks;

CREATE POLICY "partners read own clicks" ON referral_clicks
  FOR SELECT USING (partner_id IN (SELECT id FROM referral_partners WHERE user_id = auth.uid()));
