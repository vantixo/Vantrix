-- ─────────────────────────────────────────────────────────────────────────
-- Deep product-analytics RPCs for /admin/analytics.
--
-- 20260811_analytics_investor_dashboards.sql already covers growth/revenue
-- (activity, WAU/MAU, MRR, retention, churn) + a first trust & safety pass.
-- This migration is the second half: everything about what people actually
-- *do* in the app once they're in it — messaging volume, dating, roleplay,
-- community, digital twin, referrals-as-a-funnel, geography, the content
-- generation backlog, and feature adoption — none of which the original
-- migration's RPC set touched.
--
-- Same conventions as 20260811: read-only, SECURITY DEFINER (called via
-- supabaseAdmin service-role client, defense-in-depth if ever exposed to a
-- session client), one function per concern rather than a few giant ones,
-- GRANT EXECUTE to service_role only at the bottom.
-- ─────────────────────────────────────────────────────────────────────────

-- Daily message + conversation volume — distinct from admin_activity_series'
-- DAU/signups: this is *how much talking is happening*, not how many
-- distinct people showed up.
CREATE OR REPLACE FUNCTION admin_message_volume_series(p_days INT DEFAULT 30)
RETURNS TABLE (
  day                   DATE,
  messages              BIGINT,
  conversations_started BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH days AS (
    SELECT generate_series(
      (CURRENT_DATE - (p_days - 1) * INTERVAL '1 day')::date,
      CURRENT_DATE,
      INTERVAL '1 day'
    )::date AS day
  )
  SELECT
    d.day,
    COALESCE((SELECT COUNT(*) FROM messages WHERE created_at::date = d.day), 0),
    COALESCE((SELECT COUNT(*) FROM conversations WHERE created_at::date = d.day), 0)
  FROM days d
  ORDER BY d.day;
$$;

-- One-row "everything that happened" summary across every product surface
-- for the window — the single richest query in the dashboard. Kept as one
-- function (many scalar subqueries) rather than N round trips.
CREATE OR REPLACE FUNCTION admin_engagement_summary(p_days INT DEFAULT 30)
RETURNS TABLE (
  total_conversations      BIGINT,
  total_messages           BIGINT,
  avg_messages_per_convo   NUMERIC,
  dating_mode_conversations   BIGINT,
  roleplay_mode_conversations BIGINT,
  roleplay_sessions_started   BIGINT,
  roleplay_sessions_completed BIGINT,
  dating_swipes            BIGINT,
  dating_matches            BIGINT,
  dating_gifts              BIGINT,
  community_posts           BIGINT,
  community_replies         BIGINT,
  digital_twin_messages     BIGINT,
  xp_events                 BIGINT,
  images_generated          BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*) FROM conversations WHERE created_at > NOW() - (p_days || ' days')::interval),
    (SELECT COUNT(*) FROM messages      WHERE created_at > NOW() - (p_days || ' days')::interval),
    ROUND(
      (SELECT COUNT(*)::numeric FROM messages WHERE created_at > NOW() - (p_days || ' days')::interval)
      / NULLIF((SELECT COUNT(*) FROM conversations WHERE created_at > NOW() - (p_days || ' days')::interval), 0),
      1
    ),
    (SELECT COUNT(*) FROM conversations WHERE created_at > NOW() - (p_days || ' days')::interval AND dating_mode = true),
    (SELECT COUNT(*) FROM conversations WHERE created_at > NOW() - (p_days || ' days')::interval AND roleplay_mode = true),
    (SELECT COUNT(*) FROM roleplay_sessions WHERE started_at > NOW() - (p_days || ' days')::interval),
    (SELECT COUNT(*) FROM roleplay_sessions WHERE completed_at > NOW() - (p_days || ' days')::interval),
    (SELECT COUNT(*) FROM dating_swipes  WHERE created_at > NOW() - (p_days || ' days')::interval),
    (SELECT COUNT(*) FROM dating_matches WHERE created_at > NOW() - (p_days || ' days')::interval),
    (SELECT COUNT(*) FROM dating_gifts   WHERE created_at > NOW() - (p_days || ' days')::interval),
    (SELECT COUNT(*) FROM community_posts   WHERE created_at > NOW() - (p_days || ' days')::interval),
    (SELECT COUNT(*) FROM community_replies WHERE created_at > NOW() - (p_days || ' days')::interval),
    (SELECT COUNT(*) FROM digital_twin_messages WHERE created_at > NOW() - (p_days || ' days')::interval),
    (SELECT COUNT(*) FROM xp_events WHERE created_at > NOW() - (p_days || ' days')::interval),
    (SELECT COUNT(*) FROM generated_images WHERE created_at > NOW() - (p_days || ' days')::interval);
$$;

-- Daily dating funnel — swipes vs matches vs gifts, so an admin can see the
-- swipe→match→gift conversion shape over time, not just totals.
CREATE OR REPLACE FUNCTION admin_dating_funnel_series(p_days INT DEFAULT 30)
RETURNS TABLE (
  day     DATE,
  swipes  BIGINT,
  matches BIGINT,
  gifts   BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH days AS (
    SELECT generate_series(
      (CURRENT_DATE - (p_days - 1) * INTERVAL '1 day')::date,
      CURRENT_DATE,
      INTERVAL '1 day'
    )::date AS day
  )
  SELECT
    d.day,
    COALESCE((SELECT COUNT(*) FROM dating_swipes  WHERE created_at::date = d.day), 0),
    COALESCE((SELECT COUNT(*) FROM dating_matches WHERE created_at::date = d.day), 0),
    COALESCE((SELECT COUNT(*) FROM dating_gifts   WHERE created_at::date = d.day), 0)
  FROM days d
  ORDER BY d.day;
$$;

-- Referral program as a funnel: click → conversion → payout. fraud_flag is
-- surfaced as a count, not filtered out, so admins see the raw signal.
CREATE OR REPLACE FUNCTION admin_referral_funnel_summary(p_days INT DEFAULT 30)
RETURNS TABLE (
  clicks              BIGINT,
  conversions         BIGINT,
  fraud_flagged       BIGINT,
  payouts_sent_ngn    NUMERIC,
  payouts_pending_ngn NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*) FROM referral_clicks WHERE created_at > NOW() - (p_days || ' days')::interval),
    (SELECT COUNT(*) FROM referral_conversions WHERE created_at > NOW() - (p_days || ' days')::interval),
    (SELECT COUNT(*) FROM referral_conversions
       WHERE created_at > NOW() - (p_days || ' days')::interval AND fraud_flag IS NOT NULL),
    COALESCE((SELECT SUM(total_ngn) FROM referral_payouts
       WHERE status = 'sent' AND created_at > NOW() - (p_days || ' days')::interval), 0),
    COALESCE((SELECT SUM(total_ngn) FROM referral_payouts
       WHERE status = 'pending' AND created_at > NOW() - (p_days || ' days')::interval), 0);
$$;

-- Where users are, by country (profiles.country — self-reported / geo-IP at
-- signup, same field used by billing's geo-discount logic elsewhere).
CREATE OR REPLACE FUNCTION admin_geo_breakdown(p_limit INT DEFAULT 12)
RETURNS TABLE (country TEXT, users BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  -- NULLIF(country, '') first: an empty string is falsy-but-not-NULL, and
  -- without it '' formed its own silent group instead of folding into
  -- 'Unknown' alongside actual NULLs (caught when this shipped — a fresh
  -- signup with country briefly unset writes '' in one onboarding path).
  SELECT COALESCE(NULLIF(country, ''), 'Unknown') AS country, COUNT(*) AS users
  FROM profiles
  GROUP BY COALESCE(NULLIF(country, ''), 'Unknown')
  ORDER BY users DESC
  LIMIT p_limit;
$$;

-- Content generation backlog: how much is stuck in the pipeline right now.
-- Status enums for lora jobs / content queue vary by job type, so "not yet
-- in a terminal state" is expressed as NOT IN (terminal states) rather than
-- hardcoding one exact "pending" spelling.
CREATE OR REPLACE FUNCTION admin_content_pipeline_summary()
RETURNS TABLE (
  pending_characters     BIGINT,
  live_characters        BIGINT,
  pending_lora_jobs      BIGINT,
  pending_content_queue  BIGINT,
  images_generated_24h   BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*) FROM characters WHERE moderation_status = 'pending'),
    (SELECT COUNT(*) FROM characters WHERE is_live = true),
    (SELECT COUNT(*) FROM character_lora_jobs
       WHERE status IS NULL OR status NOT IN ('completed', 'failed', 'error', 'cancelled')),
    (SELECT COUNT(*) FROM character_content_queue
       WHERE status IS NULL OR status NOT IN ('completed', 'failed', 'error', 'cancelled')),
    (SELECT COUNT(*) FROM generated_images WHERE created_at > NOW() - INTERVAL '24 hours');
$$;

-- Feature adoption: of everyone active in the window, how many distinct
-- users touched each major surface. Answers "is dating actually being
-- used, or is it just characters chat?" at a glance.
CREATE OR REPLACE FUNCTION admin_feature_adoption(p_days INT DEFAULT 30)
RETURNS TABLE (
  chat_users      BIGINT,
  dating_users    BIGINT,
  roleplay_users  BIGINT,
  community_users BIGINT,
  twin_users      BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(DISTINCT user_id) FROM conversations WHERE created_at > NOW() - (p_days || ' days')::interval),
    (SELECT COUNT(DISTINCT user_id) FROM dating_swipes  WHERE created_at > NOW() - (p_days || ' days')::interval),
    (SELECT COUNT(DISTINCT user_id) FROM roleplay_sessions WHERE started_at > NOW() - (p_days || ' days')::interval),
    (SELECT COUNT(DISTINCT author_id) FROM (
       SELECT author_id, created_at FROM community_posts
       UNION ALL
       SELECT author_id, created_at FROM community_replies
     ) c WHERE created_at > NOW() - (p_days || ' days')::interval),
    (SELECT COUNT(DISTINCT user_id) FROM digital_twin_messages WHERE created_at > NOW() - (p_days || ' days')::interval);
$$;

-- Gamification health: streaks + today's XP volume. No time-series here by
-- design — streaks are a point-in-time state, not an event log.
CREATE OR REPLACE FUNCTION admin_gamification_summary()
RETURNS TABLE (
  active_streaks     BIGINT,
  avg_streak_length  NUMERIC,
  longest_streak     INT,
  xp_events_today    BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*) FROM user_streaks WHERE current_streak > 0),
    (SELECT ROUND(AVG(current_streak), 1) FROM user_streaks WHERE current_streak > 0),
    (SELECT COALESCE(MAX(longest_streak), 0) FROM user_streaks),
    (SELECT COUNT(*) FROM xp_events WHERE created_at::date = CURRENT_DATE);
$$;

GRANT EXECUTE ON FUNCTION admin_message_volume_series(INT)   TO service_role;
GRANT EXECUTE ON FUNCTION admin_engagement_summary(INT)      TO service_role;
GRANT EXECUTE ON FUNCTION admin_dating_funnel_series(INT)    TO service_role;
GRANT EXECUTE ON FUNCTION admin_referral_funnel_summary(INT) TO service_role;
GRANT EXECUTE ON FUNCTION admin_geo_breakdown(INT)           TO service_role;
GRANT EXECUTE ON FUNCTION admin_content_pipeline_summary()   TO service_role;
GRANT EXECUTE ON FUNCTION admin_feature_adoption(INT)        TO service_role;
GRANT EXECUTE ON FUNCTION admin_gamification_summary()       TO service_role;
