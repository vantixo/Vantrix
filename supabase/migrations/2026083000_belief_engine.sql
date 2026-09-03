-- Belief Engine — new table only, no changes to existing tables.
-- Independent of any other table's schema (plain `uuid not null`, no FK
-- references — consistent with 20260811_surprise_engine.sql and the other
-- relationship-engine-layer migrations). Dated 20260830 — after the actual
-- latest migration in the repo at time of writing
-- (20260829_crisis_events_admin_access.sql) — purely so it sorts as the
-- next migration in sequence.
--
-- Backs src/lib/cognition/belief-store.ts. Rows are never hard-deleted —
-- superseded/decayed beliefs are kept (status column) so
-- belief-conflict.ts's audit trail (`supersedes`) stays inspectable.
--
-- RLS: written and read exclusively via supabaseAdmin (service-role
-- client) in belief-store.ts — nothing here is queried from the browser
-- with the anon/authenticated key. Same fail-closed shape as
-- 20260811_surprise_engine.sql: enabling RLS with a service-role-only
-- policy fails CLOSED to anon/authenticated instead of leaving the table
-- open by default. If a client-facing "what does she remember about me"
-- feature is added later, add an owner-read policy then — don't remove
-- the service-role one.

create table if not exists user_beliefs (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null,
  character_id        uuid not null,
  subject             text not null,
  category            text not null check (category in (
                        'family', 'work', 'hobby', 'location', 'preference',
                        'pain_point', 'aspiration', 'opinion', 'relationship', 'trait'
                      )),
  statement           text not null,
  polarity            text not null check (polarity in ('affirms', 'negates')),
  confidence          numeric not null check (confidence >= 0 and confidence <= 1),
  evidence_count      integer not null default 1,
  source              text not null check (source in ('heuristic', 'ai', 'stated', 'inferred')),
  status              text not null default 'active' check (status in ('active', 'superseded', 'decayed', 'unresolved')),
  supersedes          uuid references user_beliefs(id),
  created_at          timestamptz not null default now(),
  last_reinforced_at  timestamptz not null default now(),
  last_used_at        timestamptz
);

-- Primary read path: belief-store.ts's getAllBeliefs() loads the whole
-- set for a (user, character) pair and filters/sorts in memory.
create index if not exists idx_user_beliefs_scope
  on user_beliefs (user_id, character_id);

-- belief-engine.ts's recordBelief() looks up the current active/unresolved
-- belief for one subject before reconciling new evidence against it.
create index if not exists idx_user_beliefs_subject
  on user_beliefs (user_id, character_id, subject)
  where status in ('active', 'unresolved');

alter table user_beliefs enable row level security;

create policy "user_beliefs_service_only"
  on user_beliefs for all
  to service_role
  using (true)
  with check (true);
