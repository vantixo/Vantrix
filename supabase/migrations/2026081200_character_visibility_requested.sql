-- =============================================================================
-- Vantrix — creator-requested visibility at character-creation time
-- Migration: 20260812_character_visibility_requested.sql
-- =============================================================================
--
-- Context: the creation wizard (POST /api/characters) always inserts new
-- characters as is_public = false, moderation_status = 'pending' — correct,
-- since characters_public_requires_active (see 20260623 migration) means a
-- not-yet-approved character can never be is_public = true.
--
-- But the wizard now lets a creator state their INTENT ("make this public
-- once it's approved" vs "keep this private") at creation time. That intent
-- has to be stored somewhere that survives the moderation step, since
-- is_public itself can't carry it yet. This column is that storage:
--   - visibility_requested = 'private' (default): approval leaves is_public
--     false, same as today's behavior.
--   - visibility_requested = 'public': approval sets is_public = true,
--     honoring the creator's original choice, instead of every approval
--     defaulting to public regardless of what the creator asked for.
--
-- The creator can always change their mind later via the existing
-- PATCH /api/characters/:id/visibility route regardless of this value —
-- this column only affects the ONE-TIME default applied at approval time.
-- =============================================================================

ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS visibility_requested TEXT NOT NULL DEFAULT 'private'
  CHECK (visibility_requested IN ('private', 'public'));

-- Backfill: existing rows keep the behavior they'd have gotten under the old
-- "approval defaults to public" logic, so this migration changes nothing for
-- characters that already exist.
UPDATE characters SET visibility_requested = 'public' WHERE visibility_requested = 'private' AND is_public = TRUE;
