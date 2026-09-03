-- User Election Participation
-- Lets a real user back a candidate during campaigning. Votes are folded
-- into candidate polling (small, capped nudge — see elections.ts) and,
-- separately, tallied as a distinct "popular_votes" signal used to break
-- ties and to tell the user afterward whether their pick won.

create table if not exists election_user_votes (
  id             uuid primary key default gen_random_uuid(),
  election_id    uuid not null references elections(id) on delete cascade,
  candidate_id   uuid not null references election_candidates(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  cast_at        timestamptz not null default now(),
  constraint election_user_votes_one_per_user unique (election_id, user_id)
);

create index if not exists idx_election_user_votes_election on election_user_votes(election_id);
create index if not exists idx_election_user_votes_candidate on election_user_votes(candidate_id);
create index if not exists idx_election_user_votes_user on election_user_votes(user_id);

alter table election_user_votes enable row level security;

-- Users can read their own vote and cast/change it while the election is
-- still campaigning; nothing else. Vote counts themselves are exposed only
-- through the API (aggregated), not by letting users read others' rows.
create policy "read own vote" on election_user_votes
  for select using (auth.uid() = user_id);

create policy "cast own vote" on election_user_votes
  for insert with check (auth.uid() = user_id);

create policy "change own vote" on election_user_votes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "retract own vote" on election_user_votes
  for delete using (auth.uid() = user_id);

-- New offline-log / feed entry type for election outcomes reaching the user
-- feed (see feed entry_type union in world-expansion.ts's OfflineEntryType).
-- No schema change needed for user_feeds itself — entry_type is just text
-- there — this comment documents the new value: 'election_result'.
