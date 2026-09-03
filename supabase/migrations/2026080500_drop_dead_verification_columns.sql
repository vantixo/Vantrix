-- ─────────────────────────────────────────────────────────────────────────────
-- Dead-code cleanup: remnants of the old document/third-party verification
-- system, and an abandoned verification-tier system, neither of which any
-- application code reads or writes anymore.
--
-- Verified before writing this migration (see audit conversation):
--   - age_verifications.verification_provider / .provider_reference: only
--     ever meant for the 'document'/'third_party' methods (see the CHECK
--     constraint on age_verifications.method in 20240500_age_verification.sql).
--     Only submitSelfAttestation() writes to this table now, and it never
--     sets either column. Zero reads anywhere in src/.
--   - profiles.age_verified_at, .birth_year, .verification_level,
--     .phone_verified_at, .id_verified_at: zero reads or writes anywhere in
--     src/ — grepped the whole app, only hit was the generated types file
--     itself. No indexes reference them. verification_level's CHECK
--     constraint is inline on the column definition, so it's dropped
--     automatically with the column.
--
-- NOT touched by this migration (deliberately, flagged separately rather
-- than silently removed): is_user_age_verified() and get_user_verified_age()
-- from 20240500_age_verification.sql. Also unused today, but they're
-- method-agnostic guard functions (work with self_attestation same as any
-- other method) rather than document-verification-specific dead weight —
-- a different category of "unused" than the columns above.
--
-- age_verified_at and verification_level are referenced by
-- profiles_own_update's WITH CHECK clause (added in 20241100_fix_age_
-- verified_rls.sql, last recreated in 20260709_remove_denormalized_age_
-- verified.sql). That migration's own header documents hitting a real bug
-- here: DROP COLUMN on a column a policy depends on fails outright, and
-- DROP COLUMN ... CASCADE — the tempting fix — silently deletes the whole
-- policy, leaving tier/tokens/role/is_admin/is_disabled with zero RLS
-- protection against direct client writes. Following that exact precedent:
-- drop the policy, drop the columns, recreate the policy without the two
-- dead references, with every other protected-column check unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "profiles_own_update" ON profiles;

ALTER TABLE profiles
  DROP COLUMN IF EXISTS age_verified_at,
  DROP COLUMN IF EXISTS birth_year,
  DROP COLUMN IF EXISTS verification_level,
  DROP COLUMN IF EXISTS phone_verified_at,
  DROP COLUMN IF EXISTS id_verified_at;

ALTER TABLE age_verifications
  DROP COLUMN IF EXISTS verification_provider,
  DROP COLUMN IF EXISTS provider_reference;

CREATE POLICY "profiles_own_update" ON profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND tier         = (SELECT tier         FROM profiles WHERE id = auth.uid())
    AND tokens        = (SELECT tokens        FROM profiles WHERE id = auth.uid())
    AND role          = (SELECT role          FROM profiles WHERE id = auth.uid())
    AND is_admin      = (SELECT is_admin      FROM profiles WHERE id = auth.uid())
    AND is_disabled   = (SELECT is_disabled   FROM profiles WHERE id = auth.uid())
  );
