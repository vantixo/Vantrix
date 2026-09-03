-- Daily World Choice
--
-- The "one meaningful, infrequent decision" engagement mechanic: exactly one
-- active world choice at a time, generated from real world state (a city's
-- governance/economy/culture), that users can weigh in on once. Votes tilt
-- the outcome the next governance/economy tick applies — this is a thin
-- input layer on top of the existing simulation (city_governance,
-- location_economy, culture engines), not a new game system.
--
-- Deliberately excluded by design: no streaks, no XP, no daily-login
-- requirement to keep a bonus. Skipping a day costs the user nothing; the
-- world moves on with or without their input, per the existing "world
-- ticks itself" principle already used by universe_state/world_events.

CREATE TABLE IF NOT EXISTS daily_world_choices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id    uuid REFERENCES world_locations(id) ON DELETE SET NULL,
  prompt         text NOT NULL,
  option_a_label text NOT NULL,
  option_b_label text NOT NULL,
  -- Free-form context surfaced on the card (e.g. "Ashgrove's treasury is
  -- strained after the harvest failure") so the choice reads as a
  -- consequence of the living world, not an arbitrary poll.
  context        text,
  -- What each option nudges when the next governance/economy tick runs.
  -- Read by the world-tick workers; not interpreted client-side.
  option_a_effect jsonb NOT NULL DEFAULT '{}'::jsonb,
  option_b_effect jsonb NOT NULL DEFAULT '{}'::jsonb,
  active_date    date NOT NULL DEFAULT CURRENT_DATE,
  resolved       boolean NOT NULL DEFAULT false,
  resolved_option text CHECK (resolved_option IN ('a', 'b')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz,
  -- Exactly one active choice per calendar day across the whole world —
  -- this is a single shared world event, not a per-user quest.
  UNIQUE (active_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_world_choices_active
  ON daily_world_choices(active_date) WHERE NOT resolved;

CREATE TABLE IF NOT EXISTS user_world_choice_votes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  choice_id  uuid NOT NULL REFERENCES daily_world_choices(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  option     text NOT NULL CHECK (option IN ('a', 'b')),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One vote per user per choice. A second POST from the same user is a
  -- no-op read of their existing vote, handled in the API layer.
  UNIQUE (choice_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_world_choice_votes_choice
  ON user_world_choice_votes(choice_id);

-- Public tally view — counts only, never exposes who voted for what.
CREATE OR REPLACE VIEW daily_world_choice_tallies AS
SELECT
  choice_id,
  COUNT(*) FILTER (WHERE option = 'a') AS votes_a,
  COUNT(*) FILTER (WHERE option = 'b') AS votes_b,
  COUNT(*)                             AS votes_total
FROM user_world_choice_votes
GROUP BY choice_id;

ALTER TABLE daily_world_choices     ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_world_choice_votes ENABLE ROW LEVEL SECURITY;

-- Choices are world state: readable by anyone, written only by service_role
-- (the generator cron / tick worker), matching the pattern already used for
-- world_impact_events, city_governance, etc.
CREATE POLICY "public_read_daily_world_choices" ON daily_world_choices
  FOR SELECT USING (true);

-- Votes: a user may read and insert only their own vote. No UPDATE policy
-- (votes are final once cast — changing your mind after seeing the tally
-- would let users chase the winning side, which defeats the point of
-- asking). No DELETE policy for the same reason.
CREATE POLICY "users_read_own_vote" ON user_world_choice_votes
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "users_insert_own_vote" ON user_world_choice_votes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- daily_world_choice_tallies is owned by the migration role (postgres),
-- which bypasses RLS on user_world_choice_votes when the view is queried —
-- this is what lets it return real aggregate counts instead of only the
-- querying user's own row. Grant explicit read access to app roles.
GRANT SELECT ON daily_world_choice_tallies TO anon, authenticated;
