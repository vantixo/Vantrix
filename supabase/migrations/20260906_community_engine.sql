-- Community Engine — Neighborhoods, Community Organizations, Clubs
--
-- src/lib/universe/community-engine.ts already shipped referencing this
-- migration by name in its own header comment, but the migration itself
-- was never actually written — the tables it queries (neighborhoods,
-- neighborhood_residents, clubs, club_memberships, and a civic/mission-
-- driven organizations concept) did not exist anywhere in the schema.
-- This migration completes that gap.
--
-- Naming note: 20260904_organization_layer.sql already created a table
-- named `organizations` (backing organization-engine.ts's guild/council/
-- company/order/circle concept, keyed off faction_id + cohesion). That is
-- a different domain from community-engine.ts's civic/labor/charitable/
-- professional/advocacy/religious/academic organizations (keyed off
-- founder_character_id + influence + member_count). Reusing the same
-- table name for two incompatible shapes would corrupt both engines, so
-- community-engine.ts's concept is named `community_organizations` /
-- `community_organization_memberships` here — distinct tables, no
-- collision with organization-engine.ts's `organizations` /
-- `organization_members`.

-- ── Neighborhoods ─────────────────────────────────────────────────────────────

create table if not exists neighborhoods (
  id                  uuid primary key default gen_random_uuid(),
  parent_location_id  uuid not null references world_locations(id) on delete cascade,
  name                text not null,
  vibe                text not null default 'quiet', -- short flavor descriptor, e.g. 'artsy', 'industrial', 'upscale'
  cohesion            integer not null default 60 check (cohesion between 0 and 100),
  resident_count      integer not null default 0 check (resident_count >= 0),
  created_at          timestamptz not null default now()
);

create index if not exists idx_neighborhoods_parent_location on neighborhoods(parent_location_id);

create table if not exists neighborhood_residents (
  id               uuid primary key default gen_random_uuid(),
  character_id     uuid not null references characters(id) on delete cascade,
  neighborhood_id  uuid not null references neighborhoods(id) on delete cascade,
  moved_in_at      timestamptz not null default now(),
  constraint neighborhood_residents_unique_character unique (character_id)
);

create index if not exists idx_neighborhood_residents_neighborhood on neighborhood_residents(neighborhood_id);

-- ── Community Organizations (civic/labor/charitable/etc.) ──────────────────────

create table if not exists community_organizations (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  slug                   text not null unique,
  mission                text not null,
  category               text not null check (category in
                            ('civic', 'labor', 'charitable', 'professional', 'advocacy', 'religious', 'academic')),
  location_id            uuid references world_locations(id) on delete set null,
  founder_character_id   uuid not null references characters(id) on delete cascade,
  influence              integer not null default 20 check (influence between 0 and 100),
  member_count           integer not null default 0 check (member_count >= 0),
  status                 text not null default 'active' check (status in ('active', 'dissolved')),
  created_at             timestamptz not null default now()
);

create index if not exists idx_community_organizations_founder on community_organizations(founder_character_id);
create index if not exists idx_community_organizations_location on community_organizations(location_id);
create index if not exists idx_community_organizations_status on community_organizations(status);

create table if not exists community_organization_memberships (
  id                  uuid primary key default gen_random_uuid(),
  character_id        uuid not null references characters(id) on delete cascade,
  organization_id     uuid not null references community_organizations(id) on delete cascade,
  role                text not null default 'member' check (role in ('founder', 'officer', 'member')),
  joined_at           timestamptz not null default now(),
  constraint community_org_memberships_unique_character unique (character_id)
);

create index if not exists idx_community_org_memberships_org on community_organization_memberships(organization_id);

-- ── Clubs ─────────────────────────────────────────────────────────────────────

create table if not exists clubs (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  slug                   text not null unique,
  interest_tag           text not null,
  description            text,
  location_id            uuid references world_locations(id) on delete set null,
  founder_character_id   uuid not null references characters(id) on delete cascade,
  member_count           integer not null default 0 check (member_count >= 0),
  member_cap             integer not null default 25 check (member_cap > 0),
  status                 text not null default 'active' check (status in ('active', 'disbanded')),
  created_at             timestamptz not null default now()
);

create index if not exists idx_clubs_interest_tag on clubs(interest_tag);
create index if not exists idx_clubs_location on clubs(location_id);
create index if not exists idx_clubs_status on clubs(status);

create table if not exists club_memberships (
  id            uuid primary key default gen_random_uuid(),
  character_id  uuid not null references characters(id) on delete cascade,
  club_id       uuid not null references clubs(id) on delete cascade,
  role          text not null default 'member' check (role in ('founder', 'member')),
  joined_at     timestamptz not null default now()
);

create index if not exists idx_club_memberships_club on club_memberships(club_id);
create index if not exists idx_club_memberships_character on club_memberships(character_id);

-- ── RLS: public read, service-role-only writes — same pattern as every other
-- ambient-world table in the universe layer ──────────────────────────────────

alter table neighborhoods                      enable row level security;
alter table neighborhood_residents              enable row level security;
alter table community_organizations             enable row level security;
alter table community_organization_memberships  enable row level security;
alter table clubs                               enable row level security;
alter table club_memberships                    enable row level security;

create policy "public read neighborhoods"                     on neighborhoods                     for select using (true);
create policy "public read neighborhood_residents"             on neighborhood_residents             for select using (true);
create policy "public read community_organizations"            on community_organizations            for select using (true);
create policy "public read community_organization_memberships" on community_organization_memberships for select using (true);
create policy "public read clubs"                              on clubs                              for select using (true);
create policy "public read club_memberships"                   on club_memberships                   for select using (true);
