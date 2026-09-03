-- ADS-INAPP-FIX: existing admin ad rows were seeded with full
-- "https://vantrix.ink/..." links even though they point at the app's own
-- pages (e.g. /create-character, /pricing). AdBoard used to treat every
-- ad link identically as an outside sponsored ad (new tab, rel=sponsored,
-- "Ad" badge). It now distinguishes first-party links from real external
-- ones at render time by hostname, but that only works cleanly for
-- absolute vantrix.ink URLs or paths starting with "/" — this migration
-- just normalizes the already-seeded rows to relative paths for clarity
-- and so any other code reading `link` directly also sees them as
-- in-app, not external.
update ads
set link = regexp_replace(link, '^https?://(www\.)?vantrix\.ink', '')
where link ~ '^https?://(www\.)?vantrix\.ink';

-- Guard against a row whose link was exactly the bare domain (regexp
-- above would leave it as an empty string).
update ads set link = '/' where link = '';
