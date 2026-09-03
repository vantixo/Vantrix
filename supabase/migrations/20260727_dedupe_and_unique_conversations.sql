-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: duplicate conversation rows per (user_id, character_id)
--
-- chat/[id]/page.tsx and /api/conversations/ensure both do a
-- check-then-insert ("find conversation for this user+character, else
-- create one") with no DB constraint backing the invariant. Two concurrent
-- requests for the same user+character (e.g. two tabs, or the dating page
-- and chat page racing on first open) can both miss the SELECT and both
-- INSERT, producing two conversation rows for the same pair. The "most
-- recent" lookup used everywhere then non-deterministically picks whichever
-- row is newest, so a user can land on the *other* row and see their
-- history — and any messages already written to the abandoned row — go
-- missing. This looks identical to "messages aren't being saved" from the
-- user's side even though nothing was lost; it's just orphaned under a
-- sibling conversation row.
--
-- Fix in two parts:
--   1. Merge existing duplicates: repoint every `messages` row from a
--      newer duplicate conversation onto the oldest conversation for that
--      (user_id, character_id) pair, then delete the now-empty duplicates.
--   2. Add a unique index so this can't recur, and so callers can safely
--      upsert with ON CONFLICT instead of check-then-insert.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1a. Repoint messages from duplicate (non-oldest) conversations onto the
--     oldest conversation for the same (user_id, character_id).
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
    d.id           as duplicate_id,
    c.id           as canonical_id
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

-- 1b. Delete the now-empty duplicate conversation rows.
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

-- 2. Enforce the invariant going forward. Partial index so it only applies
--    where both columns are non-null (matches app logic — every regular
--    chat conversation has both).
create unique index if not exists conversations_user_character_unique_idx
  on conversations (user_id, character_id)
  where user_id is not null and character_id is not null;
