-- Response language preference — see src/lib/ai/language-engine.ts.
--
-- 'auto' (default) means the language engine detects and follows what the
-- user is actually typing, per conversation, with turn-to-turn smoothing.
-- Any other value pins the character to that language regardless of what
-- the user types in. NULL is treated identically to 'auto' by the app
-- layer (resolveLanguageState only branches on `!= 'auto'`), but the
-- column itself is NOT NULL with a default so existing rows and every new
-- signup land on an explicit, unambiguous value rather than depending on
-- application code to interpret a NULL correctly forever.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'auto';

-- Loose format guard only — this is a free-text ISO 639-1 code (or 'auto'),
-- not a foreign key to a fixed language table, since language-engine.ts's
-- LANGUAGE_NAMES map is intentionally easy to extend without a migration.
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_preferred_language_format;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_preferred_language_format
  CHECK (preferred_language = 'auto' OR preferred_language ~ '^[a-z]{2}$');
