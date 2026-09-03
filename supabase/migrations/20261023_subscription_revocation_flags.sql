-- Automatic Premium revocation on refund/dispute — flag + grace period.
--
-- Prior state (see AUDIT_FINDINGS_LOG.md #1): all 3 payment providers claw
-- back the *referrer's* commission on a refund/dispute (clawBackCommission)
-- but nothing ever touched the *paying user's* own tier. A successful
-- dispute could keep full paid access indefinitely. That was a deliberate
-- "manual admin review" decision recorded 2026-08-06 — this migration
-- implements the follow-up decision: flag immediately, give the user a
-- grace period to contact support / let the dispute resolve, then
-- auto-downgrade if nobody's cleared the flag by the time it lapses.
--
-- Lifecycle: pending -> executed (grace period lapsed, tier downgraded)
--                    -> cleared  (admin determined the refund/dispute was
--                                 resolved in the user's favor, or was a
--                                 provider error / duplicate charge)

CREATE TABLE IF NOT EXISTS subscription_revocation_flags (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider              TEXT NOT NULL,               -- 'stripe' | 'paystack' | 'nowpayments'
  source_payment_id     TEXT NOT NULL,                -- payment_intent/invoice id, tx reference, or nowpayments payment_id
  event_type            TEXT NOT NULL,                -- e.g. 'charge.refunded', 'charge.dispute.created'
  reason                TEXT NOT NULL CHECK (reason IN ('refund', 'dispute')),

  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cleared', 'executed')),
  grace_period_ends_at  TIMESTAMPTZ NOT NULL,

  -- Populated once the sweep cron actually downgrades the tier.
  executed_at           TIMESTAMPTZ,
  previous_tier         TEXT,

  -- Populated when an admin clears the flag before it executes (dispute
  -- resolved in the user's favor, provider error, duplicate charge, etc).
  cleared_at            TIMESTAMPTZ,
  cleared_by            UUID REFERENCES auth.users(id),
  clear_reason          TEXT,

  -- One flag per underlying payment event. Both the webhook's own retry
  -- behavior and a provider re-sending the same event (e.g. Stripe retrying
  -- a 500) must not create duplicate flags with independent grace periods.
  UNIQUE (provider, source_payment_id)
);

CREATE INDEX IF NOT EXISTS subscription_revocation_flags_sweep_idx
  ON subscription_revocation_flags (status, grace_period_ends_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS subscription_revocation_flags_user_idx
  ON subscription_revocation_flags (user_id);

ALTER TABLE subscription_revocation_flags ENABLE ROW LEVEL SECURITY;
-- No policies: written/read exclusively via supabaseAdmin (service_role) from
-- payment webhooks, the sweep cron, and the admin review route — same
-- access pattern as admin_audit_log and other service-role-only tables.
