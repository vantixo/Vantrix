-- ─────────────────────────────────────────────────────────────────────────────
-- Daily-unlock hardening: move quest progress + streak-shield consumption
-- out of application-level read-modify-write into atomic, row-locked SQL.
--
-- Bugs this fixes (found in src/lib/growth/streak-rewards-engine.ts):
--
--   1. getDailyQuests(): "SELECT, if missing INSERT" from application code.
--      Two concurrent requests (e.g. two tabs, or a retry racing the
--      original) can both see no row, both attempt INSERT, and the loser
--      hits the (user_id, date) UNIQUE constraint. That error was silently
--      swallowed (`inserted` ends up null), so the loser's request returns
--      an *empty* quest list for the rest of the day until they reload.
--
--   2. progressQuest(): fetches the `quests` JSONB array, mutates it in JS,
--      writes the whole array back. Any two progress events that overlap
--      in flight (very plausible — this fires on every chat message, and
--      a fast typist / double-submit can trigger two in quick succession)
--      produce a classic lost update: the second write clobbers the first,
--      silently dropping XP and quest progress the user already earned.
--
--   3. checkStreak() shield consumption: SELECT the shield flag, then a
--      separate UPDATE to clear it. Not atomic — a double-tap on the
--      client (or a retried request) can pass the SELECT check twice
--      before either UPDATE lands, consuming a shield that should have
--      been spent once.
--
--   4. /api/user/streak-shield "use shield" endpoint has the same
--      check-then-update gap as #3, independently.
--
-- Fix: each of these becomes a single SQL statement/function executed
-- under a row lock, so "check + mutate" is indivisible.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Atomically fetch today's quest row, creating it on first access.
--    ON CONFLICT DO NOTHING + RETURNING-less INSERT, then a normal SELECT,
--    both inside one function call under READ COMMITTED — the UNIQUE
--    constraint on (user_id, date) makes the INSERT itself the race-safe
--    step; whichever caller loses the INSERT simply falls through to the
--    SELECT and reads what the winner wrote.
CREATE OR REPLACE FUNCTION get_or_create_daily_quests(p_user_id UUID, p_date DATE, p_default_quests JSONB)
RETURNS daily_quests AS $$
DECLARE
  v_row daily_quests;
BEGIN
  INSERT INTO daily_quests (user_id, date, quests)
  VALUES (p_user_id, p_date, p_default_quests)
  ON CONFLICT (user_id, date) DO NOTHING;

  SELECT * INTO v_row FROM daily_quests WHERE user_id = p_user_id AND date = p_date;
  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2) Atomically progress a quest of a given type for a user/day.
--    Locks the row (FOR UPDATE) before reading `quests`, so a second
--    concurrent call blocks until the first commits and then operates on
--    the post-update state instead of a stale copy.
CREATE OR REPLACE FUNCTION progress_daily_quest(
  p_user_id UUID, p_date DATE, p_quest_type TEXT, p_amount INTEGER DEFAULT 1
)
RETURNS TABLE(completed_quest_id TEXT, xp_earned INTEGER, bonus_earned INTEGER, quests JSONB) AS $$
DECLARE
  v_quests        JSONB;
  v_bonus_claimed BOOLEAN;
  v_completed_ct  INTEGER;
  v_idx           INTEGER;
  v_q             JSONB;
  v_xp            INTEGER := 0;
  v_bonus         INTEGER := 0;
  v_completed_id  TEXT    := NULL;
BEGIN
  SELECT quests, bonus_claimed, completed_count
  INTO   v_quests, v_bonus_claimed, v_completed_ct
  FROM   daily_quests
  WHERE  user_id = p_user_id AND date = p_date
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::TEXT, 0, 0, '[]'::JSONB;
    RETURN;
  END IF;

  FOR v_idx IN 0 .. jsonb_array_length(v_quests) - 1 LOOP
    v_q := v_quests -> v_idx;
    IF (v_q ->> 'type') = p_quest_type AND (v_q ->> 'completed')::BOOLEAN IS NOT TRUE THEN
      v_q := jsonb_set(v_q, '{progress}',
               to_jsonb(LEAST((COALESCE(v_q ->> 'progress', '0'))::INTEGER + p_amount,
                               (v_q ->> 'target')::INTEGER)));
      IF (v_q ->> 'progress')::INTEGER >= (v_q ->> 'target')::INTEGER THEN
        v_q            := jsonb_set(v_q, '{completed}', 'true');
        v_xp           := v_xp + (v_q ->> 'xpReward')::INTEGER;
        v_completed_id := v_q ->> 'id';
        v_completed_ct := v_completed_ct + 1;
      END IF;
      v_quests := jsonb_set(v_quests, ARRAY[v_idx::TEXT], v_q);
      EXIT; -- one quest progressed per call, mirrors prior JS behaviour
    END IF;
  END LOOP;

  IF v_completed_ct >= 3 AND NOT v_bonus_claimed THEN
    v_bonus         := 200;
    v_bonus_claimed := TRUE;
    v_xp            := v_xp + v_bonus;
  END IF;

  UPDATE daily_quests
  SET quests          = v_quests,
      completed_count = v_completed_ct,
      bonus_claimed   = v_bonus_claimed
  WHERE user_id = p_user_id AND date = p_date;

  IF v_xp > 0 THEN
    PERFORM increment_xp(p_user_id, v_xp,
      CASE WHEN v_completed_id IS NOT NULL THEN 'quest_' || v_completed_id ELSE 'quest_progress' END);
  END IF;

  RETURN QUERY SELECT v_completed_id, v_xp, v_bonus, v_quests;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3) Atomically consume a streak shield. Returns TRUE iff a shield was
--    actually consumed by *this* call — callers should treat FALSE as
--    "no shield available / already consumed", not retry-and-hope.
CREATE OR REPLACE FUNCTION consume_streak_shield(p_user_id UUID, p_restore_streak INTEGER DEFAULT NULL)
RETURNS TABLE(consumed BOOLEAN, restored_streak INTEGER) AS $$
DECLARE
  v_had_shield BOOLEAN;
  v_current    INTEGER;
  v_restore    INTEGER;
BEGIN
  SELECT streak_shield, current_streak INTO v_had_shield, v_current
  FROM user_streaks WHERE user_id = p_user_id FOR UPDATE;

  IF NOT FOUND OR NOT v_had_shield THEN
    RETURN QUERY SELECT FALSE, 0;
    RETURN;
  END IF;

  v_restore := COALESCE(p_restore_streak, GREATEST(v_current, 1));

  UPDATE user_streaks
  SET streak_shield  = FALSE,
      current_streak = v_restore,
      updated_at     = NOW()
  WHERE user_id = p_user_id;

  RETURN QUERY SELECT TRUE, v_restore;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_or_create_daily_quests(UUID, DATE, JSONB)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION progress_daily_quest(UUID, DATE, TEXT, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION consume_streak_shield(UUID, INTEGER)            TO authenticated, service_role;
