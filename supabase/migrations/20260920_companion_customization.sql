-- ─────────────────────────────────────────────────────────────────────────────
-- Companion customization — backs the previously-dead 'companion_customized'
-- journey signal (stage-engine.ts requires companionCustomizedCount >= 1 to
-- reach stage 4/Creator; nothing in the app ever wrote that event type or
-- exposed any customization surface at all — see JOURNEY-GAP-FIX in
-- stage-engine.ts and PATCH /api/characters/[id]/relationship).
--
-- Two user-settable fields on the relationship (not the character row,
-- since these are per-user-per-companion, not global to the character):
--   - nickname_for_user: what the companion calls the user in conversation
--   - user_nickname_for_character: what the user calls the companion,
--     shown in the chat header/UI in place of the character's given name
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE character_relationships
  ADD COLUMN IF NOT EXISTS nickname_for_user            TEXT,
  ADD COLUMN IF NOT EXISTS user_nickname_for_character   TEXT,
  ADD COLUMN IF NOT EXISTS customized_at                 TIMESTAMPTZ;

ALTER TABLE character_relationships
  ADD CONSTRAINT character_relationships_nickname_for_user_len
    CHECK (nickname_for_user IS NULL OR char_length(nickname_for_user) <= 40),
  ADD CONSTRAINT character_relationships_user_nickname_len
    CHECK (user_nickname_for_character IS NULL OR char_length(user_nickname_for_character) <= 40);
