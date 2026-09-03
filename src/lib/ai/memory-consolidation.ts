/**
 * Memory Consolidation — Vantrix
 *
 * Base of a four-part chain that turns raw, per-event memory into a
 * character's own narratable life story:
 *
 *   memory-consolidation.ts  (this file) — merges repetitive raw memories
 *   timeline-engine.ts                   — orders consolidated memories +
 *                                           other history sources chronologically
 *   life-story.ts                        — segments the timeline into chapters
 *   autobiography-engine.ts              — public facade, prompt-ready narration
 *
 * memory-graph.ts already stores every meaningful moment as a MemoryNode,
 * and memory-compressor.ts already trims *that turn's* prompt injection
 * for token budget. Neither one addresses a different problem: six
 * "shared_joke" nodes about the same running bit are six separate rows
 * forever, even though a real memory doesn't work that way — repeated
 * similar experiences fold into one stronger, generalized memory ("we
 * have this joke about the coffee machine") rather than staying six
 * discrete ones. This module is that fold, run periodically (like sleep
 * consolidation, hence the name) rather than per-turn — it is not a
 * replacement for memory-compressor.ts's prompt-time trimming, and it
 * does not touch memory-graph.ts's storage itself; callers own writing
 * the result back (or not — see below).
 *
 * Deliberately pure / no I/O, same rationale as belief-update.ts and
 * belief-decay.ts: given an array of MemoryNode-shaped input, produce
 * consolidated output, and let the caller (a cron job, same cadence
 * class as backstory-engine.ts's periodic pass) decide whether/how to
 * persist it. That keeps this module trivially unit-testable and keeps
 * memory-graph.ts as the single owner of what's actually stored.
 */

import { logger } from '@/lib/logger';
import type { MemoryEventType, MemoryNode } from '@/lib/ai/memory-graph';

// ── Types ───────────────────────────────────────────────────────────────

export interface ConsolidatedMemory {
  id: string;
  event_type: MemoryEventType;
  /** Short, prompt-ready generalized title, e.g. "The coffee machine joke". */
  title: string;
  /** Generalized description covering the whole merged group. */
  description: string;
  /** Consolidation strengthens weight rather than averaging it — a
   *  repeated moment is more memorable than any single instance of it,
   *  not less. Capped at 10 to match MemoryNode's own scale. */
  emotional_weight: number;
  tags: string[];
  /** Ids of the MemoryNodes folded into this one. */
  sourceMemoryIds: string[];
  /** Earliest and latest created_at among the sources. */
  period: { from: string; to: string };
}

// Minimum same-type, same-tag nodes required before they're worth
// folding — two similar moments could still be coincidence, three+ is
// a real pattern (mirrors lesson-engine.ts's MIN_PATTERN_SIZE choice).
const MIN_GROUP_SIZE = 3;
// A node this emotionally weighty stands on its own regardless of how
// many similar nodes exist — a single first_meeting or confession isn't
// diluted into an average just because other moments cluster near it.
const STANDALONE_WEIGHT_THRESHOLD = 8;

// ── Grouping ────────────────────────────────────────────────────────────

function sharedTagKey(node: MemoryNode): string {
  // Group by event type + the node's most distinguishing tag (first
  // sorted tag) rather than the full tag set, so near-duplicates with
  // slightly different tag ordering/extras still fold together.
  const primaryTag = [...node.tags].sort()[0] ?? '';
  return `${node.event_type}::${primaryTag}`;
}

/**
 * Fold groups of 3+ similar, non-standout MemoryNodes into single
 * ConsolidatedMemory entries; leave standout nodes (high emotional
 * weight, or part of a group too small to count as a pattern) as
 * pass-through single-source "consolidated" entries so callers get one
 * uniform shape regardless of whether folding happened.
 */
export function consolidateMemories(nodes: MemoryNode[]): ConsolidatedMemory[] {
  const groups = new Map<string, MemoryNode[]>();
  const standalone: MemoryNode[] = [];

  for (const node of nodes) {
    if (node.emotional_weight >= STANDALONE_WEIGHT_THRESHOLD) {
      standalone.push(node);
      continue;
    }
    const groupKey = sharedTagKey(node);
    const list = groups.get(groupKey) ?? [];
    list.push(node);
    groups.set(groupKey, list);
  }

  const result: ConsolidatedMemory[] = [];

  for (const [groupKey, list] of groups) {
    if (list.length < MIN_GROUP_SIZE) {
      standalone.push(...list);
      continue;
    }
    result.push(foldGroup(groupKey, list));
  }

  for (const node of standalone) {
    result.push(passThrough(node));
  }

  logger.debug('[memory-consolidation] consolidated', {
    inputNodes: nodes.length,
    outputEntries: result.length,
  });

  return result.sort((a, b) => a.period.from.localeCompare(b.period.from));
}

function foldGroup(groupKey: string, list: MemoryNode[]): ConsolidatedMemory {
  const sorted = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const allTags = Array.from(new Set(list.flatMap(n => n.tags)));
  const [eventType] = groupKey.split('::');

  return {
    id: `consolidated-${groupKey}-${sorted[0].id}`,
    event_type: eventType as MemoryEventType,
    title: `A recurring ${eventType.replace(/_/g, ' ')}: ${sorted[0].title}`,
    description: `This has come up ${list.length} times — most recently: ${sorted[sorted.length - 1].description}`,
    // Repetition strengthens the memory: start from the max source weight
    // and nudge upward, capped at 10, rather than averaging it down.
    emotional_weight: Math.min(10, Math.max(...list.map(n => n.emotional_weight)) + 1),
    tags: allTags,
    sourceMemoryIds: sorted.map(n => n.id),
    period: { from: sorted[0].created_at, to: sorted[sorted.length - 1].created_at },
  };
}

function passThrough(node: MemoryNode): ConsolidatedMemory {
  return {
    id: `consolidated-single-${node.id}`,
    event_type: node.event_type,
    title: node.title,
    description: node.description,
    emotional_weight: node.emotional_weight,
    tags: node.tags,
    sourceMemoryIds: [node.id],
    period: { from: node.created_at, to: node.created_at },
  };
}

export function formatConsolidatedForPrompt(entries: ConsolidatedMemory[]): string {
  if (entries.length === 0) return '';
  return `Moments that stand out: ${entries.map(e => e.title).join('; ')}`;
}
