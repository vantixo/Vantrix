-- Elections tick guard
--
-- advanceCampaign() applies per-tick polling drift (NPC drift + user-vote
-- nudge) via a read-then-write on each candidate row — not atomic on its
-- own. Every other per-city tick in this codebase (governance_tick,
-- economy_tick, universe_state's advanceUniverseTick) guards against
-- concurrent/retried invocations with a last_ticked_at column and a
-- conditional UPDATE claim; elections never got the same guard. Under a
-- cron overlap or a retried queue job, two concurrent calls could each
-- read the same polling values and each apply their own drift on top,
-- silently double-counting it.
--
-- This adds the same guard column so elections.ts (see advanceCampaign)
-- can claim a tick the same way world-engine.ts/economy.ts already do.

-- ORDERING FIX (Phase A audit, 2026-08-06): this migration is dated
-- 2026-07-22, but the `elections` table itself isn't created until
-- 20260831_government_engines.sql — 40 days later in filename/apply
-- order. A fresh replay (`supabase db push` from empty) would fail here
-- with "relation elections does not exist". Wrapped in a guard so this
-- migration is a safe no-op if the table doesn't exist yet; the same
-- column+index are also added directly in 20260831_government_engines.sql
-- right after `create table elections`, so the guard is applied exactly
-- once regardless of which order the two migrations actually ran in on
-- any given environment (both statements are `if not exists`, so whichever
-- runs second is a no-op either way).
do $$
begin
  if to_regclass('public.elections') is not null then
    alter table elections add column if not exists last_ticked_at timestamptz;
    create index if not exists idx_elections_last_ticked_at on elections(last_ticked_at);
  end if;
end $$;
