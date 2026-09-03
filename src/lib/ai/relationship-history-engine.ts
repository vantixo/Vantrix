/**
 * src/lib/ai/relationship-history-engine.ts
 *
 * Unified relationship timeline — merges the three history threads that
 * already exist but never talk to each other:
 *
 *   1. relationship-milestones.ts  — memory-graph "defining moments"
 *      (first vulnerable moment, biggest disagreement, etc.), read via
 *      getMilestones(). Best content, no timestamps a user-facing timeline
 *      can sort cleanly against everything else.
 *   2. character_relationships.milestones — the EXTENDED_MILESTONES bitmask
 *      from relationship-engine.ts (first_chat, week_streak, soulmate, ...).
 *      Cheap, reliable timestamps via last_checkin, but only a fixed set of
 *      named flags, no free-form content.
 *   3. dating_gifts — concrete, already-timestamped events on the romance
 *      track (who gave what, when), same table market-value.ts and
 *      queue/worker.ts already read.
 *
 * relationship-milestones.ts's formatMilestonesForPrompt() answers "what
 * matters most" for the *current* prompt turn (unordered, weighted by
 * significance). This module answers a different question: "what actually
 * happened, in order" — the data a real timeline UI (see the existing
 * /dating/history page and universe/history-explorer.tsx, which this
 * mirrors for a single relationship instead of the whole world) or a rare
 * "let's look back at how far we've come" narration would need. The two
 * are complementary, not competing: this one is the ledger, that one is
 * the highlight reel.
 *
 * aging-together-engine.ts consumes only a milestoneCount + daysKnown pair
 * to pick a style register; it deliberately does not need this module's
 * full entry list. If a future feature wants concrete callback content
 * instead of a style instruction (e.g. "reference a specific real past
 * event"), pull from buildRelationshipHistoryTimeline() here rather than
 * inventing history in the prompt — same "never fabricate shared history
 * that never happened" rule aging-together-engine.ts documents.
 *
 * Read-only aggregation: this module never writes to any of the three
 * source tables, and never touches the crisis break-character path in
 * prompt.ts.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import { getMilestones }   from './relationship-milestones';
import { EXTENDED_MILESTONES } from './relationship-engine';

// ── Entry shape ─────────────────────────────────────────────────────────

export type RelationshipHistoryEventType =
  | 'memory_milestone'   // from relationship-milestones.ts
  | 'stage_milestone'    // from the EXTENDED_MILESTONES bitmask
  | 'gift';              // from dating_gifts

export interface RelationshipHistoryEntry {
  type:          RelationshipHistoryEventType;
  key:           string;   // stable id/slug, unique within its own type
  title:         string;
  description:   string | null;
  occurred_at:   string;   // ISO timestamp — best-effort for bitmask flags (see note below)
  significance:  number;   // 0-100, roughly comparable across types
}

const STAGE_MILESTONE_META: Record<keyof typeof EXTENDED_MILESTONES, { title: string; significance: number }> = {
  first_chat:          { title: 'First Conversation',        significance: 20 },
  deep_talk:           { title: 'First Deep Talk',            significance: 40 },
  first_gift:          { title: 'First Gift',                 significance: 35 },
  week_streak:         { title: '7-Day Streak',                significance: 30 },
  soulmate:            { title: 'Soulmate Bond',               significance: 90 },
  friend_stage:        { title: 'Became Friends',              significance: 25 },
  close_friend_stage:  { title: 'Became Close Friends',        significance: 45 },
  first_lore:          { title: 'First Shared Lore',           significance: 20 },
  month_streak:        { title: '30-Day Streak',                significance: 55 },
  messages_100:        { title: '100 Messages',                significance: 25 },
  anniversary_1m:      { title: 'One-Month Anniversary',       significance: 50 },
  first_reunion:       { title: 'A Reunion, After Time Apart', significance: 30 },
  conversations_100:   { title: '100 Conversations',           significance: 60 },
  six_months:          { title: 'Six Months Together',         significance: 70 },
  one_year:            { title: 'One Year Together',           significance: 85 },
  three_years:         { title: 'Three Years Together',        significance: 95 },
};

// ── Build ───────────────────────────────────────────────────────────────

export interface BuildHistoryOptions {
  /** If this relationship is also a dating match, its dating_matches.id —
   *  enables pulling gift history. Omit for friendship-track relationships. */
  matchId?: string;
}

export async function buildRelationshipHistoryTimeline(
  userId:      string,
  characterId: string,
  opts:        BuildHistoryOptions = {},
): Promise<RelationshipHistoryEntry[]> {
  const entries: RelationshipHistoryEntry[] = [];

  const [milestones, relationship, gifts] = await Promise.all([
    getMilestones(userId, characterId),
    Promise.resolve(
      supabaseAdmin
        .from('character_relationships')
        .select('milestones, last_checkin, created_at')
        .eq('user_id', userId)
        .eq('character_id', characterId)
        .single(),
    )
      .then(r => r.data as { milestones: number; last_checkin: string | null; created_at: string } | null)
      .catch(() => null),
    opts.matchId
      ? Promise.resolve(
          supabaseAdmin
            .from('dating_gifts')
            .select('id, gift_name, created_at')
            .eq('match_id', opts.matchId),
        )
          .then(r => (r.data ?? []) as { id: string; gift_name: string; created_at: string }[])
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  // 1. Memory-graph defining moments — each has its own real timestamp.
  if (milestones) {
    if (milestones.first_vulnerable_moment) {
      entries.push({
        type: 'memory_milestone', key: 'first_vulnerable_moment',
        title: 'First Real Vulnerability',
        description: milestones.first_vulnerable_moment.description,
        occurred_at: milestones.first_vulnerable_moment.created_at,
        significance: 75,
      });
    }
    if (milestones.biggest_disagreement) {
      entries.push({
        type: 'memory_milestone', key: 'biggest_disagreement',
        title: 'Biggest Friction Point',
        description: milestones.biggest_disagreement.description,
        occurred_at: milestones.biggest_disagreement.created_at,
        significance: 60,
      });
    }
    if (milestones.most_emotional_moment) {
      entries.push({
        type: 'memory_milestone', key: 'most_emotional_moment',
        title: 'Most Emotional Moment',
        description: milestones.most_emotional_moment.description,
        occurred_at: milestones.most_emotional_moment.created_at,
        significance: 80,
      });
    }
    for (const joke of milestones.shared_jokes) {
      entries.push({
        type: 'memory_milestone', key: `shared_joke:${joke.id}`,
        title: 'Inside Joke Born',
        description: joke.title ?? joke.description,
        occurred_at: joke.created_at,
        significance: 30,
      });
    }
  }

  // 2. Bitmask stage milestones. These flags don't carry their own
  //    timestamps — last_checkin is the best available proxy for "roughly
  //    when this relationship last reached a milestone," and created_at is
  //    the floor. Callers that need real per-flag timestamps should treat
  //    occurred_at here as approximate, not authoritative (unlike the two
  //    other event types, which are always exact).
  if (relationship) {
    const approxTime = relationship.last_checkin ?? relationship.created_at;
    for (const [key, bit] of Object.entries(EXTENDED_MILESTONES) as [keyof typeof EXTENDED_MILESTONES, number][]) {
      if (!(relationship.milestones & bit)) continue;
      const meta = STAGE_MILESTONE_META[key];
      entries.push({
        type: 'stage_milestone', key,
        title: meta.title,
        description: null,
        occurred_at: approxTime,
        significance: meta.significance,
      });
    }
  }

  // 3. Gifts — exact timestamps, romance track only.
  for (const gift of gifts) {
    entries.push({
      type: 'gift', key: `gift:${gift.id}`,
      title: `Gift: ${gift.gift_name}`,
      description: null,
      occurred_at: gift.created_at,
      significance: 25,
    });
  }

  entries.sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
  return entries;
}

// ── Derived reads ─────────────────────────────────────────────────────

/** Total count across all three sources — the superset aging-together-engine.ts's
 *  own milestoneCount (memory-graph only) undercounts by design; use this
 *  instead if a caller wants "how much history exists" across everything. */
export function countHistoryEntries(entries: RelationshipHistoryEntry[]): number {
  return entries.length;
}

export function mostSignificantEntries(
  entries: RelationshipHistoryEntry[],
  limit = 3,
): RelationshipHistoryEntry[] {
  return [...entries].sort((a, b) => b.significance - a.significance).slice(0, limit);
}

// ── Optional prompt recap ───────────────────────────────────────────────
// Deliberately separate from relationship-milestones.ts's
// formatMilestonesForPrompt() ("Defining Moments" block, unordered by
// significance) — this is a short, ordered "the story so far" recap.
// Callers should use at most one of the two per prompt to avoid saying the
// same history twice; this one is meant for occasions that call for actual
// chronology (an anniversary check-in, an explicit "how have we grown"
// question) rather than every turn.

export function formatHistoryRecapForPrompt(
  entries: RelationshipHistoryEntry[],
  limit = 4,
): string {
  if (!entries.length) return '';
  const top = mostSignificantEntries(entries, limit)
    .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());

  if (!top.length) return '';

  const lines = ['── The Story So Far (chronological, for when it actually comes up) ──'];
  for (const e of top) {
    const when = new Date(e.occurred_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    lines.push(`${when} — ${e.title}${e.description ? `: ${e.description}` : ''}`);
  }
  return lines.join('\n');
}

export async function logHistoryReadFailure(userId: string, characterId: string, error: unknown): Promise<void> {
  logger.warn('relationship-history-engine: failed to build timeline', {
    userId, characterId, error: error instanceof Error ? error.message : String(error),
  });
}
