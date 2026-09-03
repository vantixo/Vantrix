-- ─────────────────────────────────────────────────────────────────────────────
-- Fix min_tier for the Archive of Echoes roster (20260821_archive_of_echoes_characters.sql)
--
-- PROBLEM: all 20 characters in that migration (Aurelian, Seraphine Vale,
-- Morrow Ash, Nyx, Cassian Rune, Lyra Starborn, The Ferryman, Evelyn Thorn,
-- Orion Black, Vesper Quinn, The Archivist Child, Selene Dusk, Dr. Elias Voss,
-- Kael Ember, Mira Glass, The Clockmaker, Astra Nocturne, Brother Corvin,
-- Valeria Storm, The Nameless One) were inserted with is_premium = true but
-- never listed min_tier in the INSERT column list. min_tier is
-- NOT NULL DEFAULT 'free' (20240101_production.sql), so every one of them
-- silently landed on a real, literal 'free' value — not NULL.
--
-- checkCharacterTierAccess()'s fallback is `characterMinTier ?? (is_premium
-- ? 'spark' : 'free')` — the ?? only fires on null/undefined. A literal
-- 'free' short-circuits it, so every check resolved to "requires free tier",
-- i.e. no gate at all. Net effect since 2026-08-21: 20 characters flagged
-- and marketed as premium have been fully accessible to every free user
-- (and, functionally, guests), with is_premium=true only affecting the
-- ?premium=true discovery filter's cosmetics, not actual access.
--
-- FIX: sets min_tier = 'spark' — the same floor the original
-- 20260721_character_tier_separation.sql migration used for "paid but not
-- VIP-exclusive" characters — for exactly this set, closing the free-access
-- gap without inventing per-character premium/elite placement that's a
-- content decision, not an engineering one. Revisit individual characters
-- (e.g. promoting a specific one to 'premium' or 'elite') as a deliberate
-- follow-up if desired.
--
-- Idempotent: plain UPDATEs keyed on name, safe to re-run.
--
-- PRODUCTION RECONCILIATION NOTE (applied 2026-08-06): when this migration
-- was actually run against production (project jepjpwkgabqimwiqwabk), none
-- of the 20 named characters were present under these names — the deployed
-- "Archive of Echoes" roster uses different names (Calla Fendris, Cassian
-- Morrow, etc.) and, as deployed, none of them have is_premium=true, so the
-- specific drift this migration was written to fix does not currently
-- exist live. The name-keyed UPDATE and the general sweep both ran as
-- no-ops (0 rows). The trigger below still installed and was verified
-- working against production directly. Left the original file as-is
-- rather than rewriting it after the fact — the local repo this migration
-- shipped from had diverged from what was actually deployed; that's a
-- separate reconciliation problem, not a reason to falsify this file's
-- history.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE characters
SET min_tier = 'spark'
WHERE is_premium = true
  AND min_tier = 'free'
  AND name IN (
    'Aurelian', 'Seraphine Vale', 'Morrow Ash', 'Nyx', 'Cassian Rune',
    'Lyra Starborn', 'The Ferryman', 'Evelyn Thorn', 'Orion Black',
    'Vesper Quinn', 'The Archivist Child', 'Selene Dusk', 'Dr. Elias Voss',
    'Kael Ember', 'Mira Glass', 'The Clockmaker', 'Astra Nocturne',
    'Brother Corvin', 'Valeria Storm', 'The Nameless One'
  );

-- General safety net beyond this specific roster: ANY character currently
-- sitting at is_premium = true with min_tier still at the column default
-- of 'free' has the exact same bug, whatever migration or admin action put
-- it there. Sweep those up too rather than relying on this migration's
-- name list being exhaustive of every past drift.
UPDATE characters
SET min_tier = 'spark'
WHERE is_premium = true
  AND min_tier = 'free';

-- ─────────────────────────────────────────────────────────────────────────────
-- Guardrail: prevent this exact drift from recurring for future character
-- inserts (creator studio, admin panel, or the next content migration that
-- forgets to list min_tier). BEFORE INSERT OR UPDATE trigger — cheaper and
-- more reliable than hoping every future INSERT statement remembers to set
-- min_tier explicitly.
--
-- Two directions, matching the sync logic 20260721_character_tier_separation.sql
-- already established by hand:
--   1. is_premium = true landing on min_tier = 'free' (either the column
--      default on INSERT, or an UPDATE that flips is_premium on without
--      touching min_tier) is bumped to 'spark' — the same floor used
--      throughout this migration. Never silently grants free access to a
--      character flagged premium.
--   2. min_tier set to anything above 'free' with is_premium left false is
--      corrected to true, so the ?premium=true discovery filter and any
--      "Premium" badge stay consistent with the real gate.
CREATE OR REPLACE FUNCTION sync_character_tier_premium_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_premium = true AND NEW.min_tier = 'free' THEN
    NEW.min_tier := 'spark';
  END IF;

  IF NEW.min_tier <> 'free' AND NEW.is_premium = false THEN
    NEW.is_premium := true;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_character_tier_premium_flag ON characters;
CREATE TRIGGER trg_sync_character_tier_premium_flag
  BEFORE INSERT OR UPDATE OF is_premium, min_tier ON characters
  FOR EACH ROW
  EXECUTE FUNCTION sync_character_tier_premium_flag();
