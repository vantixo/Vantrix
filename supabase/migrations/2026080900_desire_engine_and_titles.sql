-- ═══════════════════════════════════════════════════════════════════════
-- Core Desire Engine + Reputation Titles + Permanent World Impact
--
-- Sits beneath the existing goal engine (character_goals) and decision
-- engine (character_decisions): a desire ("belonging") is WHY a goal
-- ("build a real connection with this person") gets chosen at all.
-- Desires are near-static (who the character IS); goals/intents remain the
-- moment-to-moment machinery. See src/lib/ai/desire-engine.ts.
--
-- Reputation titles are a separate, small, contested leaderboard on top of
-- companion_reputation's fame/notoriety score — "Most Trusted", "Most
-- Feared", etc. See src/lib/universe/reputation-titles.ts.
--
-- World impact events give user actions (gifts, milestones, confessions,
-- betrayals) a durable trace, separately promotable into universe_memory
-- when significant enough. See src/lib/universe/world-impact.ts.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Core desires (one row per character — who they fundamentally are) ──────

create table if not exists character_core_desires (
  id           uuid primary key default gen_random_uuid(),
  character_id uuid not null unique,
  need         text not null,   -- e.g. "belonging"
  want         text not null,   -- e.g. "recognition"
  fear         text not null,   -- e.g. "abandonment"
  obsession    text not null,   -- e.g. "art"
  intensity    numeric not null default 60 check (intensity >= 0 and intensity <= 100),
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

-- ── Per-relationship fulfillment (how met/starved each axis is with THIS user) ──

create table if not exists character_desire_fulfillment (
  character_id          uuid not null,
  user_id                uuid not null,
  need_fulfillment       numeric not null default 0  check (need_fulfillment  >= -100 and need_fulfillment  <= 100),
  want_fulfillment       numeric not null default 0  check (want_fulfillment  >= -100 and want_fulfillment  <= 100),
  fear_activation        numeric not null default 0  check (fear_activation   >= 0    and fear_activation   <= 100),
  obsession_engagement   numeric not null default 0  check (obsession_engagement >= 0 and obsession_engagement <= 100),
  updated_at             timestamptz not null default now(),
  primary key (character_id, user_id)
);
create index if not exists idx_desire_fulfillment_user on character_desire_fulfillment(user_id, character_id);

-- ── Reputation titles (contested leaderboard, distinct from fame/notoriety) ──

create table if not exists character_titles (
  id            uuid primary key default gen_random_uuid(),
  character_id  uuid not null,
  title_key     text not null check (title_key in (
                   'most_trusted', 'most_influential', 'most_loved', 'most_feared',
                   'most_generous', 'most_mysterious', 'most_admired', 'most_notorious'
                 )),
  score         numeric not null default 0,
  awarded_at    timestamptz not null default now(),
  unique (character_id, title_key)
);
create index if not exists idx_character_titles_key on character_titles(title_key, score desc);

-- ── Permanent world impact log (user actions that leave a durable mark) ──────

create table if not exists world_impact_events (
  id            uuid primary key default gen_random_uuid(),
  character_id  uuid not null,
  user_id       uuid not null,
  source        text not null check (source in ('gift','milestone','decision','betrayal','confession','sacrifice')),
  title         text not null,
  description   text not null,
  desire_axis   text check (desire_axis in ('need','want','fear','obsession')),
  weight        numeric not null default 30 check (weight >= 0 and weight <= 100),
  memory_id     uuid,   -- set when promoted into universe_memory
  created_at    timestamptz not null default now()
);
create index if not exists idx_world_impact_character on world_impact_events(character_id, created_at desc);
create index if not exists idx_world_impact_user_pair on world_impact_events(user_id, character_id, created_at desc);

-- ── Atomic fulfillment nudge (avoids read-then-write races under concurrent chats) ──

create or replace function nudge_desire_fulfillment(
  p_character_id uuid,
  p_user_id      uuid,
  p_need_delta      numeric default 0,
  p_want_delta      numeric default 0,
  p_fear_delta      numeric default 0,
  p_obsession_delta numeric default 0
)
returns character_desire_fulfillment as $$
  insert into character_desire_fulfillment as f (character_id, user_id, need_fulfillment, want_fulfillment, fear_activation, obsession_engagement)
  values (
    p_character_id, p_user_id,
    greatest(-100, least(100, p_need_delta)),
    greatest(-100, least(100, p_want_delta)),
    greatest(0, least(100, p_fear_delta)),
    greatest(0, least(100, p_obsession_delta))
  )
  on conflict (character_id, user_id) do update set
    need_fulfillment     = greatest(-100, least(100, f.need_fulfillment     + p_need_delta)),
    want_fulfillment     = greatest(-100, least(100, f.want_fulfillment     + p_want_delta)),
    fear_activation      = greatest(0,    least(100, f.fear_activation      + p_fear_delta)),
    obsession_engagement = greatest(0,    least(100, f.obsession_engagement + p_obsession_delta)),
    updated_at           = now()
  returning f.*;
$$ language sql;

comment on table character_core_desires is 'Static per-character need/want/fear/obsession — the "why" beneath character_goals.';
comment on table character_desire_fulfillment is 'Per-relationship drift of how met/starved each desire axis is — read by decision-engine to bias intent scoring.';
comment on table character_titles is 'Small contested world leaderboard (Most Trusted/Feared/etc), distinct from companion_reputation fame/notoriety scores.';
comment on table world_impact_events is 'Durable log of user actions significant enough to leave a permanent trace on a character — promotable into universe_memory via world-impact.ts.';
