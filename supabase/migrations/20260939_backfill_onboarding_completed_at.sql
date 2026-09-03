-- ONBOARDING-PERMANENCE-FIX (backfill): onboarding_completed_at
--
-- Context: 20260916_onboarding_completed_at.sql added this column as the
-- authoritative "has this user been through onboarding" signal, but its own
-- header documents that POST /api/profile/onboarding never actually wrote
-- to it until that same fix landed — the write was missing entirely before
-- then. Net effect: onboarding_completed_at is NULL for every account
-- created before that fix shipped, regardless of whether that user really
-- did (or explicitly dismissed) onboarding under the old client-only
-- (localStorage) flow.
--
-- (main)/layout.tsx now gates whether <OnboardingFlow /> mounts at all on
-- this column being set, replacing the old localStorage-only check. Without
-- this backfill, every pre-existing registered user would see the
-- onboarding modal again on their next visit — exactly the regression this
-- migration exists to prevent. New signups going forward are unaffected:
-- their profiles row is created fresh with onboarding_completed_at left
-- NULL, so they correctly go through the real flow.
--
-- Backfill timestamp uses each profile's own created_at rather than NOW()
-- so the column stays meaningful (roughly "when this account was already
-- past onboarding") instead of every legacy account showing the same
-- migration-run instant.
update profiles
set onboarding_completed_at = created_at
where onboarding_completed_at is null;
