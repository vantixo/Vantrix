-- Secret Moments System — see src/lib/ai/secret-moments.ts
-- Stores generated poems/letters/memory-recaps/playlists/appreciation
-- messages, surfaced as their own first-class chat artifact
-- (type: 'secret_moment') rather than folded into an ordinary reply.

create table if not exists secret_moments (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  character_id   uuid not null references characters(id) on delete cascade,
  milestone_name text not null,
  moment_type    text not null,
  title          text not null,
  content        text not null,
  generated_by   text not null default 'llm',
  created_at     timestamptz not null default now()
);

create index if not exists idx_secret_moments_lookup
  on secret_moments (user_id, character_id, created_at desc);

alter table secret_moments enable row level security;

drop policy if exists secret_moments_own on secret_moments;
create policy secret_moments_own on secret_moments
  for select using (auth.uid() = user_id);

-- service role only for insert (generated server-side via supabaseAdmin,
-- same pattern as user_promises / character_surprises / character_evolution_traits)
