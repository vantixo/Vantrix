/**
 * Timeline Engine — Vantrix
 *
 * Second layer of the memory-consolidation → timeline → life-story →
 * autobiography chain (see memory-consolidation.ts's header). Three
 * history sources already exist and already don't talk to each other,
 * the exact problem relationship-history-engine.ts solved for the
 * relationship-scoped subset of them:
 *
 *   1. memory-consolidation.ts's ConsolidatedMemory[] — shared moments,
 *      folded to avoid repeats.
 *   2. relationship-history-engine.ts's RelationshipHistoryEntry[] — the
 *      unified relationship ledger it already built from milestones +
 *      stage bitmask + gifts.
 *   3. knowledge-library.ts's KnowledgeEntry[] (category 'backstory_detail')
 *      — creator-authored and backstory-engine.ts-generated canon, i.e.
 *      the character's life *before* this user existed.
 *
 * relationship-history-engine.ts deliberately stops at "this relationship's
 * ledger" — it has no notion of the character's own life outside that
 * relationship, by design (canon is character-global, not user-scoped;
 * see its header). This module is one level up: it merges all three
 * sources into a single chronological TimelineEntry[] spanning canon →
 * shared history, which is what a real "her life story so far" feature
 * needs and what neither existing module alone provides.
 *
 * Read-only merge, same as relationship-history-engine.ts: this module
 * never writes to any source, and never fabricates an entry that isn't
 * backed by one of the three inputs — same "never invent shared history"
 * rule aging-together-engine.ts and relationship-history-engine.ts both
 * already document.
 */

import { logger } from '@/lib/logger';
import type { ConsolidatedMemory } from '@/lib/ai/memory-consolidation';
import type { RelationshipHistoryEntry } from '@/lib/ai/relationship-history-engine';
import type { KnowledgeEntry } from '@/lib/ai/knowledge-library';

// ── Types ───────────────────────────────────────────────────────────────

export type TimelineSource = 'canon' | 'memory' | 'relationship';

export interface TimelineEntry {
  id: string;
  source: TimelineSource;
  title: string;
  description: string;
  /** ISO timestamp. Canon entries with no real date sort first (see below). */
  occurredAt: string;
  /** 0-100, comparable across sources — same scale
   *  relationship-history-engine.ts's `significance` already uses. */
  significance: number;
  tags: string[];
}

// Canon entries (knowledge-library.ts) predate the relationship and have
// no real timestamp — anchoring them here keeps them sorting before
// every relationship-scoped entry without needing a fabricated date.
const CANON_ANCHOR_DATE = '1970-01-01T00:00:00.000Z';

// ── Build ───────────────────────────────────────────────────────────────

export interface TimelineInputs {
  consolidatedMemories?: ConsolidatedMemory[];
  relationshipHistory?: RelationshipHistoryEntry[];
  canon?: KnowledgeEntry[];
}

/**
 * Merge all available sources into one chronological timeline. Any
 * input array can be omitted — a caller that only has memory-graph data
 * and no relationship-history-engine.ts read yet still gets a valid
 * (partial) timeline rather than an error.
 */
export function buildTimeline(inputs: TimelineInputs): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const m of inputs.consolidatedMemories ?? []) {
    entries.push({
      id: m.id,
      source: 'memory',
      title: m.title,
      description: m.description,
      occurredAt: m.period.from,
      significance: Math.round((m.emotional_weight / 10) * 100),
      tags: m.tags,
    });
  }

  for (const r of inputs.relationshipHistory ?? []) {
    entries.push({
      id: r.key,
      source: 'relationship',
      title: r.title,
      description: r.description ?? '',
      occurredAt: r.occurred_at,
      significance: r.significance,
      tags: [],
    });
  }

  for (const k of inputs.canon ?? []) {
    entries.push({
      id: k.id,
      source: 'canon',
      title: k.title,
      description: k.content,
      occurredAt: CANON_ANCHOR_DATE,
      significance: k.weight,
      tags: k.tags,
    });
  }

  const sorted = entries.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  logger.debug('[timeline-engine] built', {
    canon: inputs.canon?.length ?? 0,
    memory: inputs.consolidatedMemories?.length ?? 0,
    relationship: inputs.relationshipHistory?.length ?? 0,
    total: sorted.length,
  });

  return sorted;
}

// ── Read helpers ──────────────────────────────────────────────────────────

export function getTimelineWindow(
  timeline: TimelineEntry[],
  from: string,
  to: string,
): TimelineEntry[] {
  return timeline.filter(e => e.occurredAt >= from && e.occurredAt <= to);
}

/** Highest-significance entries, most significant first — the "highlight
 *  reel" cut of the timeline, same relationship the two docs above
 *  describe between a ledger and a highlight reel. */
export function getTopEntries(timeline: TimelineEntry[], limit: number): TimelineEntry[] {
  return [...timeline].sort((a, b) => b.significance - a.significance).slice(0, limit);
}

export function formatTimelineForPrompt(timeline: TimelineEntry[]): string {
  if (timeline.length === 0) return '';
  return `In order: ${timeline.map(e => e.title).join(' → ')}`;
}
