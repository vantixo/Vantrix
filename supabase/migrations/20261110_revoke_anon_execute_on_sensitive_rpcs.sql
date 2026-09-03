-- ─────────────────────────────────────────────────────────────────────────────
-- CRITICAL FIX: revoke public/anon/authenticated EXECUTE on nine
-- SECURITY DEFINER RPC functions that Supabase's own security advisor
-- flagged as callable directly over PostgREST by anyone holding the
-- public anon key (i.e. anyone — the anon key ships in every client
-- bundle) or any authenticated session, with zero application-level
-- checks in between.
--
-- Worst of these by far: activate_trial(p_user_id, p_stripe_customer_id,
-- p_stripe_sub_id). As shipped, ANY unauthenticated caller could POST to
-- /rest/v1/rpc/activate_trial with an arbitrary p_user_id and fabricated
-- Stripe IDs and grant that user (any user — their own, or someone else's)
-- a premium trial for free, completely bypassing checkout, Stripe/
-- Paystack webhook verification, and every payment-gating change made
-- earlier in this project. debit_subscription_tokens is nearly as bad in
-- the other direction — callable by anyone to drain any user's token
-- balance — and has zero legitimate callers in the codebase at all (grep
-- confirms it's unused/orphaned, likely superseded by deduct_tokens()).
--
-- Verified safe to revoke for all nine functions below:
--   1. Every real call site in the app codebase invokes them via
--      `supabaseAdmin` (the service_role client) from server-only Next.js
--      API routes/lib code — never from a browser/anon/authenticated
--      client. service_role bypasses these grants entirely, so revoking
--      anon/authenticated access breaks nothing the app actually does.
--   2. None of the nine are referenced inside any RLS policy's USING/WITH
--      CHECK clause (checked directly against every migration file) — so
--      revoking EXECUTE cannot silently break row-level authorization the
--      way it would for e.g. is_admin(), which genuinely is called from
--      inside several tables' RLS policies and is deliberately left alone
--      here.
--
-- trending_character_ids() and is_admin() were the other two anon-callable
-- SECURITY DEFINER functions the advisor flagged, and are deliberately
-- NOT touched here:
--   - trending_character_ids() is called from a request-scoped (anon/
--     authenticated-role) server client to power the public trending/
--     explore feed for logged-out visitors — revoking would break that
--     feature, and it only ever returns character IDs, no sensitive data.
--   - is_admin() is called from inside RLS policies on profiles,
--     characters, app_config, and user_reports — revoking EXECUTE would
--     break authorization checks for every real user, not just close a
--     hole. It does have a much smaller, real residual issue (anyone can
--     query whether an arbitrary UUID is an admin), but the fix is a
--     function-body change (e.g. restricting p_uid to auth.uid()), not a
--     grant revoke, and is out of scope for this migration.
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.activate_trial(uuid, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.adjust_character_attribute(uuid, text, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.adjust_net_worth(uuid, bigint) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.debit_subscription_tokens(uuid, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_ad_stat(uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_conversation_count(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_character_click(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_universe_memory(text, text, text, uuid[], uuid, integer, boolean) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_user_data_purged(uuid) FROM anon, authenticated;
