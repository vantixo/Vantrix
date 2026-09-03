-- Removes the regional gating feature entirely: the unused
-- 'regional_gating_enabled' app_config flag, and the characters.region_lock
-- column that backed it.
--
-- The feature (region_lock on canon characters + getCharactersForRegion()
-- in src/lib/characters/canon.ts) was never wired into any route or
-- component — dead code with no consumers. This cleans up the leftover
-- config row and column on any database where the original
-- 20240101_production.sql seed/schema already ran.

DELETE FROM app_config WHERE key = 'regional_gating_enabled';

ALTER TABLE characters DROP COLUMN IF EXISTS region_lock;
