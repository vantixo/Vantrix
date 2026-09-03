-- ═══════════════════════════════════════════════════════════════════════
-- Vantrix Coin ledger maturation.
--
-- GAP: every token-balance mutation in this codebase (deduct_tokens,
-- add_tokens, refund_tokens, credit_subscription_tokens — see
-- 20240101_production.sql, 20260930b_lock_privileged_rpcs.sql,
-- 20261021_fix_deduct_tokens_param_regression.sql) does nothing but
-- `UPDATE profiles SET tokens = tokens ± amount`. There is no record of
-- *why* a balance changed, no way to reconcile a user's current balance
-- against the events that produced it, and no audit trail for support,
-- fraud review, or a "coin history" UI — only the current number survives.
-- This is the same gap increment_xp() already solved for XP via the
-- xp_events table (same file, ~40 lines below credit_subscription_tokens)
-- — token_ledger below follows that exact same append-only-events-table
-- pattern, including its RLS shape (20260710_enable_missing_rls.sql).
--
-- APPROACH — additive and backward compatible:
--   1. token_ledger is a new, append-only table. Nothing existing reads
--      from or depends on it yet, so this migration cannot regress any
--      current behavior by itself.
--   2. Every balance-mutating function gets two new trailing parameters —
--      p_reason and p_reference_id — both with defaults, so every
--      existing call site (12+ across the app, plus send_gift() and
--      start_date_session() which call deduct_tokens() internally) keeps
--      working unchanged, whether it calls positionally or by name.
--      Callers that want a specific, queryable reason (the payment
--      webhooks crediting a subscription, in particular) can start
--      passing one immediately; everyone else still gets a ledger row,
--      just classified by the function-level default reason until their
--      call site is updated to pass something more specific.
--   3. p_reference_id is NOT given a uniqueness constraint here — the
--      existing processed_webhooks idempotency claim (webhook-claim.ts)
--      already prevents a given payment reference from crediting tokens
--      twice; token_ledger's reference_id column is for traceability
--      (letting an operator find "which ledger row did payment X
--      produce"), not a second independent idempotency mechanism. Adding
--      a real UNIQUE constraint on it would require auditing every
--      caller's reference_id uniqueness guarantees first (gifts, chat
--      media generation, etc. don't currently have one), which is out of
--      scope for this migration.
--   4. The four functions below all still run their existing UPDATE and
--      the new ledger INSERT inside the same implicit transaction (a
--      plpgsql function body is one statement to the calling transaction
--      unless it explicitly commits, which none of these do) — so a
--      failure writing the ledger row rolls back the balance change too;
--      there is no way for this migration to introduce a balance/ledger
--      drift that didn't already exist as a balance/reality drift before it.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS token_ledger (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount         INTEGER     NOT NULL, -- signed: positive = credit, negative = debit. Never 0 (see CHECK below).
  balance_after  INTEGER     NOT NULL, -- profiles.tokens immediately after this entry — lets a reconciliation
                                        -- job walk the ledger and assert it sums to the current balance without
                                        -- re-deriving running totals from amount alone.
  reason         TEXT        NOT NULL, -- e.g. 'subscription_credit', 'token_spend', 'gift_sent', 'refund',
                                        -- 'admin_adjustment', 'character_creation', 'chat_media_generation'
  reference_id   TEXT,                 -- optional pointer to the source event (payment reference, gift id, etc.)
                                        -- — traceability only, see note (3) above; not a uniqueness/idempotency key
  metadata       JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT token_ledger_amount_nonzero CHECK (amount <> 0)
);

CREATE INDEX IF NOT EXISTS idx_token_ledger_user      ON token_ledger(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_ledger_reference  ON token_ledger(reference_id) WHERE reference_id IS NOT NULL;

-- Append-only: even a service_role bug (a stray UPDATE/DELETE, not just
-- application code) should not be able to rewrite history. Genuine
-- corrections must be new compensating rows (e.g. an 'admin_adjustment'
-- credit/debit), the same way you'd correct a mistake in accounting —
-- never by editing or removing the original entry.
CREATE OR REPLACE FUNCTION token_ledger_block_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'token_ledger is append-only: % is not permitted (row id %)', TG_OP, OLD.id
    USING HINT = 'Insert a new compensating entry instead of modifying an existing one.';
END;
$$;

DROP TRIGGER IF EXISTS token_ledger_no_update ON token_ledger;
DROP TRIGGER IF EXISTS token_ledger_no_delete ON token_ledger;
CREATE TRIGGER token_ledger_no_update BEFORE UPDATE ON token_ledger
  FOR EACH ROW EXECUTE FUNCTION token_ledger_block_mutation();
CREATE TRIGGER token_ledger_no_delete BEFORE DELETE ON token_ledger
  FOR EACH ROW EXECUTE FUNCTION token_ledger_block_mutation();

ALTER TABLE token_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "token_ledger_own_read" ON token_ledger;
DROP POLICY IF EXISTS "token_ledger_service"  ON token_ledger;
-- Read-only for the owning user (mirrors xp_events_own_read exactly);
-- INSERT only ever happens via the SECURITY DEFINER functions below, so
-- no authenticated/anon INSERT policy exists at all — matches how
-- xp_events has no non-service write path either.
CREATE POLICY "token_ledger_own_read" ON token_ledger FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "token_ledger_service"  ON token_ledger FOR ALL TO service_role USING (TRUE);

REVOKE ALL ON FUNCTION token_ledger_block_mutation() FROM PUBLIC;

-- ── deduct_tokens ──────────────────────────────────────────────────────
-- Signature-compatible superset of the 20261021 version: p_reason and
-- p_reference_id are new trailing optional params, so
-- `deduct_tokens(p_user_id, p_amount)` (every existing call site,
-- including send_gift()'s and start_date_session()'s internal PERFORM)
-- keeps working exactly as before, now also writing a ledger row.
--
-- DROP-BEFORE-CREATE NOTE (see 20261021's own comment on this exact
-- issue): Postgres function identity includes the parameter list, and
-- this change adds two new parameters — a different arg count, not just
-- a rename. CREATE OR REPLACE cannot retarget an existing (uuid,integer)
-- function onto a (uuid,integer,text,text) signature; left alone it would
-- create a SECOND overload, and PostgREST's named-argument RPC calls
-- (every call site passes only p_user_id/p_amount) would then match BOTH
-- overloads — an ambiguous-function error at every call site. The DROP
-- is required, not defensive boilerplate.
DROP FUNCTION IF EXISTS deduct_tokens(UUID, INTEGER);

CREATE OR REPLACE FUNCTION deduct_tokens(
  p_user_id      UUID,
  p_amount       INTEGER,
  p_reason       TEXT DEFAULT 'token_spend',
  p_reference_id TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_tokens INTEGER;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount'
      USING HINT = 'deduct_tokens requires a positive amount; use add_tokens() for credits/refunds';
  END IF;

  UPDATE profiles
  SET tokens = tokens - p_amount
  WHERE id = p_user_id AND tokens >= p_amount
  RETURNING tokens INTO v_tokens;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'insufficient_tokens'
      USING HINT = 'User does not have enough tokens';
  END IF;

  INSERT INTO token_ledger (user_id, amount, balance_after, reason, reference_id)
  VALUES (p_user_id, -p_amount, v_tokens, p_reason, p_reference_id);

  RETURN v_tokens;
END;
$$;

REVOKE EXECUTE ON FUNCTION deduct_tokens(UUID, INTEGER, TEXT, TEXT) FROM authenticated, anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION deduct_tokens(UUID, INTEGER, TEXT, TEXT) TO service_role;

-- ── add_tokens ─────────────────────────────────────────────────────────
-- Same drop-before-create requirement as deduct_tokens above — new arg
-- count, not a rename.
DROP FUNCTION IF EXISTS add_tokens(UUID, INTEGER);

CREATE OR REPLACE FUNCTION add_tokens(
  p_user_id      UUID,
  p_amount       INTEGER,
  p_reason       TEXT DEFAULT 'token_credit',
  p_reference_id TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_tokens INTEGER;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount'
      USING HINT = 'add_tokens requires a positive amount';
  END IF;

  UPDATE profiles SET tokens = tokens + p_amount WHERE id = p_user_id
  RETURNING tokens INTO v_tokens;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found' USING HINT = 'No profile row for p_user_id';
  END IF;

  INSERT INTO token_ledger (user_id, amount, balance_after, reason, reference_id)
  VALUES (p_user_id, p_amount, v_tokens, p_reason, p_reference_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION add_tokens(UUID, INTEGER, TEXT, TEXT) FROM authenticated, anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION add_tokens(UUID, INTEGER, TEXT, TEXT) TO service_role;

-- ── refund_tokens ──────────────────────────────────────────────────────
-- Same drop-before-create requirement as deduct_tokens above.
DROP FUNCTION IF EXISTS refund_tokens(UUID, INTEGER);

CREATE OR REPLACE FUNCTION refund_tokens(
  p_user_id      UUID,
  p_amount       INTEGER,
  p_reason       TEXT DEFAULT 'refund',
  p_reference_id TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_tokens INTEGER;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount'
      USING HINT = 'refund_tokens requires a positive amount to credit';
  END IF;

  UPDATE profiles
  SET tokens = tokens + p_amount
  WHERE id = p_user_id
  RETURNING tokens INTO v_tokens;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found'
      USING HINT = 'No profile row for p_user_id';
  END IF;

  INSERT INTO token_ledger (user_id, amount, balance_after, reason, reference_id)
  VALUES (p_user_id, p_amount, v_tokens, p_reason, p_reference_id);

  RETURN v_tokens;
END;
$$;

REVOKE EXECUTE ON FUNCTION refund_tokens(UUID, INTEGER, TEXT, TEXT) FROM authenticated, anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION refund_tokens(UUID, INTEGER, TEXT, TEXT) TO service_role;

-- ── credit_subscription_tokens ────────────────────────────────────────
-- Original (20240101_production.sql) silently clamped negative amounts to
-- 0 via GREATEST(0, p_amount) rather than rejecting them outright — kept
-- as-is here (not a behavior change this migration is scoped to make),
-- but a clamped-to-zero call now still writes a ledger row so that a
-- caller that (bug or not) passed <= 0 is visible in the ledger as a
-- zero-effect event rather than vanishing silently. amount = 0 is
-- rejected by token_ledger's own CHECK constraint, so that case logs
-- nothing — consistent with "nothing happened" needing no entry.
--
-- Same drop-before-create requirement as deduct_tokens above.
DROP FUNCTION IF EXISTS credit_subscription_tokens(UUID, INTEGER);

CREATE OR REPLACE FUNCTION credit_subscription_tokens(
  p_user_id      UUID,
  p_amount       INTEGER,
  p_reason       TEXT DEFAULT 'subscription_credit',
  p_reference_id TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_credit INTEGER := GREATEST(0, p_amount);
  v_tokens INTEGER;
BEGIN
  UPDATE profiles SET tokens = tokens + v_credit WHERE id = p_user_id
  RETURNING tokens INTO v_tokens;

  IF FOUND AND v_credit > 0 THEN
    INSERT INTO token_ledger (user_id, amount, balance_after, reason, reference_id)
    VALUES (p_user_id, v_credit, v_tokens, p_reason, p_reference_id);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION credit_subscription_tokens(UUID, INTEGER, TEXT, TEXT) FROM authenticated, anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION credit_subscription_tokens(UUID, INTEGER, TEXT, TEXT) TO service_role;

-- ── send_gift / start_date_session: richer ledger reasons ───────────────
-- Both already route their token spend through deduct_tokens() (see
-- 20240101_production.sql and 20260930_first_dates_and_forecast.sql), so
-- they'd get a ledger row automatically with the generic 'token_spend'
-- default reason above. These two are the highest-volume, most
-- user-visible spend paths in the app (every gift, every date), so it's
-- worth the small extra specificity here rather than leaving them on the
-- generic default forever. Signatures are UNCHANGED for both (only the
-- internal deduct_tokens call gains its two new trailing args), so
-- CREATE OR REPLACE is sufficient — no DROP needed, matching the
-- 20261021 migration's own "same types, same arg count" rule.
CREATE OR REPLACE FUNCTION send_gift(
  p_user_id    UUID,
  p_match_id   UUID,
  p_char_id    UUID,
  p_gift_type  TEXT,
  p_gift_name  TEXT,
  p_bond_bonus INTEGER,
  p_token_cost INTEGER,
  p_message    TEXT DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE v_bond INTEGER;
BEGIN
  PERFORM deduct_tokens(p_user_id, p_token_cost, 'gift_sent', p_match_id::TEXT);
  INSERT INTO dating_gifts
    (match_id, user_id, character_id, gift_type, gift_name, bond_bonus, token_cost, message)
  VALUES
    (p_match_id, p_user_id, p_char_id, p_gift_type, p_gift_name, p_bond_bonus, p_token_cost, p_message);
  SELECT update_bond_score(p_match_id, p_bond_bonus) INTO v_bond;
  RETURN COALESCE(v_bond, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Explicit, not relying on CREATE OR REPLACE's (correct, but easy to
-- doubt) behavior of preserving a previously-ALTER'd search_path when the
-- new definition doesn't repeat a SET clause — see 20260908's original
-- hardening of this exact function. Being explicit here means this
-- migration is self-contained proof the hardening survives, not a claim
-- that depends on knowing Postgres's CREATE OR REPLACE semantics.
ALTER FUNCTION public.send_gift(uuid, uuid, uuid, text, text, integer, integer, text)
  SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION start_date_session(
  p_user_id        UUID,
  p_match_id       UUID,
  p_char_id        UUID,
  p_date_type      TEXT,
  p_opening_scene  TEXT,
  p_token_cost     INTEGER,
  p_bond_bonus     INTEGER,
  p_conversation_id UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_session_id UUID;
BEGIN
  IF p_token_cost > 0 THEN
    PERFORM deduct_tokens(p_user_id, p_token_cost, 'date_session', p_match_id::TEXT);
  END IF;

  INSERT INTO date_sessions
    (match_id, user_id, character_id, date_type, opening_scene, token_cost, bond_bonus, conversation_id)
  VALUES
    (p_match_id, p_user_id, p_char_id, p_date_type, p_opening_scene, p_token_cost, p_bond_bonus, p_conversation_id)
  RETURNING id INTO v_session_id;

  RETURN v_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER FUNCTION public.start_date_session(uuid, uuid, uuid, text, text, integer, integer, uuid)
  SET search_path = public, pg_temp;
