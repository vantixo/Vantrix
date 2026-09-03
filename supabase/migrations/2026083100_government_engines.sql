-- Government Engines — Elections, Laws, Diplomacy, Crises
-- Fills in the previously-noop job types: election_process, law_vote,
-- diplomatic_event, city_crisis. faction_evolve gains a real evolution
-- table alongside its existing career-tick behavior.

-- ── Laws ──────────────────────────────────────────────────────────────────────

create table if not exists proposed_laws (
  id             uuid primary key default gen_random_uuid(),
  location_id    uuid not null references world_locations(id) on delete cascade,
  title          text not null,
  description    text not null,
  category       text not null default 'general', -- economic | social | security | civic | general
  support        numeric not null default 50,      -- 0-100, current projected support
  status         text not null default 'proposed',  -- proposed | passed | rejected | repealed
  proposed_by_faction_id uuid references factions(id) on delete set null,
  proposed_at    timestamptz not null default now(),
  resolved_at    timestamptz
);

create index if not exists idx_proposed_laws_location on proposed_laws(location_id);
create index if not exists idx_proposed_laws_status on proposed_laws(status);

-- ── Elections ─────────────────────────────────────────────────────────────────

create table if not exists elections (
  id             uuid primary key default gen_random_uuid(),
  location_id    uuid not null references world_locations(id) on delete cascade,
  status         text not null default 'campaigning', -- campaigning | voting | concluded
  called_at      timestamptz not null default now(),
  concluded_at   timestamptz,
  winner_character_id uuid references characters(id) on delete set null,
  winner_faction_id    uuid references factions(id) on delete set null,
  turnout        numeric,   -- 0-100
  margin         numeric,   -- winning margin, 0-100
  last_ticked_at timestamptz  -- tick-claim guard; see 20260722_elections_tick_guard.sql
);

create index if not exists idx_elections_last_ticked_at on elections(last_ticked_at);

create table if not exists election_candidates (
  id             uuid primary key default gen_random_uuid(),
  election_id    uuid not null references elections(id) on delete cascade,
  character_id   uuid references characters(id) on delete set null,
  faction_id     uuid references factions(id) on delete set null,
  platform       text,
  polling        numeric not null default 20, -- 0-100, drifts each tick during campaigning
  created_at     timestamptz not null default now()
);

create index if not exists idx_elections_location on elections(location_id);
create index if not exists idx_election_candidates_election on election_candidates(election_id);

-- ── Diplomacy ─────────────────────────────────────────────────────────────────

create table if not exists diplomatic_relations (
  id               uuid primary key default gen_random_uuid(),
  location_a_id    uuid not null references world_locations(id) on delete cascade,
  location_b_id    uuid not null references world_locations(id) on delete cascade,
  standing         numeric not null default 50, -- 0-100: 0 hostile, 100 allied
  status           text not null default 'neutral', -- allied | friendly | neutral | tense | hostile | at_war
  updated_at       timestamptz not null default now(),
  constraint diplomatic_relations_unique_pair unique (location_a_id, location_b_id),
  constraint diplomatic_relations_no_self check (location_a_id <> location_b_id)
);

create index if not exists idx_diplomatic_relations_a on diplomatic_relations(location_a_id);
create index if not exists idx_diplomatic_relations_b on diplomatic_relations(location_b_id);

-- ── Faction Evolution ─────────────────────────────────────────────────────────

create table if not exists faction_evolution_log (
  id             uuid primary key default gen_random_uuid(),
  faction_id     uuid not null references factions(id) on delete cascade,
  change_type    text not null, -- influence_shift | ruling_change | ideology_drift | dissolved | founded
  delta          numeric,
  note           text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_faction_evolution_faction on faction_evolution_log(faction_id);

-- ── City Crises ───────────────────────────────────────────────────────────────

create table if not exists city_crises (
  id             uuid primary key default gen_random_uuid(),
  location_id    uuid not null references world_locations(id) on delete cascade,
  crisis_type    text not null, -- unrest | scandal | disaster | shortage | uprising
  severity       int not null default 2, -- 1-5
  status         text not null default 'active', -- active | resolved
  title          text not null,
  description    text not null,
  started_at     timestamptz not null default now(),
  resolved_at    timestamptz
);

create index if not exists idx_city_crises_location on city_crises(location_id);
create index if not exists idx_city_crises_status on city_crises(status);

-- ── RLS: server-only writes, public read on non-sensitive summaries ───────────
-- Mirrors the existing world-state lockdown pattern (see
-- 20260811_world_state_rls_lockdown_and_impact_privacy.sql) — these are
-- simulation tables written only by supabaseAdmin from the world worker.

alter table proposed_laws           enable row level security;
alter table elections                enable row level security;
alter table election_candidates      enable row level security;
alter table diplomatic_relations     enable row level security;
alter table faction_evolution_log    enable row level security;
alter table city_crises              enable row level security;

create policy "public read proposed_laws"        on proposed_laws        for select using (true);
create policy "public read elections"             on elections             for select using (true);
create policy "public read election_candidates"   on election_candidates   for select using (true);
create policy "public read diplomatic_relations"  on diplomatic_relations  for select using (true);
create policy "public read faction_evolution_log" on faction_evolution_log for select using (true);
create policy "public read city_crises"           on city_crises           for select using (true);
