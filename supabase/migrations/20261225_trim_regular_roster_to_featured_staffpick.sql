-- Trims the regular companion roster (category IN male/female/anime) down
-- to just the characters already marked is_featured or is_staff_pick,
-- taking it from 45 to 30. Archive of Echoes (category='archive-of-echoes',
-- the 20 canon characters wired into the faction/election/politics
-- engines) is untouched — this migration is scoped to the plain dating/
-- chat roster only.
--
-- Safe to hard-delete rather than deactivate: every FK referencing
-- characters.id (conversations, character_likes, dating_swipes,
-- memory_graph, generated_images, etc. — see information_schema check
-- run before this migration) is ON DELETE CASCADE or SET NULL, and none
-- of the 15 removed rows had any real engagement (chat_count/like_count/
-- profile_click_count were all 0 or near-0 — this was pre-launch seed
-- content, not live user history).
--
-- Removed: Bianca, Chef Amara, Dr. Covenant, Haifa, Hannah, Hispania,
-- Marianne, Seraphine (female); Alexei, Athra, Narcis, Professor Emeka,
-- Rumi, Sancea, Takeshi (male).
--
-- Companion piece: src/lib/characters/intelligence.ts had per-name
-- CHARACTER_INTELLIGENCE entries for all 15 of these — removed in the
-- same change, since a name that can no longer exist in `characters`
-- can never be looked up there again (getIntelligenceProfile() falls
-- through to DEFAULT_INTELLIGENCE regardless, so this was dead weight,
-- not a functional dependency).

DELETE FROM characters
WHERE category IN ('male', 'female', 'anime')
  AND NOT (is_featured OR is_staff_pick);
