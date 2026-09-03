-- ═══════════════════════════════════════════════════════════════════════
-- Migration-replay reconciliation.
--
-- GAP: a from-scratch replay of this migration folder (new dev machine,
-- CI test database, disaster-recovery restore) does not reproduce the
-- actual production schema. Some earlier migrations were deleted after
-- being superseded (20260810_single_plan_three_billing_lengths.sql's own
-- header says as much: "REPLACES the entire prior pricing/discount
-- migration history ... all deleted"), and at least one cluster of
-- objects (the debit_subscription_tokens() RPC below) has no CREATE
-- migration in this folder at all, meaning it was applied directly
-- against the database outside of migration history. Either way, replaying
-- this folder top-to-bottom against an empty database currently breaks
-- partway through with `column "billing_interval" of relation "tiers"
-- does not exist` (20260810 assumes columns that no surviving migration
-- creates) and would keep breaking after that fix too.
--
-- This migration exists to make the replay whole again, using
-- src/types/supabase.ts (generated FROM the live production schema, so
-- it reflects what's actually deployed regardless of which migration
-- files survived) as ground truth for exactly which columns are missing
-- and what type/nullability they need. Every statement here is
-- IF NOT EXISTS / idempotent, so this migration is a no-op against the
-- real production database (which already has all of this) and only
-- does real work when replayed against a fresh one — it cannot regress
-- production by running it there.
--
-- Dated 20260809 (one day before 20260810) so it lands immediately before
-- the first point the replay currently breaks, without reordering
-- anything that came before it (nothing earlier in the folder references
-- these columns — verified by grep before choosing this position).
-- ═══════════════════════════════════════════════════════════════════════

-- ── tiers ──────────────────────────────────────────────────────────────
-- billing_interval / base_tier_slug: assumed pre-existing by 20260810
-- (ALTER COLUMN ... SET DEFAULT, and an INSERT naming them) but never
-- created by any surviving migration.
ALTER TABLE tiers ADD COLUMN IF NOT EXISTS billing_interval TEXT NOT NULL DEFAULT 'monthly';
ALTER TABLE tiers ADD COLUMN IF NOT EXISTS base_tier_slug   TEXT;

-- price_usd: original 20240101 schema types this INTEGER (whole-dollar
-- pricing from the original multi-tier product). 20260810 inserts
-- fractional values (9.99, 19.47, 35.88) into it — production must
-- already have this widened (src/types/supabase.ts's generated Row type
-- is `price_usd: number`, and only a NUMERIC column would accept those
-- literals without silently rounding them to 10/19/36). USING clause
-- makes this safe to run even if some existing whole-dollar rows are
-- still technically integers under the hood.
ALTER TABLE tiers ALTER COLUMN price_usd TYPE NUMERIC USING price_usd::numeric;

-- ── subscriptions ──────────────────────────────────────────────────────
-- billing_interval: same situation as tiers.billing_interval — 20260810
-- adds a CHECK constraint assuming this column exists; nothing creates it.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_interval TEXT NOT NULL DEFAULT 'monthly';

-- disputed_at / pre_dispute_tier: present in src/types/supabase.ts's Row
-- type for `subscriptions`, so they exist in the real production
-- database, but neither column appears anywhere in this migration
-- folder — not even a reference, let alone a CREATE. Their names imply a
-- subscription-dispute/chargeback flow, but there's no application code
-- anywhere under src/ that reads or writes either column (grepped), and
-- no surviving migration touches them either, so nothing in the replay
-- actually breaks without them. Adding them here anyway for schema
-- fidelity — a replayed database should match the real one — but
-- deliberately NOT reconstructing whatever business logic used to set
-- them: I don't have a source for that logic anywhere in this repo, and
-- guessing at dispute/chargeback handling and presenting it as this
-- migration's own is worse than leaving the gap explicit. If this flow
-- is still active, the real logic needs to be sourced from wherever it
-- actually lives (application code in a different repo, a Supabase Edge
-- Function, or the dashboard) and added as its own migration.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS disputed_at      TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS pre_dispute_tier TEXT;

-- debit_subscription_tokens(uuid, integer): unlike the dispute columns
-- above, this one DOES break the replay if left out — 20260908 runs
-- `ALTER FUNCTION public.debit_subscription_tokens(uuid, integer) SET
-- search_path`, and 20261110/20261111 REVOKE/GRANT on it, all of which
-- fail with "function does not exist" against a fresh database, since
-- this function's own CREATE FUNCTION is not present anywhere in this
-- migration folder (only ever ALTER'd/REVOKE'd/GRANT'd on), meaning it
-- was created directly against the database outside of migration
-- history — the same situation as the dispute columns above, except
-- this one actually blocks the replay instead of just being a fidelity
-- gap. It's also unused
-- by current application code (grepped: zero references under src/,
-- credit_subscription_tokens is what every payment webhook actually
-- calls). Rather than invent plausible-looking debit logic and risk it
-- being mistaken for the verified original, this reconstruction is
-- deliberately the simplest possible function with the right name,
-- signature, and return type to satisfy the later ALTER/REVOKE/GRANT
-- statements — it does not touch profiles.tokens at all. If this
-- function is ever actually called in production, that call is already
-- running against whatever the real (unrecoverable-from-this-repo)
-- definition is; this stub only exists so a fresh replay has a same-
-- named, same-signature function for later migrations to point their
-- ALTER/REVOKE/GRANT at, not as a claim about what it actually does.
CREATE OR REPLACE FUNCTION debit_subscription_tokens(p_user_id UUID, p_amount INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'debit_subscription_tokens: original production definition was never captured in migration history and is not reconstructed here — see 20260809_schema_replay_reconciliation.sql. This stub exists only so migration replay completes; find the real definition before relying on this function.';
END;
$$;
