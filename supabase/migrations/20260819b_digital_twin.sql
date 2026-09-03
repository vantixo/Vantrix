-- Digital Twin — Elite-tier feature (see canUseDigitalTwin() in
-- lib/tiers/config.ts, previously dead code with nothing behind it despite
-- being advertised on the pricing page). An AI clone of the USER that
-- learns their own texting style and can generate replies "as them".
--
-- One row per user. auto_* columns are (re)written by buildStyleProfile()
-- from the user's own message history; manual_* columns are user-supplied
-- refinements layered on top at generation time — auto-learning never
-- overwrites manual input.

CREATE TABLE IF NOT EXISTS digital_twin_profiles (
  user_id               uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  enabled               boolean NOT NULL DEFAULT true,

  -- Auto-learned from the user's own sent messages (role='user' rows the
  -- user themself wrote, across their conversations). Rebuilt whenever
  -- /api/digital-twin/train is called; never hand-edited.
  auto_style_summary    text,               -- free-text style description written by the LLM
  auto_traits           jsonb,              -- structured: tone, avgMessageLength, emojiUsage, commonPhrases[], vocabularyNotes
  source_message_count  integer NOT NULL DEFAULT 0,
  last_trained_at       timestamptz,

  -- Manual refinement — user-supplied, always takes precedence over the
  -- auto-learned profile when both speak to the same trait.
  manual_notes          text,               -- freeform "make sure my twin always..." instructions
  manual_sample_phrases text[] NOT NULL DEFAULT '{}',

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE digital_twin_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users read own digital twin" ON digital_twin_profiles;
CREATE POLICY "users read own digital twin" ON digital_twin_profiles
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "users update own digital twin" ON digital_twin_profiles;
CREATE POLICY "users update own digital twin" ON digital_twin_profiles
  FOR UPDATE USING (user_id = auth.uid());

-- Log of twin-generated replies, mainly so a user can review/delete what
-- their twin has said and so abuse/quality issues are auditable.
CREATE TABLE IF NOT EXISTS digital_twin_messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  prompt         text NOT NULL,     -- what the twin was asked to respond to
  reply          text NOT NULL,     -- what the twin generated
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_digital_twin_messages_user ON digital_twin_messages (user_id, created_at DESC);

ALTER TABLE digital_twin_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users read own digital twin messages" ON digital_twin_messages;
CREATE POLICY "users read own digital twin messages" ON digital_twin_messages
  FOR SELECT USING (user_id = auth.uid());
