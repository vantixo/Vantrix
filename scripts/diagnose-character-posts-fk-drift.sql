-- diagnose-character-posts-fk-drift.sql
--
-- WHY THIS EXISTS
-- ────────────────
-- Live error: "Could not embed because more than one relationship was
-- found for 'character_posts' and 'characters'" — PostgREST/Supabase's
-- standard error when two tables have 2+ FK constraints directly between
-- them and a query embeds one without specifying which.
--
-- The checked-in migrations (20240101_production.sql) and the checked-in
-- generated types (src/types/supabase.ts) both show exactly ONE FK
-- between these two tables: character_posts_character_id_fkey. That means
-- the live database has drifted from what's in this repo — most likely a
-- second FK constraint (possibly on a renamed/duplicate column, or a
-- leftover from a rollback/rename) was added directly against the live DB
-- and never captured in a migration file here.
--
-- The application-code side of this is already fixed (every query that
-- embeds `characters` off `character_posts` now names the FK explicitly:
-- `characters!character_posts_character_id_fkey`), so the ambiguity no
-- longer breaks the app regardless of what's live. This script is for
-- finding — and, once you've confirmed it's actually a leftover, removing
-- — the drift itself, so the schema matches what's checked in here.
--
-- Run the SELECT first. Nothing below it is destructive on its own; the
-- DROP at the bottom is commented out and named by hand after you've
-- inspected the output — do not uncomment it blind.

SELECT
  con.conname                                   AS constraint_name,
  con.contype,
  pg_get_constraintdef(con.oid)                 AS definition
FROM pg_constraint con
JOIN pg_class rel      ON rel.oid = con.conrelid
JOIN pg_class frel     ON frel.oid = con.confrelid
WHERE con.contype = 'f'
  AND rel.relname  = 'character_posts'
  AND frel.relname = 'characters';

-- Expected (matches this repo): exactly one row,
-- constraint_name = character_posts_character_id_fkey.
--
-- If you see 2+ rows: the extra one(s) are the drift. Once you've
-- confirmed (from `definition`) which constraint is the real one your
-- data actually depends on and which is the stray duplicate, drop the
-- stray by name:
--
--   ALTER TABLE character_posts DROP CONSTRAINT <stray_constraint_name>;
--
-- After dropping it, PostgREST's schema cache needs a refresh before the
-- ambiguity error clears even for *unhinted* embeds elsewhere in the repo
-- (Supabase dashboard: Settings → API → "Reload schema", or
-- `NOTIFY pgrst, 'reload schema';` if you're on self-hosted PostgREST).
