-- ═══════════════════════════════════════════════════════════════════════
-- P0 fix: 20260930b_lock_privileged_rpcs.sql revoked most privileged
-- SECURITY DEFINER RPCs from `authenticated`, but did not enumerate the
-- social/reward RPCs below. Each accepts a caller-controlled p_user_id
-- and was still GRANTed to `authenticated`, so any logged-in browser
-- client could call e.g.:
--
--   supabase.rpc('toggle_character_like', { p_user_id: '<victim>', p_char_id: '<id>' })
--
-- and mutate another user's likes/follows/rewards under elevated
-- privilege, since the function itself never checked auth.uid().
--
-- Audit confirms every legitimate caller already goes through
-- supabaseAdmin (service_role) after resolving the acting user from
-- their own session (src/app/api/characters/**/like, **/follow,
-- src/app/api/community/**/like, src/app/api/feed/posts/**/like).
-- claim_daily_login_reward currently has no application caller at all.
--
-- Fix (defense in depth, both layers from the audit):
--   1. Re-create each function (bodies unchanged from their canonical
--      definitions) with an added auth.uid() = p_user_id guard, so a
--      caller can never mutate another user's identity-bound data even
--      if a future change re-grants these to `authenticated`.
--   2. REVOKE EXECUTE from anon/authenticated/PUBLIC, leaving only
--      service_role, matching the intent of 20260930b_lock_privileged_rpcs.sql.
-- ═══════════════════════════════════════════════════════════════════════

-- 1) toggle_character_like(p_user_id, p_char_id) — canonical body: 20240101_production.sql
CREATE OR REPLACE FUNCTION toggle_character_like(p_user_id UUID, p_char_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_liked BOOLEAN;
  v_count INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'unauthorized: cannot act on behalf of another user';
  END IF;

  SELECT EXISTS(SELECT 1 FROM character_likes WHERE user_id = p_user_id AND character_id = p_char_id) INTO v_liked;
  IF v_liked THEN
    DELETE FROM character_likes WHERE user_id = p_user_id AND character_id = p_char_id;
    UPDATE characters SET like_count = GREATEST(0, like_count - 1) WHERE id = p_char_id RETURNING like_count INTO v_count;
  ELSE
    INSERT INTO character_likes (user_id, character_id) VALUES (p_user_id, p_char_id) ON CONFLICT DO NOTHING;
    UPDATE characters SET like_count = like_count + 1 WHERE id = p_char_id RETURNING like_count INTO v_count;
  END IF;
  RETURN jsonb_build_object('liked', NOT v_liked, 'like_count', v_count);
END;
$$;

-- 2) claim_daily_login_reward(p_user_id) — canonical body: 20240101_production.sql
CREATE OR REPLACE FUNCTION claim_daily_login_reward(p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_today   DATE    := CURRENT_DATE;
  v_reward  INTEGER;
  v_balance INTEGER;
  v_claimed BOOLEAN;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'unauthorized: cannot act on behalf of another user';
  END IF;

  SELECT (last_login_reward = v_today) INTO v_claimed FROM profiles WHERE id = p_user_id;
  IF COALESCE(v_claimed, FALSE) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'already_claimed_today');
  END IF;
  SELECT value::INTEGER INTO v_reward FROM app_config WHERE key = 'login_reward_swipes';
  v_reward := COALESCE(v_reward, 5);
  UPDATE profiles
  SET swipe_points = swipe_points + v_reward,
      last_login_reward = v_today,
      last_active_at    = NOW()
  WHERE id = p_user_id
  RETURNING swipe_points INTO v_balance;
  RETURN jsonb_build_object('claimed', true, 'points_earned', v_reward, 'balance', v_balance);
END;
$$;

-- 3) toggle_post_like(p_post_id, p_user_id) — canonical body: 20240101_production.sql
CREATE OR REPLACE FUNCTION toggle_post_like(p_post_id UUID, p_user_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_already   BOOLEAN;
  v_new_count INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'unauthorized: cannot act on behalf of another user';
  END IF;

  SELECT EXISTS(SELECT 1 FROM post_likes WHERE post_id = p_post_id AND user_id = p_user_id) INTO v_already;
  IF NOT EXISTS (SELECT 1 FROM character_posts WHERE id = p_post_id) THEN
    RAISE EXCEPTION 'Post not found';
  END IF;
  IF v_already THEN
    DELETE FROM post_likes WHERE post_id = p_post_id AND user_id = p_user_id;
    UPDATE character_posts SET likes_count = GREATEST(0, likes_count - 1) WHERE id = p_post_id RETURNING likes_count INTO v_new_count;
  ELSE
    INSERT INTO post_likes (post_id, user_id) VALUES (p_post_id, p_user_id) ON CONFLICT DO NOTHING;
    IF FOUND THEN
      UPDATE character_posts SET likes_count = likes_count + 1 WHERE id = p_post_id RETURNING likes_count INTO v_new_count;
    ELSE
      SELECT likes_count INTO v_new_count FROM character_posts WHERE id = p_post_id;
    END IF;
  END IF;
  RETURN json_build_object('liked', NOT v_already, 'likes_count', COALESCE(v_new_count, 0));
END;
$$;

-- 4) toggle_character_follow(p_character_id, p_user_id) — canonical body: 20260804_character_likes_and_follows.sql
CREATE OR REPLACE FUNCTION toggle_character_follow(p_character_id UUID, p_user_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_was_following BOOLEAN;
  v_new_count     INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'unauthorized: cannot act on behalf of another user';
  END IF;

  PERFORM 1 FROM characters WHERE id = p_character_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Character not found';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM character_follows
    WHERE character_id = p_character_id AND user_id = p_user_id
  ) INTO v_was_following;

  IF v_was_following THEN
    DELETE FROM character_follows
    WHERE character_id = p_character_id AND user_id = p_user_id;

    UPDATE characters
    SET follower_count = GREATEST(0, follower_count - 1)
    WHERE id = p_character_id
    RETURNING follower_count INTO v_new_count;
  ELSE
    INSERT INTO character_follows (character_id, user_id)
    VALUES (p_character_id, p_user_id)
    ON CONFLICT (user_id, character_id) DO NOTHING;

    UPDATE characters
    SET follower_count = follower_count + 1
    WHERE id = p_character_id
    RETURNING follower_count INTO v_new_count;
  END IF;

  RETURN json_build_object('following', NOT v_was_following, 'follower_count', v_new_count);
END;
$$;

-- 5) toggle_community_post_like(p_post_id, p_user_id) — canonical body: 20241200_community_like_toggle_rpc.sql
CREATE OR REPLACE FUNCTION toggle_community_post_like(p_post_id UUID, p_user_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_was_liked  BOOLEAN;
  v_new_liked  JSONB;
  v_new_count  INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'unauthorized: cannot act on behalf of another user';
  END IF;

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

-- 6) toggle_community_reply_like(p_reply_id, p_user_id) — canonical body: 20241200_community_like_toggle_rpc.sql
CREATE OR REPLACE FUNCTION toggle_community_reply_like(p_reply_id UUID, p_user_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_was_liked  BOOLEAN;
  v_new_liked  JSONB;
  v_new_count  INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'unauthorized: cannot act on behalf of another user';
  END IF;

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

-- Close the inventory gap left by 20260930b_lock_privileged_rpcs.sql.
-- All confirmed callers already run server-side via supabaseAdmin
-- (service_role), so revoking browser/authenticated execution is safe.
REVOKE EXECUTE ON FUNCTION toggle_character_like(UUID, UUID)         FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION claim_daily_login_reward(UUID)            FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION toggle_post_like(UUID, UUID)              FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION toggle_character_follow(UUID, UUID)       FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION toggle_community_post_like(UUID, UUID)    FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION toggle_community_reply_like(UUID, UUID)   FROM authenticated, anon, PUBLIC;
