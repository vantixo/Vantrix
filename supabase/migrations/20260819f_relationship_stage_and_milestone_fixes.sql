-- ─────────────────────────────────────────────────────────────────────────
-- BUG FIX 1: character_relationships.stage CHECK constraint didn't match
-- the app-level RelationshipStage type
-- ─────────────────────────────────────────────────────────────────────────
-- The original migration's CHECK only allowed
-- ('stranger','acquaintance','friend','close_friend','partner','soulmate').
-- relationship-engine.ts's RelationshipStage type (the actual source of
-- truth for what addRelationshipXp writes) is:
--   friendship track: stranger -> acquaintance -> friend -> close_friend -> best_friend
--   romance track:    match -> dating -> exclusive -> partner
--
-- 'best_friend', 'match', 'dating', 'exclusive' were never in the CHECK
-- list. Every relationship in this codebase starts on the friendship track
-- (ensureRelationship always inserts stage='stranger'), and normal
-- long-term engagement naturally progresses stranger -> ... -> close_friend
-- -> best_friend. The moment ANY relationship reaches best_friend, the
-- upsert in addRelationshipXp violates this CHECK constraint and fails —
-- silently, since that call site is fire-and-forget
-- (`.catch(bg('addRelationshipXp'))`), so it would have shown up only as a
-- swallowed error in logs, not a visible crash. From that point on the
-- relationship stops progressing/updating for that user+character pair.
--
-- 'soulmate' is kept in the allowed list even though it isn't a current
-- RelationshipStage value, in case any legacy row already has it — no
-- destructive change to existing data.
ALTER TABLE character_relationships
  DROP CONSTRAINT IF EXISTS character_relationships_stage_check;

ALTER TABLE character_relationships
  ADD CONSTRAINT character_relationships_stage_check
  CHECK (stage IN (
    'stranger', 'acquaintance', 'friend', 'close_friend', 'best_friend',
    'match', 'dating', 'exclusive', 'partner', 'soulmate'
  ));

-- ─────────────────────────────────────────────────────────────────────────
-- BUG FIX 2: extend character_surprises.type so level-up / milestone
-- notifications can ride the existing SSE delivery pipeline
-- ─────────────────────────────────────────────────────────────────────────
-- addRelationshipXp()'s ProgressionResult (leveledUp / newMilestone) and
-- the newly-wired EXTENDED_MILESTONES bits (first_lore, month_streak,
-- messages_100, anniversary_1m, first_reunion — see
-- checkAndApplyExtraMilestones() in relationship-engine.ts) were computed
-- but never surfaced to the user in any way. Rather than building a new
-- delivery mechanism, this reuses the existing character_surprises /
-- getPendingSurprises / SSE notifications route already wired end-to-end
-- for promise_followup / anniversary / memory_poem.
ALTER TABLE character_surprises
  DROP CONSTRAINT IF EXISTS character_surprises_type_check;

ALTER TABLE character_surprises
  ADD CONSTRAINT character_surprises_type_check
  CHECK (type IN ('promise_followup', 'anniversary', 'memory_poem', 'milestone_unlocked'));
