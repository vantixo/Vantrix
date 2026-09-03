-- Adds delivery tracking to character_surprises so the notifications SSE
-- endpoint (src/app/api/notifications/route.ts) can surface unread rows
-- exactly once, the same "fetch pending, mark delivered" pattern already
-- used for character_initiatives. Needed to wire WIRING.md step 7
-- (surfacing generated surprises to the user) — the table as originally
-- shipped in 20260811_surprise_engine.sql had no delivery-state column.

alter table character_surprises
  add column if not exists delivered boolean not null default false;

create index if not exists idx_character_surprises_pending
  on character_surprises (user_id, delivered, created_at desc)
  where delivered = false;
