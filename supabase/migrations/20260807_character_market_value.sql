-- Character Market Value & Rarity
--
-- "Character rarity/market value" — distinct from the fictional in-world
-- status/legend system (social_status, legends), which is simulated and
-- decays on narrative events. This table tracks REAL platform value: a
-- character becomes more valuable as real users actually engage with it
-- (likes, follows, swipes, conversations, gifts) — the collectible angle.
--
-- Rarity tiers are RELATIVE (percentile-based), not fixed thresholds, so
-- scarcity is structural: only the top slice of characters can ever hold
-- the rarest tiers, no matter how the whole roster's engagement grows.
-- Top tiers additionally carry a hard cap, mirroring the existing
-- MAX_ACTIVE_LEGENDS pattern in status-legend.ts.

CREATE TABLE IF NOT EXISTS character_market_value (
  character_id      UUID        PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  value_score        NUMERIC     NOT NULL DEFAULT 0,
  percentile          NUMERIC     NOT NULL DEFAULT 0,   -- 0..100, higher = more valuable
  rarity_tier         TEXT        NOT NULL DEFAULT 'common',
  previous_tier        TEXT,
  value_history       JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- [{ at, score, tier }], capped 30
  signals              JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- raw components, for transparency/debugging
  computed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT character_market_value_rarity_check
    CHECK (rarity_tier IN ('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'))
);

CREATE INDEX IF NOT EXISTS idx_character_market_value_score  ON character_market_value (value_score DESC);
CREATE INDEX IF NOT EXISTS idx_character_market_value_rarity ON character_market_value (rarity_tier, value_score DESC);

ALTER TABLE character_market_value ENABLE ROW LEVEL SECURITY;

-- Value/rarity is a public-facing signal (badges on cards, leaderboard) —
-- readable by anyone, writable only by the service role (via the tick job).
CREATE POLICY character_market_value_public_read
  ON character_market_value
  FOR SELECT
  USING (true);
