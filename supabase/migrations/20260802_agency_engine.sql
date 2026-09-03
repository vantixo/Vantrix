-- ═══════════════════════════════════════════════════════════════════════
-- Agency Engine — open threads + long-term plan
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists character_open_threads (
  id           uuid primary key default gen_random_uuid(),
  character_id uuid not null,
  user_id      uuid not null,
  subject      text not null,
  context      text not null default '',
  status       text not null default 'open',   -- 'open' | 'resolved' | 'stale'
  raised_count int not null default 0,
  created_at   timestamptz not null default now(),
  last_raised  timestamptz
);
create index if not exists idx_open_threads_pair on character_open_threads(user_id, character_id, status);

create table if not exists character_long_term_plan (
  user_id           uuid not null,
  character_id      uuid not null,
  current_focus     text not null default '',
  current_interest  text not null default '',
  updated_at        timestamptz not null default now(),
  primary key (user_id, character_id)
);

create or replace function increment_thread_raised(p_thread_id uuid)
returns void as $$
  update character_open_threads
  set raised_count = raised_count + 1, last_raised = now()
  where id = p_thread_id;
$$ language sql;
