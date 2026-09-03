/**
 * Goal Engine + Decision Log — Vantrix Silicon Valley
 *
 * Table mapping against the 8 tables requested — most already exist under
 * different names from earlier sessions; only two are genuinely new here:
 *
 *   character_goals             → NEW (this file)      — characters.current_goal was a single string; this is the real multi-goal engine
 *   character_emotions          → EXISTING              → character_psychology + emotion-engine.ts (in-process, not persisted per-message by design — see emotion-engine.ts header)
 *   character_relationships     → EXISTING              → character_relationships (relationship-engine.ts)
 *   character_decisions         → NEW (this file)       — logs every Intent decision for consistency + debugging
 *   character_daily_journal     → EXISTING               → character_journal (daily-journal.ts)
 *   character_internal_thoughts → EXISTING               → character_thoughts (independent-thoughts.ts)
 *   character_milestones        → EXISTING               → relationship_milestones (relationship-milestones.ts)
 *   character_behavior_profiles → EXISTING               → characters.writing_style + voice_profile (digital-person-bootstrap.ts)
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import type { Goal, Intent, IntentDecision } from './decision-engine';

// ── Goal engine ──────────────────────────────────────────────────────────

export async function getActiveGoals(characterId: string, userId: string): Promise<Goal[]> {
  const { data } = await supabaseAdmin
    .from('character_goals')
    .select('id,label,priority,category')
    .eq('character_id', characterId)
    .or(`user_id.is.null,user_id.eq.${userId}`) // global ambitions (user_id null) + this-relationship-specific goals
    .eq('active', true)
    .order('priority', { ascending: false })
    .limit(6);

  return (data ?? []) as unknown as Goal[];
}

export async function upsertGoal(
  characterId: string,
  userId:      string | null, // null = global goal (e.g. "finish the book"), set = relationship-specific (e.g. "deepen bond with this user")
  goal:        Omit<Goal, 'id'> & { id?: string },
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('character_goals')
    .upsert({
      id:           goal.id,
      character_id: characterId,
      user_id:      userId,
      label:        goal.label,
      priority:     goal.priority,
      category:     goal.category,
      active:       true,
      updated_at:   new Date().toISOString(),
    });

  if (error) logger.warn('goal-engine: upsert failed', { characterId, error: error.message });
}

export async function completeGoal(goalId: string): Promise<void> {
  await supabaseAdmin.from('character_goals').update({ active: false, completed_at: new Date().toISOString() }).eq('id', goalId);
}

/** Every character should always have at least one relationship goal per user — called lazily on first contact, same pattern as ensureRelationship(). */
export async function ensureDefaultRelationshipGoal(characterId: string, userId: string): Promise<void> {
  const { count } = await supabaseAdmin
    .from('character_goals')
    .select('id', { count: 'exact', head: true })
    .eq('character_id', characterId)
    .eq('user_id', userId);

  if ((count ?? 0) > 0) return;

  await upsertGoal(characterId, userId, {
    label:    'Build a real connection with this person',
    priority: 0.7,
    category: 'relationship',
  });
}

// ── Decision log ─────────────────────────────────────────────────────────
// Every Intent decision is logged. This is what lets you audit "why did
// Sophia respond that way on Tuesday" and, longer term, retrain the
// scoring weights against which decisions actually landed well (see
// recordDecisionOutcome).

export interface LoggedDecision {
  id:           string;
  character_id: string;
  user_id:      string;
  intent:       Intent;
  confidence:   number;
  scores:       Record<Intent, number>;
  monologue:    string;
  created_at:   string;
  outcome?:     'positive' | 'neutral' | 'negative' | null;
}

export async function logDecision(
  userId:      string,
  characterId: string,
  decision:    IntentDecision,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('character_decisions')
    .insert({
      user_id:      userId,
      character_id: characterId,
      intent:       decision.intent,
      confidence:   decision.confidence,
      scores:       decision.scores,
      monologue:    decision.monologue,
    })
    .select('id')
    .single();

  if (error) {
    logger.warn('decision-log: insert failed', { userId, characterId, error: error.message });
    return null;
  }
  return data?.id ?? null;
}

/** Recent decision history — used to avoid repeating the same intent turn after turn (e.g. always Comfort reads as one-note). */
export async function getRecentIntents(userId: string, characterId: string, limit = 5): Promise<Intent[]> {
  const { data } = await supabaseAdmin
    .from('character_decisions')
    .select('intent')
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data ?? []).map((r: { intent: string }) => r.intent as Intent);
}

/**
 * Optional feedback hook — call from a thumbs-up/down or from downstream
 * signals (user disengaged right after vs. conversation deepened) to mark
 * how a decision landed. Not consumed anywhere yet; this is the hook point
 * for eventually tuning scoreIntents() weights against real outcomes.
 */
export async function recordDecisionOutcome(decisionId: string, outcome: 'positive' | 'neutral' | 'negative'): Promise<void> {
  await supabaseAdmin.from('character_decisions').update({ outcome }).eq('id', decisionId);
}
