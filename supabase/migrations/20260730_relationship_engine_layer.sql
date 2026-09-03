-- ═══════════════════════════════════════════════════════════════════════
-- Relationship Engine Layer — combined migration
-- Covers: relationship milestones, character knowledge library, character
-- journal, skill exemplar bank, independent thoughts.
-- ═══════════════════════════════════════════════════════════════════════

-- Relationship Milestones cache table
create table if not exists relationship_milestones (
  user_id      uuid not null,
  character_id uuid not null,
  data         jsonb not null,
  updated_at   timestamptz not null default now(),
  primary key (user_id, character_id)
);

-- Character knowledge library
create table if not exists character_knowledge (
  id           uuid primary key default gen_random_uuid(),
  character_id uuid not null,
  category     text not null,
  title        text not null,
  content      text not null,
  tags         text[] not null default '{}',
  weight       int not null default 50,
  created_at   timestamptz not null default now()
);
create index if not exists idx_character_knowledge_char on character_knowledge(character_id);

-- Character private journal
create table if not exists character_journal (
  id           uuid primary key default gen_random_uuid(),
  character_id uuid not null,
  user_id      uuid not null,
  content      text not null,
  follow_up    text not null default '',
  mood         text not null default '',
  created_at   timestamptz not null default now()
);
create index if not exists idx_character_journal_pair on character_journal(user_id, character_id, created_at desc);

-- Skill exemplar bank (conversation dataset)
create table if not exists skill_exemplars (
  id       uuid primary key default gen_random_uuid(),
  skill    text not null,
  medium   text not null,
  source   text not null,
  excerpt  text not null,
  note     text not null
);
create index if not exists idx_skill_exemplars_skill on skill_exemplars(skill);

-- Independent thoughts
create table if not exists character_thoughts (
  id           uuid primary key default gen_random_uuid(),
  character_id uuid not null,
  user_id      uuid not null,
  trigger      text not null,
  subject      text not null default '',
  content      text not null,
  surfaced     boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists idx_character_thoughts_pair on character_thoughts(user_id, character_id, surfaced, created_at desc);
