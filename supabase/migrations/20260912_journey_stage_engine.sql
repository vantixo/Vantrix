-- Journey Stage Engine — Progressive Disclosure
--
-- Backs the "one promise, then earn the rest" product model: Vantrix
-- starts as a single companion conversation and unlocks World/Create/
-- Community/Universe only as behavioral milestones are actually hit,
-- never on elapsed time alone. See src/lib/journey/stage-engine.ts for
-- the stage-computation logic this schema supports.
--
-- Two tables, different jobs:
--   journey_events        — append-only log of the specific behavioral
--                            signals stage thresholds are computed from
--                            (meaningful messages, world-reference taps,
--                            companion customization, publishing, etc.).
--                            Nothing here is ever deleted or overwritten —
--                            it's the audit trail a recompute replays.
--   user_journey_state    — the cached, current result of that
--                            computation: which stage the user is on,
--                            when it was last computed, and which
--                            individual features have been explicitly
--                            unlocked (a user can sit in Stage 2 while
--                            having triggered a couple of Stage 3 signals
--                            early — unlocked_features tracks those
--                            per-feature grants precisely rather than
--                            forcing an all-or-nothing stage jump).
--
-- profiles.journey_stage is a denormalized copy of
-- user_journey_state.stage, written at the same time, purely so
-- middleware.ts can gate routes with the same single cheap read it
-- already does for profiles.age_verified — recomputing the full stage
-- engine (a handful of aggregate queries) on every Edge request per the
-- existing age-gate pattern's own comment would be far too expensive.

-- ── Event log ─────────────────────────────────────────────────────────────────

create table if not exists journey_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  character_id  uuid references characters(id) on delete set null,
  event_type    text not null check (event_type in (
                    'meaningful_message',      -- non-trivial user message sent (see isMeaningfulMessage())
                    'session_return',          -- returned in a new session (>30min gap) on a distinct day
                    'memory_demonstrated',     -- companion's reply referenced a stored fact/memory back to the user
                    'world_reference_shown',   -- companion mentioned a world event/place/person in-chat
                    'world_reference_tapped',  -- user tapped a world reference to learn more
                    'companion_customized',    -- personality/appearance/voice customization saved
                    'gift_sent',
                    'character_created',
                    'location_created',
                    'lore_created',
                    'content_published',       -- shared a created character/location/story publicly
                    'creator_followed',        -- followed or was followed by another creator
                    'companion_added'          -- started a second/third+ active companion relationship
                  )),
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now()
);

create index if not exists idx_journey_events_user      on journey_events(user_id, event_type, created_at desc);
create index if not exists idx_journey_events_user_day   on journey_events(user_id, ((created_at AT TIME ZONE 'UTC')::date));

-- ── Cached stage state ───────────────────────────────────────────────────────

create table if not exists user_journey_state (
  user_id             uuid primary key references profiles(id) on delete cascade,
  stage               smallint not null default 0 check (stage between 0 and 6),
  unlocked_features    text[]  not null default '{}',
  last_computed_at     timestamptz not null default now(),
  last_advanced_at     timestamptz,
  created_at           timestamptz not null default now()
);

-- ── Denormalized fast-read column for middleware ────────────────────────────

alter table profiles add column if not exists journey_stage smallint not null default 0;
create index if not exists idx_profiles_journey_stage on profiles(journey_stage);

-- Freshness is tracked via last_computed_at, written directly by
-- stage-engine.ts on every recompute — no updated_at trigger needed here.

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Written exclusively by supabaseAdmin (service-role) from stage-engine.ts;
-- readable by the owning user for their own progression UI.

alter table journey_events      enable row level security;
alter table user_journey_state  enable row level security;

create policy "journey_events_owner_read" on journey_events
  for select using (auth.uid() = user_id);
create policy "journey_events_service_write" on journey_events
  for all to service_role using (true) with check (true);

create policy "user_journey_state_owner_read" on user_journey_state
  for select using (auth.uid() = user_id);
create policy "user_journey_state_service_write" on user_journey_state
  for all to service_role using (true) with check (true);
