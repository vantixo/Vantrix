-- ═══════════════════════════════════════════════════════════════════════
-- P0 fix: SECURITY DEFINER functions are executable by PUBLIC by default
-- in Postgres unless explicitly revoked. 20260908_security_definer_and_
-- search_path_fixes.sql pinned search_path on these (closing the
-- search_path-hijack vector) but never revoked EXECUTE — so every
-- function below has remained reachable by any anon/authenticated
-- PostgREST client this whole time, e.g.:
--
--   supabase.rpc('add_tokens', { p_user_id: '<self-or-anyone>', p_amount: 999999 })
--   supabase.rpc('get_user_verified_age', { p_user_id: '<victim>' })
--
-- Audit confirms every legitimate server-side caller of these already
-- goes through `supabaseAdmin` (service_role) after resolving the acting
-- user from their session — see src/lib/access/character-gate.ts,
-- src/app/api/cron/daily-reset/route.ts, src/app/api/user/delete/route.ts,
-- src/app/api/discover/status-views/route.ts,
-- src/app/api/roleplay/scenarios/[id]/vote/route.ts,
-- src/app/api/community/**/route.ts, src/lib/growth/viral-share.ts, and
-- the admin analytics dashboard routes. Nothing legitimate calls any of
-- these directly from the browser client — safe to revoke.
--
-- NOT included here (already fixed correctly by prior migrations, left
-- alone to avoid redundant/conflicting statements):
--   - 20260930b_lock_privileged_rpcs.sql        (deduct_tokens, increment_xp,
--     update_psychology, apply_personality_drift, check_and_update_streak,
--     increment_daily_messages, quests, streak shields, bond scores,
--     gifts, date sessions, notifications, subscription tokens)
--   - 20261026_fix_identity_bearing_rpcs.sql    (character likes/follows,
--     post likes, community likes, login reward — auth.uid() checked +
--     revoked)
--   - 20260820_fix_can_send_message_rpc.sql     (can_send_message)
--
-- Also NOT included: increment_ad_stat(UUID, TEXT). It already has an
-- explicit `GRANT ... TO anon, authenticated` — anonymous ad impression/
-- click tracking is the intended behavior, the function allowlists its
-- target column (no dynamic SQL), and leaving PUBLIC's redundant default
-- grant in place adds no exposure beyond what's already deliberately
-- granted. Revoking it here would just be noise.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Token economy ───────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION add_tokens(UUID, INTEGER)                        FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION add_tokens(UUID, INTEGER)                        TO service_role;

-- ── Subscription / trial lifecycle ──────────────────────────────────────
REVOKE EXECUTE ON FUNCTION expire_subscriptions()                          FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION expire_subscriptions()                          TO service_role;

REVOKE EXECUTE ON FUNCTION expire_trials()                                 FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION expire_trials()                                 TO service_role;

-- ── Account deletion ─────────────────────────────────────────────────────
-- Accepts p_user_id and dynamically deletes that user's rows. The single
-- most serious individual exposure in the audit if left reachable.
REVOKE EXECUTE ON FUNCTION purge_user_data_remediate(UUID)                 FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION purge_user_data_remediate(UUID)                 TO service_role;

-- ── Private character media (comment already says "service_role-only";
--    the migration granted service_role but never revoked PUBLIC) ───────
REVOKE EXECUTE ON FUNCTION append_character_private_media(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION append_character_private_media(UUID, TEXT, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION remove_character_private_media(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION remove_character_private_media(UUID, TEXT, TEXT) TO service_role;

-- ── Message / webhook housekeeping ──────────────────────────────────────
REVOKE EXECUTE ON FUNCTION prune_old_messages(UUID, INTEGER)               FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION prune_old_messages(UUID, INTEGER)               TO service_role;

REVOKE EXECUTE ON FUNCTION reset_daily_messages()                          FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION reset_daily_messages()                          TO service_role;

REVOKE EXECUTE ON FUNCTION daily_reset_message_counts()                    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION daily_reset_message_counts()                    TO service_role;

REVOKE EXECUTE ON FUNCTION purge_old_webhooks()                            FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION purge_old_webhooks()                            TO service_role;

-- ── Generic counter (share_cards.views / referral_codes.uses) ──────────
-- Allowlisted table/column targets (no injection vector), but any caller
-- could still corrupt referral/share analytics for an arbitrary row_id.
REVOKE EXECUTE ON FUNCTION increment(INTEGER, UUID, TEXT, TEXT)            FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION increment(INTEGER, UUID, TEXT, TEXT)            TO service_role;

-- ── Age verification ─────────────────────────────────────────────────────
-- get_user_verified_age has zero application callers today — it is a
-- pure latent exposure (returns an arbitrary user's verified age to
-- whoever asks). is_user_age_verified is the real access-gate check;
-- both are server-resolved via supabaseAdmin already.
REVOKE EXECUTE ON FUNCTION is_user_age_verified(UUID)                      FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION is_user_age_verified(UUID)                      TO service_role;

REVOKE EXECUTE ON FUNCTION get_user_verified_age(UUID)                     FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION get_user_verified_age(UUID)                     TO service_role;

-- ── Status views / scenario votes / community reply counts ─────────────
-- All three accept a caller-controlled id (p_user_id or a target row) with
-- no auth.uid() check in the function body, and the app already resolves
-- + supplies the authenticated user server-side via supabaseAdmin.
-- mark_character_status_viewed currently has an EXPLICIT `GRANT ... TO
-- authenticated` (20261032) — that's the one that actually let a signed-in
-- browser client mark views under any p_user_id, not just its own.
REVOKE EXECUTE ON FUNCTION mark_character_status_viewed(UUID, UUID)        FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION mark_character_status_viewed(UUID, UUID)        TO service_role;

REVOKE EXECUTE ON FUNCTION toggle_scenario_vote(UUID, UUID, TEXT)          FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION toggle_scenario_vote(UUID, UUID, TEXT)          TO service_role;

REVOKE EXECUTE ON FUNCTION increment_community_reply_count(UUID)           FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION increment_community_reply_count(UUID)           TO service_role;

REVOKE EXECUTE ON FUNCTION decrement_community_reply_count(UUID)           FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION decrement_community_reply_count(UUID)           TO service_role;

-- ── Admin analytics / investor dashboards ───────────────────────────────
-- None of these check caller identity internally — the app's own
-- requireAdmin() gate in the route handler is the only thing standing
-- between a signed-in-but-non-admin user and full business metrics
-- (revenue, MRR, churn, abuse signals, crisis events) if these stay
-- reachable via PostgREST directly.
REVOKE EXECUTE ON FUNCTION admin_activity_series(INT)                      FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_activity_series(INT)                      TO service_role;

REVOKE EXECUTE ON FUNCTION admin_wau_mau()                                 FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_wau_mau()                                 TO service_role;

REVOKE EXECUTE ON FUNCTION admin_revenue_series(INT)                       FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_revenue_series(INT)                       TO service_role;

REVOKE EXECUTE ON FUNCTION admin_mrr_snapshot()                            FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_mrr_snapshot()                            TO service_role;

REVOKE EXECUTE ON FUNCTION admin_tier_breakdown()                          FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_tier_breakdown()                          TO service_role;

REVOKE EXECUTE ON FUNCTION admin_retention_cohorts(INT)                    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_retention_cohorts(INT)                    TO service_role;

REVOKE EXECUTE ON FUNCTION admin_top_characters(INT)                       FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_top_characters(INT)                       TO service_role;

REVOKE EXECUTE ON FUNCTION admin_report_category_breakdown(INT)            FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_report_category_breakdown(INT)            TO service_role;

REVOKE EXECUTE ON FUNCTION admin_abuse_signal_trend(INT)                   FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_abuse_signal_trend(INT)                   TO service_role;

REVOKE EXECUTE ON FUNCTION admin_crisis_event_summary(INT)                 FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_crisis_event_summary(INT)                 TO service_role;

REVOKE EXECUTE ON FUNCTION admin_top_community_posts(INT, INT)             FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_top_community_posts(INT, INT)             TO service_role;

REVOKE EXECUTE ON FUNCTION admin_churn_trend(INT)                          FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_churn_trend(INT)                          TO service_role;

REVOKE EXECUTE ON FUNCTION admin_message_volume_series(INT)                FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_message_volume_series(INT)                TO service_role;

REVOKE EXECUTE ON FUNCTION admin_engagement_summary(INT)                   FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_engagement_summary(INT)                   TO service_role;

REVOKE EXECUTE ON FUNCTION admin_dating_funnel_series(INT)                 FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_dating_funnel_series(INT)                 TO service_role;

REVOKE EXECUTE ON FUNCTION admin_referral_funnel_summary(INT)              FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_referral_funnel_summary(INT)              TO service_role;

REVOKE EXECUTE ON FUNCTION admin_geo_breakdown(INT)                        FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_geo_breakdown(INT)                        TO service_role;

REVOKE EXECUTE ON FUNCTION admin_content_pipeline_summary()                FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_content_pipeline_summary()                TO service_role;

REVOKE EXECUTE ON FUNCTION admin_feature_adoption(INT)                     FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_feature_adoption(INT)                     TO service_role;

REVOKE EXECUTE ON FUNCTION admin_gamification_summary()                    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_gamification_summary()                    TO service_role;

-- ── Trigger functions (defense in depth) ────────────────────────────────
-- Trigger execution doesn't require the DML-issuing role to have EXECUTE
-- on the trigger function — Postgres invokes these internally regardless
-- of caller privilege — so revoking here cannot break any existing
-- trigger. Closes them off as a direct RPC target for no functional cost.
REVOKE EXECUTE ON FUNCTION set_updated_at()                                FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION set_updated_at()                                TO service_role;

REVOKE EXECUTE ON FUNCTION trg_fn_tier_badge()                             FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION trg_fn_tier_badge()                             TO service_role;

REVOKE EXECUTE ON FUNCTION sync_age_verified_to_profile()                  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION sync_age_verified_to_profile()                  TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- is_admin() hardening
--
-- Cannot be revoked from authenticated/anon like the above — it's called
-- bare (is_admin(), defaulting p_uid to auth.uid()) inside 11 RLS
-- policies, and RLS policy evaluation requires the querying role to have
-- EXECUTE on any function the policy calls. Revoking would break those
-- policies for every signed-in user.
--
-- The actual gap: is_admin(p_uid) accepts an EXPLICIT uid argument with
-- no check that the caller is asking about themselves. No app code calls
-- it this way today (requireAdmin() queries profiles directly via
-- supabaseAdmin instead), but nothing stopped a browser client from
-- calling supabase.rpc('is_admin', { p_uid: '<anyone>' }) to probe
-- whether an arbitrary user is an admin. Fix: only trust an explicit
-- p_uid when it matches the caller's own auth.uid(), or when the caller
-- is service_role. The bare is_admin() call every RLS policy actually
-- uses is unaffected — p_uid defaults to auth.uid(), so it always
-- satisfies the check trivially.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION is_admin(p_uid UUID DEFAULT auth.uid())
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = p_uid
      AND (role = 'admin' OR is_admin = TRUE)
      AND (auth.role() = 'service_role' OR p_uid = auth.uid())
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

-- ═══════════════════════════════════════════════════════════════════════
-- Default privilege policy going forward — Supabase's own advisory
-- recommends this: without it, every NEW SECURITY DEFINER function
-- created in future migrations is PUBLIC-executable again by default,
-- silently reopening this exact class of gap. Only affects functions
-- created AFTER this migration runs; every function above was fixed
-- explicitly since this cannot be retroactive.
--
-- Practical effect: any future migration that adds a function meant to
-- be callable directly by anon/authenticated (rare — most RPCs here are
-- server-only) must now GRANT that explicitly, the same way every
-- intentionally-public function in this codebase already does
-- (increment_ad_stat, the identity-checked toggle_* RPCs, etc.).
-- ═══════════════════════════════════════════════════════════════════════
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
