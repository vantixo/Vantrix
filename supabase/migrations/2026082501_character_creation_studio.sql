-- ─────────────────────────────────────────────────────────────────────────────
-- Character Creation Studio — 3 small additive columns.
--
-- Context: characters already carries almost the entire "premium character
-- studio" field set (archetype, attachment_style, love_language,
-- char_openness/warmth/adventure/depth, values_list/fears/flaws/dreams,
-- backstory/scenario/origin/family_bg/childhood_bg, speech_style,
-- voice_profile, hair_color/eye_color/body_type/skin_tone/art_style/clothing,
-- face_prompt) — all built for the Creator Studio edit page (PATCH
-- /api/characters/:id) but never surfaced at *creation* time, where the
-- form only ever collected 8 fields. This migration doesn't rebuild any of
-- that — it adds the 3 columns the new creation wizard needs that didn't
-- already exist anywhere:
--
--   pronouns          — collected on the wizard's Identity stage. No prior
--                        column; gender exists but is a closed enum
--                        (female/male/anime/other) that doesn't carry this.
--   creation_prompt    — the free-text one-line concept prompt, if the
--                        character was drafted via the AI Concept stage
--                        (POST /api/characters/generate-concept). NULL for
--                        characters built manually ("start from scratch")
--                        or created before this migration.
--   identity_locked    — real Visual Identity Lock flag. face_prompt
--                        already exists as "the locked canonical identity
--                        description" (see 20260718's column comment) but
--                        nothing ever recorded whether a creator had
--                        actually locked it — the Appearance/Identity-Lock
--                        stage needs a boolean to gate re-editing appearance
--                        fields client-side and to show lock status in
--                        Creator Studio.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS pronouns        TEXT,
  ADD COLUMN IF NOT EXISTS creation_prompt TEXT,
  ADD COLUMN IF NOT EXISTS identity_locked BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN characters.pronouns IS
  'Free-text pronouns collected at creation (e.g. "she/her"). Optional, display-only — does not affect the gender enum used for gating/discovery.';
COMMENT ON COLUMN characters.creation_prompt IS
  'Original one-line concept prompt used by the AI Concept stage to draft this character, if any. NULL for manually-built characters.';
COMMENT ON COLUMN characters.identity_locked IS
  'Set true once the creator locks the character''s visual identity after approving a canonical portrait (Appearance stage). Creator Studio''s Appearance tab treats this as advisory — a locked identity warns before further face_prompt/appearance edits rather than hard-blocking them, since an admin or the creator may still legitimately need to fix a bad generation.';
