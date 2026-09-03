-- ─────────────────────────────────────────────────────────────────────────────
-- Private, admin-only media gallery per character.
--
-- Distinct from gallery_image_urls / gallery_video_urls (20260717), which
-- are public-facing and shown to end users in the character profile
-- carousel. private_gallery_* is never returned to end users or to
-- character creators — it exists purely so an admin can manually curate a
-- reference/asset stash per character. Enforcement is at the application
-- layer (admin-gated routes only) since these columns live on the same
-- `characters` row as public fields already covered by the
-- "characters_read" RLS policy — see the accompanying code changes that
-- strip these fields from every non-admin read path.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS private_gallery_image_urls TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS private_gallery_video_urls TEXT[] DEFAULT '{}';

COMMENT ON COLUMN characters.private_gallery_image_urls IS 'Admin-only image stash for this character. NEVER expose via public/creator-facing APIs — see /api/admin/characters/[id]/media and /api/admin/characters/[id]/private-gallery, the only routes permitted to read/write this column.';
COMMENT ON COLUMN characters.private_gallery_video_urls IS 'Admin-only video stash for this character. Same access restriction as private_gallery_image_urls.';

-- Atomic append/remove so admin uploads (or concurrent admin edits) never
-- lose an entry to a fetch-then-write race, matching the hardening applied
-- to the daily-unlock system in 20260720b.
CREATE OR REPLACE FUNCTION append_character_private_media(p_character_id UUID, p_column TEXT, p_url TEXT)
RETURNS TEXT[] AS $$
DECLARE
  v_result TEXT[];
BEGIN
  -- Whitelist covers both admin-only and public gallery array columns, so
  -- the admin media upload route (which handles both) can call this one
  -- function. p_column is never user input — it's looked up from the
  -- fixed FIELD_TO_COLUMN map in the route, not passed through from the
  -- request body/query directly.
  IF p_column NOT IN (
    'private_gallery_image_urls', 'private_gallery_video_urls',
    'gallery_image_urls', 'gallery_video_urls'
  ) THEN
    RAISE EXCEPTION 'append_character_private_media: invalid column %', p_column;
  END IF;

  EXECUTE format(
    'UPDATE characters SET %I = array_append(COALESCE(%I, ARRAY[]::TEXT[]), $1) WHERE id = $2 RETURNING %I',
    p_column, p_column, p_column
  ) INTO v_result USING p_url, p_character_id;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION remove_character_private_media(p_character_id UUID, p_column TEXT, p_url TEXT)
RETURNS TEXT[] AS $$
DECLARE
  v_result TEXT[];
BEGIN
  IF p_column NOT IN ('private_gallery_image_urls', 'private_gallery_video_urls') THEN
    RAISE EXCEPTION 'remove_character_private_media: invalid column %', p_column;
  END IF;

  EXECUTE format(
    'UPDATE characters SET %I = array_remove(COALESCE(%I, ARRAY[]::TEXT[]), $1) WHERE id = $2 RETURNING %I',
    p_column, p_column, p_column
  ) INTO v_result USING p_url, p_character_id;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- These are called only from admin-gated (service-role) routes — restrict
-- execution to service_role, not the broad authenticated grant used by the
-- daily-unlock RPCs above.
GRANT EXECUTE ON FUNCTION append_character_private_media(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION remove_character_private_media(UUID, TEXT, TEXT) TO service_role;

-- RLS on `characters` is row-level (active + approved), not column-level —
-- it does nothing to hide these two columns from a plain `select('*')`
-- issued by a logged-in user's browser client (e.g. src/app/(main)/chat/page.tsx
-- uses the anon/authenticated-scoped client, not supabaseAdmin). PostgREST
-- respects column-level GRANTs though: revoking SELECT on just these two
-- columns for anon/authenticated means a '*' select from those roles omits
-- them from the response entirely, with no error and no code change needed
-- at every call site. service_role (used by supabaseAdmin) is unaffected.
REVOKE SELECT (private_gallery_image_urls, private_gallery_video_urls) ON characters FROM anon;
REVOKE SELECT (private_gallery_image_urls, private_gallery_video_urls) ON characters FROM authenticated;
