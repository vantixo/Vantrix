-- Security advisor remediation: SECURITY DEFINER views + mutable search_path functions
--
-- 1) SECURITY DEFINER views run with the view CREATOR's privileges/RLS bypass
--    rather than the querying user's. Both flagged views only read from
--    tables that already carry their own RLS policies (characters, companies,
--    companion_occupations, user_world_choice_votes), so switching them to
--    SECURITY INVOKER makes them respect the querying user's row access
--    instead of silently bypassing it. Postgres 15+ view option.
--
-- 2) Functions without a pinned search_path are vulnerable to search_path
--    hijacking: a malicious role could create objects in a schema earlier in
--    their search_path that shadow the ones the function intends to call.
--    Pinning `search_path = public, pg_temp` on each function closes this
--    without touching function bodies or behavior.

-- ── 1. SECURITY DEFINER views → SECURITY INVOKER ──────────────────────────

ALTER VIEW public.company_roster SET (security_invoker = true);
ALTER VIEW public.daily_world_choice_tallies SET (security_invoker = true);

-- ── 2. Pin search_path on all flagged functions ────────────────────────────

ALTER FUNCTION public.activate_trial(uuid, text, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.add_tokens(uuid, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.adjust_character_attribute(uuid, text, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.adjust_net_worth(uuid, bigint) SET search_path = public, pg_temp;
ALTER FUNCTION public.append_character_private_media(uuid, text, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.apply_personality_drift(uuid, uuid, numeric, numeric, numeric) SET search_path = public, pg_temp;
ALTER FUNCTION public.bump_char_post_likes_count() SET search_path = public, pg_temp;
ALTER FUNCTION public.bump_post_comments_count() SET search_path = public, pg_temp;
ALTER FUNCTION public.can_send_message(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.chat_affinity_tags(uuid, numeric) SET search_path = public, pg_temp;
ALTER FUNCTION public.check_and_update_streak(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.claim_daily_login_reward(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.consume_streak_shield(uuid, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.credit_subscription_tokens(uuid, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.daily_reset_message_counts() SET search_path = public, pg_temp;
ALTER FUNCTION public.debit_subscription_tokens(uuid, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.deduct_tokens(uuid, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.enforce_admin_enterprise_tier() SET search_path = public, pg_temp;
ALTER FUNCTION public.enforce_character_adult_age() SET search_path = public, pg_temp;
ALTER FUNCTION public.expire_subscriptions() SET search_path = public, pg_temp;
ALTER FUNCTION public.expire_trials() SET search_path = public, pg_temp;
ALTER FUNCTION public.find_heavy_conversations(integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_character_biography(uuid, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_journey_signals(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_or_create_daily_quests(uuid, date, jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_referral_leaderboard(integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_referral_user_totals(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_user_verified_age(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_world_timeline(integer, uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.increment_ad_stat(uuid, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.increment_community_reply_count(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.increment_daily_messages(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.increment_thread_raised(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.increment_xp(uuid, integer, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.increment(integer, uuid, text, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.is_admin(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.is_user_age_verified(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.nudge_desire_fulfillment(uuid, uuid, numeric, numeric, numeric, numeric) SET search_path = public, pg_temp;
ALTER FUNCTION public.progress_daily_quest(uuid, date, text, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.prune_old_messages(uuid, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.purge_old_webhooks() SET search_path = public, pg_temp;
ALTER FUNCTION public.record_universe_memory(text, text, text, uuid[], uuid, integer, boolean) SET search_path = public, pg_temp;
ALTER FUNCTION public.referral_tier(integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.referral_tokens_for_count(integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.remove_character_private_media(uuid, text, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.reset_daily_counters() SET search_path = public, pg_temp;
ALTER FUNCTION public.reset_daily_messages() SET search_path = public, pg_temp;
ALTER FUNCTION public.send_gift(uuid, uuid, uuid, text, text, integer, integer, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.set_character_evolution_traits_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_tier_badge_colour() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.spend_tokens(uuid, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.toggle_character_follow(uuid, uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.toggle_character_like(uuid, uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.toggle_community_post_like(uuid, uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.toggle_community_reply_like(uuid, uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.toggle_post_like(uuid, uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.touch_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_fn_tier_badge() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_bond_score(uuid, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.update_dating_streak(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.update_psychology(uuid, uuid, text) SET search_path = public, pg_temp;
