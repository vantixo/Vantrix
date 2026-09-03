/**
 * Reputation Engine — Companion Narrative Fame & Notoriety
 *
 * Distinct from social_status (civilization rank from status-legend.ts):
 *   - Reputation = how people *talk* about you (fame, notoriety, what you're known for)
 *   - Status     = your formal rank in the civic hierarchy
 *
 * Reputation drifts naturally over time. High-profile interactions (events,
 * milestones) shift it faster. A character can be famous and low-status,
 * or notorious and high-status — these are independent axes.
 */

import { supabaseAdmin }  from '@/lib/supabase/admin';
import { logger }         from '@/lib/logger';
import type { CompanionReputation, ReputationType } from '@/types/world-expansion';

// ── Public: Read ───────────────────────────────────────────────────────────────

export async function getReputation(characterId: string): Promise<CompanionReputation | null> {
  const { data, error } = await supabaseAdmin
    .from('companion_reputation')
    .select('*')
    .eq('character_id', characterId)
    .maybeSingle();

  if (error || !data) return null;
  return data as CompanionReputation;
}

// ── Public: Tick ───────────────────────────────────────────────────────────────

/**
 * Drift all reputations by a small natural decay/recovery.
 * Very famous or notorious characters regress slightly toward the mean;
 * unknown characters with recent activity may tick upward.
 */
export async function tickReputation(): Promise<{ processed: number }> {
  const { data: reps, error } = await supabaseAdmin
    .from('companion_reputation')
    .select('id, character_id, fame_score, notoriety_score, reputation_type')
    .gt('fame_score', 0)
    .limit(300);

  if (error || !reps) {
    logger.warn('reputation:tick:fetch-failed', { error });
    return { processed: 0 };
  }

  await Promise.allSettled(
    reps.map(async (rep) => {
      // Fame decays slightly (people forget), notoriety is stickier
      const newFame       = Math.max(0, rep.fame_score       - Math.floor(rep.fame_score       * 0.01));
      const newNotoriety  = Math.max(0, rep.notoriety_score  - Math.floor(rep.notoriety_score  * 0.005));
      const newType       = deriveReputationType(newFame, newNotoriety);

      if (newFame === rep.fame_score && newNotoriety === rep.notoriety_score) return;

      await supabaseAdmin
        .from('companion_reputation')
        .update({
          fame_score:      newFame,
          notoriety_score: newNotoriety,
          reputation_type: newType,
          updated_at:      new Date().toISOString(),
        })
        .eq('id', rep.id);
    }),
  );

  return { processed: reps.length };
}

// ── Public: Modify ─────────────────────────────────────────────────────────────

export async function applyFameEvent(
  characterId: string,
  fameDelta:   number,
  knownFor?:   string,
): Promise<void> {
  const current = await getReputation(characterId);

  const newFame      = Math.min(1000, Math.max(0, (current?.fame_score ?? 0) + fameDelta));
  const newNotoriety = current?.notoriety_score ?? 0;
  const knownForArr  = current?.known_for ?? [];
  if (knownFor && !knownForArr.includes(knownFor)) {
    knownForArr.push(knownFor);
  }

  await supabaseAdmin
    .from('companion_reputation')
    .upsert(
      {
        character_id:    characterId,
        fame_score:      newFame,
        notoriety_score: newNotoriety,
        reputation_type: deriveReputationType(newFame, newNotoriety),
        known_for:       knownForArr.slice(-5), // cap at 5 entries
        updated_at:      new Date().toISOString(),
      },
      { onConflict: 'character_id' },
    );
}

// ── Public: Prompt Formatter ───────────────────────────────────────────────────

export async function formatReputationForPrompt(characterId: string): Promise<string> {
  const rep = await getReputation(characterId);

  if (!rep || (rep.fame_score === 0 && rep.notoriety_score === 0)) return '';

  const lines: string[] = [];

  if (rep.fame_score > 200) {
    const label = FAME_LABELS.find((l) => rep.fame_score >= l.min)?.label ?? 'recognized';
    lines.push(`Reputation: ${label} (fame ${rep.fame_score}/1000)`);
  }
  if (rep.notoriety_score > 100) {
    lines.push(`Notoriety: ${rep.notoriety_score}/1000 — people have opinions`);
  }
  if (rep.known_for.length > 0) {
    lines.push(`Known for: ${rep.known_for.slice(0, 3).join(', ')}`);
  }

  if (lines.length === 0) return '';
  return `[Public Reputation]\n${lines.join('\n')}`;
}

// ── Internal ───────────────────────────────────────────────────────────────────

function deriveReputationType(fame: number, notoriety: number): ReputationType {
  if (notoriety > fame * 1.5)  return 'villain';
  if (fame > 500)              return 'celebrity';
  if (notoriety > 300)         return 'outlaw';
  if (fame > 200)              return 'hero';
  if (notoriety > 100)         return 'enigma';
  return 'neutral';
}

const FAME_LABELS = [
  { min: 800, label: 'legendary figure' },
  { min: 500, label: 'widely celebrated' },
  { min: 300, label: 'publicly known' },
  { min: 200, label: 'locally recognized' },
];
