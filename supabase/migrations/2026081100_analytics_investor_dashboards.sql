-- ─────────────────────────────────────────────────────────────────────────
-- Analytics + Investor dashboard RPCs.
-- All read-only, SECURITY DEFINER (admin pages call these via supabaseAdmin
-- already, but SECURITY DEFINER + explicit admin check keeps them safe if
-- ever exposed through a user-session client). No new tables for the
-- investor board — by design it only aggregates data that already exists
-- (user_reports, abuse_signals, subscriptions, character_posts, xp_events),
-- never invents a "reviews" source.
-- ─────────────────────────────────────────────────────────────────────────

-- Daily active / weekly active / monthly active users, based on
-- active_sessions.last_seen (already updated on every authenticated
-- request — see src/lib/session presence tracking).
CREATE OR REPLACE FUNCTION admin_activity_series(p_days INT DEFAULT 30)
RETURNS TABLE (
  day          DATE,
  dau          BIGINT,
  new_signups  BIGINT
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
    COALESCE((
      SELECT COUNT(DISTINCT user_id) FROM active_sessions
      WHERE last_seen::date = d.day
    ), 0) AS dau,
    COALESCE((
      SELECT COUNT(*) FROM profiles
      WHERE created_at::date = d.day
    ), 0) AS new_signups
  FROM days d
  ORDER BY d.day;
$$;

CREATE OR REPLACE FUNCTION admin_wau_mau()
RETURNS TABLE (wau BIGINT, mau BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(DISTINCT user_id) FROM active_sessions WHERE last_seen > NOW() - INTERVAL '7 days')  AS wau,
    (SELECT COUNT(DISTINCT user_id) FROM active_sessions WHERE last_seen > NOW() - INTERVAL '30 days') AS mau;
$$;

-- Revenue series (USD-denominated subscriptions only — non-USD amounts are
-- flagged rather than summed at face value into a misleading total).
CREATE OR REPLACE FUNCTION admin_revenue_series(p_days INT DEFAULT 30)
RETURNS TABLE (
  day           DATE,
  revenue_usd   NUMERIC,
  new_subs      BIGINT
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
    COALESCE((
      SELECT SUM(amount) FROM subscriptions
      WHERE created_at::date = d.day AND currency = 'USD' AND status IN ('active','cancelled','canceled','expired')
    ), 0) AS revenue_usd,
    COALESCE((
      SELECT COUNT(*) FROM subscriptions WHERE created_at::date = d.day
    ), 0) AS new_subs
  FROM days d
  ORDER BY d.day;
$$;

-- Current MRR: active, non-expired subs, USD only, normalised to a monthly
-- figure. Non-USD active subs are returned separately as a count so the UI
-- can disclose "+N active in other currencies, not included in MRR".
CREATE OR REPLACE FUNCTION admin_mrr_snapshot()
RETURNS TABLE (
  mrr_usd            NUMERIC,
  active_subs_usd    BIGINT,
  active_subs_other  BIGINT,
  cancelled_30d      BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE((SELECT SUM(amount) FROM subscriptions
      WHERE status = 'active' AND currency = 'USD' AND expires_at > NOW()), 0) AS mrr_usd,
    (SELECT COUNT(*) FROM subscriptions WHERE status = 'active' AND currency = 'USD' AND expires_at > NOW()) AS active_subs_usd,
    (SELECT COUNT(*) FROM subscriptions WHERE status = 'active' AND currency <> 'USD' AND expires_at > NOW()) AS active_subs_other,
    (SELECT COUNT(*) FROM subscriptions WHERE status IN ('cancelled','canceled') AND created_at > NOW() - INTERVAL '30 days') AS cancelled_30d;
$$;

-- Tier breakdown (from profiles.tier — the source of truth used elsewhere
-- in the app, e.g. paywall gating), for a distribution chart.
CREATE OR REPLACE FUNCTION admin_tier_breakdown()
RETURNS TABLE (tier TEXT, users BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tier, COUNT(*) AS users FROM profiles GROUP BY tier ORDER BY users DESC;
$$;

-- Simple retention cohorts: of users who signed up N weeks ago, what % had
-- an active_sessions row in each subsequent week. Capped at 8 weeks back to
-- keep the query cheap.
CREATE OR REPLACE FUNCTION admin_retention_cohorts(p_weeks INT DEFAULT 8)
RETURNS TABLE (
  cohort_week   DATE,
  cohort_size   BIGINT,
  week_0        NUMERIC,
  week_1        NUMERIC,
  week_2        NUMERIC,
  week_3        NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH cohorts AS (
    SELECT
      date_trunc('week', created_at)::date AS cohort_week,
      id AS user_id
    FROM profiles
    WHERE created_at > NOW() - (p_weeks || ' weeks')::interval
  ),
  sizes AS (
    SELECT cohort_week, COUNT(*) AS cohort_size
    FROM cohorts GROUP BY cohort_week
  ),
  active AS (
    SELECT c.cohort_week, c.user_id, s.last_seen
    FROM cohorts c
    JOIN active_sessions s ON s.user_id = c.user_id
  )
  SELECT
    s.cohort_week,
    s.cohort_size,
    ROUND(100.0 * COUNT(DISTINCT a.user_id) FILTER (
      WHERE a.last_seen BETWEEN s.cohort_week AND s.cohort_week + INTERVAL '7 days'
    ) / NULLIF(s.cohort_size, 0), 1) AS week_0,
    ROUND(100.0 * COUNT(DISTINCT a.user_id) FILTER (
      WHERE a.last_seen BETWEEN s.cohort_week + INTERVAL '7 days' AND s.cohort_week + INTERVAL '14 days'
    ) / NULLIF(s.cohort_size, 0), 1) AS week_1,
    ROUND(100.0 * COUNT(DISTINCT a.user_id) FILTER (
      WHERE a.last_seen BETWEEN s.cohort_week + INTERVAL '14 days' AND s.cohort_week + INTERVAL '21 days'
    ) / NULLIF(s.cohort_size, 0), 1) AS week_2,
    ROUND(100.0 * COUNT(DISTINCT a.user_id) FILTER (
      WHERE a.last_seen BETWEEN s.cohort_week + INTERVAL '21 days' AND s.cohort_week + INTERVAL '28 days'
    ) / NULLIF(s.cohort_size, 0), 1) AS week_3
  FROM sizes s
  LEFT JOIN active a ON a.cohort_week = s.cohort_week
  GROUP BY s.cohort_week, s.cohort_size
  ORDER BY s.cohort_week;
$$;

-- Top characters by conversation + message volume (engagement), used for
-- both the analytics dashboard and the investor "what's resonating" panel.
CREATE OR REPLACE FUNCTION admin_top_characters(p_limit INT DEFAULT 10)
RETURNS TABLE (
  character_id    UUID,
  name            TEXT,
  conversations   BIGINT,
  messages        BIGINT,
  likes           BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.name,
    COUNT(DISTINCT conv.id)  AS conversations,
    COALESCE(SUM(m.msg_count), 0) AS messages,
    COALESCE(c.like_count, 0) AS likes
  FROM characters c
  LEFT JOIN conversations conv ON conv.character_id = c.id
  LEFT JOIN LATERAL (
    SELECT conv.id AS conv_id, COUNT(*) AS msg_count
    FROM messages msg WHERE msg.conversation_id = conv.id
  ) m ON true
  GROUP BY c.id, c.name, c.like_count
  ORDER BY conversations DESC, messages DESC
  LIMIT p_limit;
$$;

-- ── Investor / sentiment board ─────────────────────────────────────────
-- Everything below is aggregate-only. crisis_events and message content
-- are intentionally never surfaced here beyond counts — this board is for
-- growth/health signal, not a place to read sensitive user data.

CREATE OR REPLACE FUNCTION admin_report_category_breakdown(p_days INT DEFAULT 30)
RETURNS TABLE (category TEXT, count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT category, COUNT(*) AS count
  FROM user_reports
  WHERE created_at > NOW() - (p_days || ' days')::interval
  GROUP BY category
  ORDER BY count DESC;
$$;

CREATE OR REPLACE FUNCTION admin_abuse_signal_trend(p_days INT DEFAULT 30)
RETURNS TABLE (day DATE, signals BIGINT, confirmed_bot BIGINT)
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
    COALESCE((SELECT COUNT(*) FROM abuse_signals WHERE created_at::date = d.day), 0),
    COALESCE((SELECT COUNT(*) FROM abuse_signals WHERE created_at::date = d.day AND status = 'confirmed_bot'), 0)
  FROM days d ORDER BY d.day;
$$;

-- Sensitive-conversation volume, counts only — never content. Gives an
-- investor-facing signal of trust & safety load without exposing anything
-- that would compromise a user's privacy.
CREATE OR REPLACE FUNCTION admin_crisis_event_summary(p_days INT DEFAULT 30)
RETURNS TABLE (category TEXT, count BIGINT, followed_up BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    category,
    COUNT(*) AS count,
    COUNT(*) FILTER (WHERE status = 'reviewed_followed_up') AS followed_up
  FROM crisis_events
  WHERE created_at > NOW() - (p_days || ' days')::interval
  GROUP BY category
  ORDER BY count DESC;
$$;

-- Most-liked community posts in the window — the closest honest proxy this
-- schema has to "what users are saying / responding to" without inventing
-- a reviews table.
CREATE OR REPLACE FUNCTION admin_top_community_posts(p_days INT DEFAULT 30, p_limit INT DEFAULT 10)
RETURNS TABLE (
  post_id      UUID,
  character_id UUID,
  character_name TEXT,
  caption      TEXT,
  likes_count  INTEGER,
  created_at   TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.character_id, c.name, p.caption, p.likes_count, p.created_at
  FROM character_posts p
  JOIN characters c ON c.id = p.character_id
  WHERE p.created_at > NOW() - (p_days || ' days')::interval
  ORDER BY p.likes_count DESC
  LIMIT p_limit;
$$;

-- Churn signal: cancellation trend + which tier churns most. There is no
-- exit-survey/reason field in the schema (flagged to Vantrix — see chat),
-- so this reports the *rate*, not the *why*.
CREATE OR REPLACE FUNCTION admin_churn_trend(p_days INT DEFAULT 30)
RETURNS TABLE (day DATE, cancellations BIGINT)
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
  SELECT d.day, COALESCE((
    SELECT COUNT(*) FROM subscriptions
    WHERE status IN ('cancelled','canceled') AND created_at::date = d.day
  ), 0)
  FROM days d ORDER BY d.day;
$$;

GRANT EXECUTE ON FUNCTION admin_activity_series(INT)        TO service_role;
GRANT EXECUTE ON FUNCTION admin_wau_mau()                   TO service_role;
GRANT EXECUTE ON FUNCTION admin_revenue_series(INT)         TO service_role;
GRANT EXECUTE ON FUNCTION admin_mrr_snapshot()              TO service_role;
GRANT EXECUTE ON FUNCTION admin_tier_breakdown()            TO service_role;
GRANT EXECUTE ON FUNCTION admin_retention_cohorts(INT)      TO service_role;
GRANT EXECUTE ON FUNCTION admin_top_characters(INT)         TO service_role;
GRANT EXECUTE ON FUNCTION admin_report_category_breakdown(INT) TO service_role;
GRANT EXECUTE ON FUNCTION admin_abuse_signal_trend(INT)     TO service_role;
GRANT EXECUTE ON FUNCTION admin_crisis_event_summary(INT)   TO service_role;
GRANT EXECUTE ON FUNCTION admin_top_community_posts(INT,INT) TO service_role;
GRANT EXECUTE ON FUNCTION admin_churn_trend(INT)            TO service_role;
