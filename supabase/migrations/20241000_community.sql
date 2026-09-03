-- ============================================================================
-- Migration: 20241000_community.sql
-- Community posts and replies system for Vantrix
-- ============================================================================

-- ── Tables ───────────────────────────────────────────────────────────────────

create table if not exists community_posts (
  id              uuid        primary key default gen_random_uuid(),
  community_slug  text        not null,
  author_id       uuid        references profiles(id) on delete cascade,
  title           text        not null check (char_length(title) <= 200),
  body            text        not null check (char_length(body) <= 10000),
  tag             text        not null default 'discussion'
                              check (tag in ('discussion','question','theory','tips','fan-art','lore','milestone')),
  likes_count     integer     not null default 0 check (likes_count >= 0),
  liked_by        jsonb       not null default '[]'::jsonb,
  reply_count     integer     not null default 0 check (reply_count >= 0),
  is_pinned       boolean     not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists community_replies (
  id          uuid        primary key default gen_random_uuid(),
  post_id     uuid        not null references community_posts(id) on delete cascade,
  author_id   uuid        references profiles(id) on delete cascade,
  body        text        not null check (char_length(body) <= 4000),
  likes_count integer     not null default 0 check (likes_count >= 0),
  liked_by    jsonb       not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

create index if not exists community_posts_slug_idx
  on community_posts(community_slug);

create index if not exists community_posts_slug_created_idx
  on community_posts(community_slug, created_at desc);

create index if not exists community_posts_slug_likes_idx
  on community_posts(community_slug, likes_count desc);

create index if not exists community_posts_pinned_idx
  on community_posts(community_slug, is_pinned desc, created_at desc);

create index if not exists community_replies_post_idx
  on community_replies(post_id, created_at asc);

-- ── updated_at trigger ───────────────────────────────────────────────────────

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists community_posts_updated_at on community_posts;
create trigger community_posts_updated_at
  before update on community_posts
  for each row execute function set_updated_at();

drop trigger if exists community_replies_updated_at on community_replies;
create trigger community_replies_updated_at
  before update on community_replies
  for each row execute function set_updated_at();

-- ── RPC: increment reply count atomically ────────────────────────────────────

create or replace function increment_community_reply_count(p_post_id uuid)
returns void language plpgsql security definer as $$
begin
  update community_posts
  set    reply_count = reply_count + 1,
         updated_at  = now()
  where  id = p_post_id;
end;
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table community_posts    enable row level security;
alter table community_replies  enable row level security;

-- Drop existing policies to allow idempotent re-runs
drop policy if exists "community_posts_select"          on community_posts;
drop policy if exists "community_posts_insert"          on community_posts;
drop policy if exists "community_posts_update_own"      on community_posts;
drop policy if exists "community_posts_delete_own"      on community_posts;
drop policy if exists "community_replies_select"        on community_replies;
drop policy if exists "community_replies_insert"        on community_replies;
drop policy if exists "community_replies_update_own"    on community_replies;
drop policy if exists "community_replies_delete_own"    on community_replies;

-- Read: any authenticated user can read all posts and replies
create policy "community_posts_select"
  on community_posts for select
  to authenticated
  using (true);

create policy "community_replies_select"
  on community_replies for select
  to authenticated
  using (true);

-- Insert: authenticated users can create posts/replies as themselves
create policy "community_posts_insert"
  on community_posts for insert
  to authenticated
  with check (author_id = auth.uid());

create policy "community_replies_insert"
  on community_replies for insert
  to authenticated
  with check (author_id = auth.uid());

-- Update: users may only update their own posts/replies
-- (likes_count / liked_by updates go through the admin client bypassing RLS)
create policy "community_posts_update_own"
  on community_posts for update
  to authenticated
  using (author_id = auth.uid());

create policy "community_replies_update_own"
  on community_replies for update
  to authenticated
  using (author_id = auth.uid());

-- Delete: users may only delete their own posts/replies
create policy "community_posts_delete_own"
  on community_posts for delete
  to authenticated
  using (author_id = auth.uid());

create policy "community_replies_delete_own"
  on community_replies for delete
  to authenticated
  using (author_id = auth.uid());
