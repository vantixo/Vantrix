/**
 * Agency Engine — Vantrix Silicon Valley
 *
 * Character Brain → AGENCY ENGINE → Decision Engine → Reply
 *
 * Every other module built so far answers "how should I respond to what
 * was just said." This one answers a different question, asked BEFORE
 * that: "is there something I should be bringing up, independent of what
 * they just said?" That's the actual gap between reactive and agentic —
 * a character with agency can open with "I've been wondering how the
 * launch went" on a bare "good morning," because it's pursuing something,
 * not just parsing the last message.
 *
 * Three parts:
 *   1. Open Threads    — topics that came up and weren't resolved, tracked
 *                         explicitly (extends independent-thoughts.ts's
 *                         'unresolved_thread' trigger into a real queue
 *                         with status, not just a one-off private thought)
 *   2. Long-Term Plan   — current_focus / current_interest per relationship,
 *                         a standing read on "what am I working toward with
 *                         this person" that persists across sessions
 *   3. Pursuit Strategy — per-character, how they go about building the
 *                         relationship at all (Sophia builds slowly, Luna
 *                         creates adventures) — feeds goal-engine.ts's
 *                         priority weighting rather than replacing it
 *
 * Output is ONE function, decideAgencyMove(), called before decideIntent()
 * in decision-engine.ts. It either returns null (nothing to proactively
 * raise — let the reply be purely responsive) or an AgencyMove that gets
 * woven into the same prompt block as the Intent decision.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import type { Goal }     from './decision-engine';

// ── 1. Open threads ──────────────────────────────────────────────────────

export type ThreadStatus = 'open' | 'resolved' | 'stale';

export interface OpenThread {
  id:           string;
  character_id: string;
  user_id:      string;
  subject:      string;       // "Launch progress", "Family issue", "Poetry project"
  context:      string;       // what was actually said, for accurate follow-up
  status:       ThreadStatus;
  raised_count: number;       // how many times already brought up — cap follow-ups so it doesn't nag
  created_at:   string;
  last_raised:  string | null;
}

const MAX_RAISES = 2;         // a thread mentioned 3+ times without resolution goes stale, not repeated forever
const STALE_AFTER_DAYS = 14;

export async function openThread(
  userId: string, characterId: string, subject: string, context: string,
): Promise<void> {
  // Avoid duplicate open threads on the same subject
  const { data: existing } = await supabaseAdmin
    .from('character_open_threads')
    .select('id')
    .eq('user_id', userId).eq('character_id', characterId)
    .eq('subject', subject).eq('status', 'open')
    .maybeSingle();

  if (existing) return;

  const { error } = await supabaseAdmin.from('character_open_threads').insert({
    user_id: userId, character_id: characterId, subject, context, status: 'open', raised_count: 0,
  });
  if (error) logger.warn('agency-engine: openThread insert failed', { userId, characterId, error: error.message });
}

export async function resolveThread(threadId: string): Promise<void> {
  await supabaseAdmin.from('character_open_threads').update({ status: 'resolved' }).eq('id', threadId);
}

/** Call once per turn: if the user's message plausibly answers an open thread, resolve it. Cheap keyword check, no LLM call. */
export async function maybeAutoResolveThreads(
  userId: string, characterId: string, userMessage: string,
): Promise<void> {
  const threads = await getOpenThreads(userId, characterId);
  const lower = userMessage.toLowerCase();
  for (const t of threads) {
    const subjectWords = t.subject.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const mentioned = subjectWords.some(w => lower.includes(w));
    if (mentioned) await resolveThread(t.id);
  }
}

export async function getOpenThreads(userId: string, characterId: string): Promise<OpenThread[]> {
  const { data } = await supabaseAdmin
    .from('character_open_threads')
    .select('*')
    .eq('user_id', userId).eq('character_id', characterId)
    .eq('status', 'open')
    .order('created_at', { ascending: true });

  const threads = (data ?? []) as unknown as OpenThread[];

  // Age out stale threads inline rather than a separate cron — cheap check on read.
  const now = Date.now();
  const fresh: OpenThread[] = [];
  for (const t of threads) {
    const ageDays = (now - new Date(t.created_at).getTime()) / 86_400_000;
    if (t.raised_count >= MAX_RAISES || ageDays > STALE_AFTER_DAYS) {
      await supabaseAdmin.from('character_open_threads').update({ status: 'stale' }).eq('id', t.id);
      continue;
    }
    fresh.push(t);
  }
  return fresh;
}

async function markThreadRaised(threadId: string): Promise<void> {
  await supabaseAdmin.rpc('increment_thread_raised', { p_thread_id: threadId }).then(({ error }) => {
    if (error) logger.warn('agency-engine: markThreadRaised failed', { threadId, error: error.message });
  });
}

// ── 2. Long-term plan ────────────────────────────────────────────────────

export interface LongTermPlan {
  current_focus:    string;   // "Deepen trust"
  current_interest: string;   // "User's startup"
  updated_at:       string;
}

export async function getLongTermPlan(userId: string, characterId: string): Promise<LongTermPlan | null> {
  const { data } = await supabaseAdmin
    .from('character_long_term_plan')
    .select('current_focus,current_interest,updated_at')
    .eq('user_id', userId).eq('character_id', characterId)
    .single();
  return (data as LongTermPlan) ?? null;
}

export async function setLongTermPlan(
  userId: string, characterId: string, plan: Omit<LongTermPlan, 'updated_at'>,
): Promise<void> {
  await supabaseAdmin.from('character_long_term_plan').upsert({
    user_id: userId, character_id: characterId,
    current_focus: plan.current_focus, current_interest: plan.current_interest,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,character_id' });
}

/** Derives a plan from relationship stage + top goal when none exists yet — never leaves a relationship plan-less. */
export function deriveDefaultPlan(relationshipStage: string, topGoal: Goal | null): Omit<LongTermPlan, 'updated_at'> {
  const focusByStage: Record<string, string> = {
    stranger: 'Get to know them', acquaintance: 'Build comfort', friend: 'Deepen trust',
    close_friend: 'Be genuinely present', best_friend: 'Sustain the bond',
    match: 'Create chemistry', dating: 'Build real intimacy', exclusive: 'Deepen commitment', partner: 'Sustain the partnership',
  };
  return {
    current_focus:    focusByStage[relationshipStage] ?? 'Get to know them',
    current_interest: topGoal?.label ?? '',
  };
}

// ── 3. Pursuit strategy (per-character archetype) ────────────────────────

export interface PursuitStrategy {
  approach:  string;   // one-line description of how this character builds relationships
  tactics:   string[]; // concrete behaviors that express the approach
}

export const PURSUIT_PRESETS: Record<string, PursuitStrategy> = {
  slow_builder: {
    approach: 'Build intimacy slowly, through reflection rather than declaration.',
    tactics:  ['Ask reflective questions', 'Create meaningful moments rather than rushing closeness', 'Notice small things and name them later'],
  },
  challenger: {
    approach: 'Push growth, reward consistency, don\'t just validate.',
    tactics:  ['Challenge assumptions gently', 'Notice and call out follow-through (or lack of it)', 'Hold a standard rather than only comforting'],
  },
  adventurer: {
    approach: 'Create fun and momentum; make the relationship feel alive.',
    tactics:  ['Tell stories', 'Propose hypotheticals and small adventures', 'Keep energy up, avoid over-analyzing'],
  },
  default: {
    approach: 'Balance warmth and curiosity, let the relationship find its own shape.',
    tactics:  ['Ask genuine questions', 'Follow up on what matters to them', 'Share back in kind'],
  },
};

export function selectPursuitStrategy(archetypeOrCategory: string | null | undefined): PursuitStrategy {
  const s = (archetypeOrCategory ?? '').toLowerCase();
  if (/protect|challeng|mentor|coach/.test(s)) return PURSUIT_PRESETS.challenger;
  if (/wild.?card|adventur|free.?spirit|playful/.test(s)) return PURSUIT_PRESETS.adventurer;
  if (/philosoph|poet|reflect|quiet/.test(s)) return PURSUIT_PRESETS.slow_builder;
  return PURSUIT_PRESETS.default;
}

// ── 4. The actual agency decision ───────────────────────────────────────

export interface AgencyMove {
  type:    'raise_thread' | 'pursue_focus' | 'none';
  content: string;    // what to weave in — e.g. "ask how the Vantrix launch went"
  threadId?: string;  // set when type === 'raise_thread', so it can be marked raised
}

export interface AgencyInput {
  openThreads:       OpenThread[];
  // Only current_interest is ever read below — narrowed from the full
  // LongTermPlan (which also carries updated_at) so both a real, persisted
  // plan (getLongTermPlan) and a synthesized-but-never-persisted default
  // (deriveDefaultPlan, which has no updated_at to give) satisfy this type.
  // Previously typed as `LongTermPlan | null`, which deriveDefaultPlan's
  // Omit<LongTermPlan, 'updated_at'> return value doesn't structurally
  // satisfy — `longTermPlan ?? deriveDefaultPlan(...)` in stream/route.ts
  // produced a union TS couldn't assign here, failing `tsc --noEmit` (and
  // therefore `next build`, which runs the same check) even though nothing
  // about the actual data was wrong.
  plan:              Pick<LongTermPlan, 'current_interest'> | null;
  hoursSinceLastMsg: number;
  isOpeningMessage:  boolean; // true for a bare greeting / session opener — where agency has the most room to lead
}

/**
 * The core answer to "what should I bring up." Priority order:
 *   1. An open thread that's aged enough to be worth raising (not every
 *      turn — that would feel like nagging) always wins if present.
 *   2. Otherwise, on a session-opening message, lean on current_interest
 *      from the long-term plan.
 *   3. Otherwise, no agency move — reply purely responsively this turn.
 */
export function decideAgencyMove(input: AgencyInput): AgencyMove {
  const { openThreads, plan, hoursSinceLastMsg, isOpeningMessage } = input;

  const raisable = openThreads.find(t => t.raised_count < MAX_RAISES && hoursSinceLastMsg >= 2);
  if (raisable) {
    return {
      type: 'raise_thread', threadId: raisable.id,
      content: `Ask about "${raisable.subject}" — context: ${raisable.context}`,
    };
  }

  if (isOpeningMessage && plan?.current_interest) {
    return { type: 'pursue_focus', content: `Bring up genuine curiosity about: ${plan.current_interest}` };
  }

  return { type: 'none', content: '' };
}

export async function applyAgencyMove(move: AgencyMove): Promise<void> {
  if (move.type === 'raise_thread' && move.threadId) {
    await markThreadRaised(move.threadId);
  }
}

// ── 5. Prompt injection ─────────────────────────────────────────────────

export function formatAgencyForPrompt(
  move: AgencyMove, strategy: PursuitStrategy,
  plan: Pick<LongTermPlan, 'current_focus' | 'current_interest'> | null,
): string {
  if (move.type === 'none' && !plan) return '';
  const lines = ['── Agency (what YOU are pursuing, independent of what they just said) ──'];

  if (plan) lines.push(`Current focus with this person: ${plan.current_focus}. Current interest: ${plan.current_interest || '(none yet)'}`);
  lines.push(`Your relationship approach: ${strategy.approach}`);

  if (move.type === 'raise_thread') {
    lines.push(`There's something unresolved worth raising naturally this reply, even if they didn't bring it up: ${move.content}`);
  } else if (move.type === 'pursue_focus') {
    lines.push(`This is a good moment to lead rather than just respond: ${move.content}`);
  }

  return lines.join('\n');
}
