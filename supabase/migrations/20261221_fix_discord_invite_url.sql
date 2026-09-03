-- 20261221_fix_discord_invite_url.sql
--
-- 20261216_seed_contact_and_discord_config.sql seeded discord_invite_url
-- with the https://discord.gg/vantrix placeholder (that migration's own
-- comment flagged it as unconfirmed) — this replaces it with the real,
-- monitored server invite. getDiscordUrl() (src/lib/config/contact.ts)
-- reads this at request time, so no redeploy needed for this to take
-- effect; FALLBACK_DISCORD_URL there is a separate hardcoded copy for if
-- this row is ever missing/invalid and is updated alongside this
-- migration so the two stay in sync.

UPDATE app_config
SET value = 'https://discord.gg/py7JQNqqz'
WHERE key = 'discord_invite_url';

-- Belt-and-suspenders: insert it if the earlier seed's ON CONFLICT DO
-- NOTHING somehow left the row missing entirely (e.g. this migration
-- runs against a DB where 20261216's insert never landed).
INSERT INTO app_config (key, value)
SELECT 'discord_invite_url', 'https://discord.gg/py7JQNqqz'
WHERE NOT EXISTS (SELECT 1 FROM app_config WHERE key = 'discord_invite_url');
