-- Reputation Engine — Public Perception
-- "Every citizen knows this person is..." — a small set of binary-ish public
-- tags derived from existing signals (companion_reputation, world_impact_events,
-- character_attributes, character_market_value). Distinct from the underlying
-- fame/notoriety scores: this is the crossed-a-threshold, common-knowledge layer
-- that's safe to surface verbatim in any character's prompt, including ones who
-- have never met the subject.

create table if not exists character_public_perception (
  character_id   uuid primary key references characters(id) on delete cascade,
  trustworthy    boolean not null default false,
  dangerous      boolean not null default false,
  famous         boolean not null default false,
  dishonest      boolean not null default false,
  heroic         boolean not null default false,
  rich           boolean not null default false,
  -- Underlying 0-100 scores, kept alongside the booleans so the UI can show
  -- "getting a reputation for..." before a trait crosses the public threshold.
  trustworthy_score numeric not null default 0,
  dangerous_score   numeric not null default 0,
  famous_score      numeric not null default 0,
  dishonest_score   numeric not null default 0,
  heroic_score      numeric not null default 0,
  rich_score        numeric not null default 0,
  updated_at     timestamptz not null default now()
);

create index if not exists idx_character_public_perception_traits
  on character_public_perception(trustworthy, dangerous, famous, dishonest, heroic, rich);

alter table character_public_perception enable row level security;
create policy "public read character_public_perception" on character_public_perception for select using (true);
