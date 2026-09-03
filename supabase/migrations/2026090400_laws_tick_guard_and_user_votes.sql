-- Laws: tick guard + user participation
--
-- Two gaps identified in the governance/laws audit, both mirroring fixes
-- already applied to elections.ts:
--
-- 1. runLawVote() drifts `support` on every open proposal via a
--    read-then-write per row — not atomic. Under a cron overlap or a
--    retried queue job, two concurrent calls could each read the same
--    support value and each apply their own drift on top, silently
--    double-counting it (the same race elections.ts had before the
--    20260722 tick-guard migration). Since a single runLawVote() call
--    processes every open law for a location in one pass, the guard is
--    per-law-row rather than per-call — each law claims its own tick.
--
-- 2. proposed_laws had zero player-facing surface. law_user_votes lets a
--    user back or oppose a law while it's still 'proposed'; the vote
--    nudges support (small, capped — see laws.ts) exactly like
--    election_user_votes nudges candidate polling.

alter table proposed_laws add column if not exists last_ticked_at timestamptz;

create index if not exists idx_proposed_laws_last_ticked_at on proposed_laws(last_ticked_at);

create table if not exists law_user_votes (
  id             uuid primary key default gen_random_uuid(),
  law_id         uuid not null references proposed_laws(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  position       text not null, -- 'support' | 'oppose'
  cast_at        timestamptz not null default now(),
  constraint law_user_votes_position_check check (position in ('support', 'oppose')),
  constraint law_user_votes_one_per_user unique (law_id, user_id)
);

create index if not exists idx_law_user_votes_law on law_user_votes(law_id);
create index if not exists idx_law_user_votes_user on law_user_votes(user_id);

alter table law_user_votes enable row level security;

-- Same policy shape as election_user_votes: users can read/cast/change/
-- retract only their own row. Aggregate tallies are exposed through the
-- API, not by letting users read each other's votes.
create policy "read own law vote" on law_user_votes
  for select using (auth.uid() = user_id);

create policy "cast own law vote" on law_user_votes
  for insert with check (auth.uid() = user_id);

create policy "change own law vote" on law_user_votes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "retract own law vote" on law_user_votes
  for delete using (auth.uid() = user_id);
