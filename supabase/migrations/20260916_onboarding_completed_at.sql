-- ONBOARDING-WIRING-FIX: onboarding_completed_at
--
-- stage-engine.ts's reachedStage1 gate (see journey/stage-engine.ts) has
-- required `onboardingComplete` since it was written, and that signal has
-- always been derived as `Boolean(profiles.onboarding_character_id)`. Two
-- problems with that, found while auditing why nobody was progressing past
-- stage 0:
--
--   1. /api/profile/onboarding's POST handler never actually wrote
--      onboarding_character_id (or onboarding_intent) to the profiles row —
--      it read/validated the body, ran referral attribution and a
--      relationship-engine side effect, and logged, but never persisted
--      the two columns that already existed for exactly this purpose. So
--      onboardingComplete was Boolean(null) for every account, forever,
--      regardless of real onboarding completion — the entire progressive
--      unlock system (memories, relationship status, gifts, world map,
--      creator tools, community, everything above stage 0) was
--      unreachable for the whole user base.
--
--   2. Even with that fixed, onboarding_character_id presence was never a
--      sound completion proxy on its own — a user who skips the
--      character-matching step, or who dismisses onboarding outright via
--      the X button (which never called the API at all — see
--      onboarding-flow.tsx dismiss()), legitimately has no
--      onboarding_character_id but has still "completed" (or opted out of)
--      onboarding and shouldn't be permanently blocked from progressing.
--
-- This column is the real, unambiguous completion signal: set once, by the
-- onboarding route, on every completion path (finish or explicit skip/
-- dismiss) — never inferred from whether the user happened to pick a
-- character along the way.
alter table profiles
  add column if not exists onboarding_completed_at timestamptz;

comment on column profiles.onboarding_completed_at is
  'Set once by POST /api/profile/onboarding on any completion path (finished or explicitly skipped/dismissed). The authoritative "has this user been through onboarding" signal — do not infer this from onboarding_character_id, which is only set when a character was actually picked.';
