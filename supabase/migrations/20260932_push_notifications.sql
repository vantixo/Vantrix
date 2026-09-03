-- ─────────────────────────────────────────────────────────────────────────────
-- push_subscriptions — Web Push (VAPID) subscription storage
--
-- Backs real OS/browser push notifications (nudges, character initiatives,
-- surprise moments) for users who aren't actively connected to the in-app
-- SSE stream (see /api/notifications). One row per browser/device
-- subscription — a user can have several (phone, laptop, etc).
--
-- endpoint is the unique push service URL the browser hands back from
-- PushManager.subscribe(); it's the natural dedupe key (re-subscribing the
-- same device/browser after a permission reset yields the same endpoint on
-- most UAs, a new one after a hard reset — both are fine, upsert on
-- endpoint handles either case).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  endpoint      TEXT NOT NULL,
  p256dh        TEXT NOT NULL,
  auth_key      TEXT NOT NULL,
  user_agent    TEXT,

  -- Soft-invalidated (not deleted) the first time the push service returns
  -- 404/410 for this endpoint, so a delivery failure never destroys the
  -- audit trail. send-push.ts filters on `invalid_at IS NULL`; a fresh
  -- subscribe() from the same device later just clears it via upsert.
  invalid_at    TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint_unique
  ON push_subscriptions (endpoint);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id
  ON push_subscriptions (user_id) WHERE invalid_at IS NULL;
-- Supports both the per-user device-cap eviction query in
-- /api/push/subscribe (oldest last_seen_at first) and future pruning of
-- long-stale invalidated rows.
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_last_seen
  ON push_subscriptions (user_id, last_seen_at);

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Users manage their own device subscriptions directly (subscribe/
-- unsubscribe from the client); the send path always runs through
-- supabaseAdmin (service-role) from send-push.ts, which bypasses RLS.
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "push_subscriptions_owner_select" ON push_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "push_subscriptions_owner_insert" ON push_subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "push_subscriptions_owner_update" ON push_subscriptions
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "push_subscriptions_owner_delete" ON push_subscriptions
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "push_subscriptions_service_all" ON push_subscriptions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
