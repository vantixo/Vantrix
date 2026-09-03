-- Persist the Skin Engine selection (see src/components/theme/skin-provider.tsx)
-- server-side, per user, instead of localStorage-only. localStorage remains
-- the source of truth for signed-out visitors; for authed users the value
-- synced here is what SkinProvider hydrates from and writes back to on
-- change (mirrors preferred_language's pattern exactly — see
-- 20261024_preferred_language.sql).
--
-- 'monochrome' added to vantrix-skins.ts alongside the three existing
-- color skins (obsidian-aether, velvet-rouge, midnight-sapphire) — a true
-- grayscale option, not a filter over an existing skin.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS theme_skin TEXT NOT NULL DEFAULT 'obsidian-aether';

ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_theme_skin_valid;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_theme_skin_valid
  CHECK (theme_skin IN ('obsidian-aether', 'velvet-rouge', 'midnight-sapphire', 'monochrome'));

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS theme_accent TEXT NOT NULL DEFAULT 'champagne';

ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_theme_accent_valid;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_theme_accent_valid
  CHECK (theme_accent IN ('champagne', 'silver', 'rose', 'violet', 'emerald', 'sapphire', 'copper'));
