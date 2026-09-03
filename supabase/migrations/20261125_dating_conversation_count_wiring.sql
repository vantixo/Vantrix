-- WIRE-FIX (2026-08-24): dating_matches.conversation_count (added
-- 20240101_production.sql, NOT NULL DEFAULT 0) is read by three separate
-- dating features:
--   - dating/compatibility/route.ts   — 15%-weighted "engagement" factor in
--                                        the compatibility score, and the
--                                        "10 new conversations" recompute
--                                        trigger (compatibility_update_convo_count
--                                        delta, added 20260922)
--   - dating/chemistry/route.ts       — the "Engagement" chemistry dimension
--                                        (conversationCount * 5) and the
--                                        pace = bondScore / conversationCount
--                                        calculation feeding "pacing"
--   - dating/forecast/route.ts        — the "Conversation" forecast
--                                        dimension and the
--                                        "sustained, longer conversations" /
--                                        "conversations that haven't
--                                        deepened much yet" insight lines
--
-- No code path anywhere in the application — searched exhaustively across
-- src/ and every prior migration — ever increments this column. It has been
-- permanently 0 for every match since the table was created: Engagement
-- always renders as the floor value, pacing always resolves off a pace of
-- 0, the compatibility engagement factor always contributes 0, the
-- conversation-count-based recompute trigger has never once fired (only the
-- 24h timer works), and the forecast's "Conversation" dimension is
-- permanently stuck at "Just getting started" regardless of relationship
-- age. Same silent-dead-column failure mode as the conversations.match_id
-- issue fixed the same day in dating/mood/route.ts, just affecting three
-- read surfaces instead of one write-gate.
--
-- Fix: an atomic increment function, called once per dating chat session
-- from dating/mood/route.ts — the same session-end choke point that already
-- updates bond_score (update_bond_score) and streak_days
-- (update_dating_streak) via RPC, so conversation_count now advances on
-- exactly the same cadence as the two counters it already sits alongside.
CREATE OR REPLACE FUNCTION increment_conversation_count(p_match_id UUID)
RETURNS INTEGER AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE dating_matches
  SET conversation_count = conversation_count + 1
  WHERE id = p_match_id
  RETURNING conversation_count INTO v_count;
  RETURN COALESCE(v_count, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
