-- Digital Twin expansion — adds a second training data source (community
-- posts/replies, alongside chat messages) and surfaces reply history that
-- was already being logged but never readable/deletable by the user.
-- See src/lib/digital-twin/engine.ts.

-- Per-source message counts from the most recent training run, e.g.
-- {"chat": 142, "community": 18}. Nullable — older profiles trained before
-- this column existed simply won't have a breakdown until retrained.
ALTER TABLE digital_twin_profiles
  ADD COLUMN IF NOT EXISTS source_breakdown jsonb;

-- digital_twin_messages already had SELECT-own RLS (20260819b) but no
-- DELETE policy, so "review/delete what their twin has said" (the intent
-- documented on the table itself) had no user-facing path. The API route
-- already scopes deletes to the caller's own userId via supabaseAdmin
-- (service role bypasses RLS), but this closes the gap in case that table
-- is ever queried with a user-scoped client instead.
DROP POLICY IF EXISTS "users delete own digital twin messages" ON digital_twin_messages;
CREATE POLICY "users delete own digital twin messages" ON digital_twin_messages
  FOR DELETE USING (user_id = auth.uid());
