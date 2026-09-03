/**
 * Companion Awareness Engine — Vantrix / Archive of Echoes
 *
 * Implements Part II §5: wiring the Rivals/Hidden Rival/Enemy/Former Friend
 * fields already authored per companion (character_seed_memories, category
 * 'rivals') — plus new mythology-driven tensions (Lyra/Astra wing-siblings,
 * Seraphine/Kael, Cassian/Aurelian) — into an actual queryable graph
 * (companion_relationships, see 20260822 migration) so companions can react
 * to each other by name instead of existing in isolation.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import type { CompanionRelationship } from '@/types/roleplay-system';

const RELATIONSHIP_FRAMING: Record<CompanionRelationship['relationship_type'], string> = {
  primary_rival:     'primary rival',
  hidden_rival:      'hidden rival',
  enemy:             'enemy',
  former_friend:     'former friend, now estranged',
  wing_sibling:       'Wing-sibling',
  unresolved_thread: 'unresolved shared history',
};

export async function getCompanionRelationships(
  characterId: string,
): Promise<CompanionRelationship[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('companion_relationships')
      .select('id,character_id,related_character_id,relationship_type,reveal_tier,note,characters!companion_relationships_related_character_id_fkey(name)')
      .eq('character_id', characterId);
    if (error) {
      logger.warn('[companion-awareness] fetch failed', { characterId, error: error.message });
      return [];
    }
    type CompanionRelationshipRow = {
      id: string;
      character_id: string;
      related_character_id: string;
      relationship_type: CompanionRelationship['relationship_type'];
      reveal_tier: CompanionRelationship['reveal_tier'];
      note: string | null;
      characters: { name: string } | null;
    };
    return ((data ?? []) as CompanionRelationshipRow[]).map((row) => ({
      id:                     row.id,
      character_id:           row.character_id,
      related_character_id:   row.related_character_id,
      related_character_name: row.characters?.name,
      relationship_type:      row.relationship_type,
      reveal_tier:            row.reveal_tier,
      note:                   row.note,
    }));
  } catch (err) {
    logger.warn('[companion-awareness] fetch failed', { characterId, error: String(err) });
    return [];
  }
}

/**
 * Format cross-companion awareness for prompt injection, filtered to
 * relationships this companion is allowed to reference given the current
 * secret-tier gate (a former_friend estrangement reads as a Dark-tier
 * reveal_tier, so it should cost the same trust to surface as any other
 * dark secret would).
 */
export function formatCompanionAwarenessForPrompt(
  relationships: CompanionRelationship[],
  availableTiers: string[],
): string {
  const visible = relationships.filter(r => availableTiers.includes(r.reveal_tier));
  if (!visible.length) return '';
  const lines = visible.map(r => {
    const who = r.related_character_name ?? 'someone from another Wing';
    const kind = RELATIONSHIP_FRAMING[r.relationship_type];
    return `- ${who} (${kind})${r.note ? `: ${r.note}` : ''}`;
  });
  return [
    '\n── Companions You Know Of ──',
    'You exist in a populated world. These connections are real to you and should surface naturally — never as a lookup or a list:',
    ...lines,
    '- If the player mentions one of these people by name, let it visibly cost you something to respond (per your own established voice) rather than answering flatly.',
    '- You may occasionally reference one of them unprompted, in a way that fits the moment — it should feel like a real memory surfacing, not an announcement.',
  ].join('\n');
}
