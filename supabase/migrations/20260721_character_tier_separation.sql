-- ─────────────────────────────────────────────────────────────────────────────
-- Character tier separation
--
-- PROBLEM: characters.min_tier has existed since the very first migration
-- (20240101_production.sql) but was never actually read anywhere in the app —
-- every character defaulted to 'free' at the DB level, and all real gating
-- was done through the single `is_premium` boolean in checkPremiumCharacterAccess().
-- That means "premium" and "VIP" characters were functionally identical: any
-- paid tier, even the cheapest (Spark, $4.99), unlocked ALL of them. There was
-- no way for a character to be genuinely exclusive to the top (Elite/VIP) tier.
--
-- FIX: this migration gives min_tier real, distinct values per character so
-- checkCharacterTierAccess() (src/lib/rate-limit/index.ts) can enforce true
-- multi-tier separation, and shuttles most of the previously "is_premium"
-- characters down out of VIP — only one character stays truly VIP-exclusive
-- (min_tier = 'elite'); the rest move to 'premium' or 'spark' so they read as
-- "paid" without requiring the top tier.
--
-- Idempotent: plain UPDATEs keyed on name, safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- Everything defaults to 'free' unless explicitly listed below — this is
-- already the column default, but set explicitly here so the full cast is
-- visibly and intentionally 'free' rather than "whatever the default happens
-- to be".
UPDATE characters
SET min_tier = 'free'
WHERE name IN (
  'Yanefes', 'Ghost of Muru', 'Elan', 'Sancea', 'Athra', 'Dr. Covenant',
  'Haifa', 'Rumi', 'Narcis', 'Alexei', 'Hannah', 'Takeshi',
  'Professor Emeka', 'Chef Amara', 'Dominik', 'Seraphine'
);

-- Previously is_premium = true (Spark-or-higher unlocked all five). Shuttle
-- most of them down out of VIP:
UPDATE characters SET min_tier = 'spark'   WHERE name = 'Hispania';
UPDATE characters SET min_tier = 'spark'   WHERE name = 'Marianne';
UPDATE characters SET min_tier = 'premium' WHERE name = 'Bianca';
UPDATE characters SET min_tier = 'premium' WHERE name = 'Lord Adrian';

-- Only Countess Vesper remains genuinely VIP-exclusive (Elite tier only).
UPDATE characters SET min_tier = 'elite', is_premium = true WHERE name = 'Countess Vesper';

-- Keep is_premium in sync with the new min_tier so the existing "Premium"
-- badge/filter (?premium=true, is_premium-based UI) still reads correctly:
-- is_premium now means "requires any paid tier", min_tier carries the real
-- granularity on top of that.
UPDATE characters SET is_premium = false WHERE min_tier = 'free';
UPDATE characters SET is_premium = true  WHERE min_tier IN ('spark', 'basic', 'premium', 'elite', 'enterprise');
