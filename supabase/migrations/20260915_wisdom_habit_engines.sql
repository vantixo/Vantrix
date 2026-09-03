-- Wisdom + Habit Engines — two new tables, no changes to existing tables.
-- Same shape/conventions as 20260830_belief_engine.sql: plain `uuid not
-- null` (no FK references), service-role-only RLS, scope index for the
-- primary "load everything for this (user, character) pair" read path.
-- Dated 20260915 — after the actual latest migration in the repo at time
-- of writing (20260914_chat_affinity_discover.sql), purely so it sorts as
-- the next migration in sequence.
--
-- Backs src/lib/cognition/wisdom-store.ts and src/lib/cognition/habit-store.ts.
-- Closes the gap documented in wisdom-engine.ts's and habit-engine.ts's
-- original headers: both were in-process Maps, meaning a serverless
-- invocation almost certainly ran in a different process than any chat
-- request that had written to them, so nothing ever accumulated across
-- turns in production. These two tables plus their store modules are what
-- makes cron/20260915_wisdom_habit_maintenance's sweep (and the engines
-- themselves) actually durable.
--
-- Rows are never hard-deleted by normal operation — retirement/dropping
-- (wisdom's RETIREMENT_THRESHOLD, habit's MIN_STRENGTH floor) is expressed
-- by a delete from the *maintenance sweep* specifically, same as the prior
-- in-memory behavior (bucket.delete(...)), not by application code on the
-- request path.
--
-- RLS: written and read exclusively via supabaseAdmin (service-role
-- client) in wisdom-store.ts / habit-store.ts — nothing here is queried
-- from the browser with the anon/authenticated key. Same fail-closed shape
-- as 20260830_belief_engine.sql.

create table if not exists user_wisdom (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null,
  character_id           uuid not null,
  -- lesson-engine.ts's ExperienceCategory union — kept as free text (not a
  -- check constraint) since ExperienceCategory/Lesson['category'] is
  -- defined in TS and this table shouldn't need a migration every time
  -- that union grows, matching how belief_engine.ts's own category enum
  -- is the one place in this family that DOES check-constrain (it changes
  -- far less often).
  domain                 text not null,
  principle              text not null,
  confidence             numeric not null check (confidence >= 0 and confidence <= 1),
  times_applied          integer not null default 1,
  last_applied_turn      integer not null default 0,
  derived_from_lesson_ids text[] not null default '{}',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- Primary read path: wisdom-store.ts's getAllWisdom() loads the whole set
-- for a (user, character) pair and filters/sorts in memory, same as
-- belief-store.ts's getAllBeliefs().
create index if not exists idx_user_wisdom_scope
  on user_wisdom (user_id, character_id);

-- synthesizeWisdom()'s upsert-by-key path (existing principle for this
-- domain+principle text gets reinforced rather than duplicated) needs a
-- fast lookup on the same key wisdom-engine.ts's old in-memory Map used
-- (`${category}:${insight}`).
create unique index if not exists idx_user_wisdom_dedup
  on user_wisdom (user_id, character_id, domain, principle);

alter table user_wisdom enable row level security;

create policy "user_wisdom_service_only"
  on user_wisdom for all
  to service_role
  using (true)
  with check (true);

create table if not exists user_habits (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,
  character_id      uuid not null,
  -- habit-engine.ts's HabitCue union — same free-text rationale as
  -- user_wisdom.domain above.
  cue               text not null,
  response          text not null,
  strength          numeric not null check (strength >= 0 and strength <= 1),
  times_fired       integer not null default 1,
  times_rewarded    integer not null default 0,
  last_fired_turn   integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Primary read path: habit-store.ts's getAllHabits().
create index if not exists idx_user_habits_scope
  on user_habits (user_id, character_id);

-- getHabitsForCue()/getDominantHabit() filter by cue on top of the scope
-- read; recordHabitOutcome()'s upsert needs the same
-- (cue, response) dedup key habit-engine.ts's old Map used.
create unique index if not exists idx_user_habits_dedup
  on user_habits (user_id, character_id, cue, response);

alter table user_habits enable row level security;

create policy "user_habits_service_only"
  on user_habits for all
  to service_role
  using (true)
  with check (true);
