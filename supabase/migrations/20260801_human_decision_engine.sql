-- ═══════════════════════════════════════════════════════════════════════
-- Human Decision Engine — goal engine + decision log
-- (character_emotions, character_relationships, character_daily_journal,
--  character_internal_thoughts, character_milestones, and
--  character_behavior_profiles already exist under different names —
--  see goal-engine.ts header for the mapping.)
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists character_goals (
  id           uuid primary key default gen_random_uuid(),
  character_id uuid not null,
  user_id      uuid,              -- null = global/ambition goal, set = relationship-specific
  label        text not null,
  priority     numeric not null default 0.5,
  category     text not null,     -- 'ambition' | 'relationship' | 'self'
  active       boolean not null default true,
  completed_at timestamptz,
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index if not exists idx_character_goals_lookup on character_goals(character_id, user_id, active);

create table if not exists character_decisions (
  id           uuid primary key default gen_random_uuid(),
  character_id uuid not null,
  user_id      uuid not null,
  intent       text not null,
  confidence   numeric not null,
  scores       jsonb not null,
  monologue    text not null default '',
  outcome      text,              -- 'positive' | 'neutral' | 'negative' | null
  created_at   timestamptz not null default now()
);
create index if not exists idx_character_decisions_pair on character_decisions(user_id, character_id, created_at desc);
