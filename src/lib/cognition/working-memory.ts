/**
 * Working Memory — Vantrix Cognition Layer
 *
 * Everything in src/lib/ai/ computes something *this turn* (drives, goals,
 * confidence, attention) but none of it persists between turns except
 * through what gets written back to durable storage (memory-graph.ts,
 * relationship-engine.ts, etc). There was nothing holding the small,
 * fast-decaying set of "what's live right now" items across a handful of
 * turns — the conversational equivalent of a scratchpad, as opposed to
 * long-term memory. That's what this module is: a bounded, decaying
 * buffer of WorkingMemoryItems, scoped per (userId, characterId), kept
 * in-process (not Redis — this is deliberately cheaper and lossier than
 * durable memory; losing it on a server restart is fine).
 *
 * This is the "global workspace" in the loose cognitive-architecture
 * sense used by consciousness-loop.ts: attention-engine.ts decides what's
 * salient enough to be *written* here, executive-controller.ts (this
 * directory) reads from it when making a decision, and consciousness-loop.ts
 * is what actually advances it turn over turn (decay, eviction, commit).
 */

export type WorkingMemoryKind =
  | 'open_thread'      // a question or topic the conversation left dangling
  | 'active_task'      // mirrors ai/task-manager.ts's active task, cached locally
  | 'emotional_beat'    // a notable emotional moment worth not immediately forgetting
  | 'surfaced_fact'     // a fact pulled from memory-graph.ts and currently "in mind"
  | 'commitment'        // something she said she'd do/remember
  | 'watch_flag';       // safety/moderation-relevant note to keep attending to

export interface WorkingMemoryItem {
  id:  string;
  kind: WorkingMemoryKind;
  /** Short, prompt-ready description of the item. */
  summary: string;
  /** 0–1. Starting salience; decays each turn via DECAY_RATE. */
  activation: number;
  createdAtTurn: number;
  lastTouchedTurn: number;
  /** Arbitrary payload for callers that need more than `summary`. */
  data?: Record<string, unknown>;
}

export interface WorkingMemoryState {
  userId: string;
  characterId: string;
  turn: number;
  items: WorkingMemoryItem[];
}

const CAPACITY = 12;
const DECAY_RATE = 0.15;
const EVICTION_THRESHOLD = 0.05;

const store = new Map<string, WorkingMemoryState>();

function key(userId: string, characterId: string): string {
  return `${userId}::${characterId}`;
}

export function getWorkingMemory(userId: string, characterId: string): WorkingMemoryState {
  const k = key(userId, characterId);
  let state = store.get(k);
  if (!state) {
    state = { userId, characterId, turn: 0, items: [] };
    store.set(k, state);
  }
  return state;
}

/**
 * Advance the buffer by one turn: decay every item's activation, evict
 * anything that's faded below EVICTION_THRESHOLD, and enforce capacity by
 * dropping the least-activated items first. Call once per turn, before
 * reading — consciousness-loop.ts owns this call so no other module needs
 * to remember to do it.
 */
export function tick(userId: string, characterId: string): WorkingMemoryState {
  const state = getWorkingMemory(userId, characterId);
  state.turn += 1;
  state.items = state.items
    .map(item => ({ ...item, activation: item.activation * (1 - DECAY_RATE) }))
    .filter(item => item.activation >= EVICTION_THRESHOLD);

  if (state.items.length > CAPACITY) {
    state.items.sort((a, b) => b.activation - a.activation);
    state.items = state.items.slice(0, CAPACITY);
  }
  return state;
}

/**
 * Write or refresh an item. Writing an existing id boosts its activation
 * back up and marks it touched this turn rather than duplicating it —
 * repetition is itself a salience signal (an open thread the user keeps
 * circling back to should get harder to forget, not accumulate copies).
 */
export function commit(
  userId: string,
  characterId: string,
  item: Omit<WorkingMemoryItem, 'createdAtTurn' | 'lastTouchedTurn'> & Partial<Pick<WorkingMemoryItem, 'createdAtTurn'>>,
): WorkingMemoryItem {
  const state = getWorkingMemory(userId, characterId);
  const existing = state.items.find(i => i.id === item.id);

  if (existing) {
    existing.activation = Math.min(1, Math.max(existing.activation, item.activation));
    existing.summary = item.summary;
    existing.data = item.data ?? existing.data;
    existing.lastTouchedTurn = state.turn;
    return existing;
  }

  const created: WorkingMemoryItem = {
    ...item,
    createdAtTurn: item.createdAtTurn ?? state.turn,
    lastTouchedTurn: state.turn,
  };
  state.items.push(created);
  return created;
}

export function forget(userId: string, characterId: string, id: string): void {
  const state = getWorkingMemory(userId, characterId);
  state.items = state.items.filter(i => i.id !== id);
}

export function peek(userId: string, characterId: string, kind?: WorkingMemoryKind): WorkingMemoryItem[] {
  const state = getWorkingMemory(userId, characterId);
  const items = kind ? state.items.filter(i => i.kind === kind) : state.items;
  return [...items].sort((a, b) => b.activation - a.activation);
}

/** Pure formatter — same rendering `formatWorkingMemoryForPrompt` uses,
 *  but takes an already-resolved item list instead of peeking the store
 *  itself. Lets callers that received a `workingMemoryOverride` (see
 *  cognition/executive-controller.ts) render from exactly the items they
 *  were given, rather than silently re-peeking current store state and
 *  risking the rendered text disagreeing with the override. */
export function formatWorkingMemoryItemsForPrompt(items: WorkingMemoryItem[]): string {
  if (items.length === 0) return '';
  const lines = items.map(i => `- [${i.kind}] ${i.summary}`);
  return `Currently in mind:\n${lines.join('\n')}`;
}

/** Prompt-ready rendering of whatever's still live, most salient first. */
export function formatWorkingMemoryForPrompt(userId: string, characterId: string): string {
  return formatWorkingMemoryItemsForPrompt(peek(userId, characterId));
}

/** Test/reset hook — clears the in-process buffer for one participant. */
export function resetWorkingMemory(userId: string, characterId: string): void {
  store.delete(key(userId, characterId));
}
