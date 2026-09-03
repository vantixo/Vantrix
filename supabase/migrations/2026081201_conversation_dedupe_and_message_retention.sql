-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: chat history disappearing on reopen ("messages not saved")
--
-- ROOT CAUSE (confirmed): duplicate `conversations` rows per (user_id,
-- character_id) pair, caused by a check-then-insert race between
-- chat/[id]/page.tsx and /api/conversations/ensure (two tabs, or the
-- dating page and chat page both racing to create the first conversation
-- for a character). Both call sites already assumed a unique index on
-- (user_id, character_id) existed and used upsert(onConflict: ...)
-- accordingly — see 20260727_dedupe_and_unique_conversations.sql, which
-- added exactly that index and merged existing duplicates at the time.
--
-- This migration is a SAFE, IDEMPOTENT RE-RUN of that same repair. It
-- exists because a migration file being present in the repo does not
-- guarantee it was actually applied to every environment — if
-- 20260727_... was skipped, never ran, or a new duplicate slipped in
-- before the unique index existed, this closes the gap regardless. If
-- 20260727_... already ran cleanly, every statement below is a no-op
-- (IF NOT EXISTS / no matching rows) — it is always safe to run this.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Re-run the merge-and-dedupe in case any duplicates exist (from before
--    the original fix, or from a window before the unique index existed).
with ranked as (
  select
    id,
    user_id,
    character_id,
    row_number() over (
      partition by user_id, character_id
      order by created_at asc, id asc
    ) as rn
  from conversations
  where user_id is not null and character_id is not null
),
canonical as (
  select
    d.id as duplicate_id,
    c.id as canonical_id
  from ranked d
  join ranked c
    on c.user_id = d.user_id
   and c.character_id = d.character_id
   and c.rn = 1
  where d.rn > 1
)
update messages m
set conversation_id = canonical.canonical_id
from canonical
where m.conversation_id = canonical.duplicate_id;

with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, character_id
      order by created_at asc, id asc
    ) as rn
  from conversations
  where user_id is not null and character_id is not null
)
delete from conversations
where id in (select id from ranked where rn > 1);

-- 2. Re-assert the unique index (idempotent — no-op if it already exists).
create unique index if not exists conversations_user_character_unique_idx
  on conversations (user_id, character_id)
  where user_id is not null and character_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1-month message retention: recent messages stay in `messages` (fast,
-- unbounded lookback within the window), older messages move to
-- `messages_archive` (same columns, same RLS-equivalent ownership via
-- conversation_id) rather than being deleted outright — "clear old
-- messages after one month" without permanently destroying a user's
-- chat history. archived rows are excluded from the live chat read path
-- automatically (they're in a different table), so this doesn't require
-- any change to chat/[id]/page.tsx's query.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists messages_archive (
  id              uuid        primary key,
  conversation_id uuid        not null references conversations(id) on delete cascade,
  role            text        not null,
  content         text        not null,
  image_url       text,
  tokens_used     integer     default 0,
  created_at      timestamptz not null,
  archived_at     timestamptz not null default now()
);

create index if not exists messages_archive_conversation_id_idx
  on messages_archive (conversation_id);

create index if not exists messages_archive_created_at_idx
  on messages_archive (created_at);

alter table messages_archive enable row level security;

drop policy if exists "messages_archive_own" on messages_archive;
create policy "messages_archive_own" on messages_archive for select using (
  exists (select 1 from conversations c where c.id = conversation_id and c.user_id = auth.uid())
);
-- No insert/update/delete policy for anon/authenticated — only the cron's
-- service-role client (which bypasses RLS) moves rows into this table.

-- ─────────────────────────────────────────────────────────────────────────────
-- Retire prune_old_messages() — it hard-DELETEd messages beyond the most
-- recent N in a conversation, with no archive step. Called daily from
-- api/cron/daily-reset, this meant any conversation crossing 250 messages
-- lost everything past the newest 200, permanently, every night —
-- reachable in days for an active user, not months. This is very likely
-- the dominant cause of "chat messages disappeared" reported by the user.
--
-- daily-reset/route.ts has been updated to archive overflow messages into
-- messages_archive instead of calling this function. Redefining the
-- function itself as a no-op (rather than just stopping the app-level
-- calls) is defense-in-depth: if any other call site — present or future
-- — invokes prune_old_messages(), it does nothing destructive instead of
-- silently resuming hard deletes.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION prune_old_messages(p_conversation_id UUID, p_keep INTEGER DEFAULT 200)
RETURNS VOID LANGUAGE sql AS $$
  SELECT NULL::void; -- intentionally a no-op — see comment above
$$;

-- Helpful index for the archival cron's cutoff scan on the live table.
create index if not exists messages_created_at_idx on messages (created_at);
