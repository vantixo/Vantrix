-- Adds an explicit, default-OFF opt-in flag controlling whether a user's
-- chat messages may be queued for Kaetah training-data collection.
--
-- Default is false on purpose: this is real user conversation content, and
-- consent must be affirmative, not assumed. queueForTraining()
-- (src/lib/training/queue.ts) checks this column before ever touching a
-- message; nothing is queued for a user who hasn't set it true.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS training_data_consent boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN profiles.training_data_consent IS
  'Opt-in: user has consented to their (redacted, de-identified) chat messages being used for Kaetah model training and character-building. Default false — must be explicitly set true.';

CREATE INDEX IF NOT EXISTS idx_profiles_training_data_consent
  ON profiles (training_data_consent)
  WHERE training_data_consent = true;
