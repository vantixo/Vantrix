-- Make contact email and Discord invite editable from app_config without a
-- redeploy, matching the pattern already used for contact_email
-- (see src/lib/config/contact.ts). Both getContactEmail() and the new
-- getDiscordUrl() fall back to hardcoded constants if these rows are
-- missing, so this insert is a convenience seed, not a hard dependency.
--
-- NOTE: discord_invite_url is seeded with the same placeholder used in the
-- codebase (https://discord.gg/vantrix) — confirm this is the real,
-- monitored server invite (and that it doesn't expire) before launch, then
-- update it here or via the admin config UI if one exists.

INSERT INTO app_config (key, value)
VALUES
  ('contact_email', 'vantrix@vantrix.ink'),
  ('discord_invite_url', 'https://discord.gg/vantrix')
ON CONFLICT (key) DO NOTHING;
