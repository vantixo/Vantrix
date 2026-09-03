-- Chat-based discover personalization
-- ─────────────────────────────────────────────────────────────────────────
-- Discover's recommendation engine (lib/recommendations/engine.ts) has only
-- ever learned from dating_swipes — a signal most users never generate,
-- since swiping is the dating feature, not the main chat surface. This adds
-- a second, independent signal: which tags/archetypes a user actually
-- *talks to* a lot, derived from real conversations + messages.
--
-- Computed as a single SQL function (rather than N round-trips from the
-- app) for one reason: doing "count messages per conversation, per tag,
-- with a recency decay" in application code would mean fetching every
-- message row for every conversation the user has ever had, just to count
-- them. This aggregates server-side and returns one small row per tag.
--
-- Deliberate design choices, spelled out because they matter for what kind
-- of product this becomes:
--
--   1. PER-CONVERSATION MESSAGE COUNT IS CAPPED (LEAST(..., 200)) before it
--      contributes to a tag's weight. Uncapped, a single conversation
--      someone got unusually absorbed in (including in an unhealthy way)
--      would dominate their entire taste profile and cause Discover to
--      relentlessly re-serve more of exactly that. Capping means loyalty
--      to a character registers, but compulsive volume in one thread
--      doesn't get an unbounded multiplier.
--
--   2. WEIGHT IS BY DISTINCT CONVERSATION, NOT RAW MESSAGE COUNT ACROSS ALL
--      TIME — recency-decayed per conversation using its last_message_at,
--      half-life 14 days. A tag the user talked to a lot two months ago but
--      hasn't touched since fades out; this is meant to track current
--      taste, not build a permanent profile of past behavior.
--
--   3. NO SIGNAL FROM SESSION FREQUENCY OR TIME-OF-DAY. Deliberately not
--      computing anything like "checks in every 2 hours" or "chats late at
--      night" as a taste signal — that's a path toward optimizing for
--      compulsive-use patterns rather than content preference, and this
--      function has no inputs that could be read that way even by
--      accident.
CREATE OR REPLACE FUNCTION chat_affinity_tags(p_user_id UUID, p_half_life_days NUMERIC DEFAULT 14)
RETURNS TABLE(tag TEXT, weight NUMERIC)
LANGUAGE sql
STABLE
AS $$
  WITH conv_engagement AS (
    SELECT
      c.character_id,
      LEAST(COUNT(m.id) FILTER (WHERE m.role = 'user'), 200)::NUMERIC AS capped_msg_count,
      -- Recency decay off the conversation's own last activity, not "now
      -- minus creation" — a conversation started months ago that's still
      -- active today should not be treated as stale.
      POWER(0.5, EXTRACT(EPOCH FROM (NOW() - c.last_message_at)) / (86400 * p_half_life_days)) AS recency_factor
    FROM conversations c
    JOIN messages m ON m.conversation_id = c.id
    WHERE c.user_id = p_user_id
    GROUP BY c.id, c.character_id, c.last_message_at
  ),
  char_weight AS (
    SELECT
      character_id,
      SUM(capped_msg_count * recency_factor) AS engagement_weight
    FROM conv_engagement
    GROUP BY character_id
  )
  SELECT tag, SUM(cw.engagement_weight) AS weight
  FROM char_weight cw
  JOIN characters ch ON ch.id = cw.character_id
  CROSS JOIN LATERAL (
    SELECT unnest(ch.tags) AS tag
    UNION ALL
    SELECT 'archetype:' || ch.archetype WHERE ch.archetype IS NOT NULL
  ) tags
  GROUP BY tag
  ORDER BY weight DESC
  LIMIT 60;
$$;

COMMENT ON FUNCTION chat_affinity_tags IS
  'Per-user tag/archetype affinity derived from real chat engagement (capped, recency-decayed message counts), independent of the dating_swipes-only signal in lib/recommendations/engine.ts. Used to personalize the Discover feed.';
