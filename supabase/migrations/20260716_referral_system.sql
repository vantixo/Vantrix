-- ============================================================
-- Vantrix Referral System — 20260716
-- Tiered rewards: Bronze → Silver → Gold → Legend
-- Each referrer's reward scales with their total referral count.
-- ============================================================

-- ── referrals table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referrals (
  id                    uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  referrer_id           uuid          NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  referee_id            uuid          NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  code                  text          NOT NULL,
  status                text          NOT NULL DEFAULT 'completed'
                          CHECK (status IN ('completed', 'reversed')),
  referrer_tokens       integer       NOT NULL DEFAULT 0,
  referee_tokens        integer       NOT NULL DEFAULT 0,
  referrer_tier_at_time text          NOT NULL DEFAULT 'bronze',
  completed_at          timestamptz   NOT NULL DEFAULT now(),
  created_at            timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT referrals_unique_referee UNIQUE (referee_id),
  CONSTRAINT referrals_no_self_ref    CHECK  (referrer_id <> referee_id)
);

CREATE INDEX IF NOT EXISTS referrals_referrer_idx   ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS referrals_code_idx       ON referrals(code);
CREATE INDEX IF NOT EXISTS referrals_completed_idx  ON referrals(completed_at DESC);

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "referrer_select_own" ON referrals
  FOR SELECT USING (auth.uid() = referrer_id);

CREATE POLICY "referee_select_own" ON referrals
  FOR SELECT USING (auth.uid() = referee_id);

-- ── Helper functions ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION referral_tier(p_count integer)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_count >= 25 THEN 'legend'
    WHEN p_count >= 10 THEN 'gold'
    WHEN p_count >=  5 THEN 'silver'
    ELSE 'bronze'
  END;
$$;

CREATE OR REPLACE FUNCTION referral_tokens_for_count(p_count integer)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_count >= 25 THEN 150
    WHEN p_count >= 10 THEN 100
    WHEN p_count >=  5 THEN 75
    ELSE 50
  END;
$$;

COMMENT ON TABLE referrals IS
  'Tracks completed referral conversions. Unique constraint on referee_id prevents double-rewarding.';

-- ── OPTIMIZATION: leaderboard aggregate ────────────────────────
-- getReferralLeaderboard() originally fetched every completed referral row
-- (referrer_id, referrer_tokens, joined profile) unfiltered and aggregated
-- them in Node with a JS Map — fine at low volume, but that result set
-- grows unbounded with total referral count and gets fully pulled into
-- memory just to compute a top-50 leaderboard. This pushes the GROUP BY /
-- ORDER BY / LIMIT into Postgres, which is what it's for — only the final
-- 50 rows ever cross the wire.
CREATE OR REPLACE FUNCTION get_referral_leaderboard(p_limit integer DEFAULT 50)
RETURNS TABLE (
  user_id             uuid,
  username            text,
  display_name        text,
  avatar_url          text,
  total_referrals     bigint,
  total_tokens_earned bigint
) LANGUAGE sql STABLE AS $$
  SELECT
    r.referrer_id,
    p.username,
    p.display_name,
    p.avatar_url,
    COUNT(*)                    AS total_referrals,
    COALESCE(SUM(r.referrer_tokens), 0) AS total_tokens_earned
  FROM referrals r
  JOIN profiles p ON p.id = r.referrer_id
  WHERE r.status = 'completed'
  GROUP BY r.referrer_id, p.username, p.display_name, p.avatar_url
  ORDER BY total_referrals DESC, total_tokens_earned DESC
  LIMIT p_limit;
$$;

-- ── OPTIMIZATION: per-user totals ──────────────────────────────
-- getReferralStats() fetched a user's ENTIRE referral history (unbounded,
-- ordered by completed_at) just to derive totalReferrals (row count) and
-- totalTokensEarned (JS reduce over all rows) — even though the dashboard
-- only ever displays the most recent 25. A top referrer with hundreds of
-- rows paid that full cost on every cache miss. This computes the totals
-- in Postgres in one cheap aggregate query; the recent-25 display list is
-- fetched separately with an actual LIMIT.
CREATE OR REPLACE FUNCTION get_referral_user_totals(p_user_id uuid)
RETURNS TABLE (
  total_referrals     bigint,
  total_tokens_earned bigint
) LANGUAGE sql STABLE AS $$
  SELECT
    COUNT(*)                             AS total_referrals,
    COALESCE(SUM(referrer_tokens), 0)    AS total_tokens_earned
  FROM referrals
  WHERE referrer_id = p_user_id AND status = 'completed';
$$;
