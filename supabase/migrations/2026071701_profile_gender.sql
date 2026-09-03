-- ============================================================
-- User Gender Capture — 20260717
-- Adds a self-reported gender field to profiles so:
--   1. Users choose their gender at account creation.
--   2. Characters can be given the user's gender in the system
--      prompt for more natural, personalised address and better
--      understanding of the user (see src/lib/ai/prompt.ts).
-- Nullable — OAuth signups land here before they can be prompted,
-- and existing users backfill via /profile settings.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS gender text
    CHECK (gender IN ('male', 'female', 'non_binary', 'prefer_not_to_say'));

COMMENT ON COLUMN profiles.gender IS
  'Self-reported at signup (or later via /profile settings). Used to give characters better context about the user — never inferred or guessed.';
