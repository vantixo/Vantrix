-- Politics Engine — Alliances & Corruption
-- Adds the two structures not yet covered by governance.ts / faction-evolution.ts:
-- faction-to-faction alliances (distinct from diplomatic_relations, which is
-- city-to-city) and corruption investigations (distinct from the simple
-- corruption drift already applied in city_governance).

-- ── Alliances ─────────────────────────────────────────────────────────────────

create table if not exists faction_alliances (
  id             uuid primary key default gen_random_uuid(),
  faction_a_id   uuid not null references factions(id) on delete cascade,
  faction_b_id   uuid not null references factions(id) on delete cascade,
  relation_type  text not null default 'alliance', -- alliance | rivalry
  strength       numeric not null default 50,        -- 0-100
  formed_at      timestamptz not null default now(),
  broken_at      timestamptz,
  status         text not null default 'active',     -- active | broken
  constraint faction_alliances_unique_pair unique (faction_a_id, faction_b_id),
  constraint faction_alliances_no_self check (faction_a_id <> faction_b_id)
);

create index if not exists idx_faction_alliances_a on faction_alliances(faction_a_id);
create index if not exists idx_faction_alliances_b on faction_alliances(faction_b_id);
create index if not exists idx_faction_alliances_status on faction_alliances(status);

-- ── Corruption Investigations ────────────────────────────────────────────────

create table if not exists corruption_investigations (
  id             uuid primary key default gen_random_uuid(),
  location_id    uuid not null references world_locations(id) on delete cascade,
  faction_id     uuid references factions(id) on delete set null,
  severity       int not null default 2,             -- 1-5
  status         text not null default 'investigating', -- investigating | exposed | cleared
  summary        text not null,
  started_at     timestamptz not null default now(),
  resolved_at    timestamptz
);

create index if not exists idx_corruption_investigations_location on corruption_investigations(location_id);
create index if not exists idx_corruption_investigations_status on corruption_investigations(status);

-- ── Campaign Contributions ────────────────────────────────────────────────────
-- A faction backing a candidate. Legitimate contributions raise polling
-- modestly and safely; "illicit" ones raise it more but risk feeding a
-- corruption investigation. Kept as its own table (rather than a column on
-- election_candidates) so a faction's total spend across candidates/cities
-- is queryable directly.

create table if not exists campaign_contributions (
  id             uuid primary key default gen_random_uuid(),
  election_id    uuid not null references elections(id) on delete cascade,
  candidate_id   uuid not null references election_candidates(id) on delete cascade,
  faction_id     uuid not null references factions(id) on delete cascade,
  amount         numeric not null default 0,
  is_illicit     boolean not null default false,
  created_at     timestamptz not null default now()
);

create index if not exists idx_campaign_contributions_election on campaign_contributions(election_id);
create index if not exists idx_campaign_contributions_candidate on campaign_contributions(candidate_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────

alter table faction_alliances       enable row level security;
alter table corruption_investigations enable row level security;
alter table campaign_contributions  enable row level security;

create policy "public read faction_alliances"        on faction_alliances        for select using (true);
-- Corruption investigations stay server-only until exposed — mirrors the
-- crisis_events admin-access pattern (20260829_crisis_events_admin_access.sql).
create policy "public read exposed corruption"        on corruption_investigations for select using (status = 'exposed');
create policy "public read campaign_contributions"    on campaign_contributions    for select using (true);
