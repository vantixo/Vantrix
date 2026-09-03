-- 20261017_recommend_candidate_pool_index.sql
--
-- lib/recommendations/character-recommender.ts's fetchCandidates() (and
-- /api/characters GET's default listing, which filters the same three
-- columns) runs:
--
--   WHERE active = true AND is_public = true AND is_live = true
--   [AND gender = ?] [AND category = ?]
--   ORDER BY like_count DESC NULLS LAST
--   LIMIT 100
--
-- The existing idx_characters_active_gender_cat covers (active, gender,
-- category) but not is_public/is_live, and doesn't include like_count, so
-- this query shape still needed a sort step over rows Postgres couldn't
-- fully narrow from an index alone. A dedicated partial index matching the
-- exact filter + sort columns lets Postgres satisfy both the filter and the
-- ORDER BY ... LIMIT from the index directly.
--
-- Partial (WHERE active AND is_public AND is_live) rather than a full index,
-- consistent with every other characters index in this file — the query
-- never asks for inactive/private/non-live rows, so indexing them is pure
-- waste.
CREATE INDEX IF NOT EXISTS idx_characters_recommend_pool
  ON characters (like_count DESC NULLS LAST)
  WHERE active = TRUE AND is_public = TRUE AND is_live = TRUE;
