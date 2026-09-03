-- Digital Twin: deep training + portable export support.
-- See src/lib/digital-twin/engine.ts (buildStyleProfile's `depth` param,
-- exportTwinProfile()).

-- Which training pass produced the current auto_* fields — 'standard'
-- (fast/cheap, small sample) or 'deep' (much larger history sample, richer
-- personality/values/humor/emotional-pattern fields, meant for a user who
-- wants their twin to really feel like them). Nullable: older profiles
-- trained before this column existed predate the distinction entirely.
ALTER TABLE digital_twin_profiles
  ADD COLUMN IF NOT EXISTS last_training_depth text
    CHECK (last_training_depth IN ('standard', 'deep'));
