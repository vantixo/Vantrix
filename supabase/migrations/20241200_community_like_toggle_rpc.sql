-- ============================================================================
-- Migration: 20241200_community_like_toggle_rpc.sql
-- Fixes a read-modify-write race condition on community post/reply likes.
--
-- PROBLEM:
--   The API routes previously did: SELECT liked_by -> compute new array in
--   application code -> UPDATE liked_by/likes_count. Two concurrent requests
--   (e.g. the same user double-tapping like, or two different users liking
--   at once) could both read the same snapshot of `liked_by`, then both
--   write back, with the second write clobbering the first. This produces
--   an incorrect likes_count (e.g. count goes up by 1 instead of 2, or a
--   like is silently dropped) and an inconsistent liked_by array.
--
-- FIX:
--   Move the read-check-mutate-write sequence into a single Postgres
--   function executed atomically inside one statement's transaction.
--   Postgres takes a row lock on the UPDATE target, so concurrent calls to
--   the same post/reply serialize correctly — no client-visible race.
--
--   liked_by remains a jsonb array (no schema change), but the membership
--   test, array mutation, and count update happen server-side in one
--   UPDATE ... RETURNING, rather than round-tripping through the app.
-- ============================================================================

-- ── Community post like toggle ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION toggle_community_post_like(p_post_id UUID, p_user_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_was_liked  BOOLEAN;
  v_new_liked  JSONB;
  v_new_count  INTEGER;
BEGIN
  -- Lock the target row up front so concurrent toggles on the same post
  -- serialize on this row lock instead of racing on independent reads.
  PERFORM 1 FROM community_posts WHERE id = p_post_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post not found';
  END IF;

  SELECT (liked_by ? p_user_id::text) INTO v_was_liked
  FROM community_posts WHERE id = p_post_id;

  IF v_was_liked THEN
    UPDATE community_posts
    SET liked_by    = (
          SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
          FROM jsonb_array_elements_text(liked_by) elem
          WHERE elem <> p_user_id::text
        ),
        likes_count = GREATEST(0, likes_count - 1)
    WHERE id = p_post_id
    RETURNING liked_by, likes_count INTO v_new_liked, v_new_count;
  ELSE
    UPDATE community_posts
    SET liked_by    = liked_by || to_jsonb(p_user_id::text),
        likes_count = likes_count + 1
    WHERE id = p_post_id
    RETURNING liked_by, likes_count INTO v_new_liked, v_new_count;
  END IF;

  RETURN json_build_object('liked', NOT v_was_liked, 'likes_count', v_new_count);
END;
$$;

GRANT EXECUTE ON FUNCTION toggle_community_post_like(UUID, UUID) TO authenticated;

-- ── Community reply like toggle ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION toggle_community_reply_like(p_reply_id UUID, p_user_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_was_liked  BOOLEAN;
  v_new_liked  JSONB;
  v_new_count  INTEGER;
BEGIN
  PERFORM 1 FROM community_replies WHERE id = p_reply_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reply not found';
  END IF;

  SELECT (liked_by ? p_user_id::text) INTO v_was_liked
  FROM community_replies WHERE id = p_reply_id;

  IF v_was_liked THEN
    UPDATE community_replies
    SET liked_by    = (
          SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
          FROM jsonb_array_elements_text(liked_by) elem
          WHERE elem <> p_user_id::text
        ),
        likes_count = GREATEST(0, likes_count - 1)
    WHERE id = p_reply_id
    RETURNING liked_by, likes_count INTO v_new_liked, v_new_count;
  ELSE
    UPDATE community_replies
    SET liked_by    = liked_by || to_jsonb(p_user_id::text),
        likes_count = likes_count + 1
    WHERE id = p_reply_id
    RETURNING liked_by, likes_count INTO v_new_liked, v_new_count;
  END IF;

  RETURN json_build_object('liked', NOT v_was_liked, 'likes_count', v_new_count);
END;
$$;

GRANT EXECUTE ON FUNCTION toggle_community_reply_like(UUID, UUID) TO authenticated;
