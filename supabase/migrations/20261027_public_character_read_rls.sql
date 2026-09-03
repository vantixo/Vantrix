-- Vantrix — tighten characters_read RLS to require is_public
-- Migration: 20261027_public_character_read_rls.sql
--
-- §2.5 FIX (public, crawlable character pages): while building
-- src/lib/seo/public-character.ts, found that the `characters_read` RLS
-- policy (20240101_production.sql) was never updated when is_public was
-- added later (20260623_character_activation_and_visibility.sql) —
-- it still only checks `active = TRUE AND moderation_status = 'approved'`.
-- Every anon-key caller that's supposed to be scoped to public characters
-- (discover/featured, dating pools) already adds `.eq("is_public", true)`
-- by hand in application code for exactly this reason — RLS itself would
-- let the anon key SELECT an active, approved-but-still-private character
-- (visibility_requested = 'private') directly by id, bypassing that
-- app-level filter entirely for anyone who guesses/enumerates an id.
--
-- The new public-character.ts helper uses supabaseAdmin (bypasses RLS,
-- applies its own explicit filter set) specifically so it never depended
-- on this policy being correct — but the gap is real and directly
-- relevant to what this pass is building, so it's closed here rather than
-- just flagged. `characters_own_write` (FOR ALL) already lets a creator
-- read their own private/pending characters via auth.uid() = creator_id
-- OR created_by, so this doesn't affect owners viewing their own work in
-- Creator Studio — only the anon/RLS-only read path for characters that
-- were never marked public.

DROP POLICY IF EXISTS "characters_read" ON characters;
CREATE POLICY "characters_read" ON characters
  FOR SELECT USING (
    active = TRUE AND moderation_status = 'approved' AND is_public = TRUE
  );
