/**
 * Task Manager — Vantrix
 *
 * goal-selector.ts picks *what she's generally trying to do* this turn
 * ("deepen bond with this user"). That's still too abstract to act on
 * directly — this module breaks a selected goal into a concrete,
 * trackable ConversationalTask ("ask about how the job interview went")
 * and persists a short queue of these across turns, so a task that
 * doesn't get completed this turn (the user changed the subject) isn't
 * simply lost — it can resurface naturally a turn or two later instead of
 * either forcing it in or forgetting it ever mattered.
 *
 * Storage: Redis, per (user, character), short TTL — this is working
 * memory for the current stretch of conversation, not a durable record;
 * memory-graph.ts is where anything actually worth remembering long-term
 * ends up once a task completes.
 */

import { logger } from '@/lib/logger';
import { redis }  from '@/lib/redis';

import type { SelectedGoal } from '@/lib/ai/goal-selector';

// ── Config ──────────────────────────────────────────────────────────────

const QUEUE_TTL = 60 * 60 * 6; // 6 hours — spans a conversation session, not much longer
const MAX_QUEUE = 5;
const MAX_ATTEMPTS_BEFORE_DROP = 3; // a task that keeps failing to fit isn't worth carrying forever

// ── Types ───────────────────────────────────────────────────────────────

export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'dropped';

export interface ConversationalTask {
  id:          string;
  goalId:      string;
  label:       string;    // concrete, this-turn-actionable — "ask how the interview went"
  status:      TaskStatus;
  createdAt:   number;
  attempts:    number;    // number of turns this has been eligible but not completed
  lastAttemptAt: number | null;
}

export interface TaskQueue {
  tasks:      ConversationalTask[];
  updatedAt:  number;
}

// ── Redis key ───────────────────────────────────────────────────────────

function queueKey(userId: string, characterId: string): string {
  return `vantrix:task-manager:${userId}:${characterId}`;
}

function slugId(): string {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function emptyQueue(): TaskQueue {
  return { tasks: [], updatedAt: Date.now() };
}

// ── Storage ─────────────────────────────────────────────────────────────

export async function getTaskQueue(userId: string, characterId: string): Promise<TaskQueue> {
  try {
    const q = await redis.get<TaskQueue>(queueKey(userId, characterId));
    return q ?? emptyQueue();
  } catch (err) {
    logger.warn('[task-manager] Redis get failed', { userId, characterId, error: String(err) });
    return emptyQueue();
  }
}

async function saveTaskQueue(userId: string, characterId: string, queue: TaskQueue): Promise<void> {
  try {
    await redis.set(queueKey(userId, characterId), queue, { ex: QUEUE_TTL });
  } catch (err) {
    logger.warn('[task-manager] save failed', { userId, characterId, error: String(err) });
  }
}

// ── Decomposition ───────────────────────────────────────────────────────

/**
 * Heuristic, deterministic decomposition of a selected goal into a
 * concrete task label. Deliberately simple templating rather than an AI
 * call — this needs to run inline, every turn, and the point is a nudge
 * toward action, not a creative rewrite of the goal.
 */
function decompose(goal: SelectedGoal): string {
  const label = goal.goal.label.toLowerCase();

  if (goal.goal.category === 'relationship') {
    return `find a natural moment to ${label.includes('deepen') ? 'go a little deeper than small talk' : label}`;
  }
  if (goal.goal.category === 'ambition') {
    return `look for a natural opening to mention progress on: ${goal.goal.label}`;
  }
  return `stay mindful of: ${goal.goal.label}`;
}

/**
 * Ensure the queue has a task for the currently selected goal, without
 * duplicating one that already exists for the same goal. Call this once
 * per turn after goal-selector.ts runs.
 */
export async function ensureTaskForGoal(
  userId: string,
  characterId: string,
  selected: SelectedGoal | null,
): Promise<TaskQueue> {
  const queue = await getTaskQueue(userId, characterId);
  if (!selected) return queue;

  const alreadyQueued = queue.tasks.some(t => t.goalId === selected.goal.id && t.status !== 'dropped' && t.status !== 'done');
  if (alreadyQueued) return queue;

  const task: ConversationalTask = {
    id: slugId(),
    goalId: selected.goal.id,
    label: decompose(selected),
    status: 'pending',
    createdAt: Date.now(),
    attempts: 0,
    lastAttemptAt: null,
  };

  let tasks = [...queue.tasks, task];
  if (tasks.length > MAX_QUEUE) {
    tasks = tasks.filter(t => t.status !== 'dropped').slice(-MAX_QUEUE);
  }

  const updated: TaskQueue = { tasks, updatedAt: Date.now() };
  await saveTaskQueue(userId, characterId, updated);
  return updated;
}

/** The single highest-priority pending/in-progress task, if any — what this turn should actually try to act on. */
export function nextActionableTask(queue: TaskQueue): ConversationalTask | null {
  const eligible = queue.tasks.filter(t => t.status === 'pending' || t.status === 'in_progress');
  if (!eligible.length) return null;
  return [...eligible].sort((a, b) => a.createdAt - b.createdAt)[0]!; // oldest pending task gets priority — avoids a new task perpetually jumping the queue
}

/**
 * Mark that a task was attempted this turn but didn't fully resolve (the
 * conversation didn't naturally allow for it). After MAX_ATTEMPTS_BEFORE_DROP
 * it's dropped rather than carried indefinitely.
 */
export async function recordAttempt(userId: string, characterId: string, taskId: string): Promise<TaskQueue> {
  const queue = await getTaskQueue(userId, characterId);
  const tasks = queue.tasks.map((t) => {
    if (t.id !== taskId) return t;
    const attempts = t.attempts + 1;
    return {
      ...t,
      attempts,
      lastAttemptAt: Date.now(),
      status: attempts >= MAX_ATTEMPTS_BEFORE_DROP ? ('dropped' as TaskStatus) : ('in_progress' as TaskStatus),
    };
  });

  const updated: TaskQueue = { tasks, updatedAt: Date.now() };
  await saveTaskQueue(userId, characterId, updated);
  return updated;
}

export async function completeTask(userId: string, characterId: string, taskId: string): Promise<TaskQueue> {
  const queue = await getTaskQueue(userId, characterId);
  const tasks = queue.tasks.map(t => (t.id === taskId ? { ...t, status: 'done' as TaskStatus } : t));
  const updated: TaskQueue = { tasks, updatedAt: Date.now() };
  await saveTaskQueue(userId, characterId, updated);
  logger.info('task-manager:completed', { userId, characterId, taskId });
  return updated;
}

// ── Prompt injection ───────────────────────────────────────────────────

export function formatTaskForPrompt(task: ConversationalTask | null): string {
  if (!task) return '';
  const patience = task.attempts === 0 ? '' : ' — this hasn\'t come up naturally yet, so don\'t force it, but stay open to the opening';
  return `# Something Worth Working Toward This Turn, If It Fits Naturally\n${task.label}${patience}.`;
}
