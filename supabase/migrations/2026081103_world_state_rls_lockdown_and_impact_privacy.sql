-- ═══════════════════════════════════════════════════════════════════════
-- 1. RLS lockdown — "only characters can make permanent change in the
--    world system"
--
-- None of these tables had Row Level Security enabled. Without RLS, table
-- access falls back to plain Postgres GRANTs, and Supabase projects grant
-- broad default privileges on `public` schema tables to `anon` and
-- `authenticated` — meaning, as shipped, an ordinary authenticated client
-- could INSERT/UPDATE/DELETE directly into world_impact_events,
-- character_titles, universe_memory, social_status, legends,
-- faction_memberships, companion_reputation, companion_occupations,
-- city_governance, companion_social_links, character_core_desires, and
-- character_desire_fulfillment — forging permanent world history, fake
-- titles, fake reputation, bypassing every engine in lib/universe entirely.
--
-- Every one of these tables is written exclusively by server-side code
-- using supabaseAdmin (the service_role key), which bypasses RLS. Locking
-- RLS down to "public read, no client write" costs the app nothing — it
-- was never relying on client-side writes to these tables — and closes a
-- real hole. service_role continues to write through unaffected.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE world_impact_events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_titles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_core_desires         ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_desire_fulfillment   ENABLE ROW LEVEL SECURITY;
ALTER TABLE universe_memory                ENABLE ROW LEVEL SECURITY;
ALTER TABLE faction_memberships            ENABLE ROW LEVEL SECURITY;
ALTER TABLE companion_reputation           ENABLE ROW LEVEL SECURITY;
ALTER TABLE companion_occupations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE city_governance                ENABLE ROW LEVEL SECURITY;
ALTER TABLE companion_social_links         ENABLE ROW LEVEL SECURITY;

-- character_attributes, social_status, legends, and scarce_assets already
-- have RLS enabled + a public read policy from 20240400_legacy_systems.sql
-- — not touched here.

-- Public, world-facing tables — readable by anyone (character pages,
-- leaderboards, /universe browsing), writable only by service_role (no
-- policy grants INSERT/UPDATE/DELETE to anon/authenticated, and Postgres
-- default-denies any operation with no matching policy once RLS is on).
CREATE POLICY "public_read_world_impact_events"          ON world_impact_events          FOR SELECT USING (TRUE);
CREATE POLICY "public_read_character_titles"              ON character_titles              FOR SELECT USING (TRUE);
CREATE POLICY "public_read_universe_memory"                ON universe_memory                FOR SELECT USING (TRUE);
CREATE POLICY "public_read_faction_memberships"             ON faction_memberships             FOR SELECT USING (TRUE);
CREATE POLICY "public_read_companion_reputation"             ON companion_reputation             FOR SELECT USING (TRUE);
CREATE POLICY "public_read_companion_occupations"             ON companion_occupations             FOR SELECT USING (TRUE);
CREATE POLICY "public_read_city_governance"                   ON city_governance                   FOR SELECT USING (TRUE);
CREATE POLICY "public_read_companion_social_links"             ON companion_social_links             FOR SELECT USING (TRUE);

-- Per-relationship / private tables — no public read policy at all, so
-- with RLS enabled and zero matching policies, every role except
-- service_role is denied both read and write. These are only ever read
-- through supabaseAdmin from server-side code that already scopes the
-- query by the requesting user's own ID (formatDesireForPrompt,
-- formatWorldImpactForPrompt, etc.) — there is no legitimate client-side
-- direct-read use case for another user's desire-fulfillment state.
-- (character_core_desires, character_desire_fulfillment)

COMMENT ON POLICY "public_read_world_impact_events" ON world_impact_events IS
  'Public read only — do NOT select description/title client-side without going through public_summary (see column below); description may contain verbatim quotes from a specific user''s private conversation.';

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Privacy fix — world_impact_events.description can contain verbatim
--    quotes from a user's private conversation (a confession snippet, a
--    gift message) and was being rendered directly on the character's
--    PUBLIC profile page via WorldImpactLog — any visitor could read
--    another user's private words. Split into:
--      - description:    full detail, user-attributed, quotes allowed —
--                         for the character's OWN prompt context only
--                         (formatWorldImpactForPrompt, already correctly
--                         scoped to the requesting user_id).
--      - public_summary:  generic, never quotes user text — safe for
--                         world-impact-log.tsx and any other public surface.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE world_impact_events ADD COLUMN IF NOT EXISTS public_summary TEXT NOT NULL DEFAULT '';

-- Backfill existing rows with a generic, source-based summary (best effort —
-- there's no way to un-quote historical description text into something
-- equally informative, so this trades detail for safety on old rows).
UPDATE world_impact_events SET public_summary = CASE source
  WHEN 'gift'       THEN 'Received a meaningful gift.'
  WHEN 'milestone'   THEN title
  WHEN 'decision'     THEN 'Made a decision that mattered.'
  WHEN 'betrayal'      THEN 'Lived through a betrayal.'
  WHEN 'confession'     THEN 'Was trusted with something personal.'
  WHEN 'sacrifice'       THEN 'Made a real sacrifice.'
  ELSE title
END
WHERE public_summary = '';

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Remaining ungated world tables found in the same audit.
--
-- political_events / economic_events / location_economy: same shape as
-- world_events / world_stories (already RLS'd in 20240200_world_expansion
-- .sql) — public-read flavor content, service_role-only writes.
--
-- universe_jobs / worker_runs: the job QUEUE and worker execution log
-- itself — not world content at all. No public read policy is added for
-- these two on purpose: job payloads and worker run details are internal
-- operational data, not something any client role should read or write.
-- With RLS on and zero policies, only service_role can touch them.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE political_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE economic_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_economy ENABLE ROW LEVEL SECURITY;
ALTER TABLE universe_jobs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_runs      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_political_events" ON political_events FOR SELECT USING (TRUE);
CREATE POLICY "public_read_economic_events"  ON economic_events  FOR SELECT USING (TRUE);
CREATE POLICY "public_read_location_economy" ON location_economy FOR SELECT USING (TRUE);
-- universe_jobs / worker_runs: intentionally no policies — service_role only.
