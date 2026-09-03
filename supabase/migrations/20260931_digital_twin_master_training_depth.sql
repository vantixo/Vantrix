-- Digital Twin: allow 'master' as a valid last_training_depth value.
--
-- 20260927_digital_twin_deep_training.sql added last_training_depth with a
-- CHECK constraint permitting only 'standard' | 'deep'. The 'master' tier
-- (src/lib/digital-twin/engine.ts TrainingDepth, wired end-to-end through
-- the train API route and the digital-twin page's UI) was built afterward
-- but this constraint was never widened to match — so completing a master
-- training run currently fails the CHECK at the final upsert, after the
-- (expensive) inference pass already ran. This just widens the constraint;
-- no data backfill needed since no row could have 'master' stored today.

ALTER TABLE digital_twin_profiles
  DROP CONSTRAINT IF EXISTS digital_twin_profiles_last_training_depth_check;

ALTER TABLE digital_twin_profiles
  ADD CONSTRAINT digital_twin_profiles_last_training_depth_check
    CHECK (last_training_depth IN ('standard', 'deep', 'master'));
