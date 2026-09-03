-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: remove_character_private_media() rejected the *public* gallery
-- columns (gallery_image_urls / gallery_video_urls), even though its
-- sibling append_character_private_media() has always accepted them.
--
-- Effect of the bug: DELETE /api/admin/characters/[id]/media worked for
-- private-stash images but threw "invalid column gallery_image_urls" for
-- anything in the public character gallery — an admin could add a public
-- gallery image but never remove one via that route.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION remove_character_private_media(p_character_id UUID, p_column TEXT, p_url TEXT)
RETURNS TEXT[] AS $$
DECLARE
  v_result TEXT[];
BEGIN
  IF p_column NOT IN (
    'private_gallery_image_urls', 'private_gallery_video_urls',
    'gallery_image_urls', 'gallery_video_urls'
  ) THEN
    RAISE EXCEPTION 'remove_character_private_media: invalid column %', p_column;
  END IF;

  EXECUTE format(
    'UPDATE characters SET %I = array_remove(COALESCE(%I, ARRAY[]::TEXT[]), $1) WHERE id = $2 RETURNING %I',
    p_column, p_column, p_column
  ) INTO v_result USING p_url, p_character_id;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
