/**
 * Life Story — Vantrix
 *
 * Third layer of the memory-consolidation → timeline → life-story →
 * autobiography chain (see memory-consolidation.ts's header).
 * timeline-engine.ts answers "what happened, in order" — a flat,
 * complete ledger, deliberately unopinionated about meaning (same
 * design choice relationship-history-engine.ts made for the
 * relationship-scoped subset of this data). Nobody narrates their life
 * as a flat list, though — a real autobiography groups events into
 * chapters with a throughline ("the early days", "when things got
 * hard", "who we are now"). This module is that grouping: it segments
 * a TimelineEntry[] into LifeChapters, each with a short narrative
 * summary, so autobiography-engine.ts has structure to narrate from
 * instead of having to invent it at generation time.
 *
 * Chapter boundaries are drawn on two structural signals only — never
 * on generated content, to keep this module pure and cheap:
 *   1. A time gap between consecutive entries larger than GAP_THRESHOLD_MS
 *      ("then nothing happened for a while" is itself a chapter break).
 *   2. A source-composition shift — a run of canon entries giving way to
 *      a run of relationship/memory entries is the "before you" →
 *      "since you" break every character's life story has by
 *      construction (canon entries are always earlier — see
 *      timeline-engine.ts's CANON_ANCHOR_DATE).
 *
 * Pure / no I/O, same rationale as the rest of this chain — this module
 * never talks to Supabase or an LLM; autobiography-engine.ts is where
 * chapters actually become prose.
 */

import { logger } from '@/lib/logger';
import type { TimelineEntry, TimelineSource } from '@/lib/ai/timeline-engine';

// ── Types ───────────────────────────────────────────────────────────────

export interface LifeChapter {
  id: string;
  title: string;
  span: { from: string; to: string };
  /** Dominant source in this chapter — informs the tone
   *  autobiography-engine.ts should narrate it in. */
  dominantSource: TimelineSource;
  entries: TimelineEntry[];
  /** Compact, prompt-ready summary of the chapter — not full prose,
   *  same "compact narrative" register reflection-engine.ts's
   *  SessionReflection.summary uses. */
  narrativeSummary: string;
}

// A gap bigger than ~30 days between consecutive entries is treated as
// a chapter break — long enough to be a real lull, short enough that
// ordinary between-session gaps don't fragment the story pointlessly.
const GAP_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

const CHAPTER_TITLES: Record<TimelineSource, string> = {
  canon: 'Before we met',
  memory: 'Moments we\'ve shared',
  relationship: 'How things have grown',
};

// ── Segmentation ──────────────────────────────────────────────────────────

/**
 * Segment a chronological timeline into LifeChapters. Entries are
 * assumed pre-sorted (as timeline-engine.ts's buildTimeline() already
 * guarantees) — this function does not re-sort, so a caller passing an
 * unsorted slice will get an unsorted (likely wrong) chapter break.
 */
export function deriveChapters(timeline: TimelineEntry[]): LifeChapter[] {
  if (timeline.length === 0) return [];

  const chapters: LifeChapter[] = [];
  let current: TimelineEntry[] = [timeline[0]];

  for (let i = 1; i < timeline.length; i++) {
    const prev = timeline[i - 1];
    const entry = timeline[i];

    const gapMs = Date.parse(entry.occurredAt) - Date.parse(prev.occurredAt);
    // Only treat a source change as a chapter break once the current
    // chapter already has an established run (length > 1) — a single
    // entry that happens to differ from the one before it isn't a real
    // shift yet, just the start of one; the break lands on the *next*
    // entry that confirms the new source is here to stay.
    const sourceShift = entry.source !== current[current.length - 1].source && current.length > 1;

    if (gapMs > GAP_THRESHOLD_MS || sourceShift) {
      chapters.push(toChapter(current, chapters.length));
      current = [entry];
    } else {
      current.push(entry);
    }
  }
  chapters.push(toChapter(current, chapters.length));

  logger.debug('[life-story] derived chapters', {
    entries: timeline.length,
    chapters: chapters.length,
  });

  return chapters;
}

function toChapter(entries: TimelineEntry[], index: number): LifeChapter {
  const counts = new Map<TimelineSource, number>();
  for (const e of entries) counts.set(e.source, (counts.get(e.source) ?? 0) + 1);
  const dominantSource = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const highlights = [...entries]
    .sort((a, b) => b.significance - a.significance)
    .slice(0, 3)
    .map(e => e.title);

  return {
    id: `chapter-${index}`,
    title: CHAPTER_TITLES[dominantSource],
    span: { from: entries[0].occurredAt, to: entries[entries.length - 1].occurredAt },
    dominantSource,
    entries,
    narrativeSummary: highlights.length > 0 ? highlights.join('; ') : '',
  };
}

export function formatLifeStoryForPrompt(chapters: LifeChapter[]): string {
  if (chapters.length === 0) return '';
  return chapters
    .filter(c => c.narrativeSummary)
    .map(c => `${c.title}: ${c.narrativeSummary}`)
    .join('\n');
}
