-- Journey Stage Engine — server-side signal aggregation
--
-- gatherSignals() in stage-engine.ts previously issued two separate
-- full-row fetches against journey_events per user
-- (`select event_type ...` and `select created_at ...`, both
-- `.eq('user_id', userId)` with no limit) and then counted/deduped in
-- JS. That's two round trips transferring O(all-time event count) rows
-- each, on every recompute — and recompute runs on the fire-and-forget
-- path after every single meaningful chat message. For a long-lived
-- active user this grows unbounded and gets slower every message.
--
-- This RPC does the counting and distinct-day dedupe in Postgres
-- (using the existing idx_journey_events_user index) and returns a
-- single small row, cutting the per-recompute journey_events cost from
-- two unbounded transfers to one aggregate query.

create or replace function get_journey_signals(p_user_id uuid)
returns table (
  meaningful_message_count   int,
  memory_demonstrated_count  int,
  session_return_count       int,
  world_reference_shown_count  int,
  world_reference_tapped_count int,
  companion_customized_count int,
  content_published_count    int,
  creator_followed_count     int,
  location_created_count     int,
  lore_created_count         int,
  distinct_active_days       int
)
language sql
stable
as $$
  select
    count(*) filter (where event_type = 'meaningful_message')::int,
    count(*) filter (where event_type = 'memory_demonstrated')::int,
    count(*) filter (where event_type = 'session_return')::int,
    count(*) filter (where event_type = 'world_reference_shown')::int,
    count(*) filter (where event_type = 'world_reference_tapped')::int,
    count(*) filter (where event_type = 'companion_customized')::int,
    count(*) filter (where event_type = 'content_published')::int,
    count(*) filter (where event_type = 'creator_followed')::int,
    count(*) filter (where event_type = 'location_created')::int,
    count(*) filter (where event_type = 'lore_created')::int,
    count(distinct (created_at at time zone 'UTC')::date)::int
  from journey_events
  where user_id = p_user_id;
$$;

grant execute on function get_journey_signals(uuid) to service_role;
