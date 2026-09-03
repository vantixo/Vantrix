-- Surprise & Promise-Keeping Engine — new tables only, no changes to
-- existing tables. Independent of any other table's schema (plain
-- `uuid not null`, no FK references — consistent with the other
-- relationship-engine-layer migrations: 20260730_relationship_engine_layer.sql
-- / 20260802_agency_engine.sql), so this is safe to run any time. Dated
-- 20260811 — after the actual latest migration in the repo
-- (20260810_desire_engine_titles_fkeys.sql) at time of writing — purely so
-- it sorts as the next migration in sequence rather than landing between
-- already-applied files.
--
-- RLS: both tables are written and read exclusively via supabaseAdmin
-- (service-role client) in surprise-engine.ts / the cron route — nothing
-- here is queried from the browser with the anon/authenticated key. Without
-- RLS enabled, Supabase's default table grants leave these open to the
-- anon key (shipped client-side) once any REST client hits them directly.
-- Same fail-open shape the RLS-audit work earlier surfaced on other tables
-- in this codebase — enabling RLS with a service-role-only policy here
-- fails CLOSED to anon/authenticated instead, matching the
-- `character_relationships` / "rel_service" pattern already in
-- 20240101_production.sql. If you later want users to read their own
-- surfaced surprises directly from the client (rather than only through
-- the cron-fed initiative delivery path — see WIRING.md step 6), add an
-- owner-read policy then; don't remove the service-role one.

create table if not exists user_promises (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  character_id  uuid not null,
  promise_text  text not null,
  raw_message   text not null,
  due_at        timestamptz not null,
  surfaced      boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists idx_user_promises_due
  on user_promises (user_id, character_id, surfaced, due_at)
  where surfaced = false;

alter table user_promises enable row level security;

create policy "user_promises_service_only"
  on user_promises for all
  to service_role
  using (true)
  with check (true);

create table if not exists character_surprises (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  character_id  uuid not null,
  type          text not null check (type in ('promise_followup', 'anniversary', 'memory_poem')),
  message       text not null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_character_surprises_cooldown
  on character_surprises (user_id, character_id, created_at desc);

alter table character_surprises enable row level security;

create policy "character_surprises_service_only"
  on character_surprises for all
  to service_role
  using (true)
  with check (true);
