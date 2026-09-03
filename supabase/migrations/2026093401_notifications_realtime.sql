-- ─────────────────────────────────────────────────────────────────────────────
-- Realtime for the notification inbox
--
-- Enables Supabase Realtime "Postgres Changes" (INSERT/UPDATE) on
-- `notifications` so the top-bar bell, notification dropdown, and toast
-- stack update the instant emitNotification() writes a row — instead of
-- only refreshing on next page load. This is a generic complement to
-- /api/notifications (see that route's own header): that SSE endpoint
-- polls every 8s but only streams 3 specific engines (character
-- initiatives, nudges, secret-moment surprises); this covers every one of
-- the 14 inbox types, the instant the row lands, with no polling delay.
--
-- REPLICA IDENTITY FULL so an UPDATE payload (e.g. read_at set by a mark-
-- read call from a second open tab/device) includes the full new row
-- rather than just the primary key — the client needs `read_at` itself to
-- reconcile local unread state, not just "row <id> changed."
--
-- RLS already restricts SELECT to `auth.uid() = user_id`
-- (notifications_owner_select, see 20260933_notification_inbox.sql) —
-- Postgres Changes evaluates that same policy per connection, so no
-- additional realtime-specific policy or grant is needed here.
--
-- Idempotent: ADD TABLE errors if the table is already a publication
-- member, so this is guarded rather than a bare ALTER PUBLICATION, in
-- case this migration is ever re-run against a database where it was
-- already applied by hand.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE notifications REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  END IF;
END $$;
