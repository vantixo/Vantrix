-- ─────────────────────────────────────────────────────────────────────────────
-- CORRECTION to 20261110_revoke_anon_execute_on_sensitive_rpcs.sql.
--
-- That migration ran successfully but had NO practical effect: querying
-- information_schema.routine_privileges directly afterward showed EXECUTE
-- was never granted to `anon`/`authenticated` specifically — it was
-- granted to `PUBLIC` (Postgres's default behavior for newly created
-- functions, unless explicitly revoked at creation time). Every role,
-- including `anon` and `authenticated`, is implicitly a member of PUBLIC,
-- so REVOKE ... FROM anon, authenticated removed a grant that didn't
-- exist on those roles directly and left the actual PUBLIC grant intact
-- — the vulnerability was still live after that migration ran.
--
-- This migration revokes from PUBLIC instead, which is where the access
-- actually originates. service_role and postgres both hold their own
-- direct EXECUTE grants (confirmed via information_schema.routine_privileges
-- before writing this), so revoking from PUBLIC does not affect them or
-- any of the app's real call paths (all confirmed service_role-only in
-- 20261110's own verification pass).
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.activate_trial(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.adjust_character_attribute(uuid, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.adjust_net_worth(uuid, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.debit_subscription_tokens(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_ad_stat(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_conversation_count(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_character_click(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_universe_memory(text, text, text, uuid[], uuid, integer, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.verify_user_data_purged(uuid) FROM PUBLIC;

-- Explicitly re-grant to service_role and postgres, belt-and-suspenders,
-- in case any environment's default privileges differ from what was
-- observed here.
GRANT EXECUTE ON FUNCTION public.activate_trial(uuid, text, text) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.adjust_character_attribute(uuid, text, integer) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.adjust_net_worth(uuid, bigint) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.debit_subscription_tokens(uuid, integer) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.increment_ad_stat(uuid, text) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.increment_conversation_count(uuid) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.record_character_click(uuid) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.record_universe_memory(text, text, text, uuid[], uuid, integer, boolean) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.verify_user_data_purged(uuid) TO service_role, postgres;
