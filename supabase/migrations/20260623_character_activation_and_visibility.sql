-- =============================================================================
-- Vantrix — Character activation & public-visibility split
-- Migration: 20260623_character_activation_and_visibility.sql
-- =============================================================================
--
-- Context: /api/characters POST inserts user-created characters with
-- active = false (post-moderation, pre-approval) but no route ever existed
-- to flip active back to true — characters could never go live (P0).
--
-- Separately, `active` was only ever enforced by the discover-listing query.
-- Every other reader of the characters table (chat, chat/stream, chat/guest,
-- dating/swipe, the character-initiatives cron) goes through the service-role
-- client, which bypasses RLS entirely — so those routes needed their own
-- explicit `active` check, which they didn't have. A pending/unapproved
-- character was fully chattable and dating-eligible by anyone who knew its
-- UUID (P0/P1). That half of the fix lives in application code (same change
-- set as this migration); this file only carries the schema changes.
--
-- This migration:
--   1. Adds is_public — "appears in the public discover/dating feed" — kept
--      distinct from active ("approved, usable at all"). This lets staff
--      approve a character (active = true, creator can use it / it's no
--      longer a dead end) without it necessarily being surfaced in the public
--      feed yet, if that distinction is ever needed.
--   2. Backfills is_public = active for all existing rows, so already-active
--      staff/canon characters keep exactly their current visibility.
--   3. Consolidates the duplicate creator_id / created_by columns. The
--      application has only ever written creator_id — created_by is always
--      NULL in practice. Any legacy created_by value is folded into
--      creator_id defensively before the column is dropped, and the RLS
--      policy that referenced created_by is updated to match.
--   4. Adds a CHECK constraint so a row can never be is_public while
--      inactive — this invariant is relied on by application code and is
--      worth enforcing at the schema level too.
--   5. Adds a partial index supporting the discover/dating feed query shape
--      (active = true AND is_public = true, ordered by created_at).
-- =============================================================================

-- 1. is_public column ----------------------------------------------------------
ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Backfill: preserve current visibility for existing rows -------------------
UPDATE characters SET is_public = TRUE WHERE active = TRUE AND is_public = FALSE;

-- 3. Consolidate creator_id / created_by ---------------------------------------
UPDATE characters
   SET creator_id = created_by
 WHERE creator_id IS NULL
   AND created_by IS NOT NULL;

-- BUGFIX (this migration, pre-release): the policy below references
-- created_by in its USING clause, which registers it as a dependency of that
-- column. DROP COLUMN must run AFTER the dependent policy is dropped, not
-- before — doing it in the other order fails with:
--   ERROR: cannot drop column created_by of table characters because other
--   objects depend on it
--   DETAIL: policy characters_own_write on table characters depends on
--   column created_by of table characters
-- Reproduced and confirmed against a real Postgres 16 instance before fixing.
DROP POLICY IF EXISTS "characters_own_write" ON characters;

ALTER TABLE characters DROP COLUMN IF EXISTS created_by;

CREATE POLICY "characters_own_write" ON characters FOR ALL USING (
  auth.uid() = creator_id OR is_admin()
);

-- 4. Invariant: never publicly listed while inactive ----------------------------
ALTER TABLE characters
  DROP CONSTRAINT IF EXISTS characters_public_requires_active;
ALTER TABLE characters
  ADD CONSTRAINT characters_public_requires_active
  CHECK (NOT is_public OR active);

-- 5. Supporting index for the discover/dating feed query ------------------------
CREATE INDEX IF NOT EXISTS idx_characters_public_feed
  ON characters (created_at DESC)
  WHERE active = TRUE AND is_public = TRUE;
