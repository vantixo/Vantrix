/**
 * World Impact Engine — Permanent Traces of User Actions
 *
 * "Actions should permanently change the world." Most interactions (a
 * normal chat message, a small gift) nudge bond/psychology scores and stop
 * there — appropriately, since not every moment should become history.
 * This engine is the escalation path for the ones that matter: a
 * significant gift, a resolved milestone, a confession, a betrayal.
 *
 * Two tiers of permanence:
 *   1. Always logged to world_impact_events — a durable per-character trace,
 *      readable in formatWorldImpactForPrompt() and on a character's page.
 *   2. Promoted to universe_memory (via the existing record_universe_memory
 *      RPC, same one deep-tick.ts uses) when weight crosses PROMOTION_
 *      THRESHOLD — at that point it's not just "this character remembers
 *      this," it's world history: it shows up in world-history.ts's
 *      timeline, status-legend.ts's biography, everywhere universe_memory
 *      is read.
 *
 * This module owns the decision of what counts as significant; callers
 * (gift route, milestone checker, chat decision pipeline) just report what
 * happened and let recordWorldImpact() decide whether it echoes forward.
 *
 * ── 'betrayal' and 'sacrifice' sources: intentionally unwired ─────────────
 * Both are valid values of WorldImpactSource and both are handled correctly
 * by this module (see the switch below) — nothing here needs to change to
 * support them. The gap is entirely on the caller side: no call site in the
 * app currently reports either, because no existing user action carries the
 * *intent* either one requires.
 *
 * The nearest existing signal — bond decay into
 * dating_matches.relationship_state = 'estranged' (api/dating/mood/route.ts)
 * — was considered and rejected. That state is reached passively (low bond
 * from infrequent/low-effort chatting); a user going quiet is not the same
 * thing as betraying someone, and logging it as one would write false
 * permanent world history for ordinary disengagement.
 *
 * What each needs before it can be wired (product decision, not an
 * engineering blocker):
 *   - 'betrayal': a real user action with unambiguous intent to harm the
 *     relationship — e.g. an explicit "end things" / unmatch action, which
 *     does not exist anywhere in api/dating/* today (checked — no
 *     unmatch/breakup endpoint of any kind).
 *   - 'sacrifice': a real user action that costs the user something
 *     specifically for the character's benefit beyond an ordinary gift —
 *     e.g. spending a large token amount with no reward/reciprocity, or a
 *     dedicated "sacrifice" flow. The existing gift flow already reports
 *     'gift', so this needs to be a distinct action, not a bigger gift.
 *
 * Once either action exists, wiring it is the same three-line pattern the
 * milestone and gift call sites already use: call recordWorldImpact() with
 * source: 'betrayal' | 'sacrifice' inside an after() fire-and-forget block
 * at the new action's route handler. No changes needed in this file.
 */

import { supabaseAdmin }      from '@/lib/supabase/admin';
import { logger }             from '@/lib/logger';
import { logOfflineEntry }    from './life-engine';
import { invalidateHistoryCache } from './world-history';
import { getCoreDesire, classifyImpactAxis, nudgeFulfillment } from '@/lib/ai/desire-engine';
import type { WorldImpactEvent, WorldImpactSource, DesireAxis } from '@/types/world-expansion';

const PROMOTION_THRESHOLD = 65; // weight >= this crosses into permanent universe_memory

export interface RecordImpactInput {
  characterId:  string;
  userId:       string;
  source:       WorldImpactSource;
  title:        string;
  description:  string;
  /**
   * Generic, never-quotes-user-text summary — required, not derived
   * automatically, because only the caller knows whether `description`
   * contains verbatim user text (a gift message, a confession snippet).
   * This is the only field WorldImpactLog (public character page) may
   * render. See the privacy note on WorldImpactEvent in world-expansion.ts.
   */
  publicSummary: string;
  weight:       number; // 0-100 — caller's estimate of significance before desire-axis adjustment
  characterName?: string; // optional, saves a lookup when caller already has it
}

export interface RecordImpactResult {
  eventId:     string | null;
  promoted:    boolean;
  memoryId?:   string | null;
  desireAxis?: DesireAxis | null;
}

// ── Public: Record ──────────────────────────────────────────────────────────

export async function recordWorldImpact(input: RecordImpactInput): Promise<RecordImpactResult> {
  const desire = await getCoreDesire(input.characterId);
  const axis   = desire ? classifyImpactAxis(desire, `${input.title} ${input.description}`) : null;

  // A gift/action that lands on the character's actual core desire axis
  // matters more than a generic one of the same nominal weight — this is
  // the mechanical link between "you gave the right gift" and "this
  // actually changed something," rather than every gift being equivalent.
  const adjustedWeight = axis ? Math.min(100, input.weight + 15) : input.weight;

  const { data, error } = await supabaseAdmin
    .from('world_impact_events')
    .insert({
      character_id:   input.characterId,
      user_id:        input.userId,
      source:         input.source,
      title:          input.title,
      description:    input.description,
      public_summary: input.publicSummary,
      desire_axis:    axis,
      weight:         adjustedWeight,
    })
    .select('id')
    .single();

  if (error || !data) {
    logger.warn('world-impact:record:insert-failed', { input, error });
    return { eventId: null, promoted: false };
  }

  const eventId = data.id as string;

  // Nudge relationship-specific desire fulfillment so this actually feeds
  // back into future decision-engine scoring, not just a static log entry.
  if (axis && desire) {
    await nudgeFulfillment(input.characterId, input.userId, axisToNudge(axis, adjustedWeight)).catch(() => { /* non-critical */ });
  }

  // Always surface in the character's own offline log — visible in feeds
  // and formatLifeContextForPrompt() regardless of whether it's promoted.
  await logOfflineEntry(input.characterId, mapSourceToOfflineType(input.source), input.description, {
    world_impact_event_id: eventId, source: input.source, weight: adjustedWeight,
  }).catch(() => { /* non-critical */ });

  if (adjustedWeight < PROMOTION_THRESHOLD) {
    return { eventId, promoted: false, desireAxis: axis };
  }

  // ── Promote to permanent world history ────────────────────────────────
  const name = input.characterName ?? (await getCharacterName(input.characterId));
  const { data: memoryId, error: memErr } = await supabaseAdmin.rpc('record_universe_memory', {
    p_type:         'social',
    p_title:        input.title.slice(0, 200),
    p_description:  `${input.description}${name ? ` This is remembered as a defining moment for ${name}.` : ''}`.slice(0, 2000),
    p_participants: [input.characterId],
    p_location_id:  undefined,
    p_weight:       Math.round(adjustedWeight),
    p_legendary:    false,
  });

  if (memErr) {
    logger.warn('world-impact:promote:memory-insert-failed', { eventId, error: memErr });
    return { eventId, promoted: false, desireAxis: axis };
  }

  await supabaseAdmin.from('world_impact_events').update({ memory_id: memoryId }).eq('id', eventId);
  await invalidateHistoryCache().catch(() => { /* non-critical */ });

  logger.info('world-impact:promoted', { eventId, memoryId, characterId: input.characterId, weight: adjustedWeight });
  return { eventId, promoted: true, memoryId: memoryId as string, desireAxis: axis };
}

// ── Public: Read ─────────────────────────────────────────────────────────

export async function getRecentImpactEvents(characterId: string, limit = 10): Promise<WorldImpactEvent[]> {
  const { data, error } = await supabaseAdmin
    .from('world_impact_events')
    .select('*')
    .eq('character_id', characterId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return [];
  return data as WorldImpactEvent[];
}

export async function formatWorldImpactForPrompt(characterId: string, userId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('world_impact_events')
    .select('title, description, source, created_at')
    .eq('character_id', characterId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(3);

  if (error || !data || data.length === 0) return '';

  const lines = data.map((e: { description: string }) => `- ${e.description}`);
  return `[Moments that left a real mark]\n${lines.join('\n')}`;
}

// ── Internal helpers ─────────────────────────────────────────────────────

function axisToNudge(axis: DesireAxis, weight: number) {
  const magnitude = Math.round(weight / 10); // 0-10 scale nudge
  switch (axis) {
    case 'need':      return { need: magnitude };
    case 'want':       return { want: magnitude };
    case 'fear':        return { fear: magnitude };
    case 'obsession':  return { obsession: magnitude };
  }
}

function mapSourceToOfflineType(source: WorldImpactSource) {
  const map: Record<WorldImpactSource, 'relationship_change' | 'goal_progress'> = {
    gift:       'relationship_change',
    milestone:  'relationship_change',
    decision:   'goal_progress',
    betrayal:   'relationship_change',
    confession: 'relationship_change',
    sacrifice:  'relationship_change',
    // TYPECHECK FIX: WorldImpactSource gained these two rupture-repair-engine
    // values (see world-expansion.ts) but this map was never updated,
    // failing `tsc --noEmit` and — at runtime, before this fix — falling
    // through map[source] to `undefined` for any rupture event.
    rupture_repaired:   'relationship_change',
    rupture_unresolved: 'relationship_change',
  };
  return map[source];
}

async function getCharacterName(characterId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('characters').select('name').eq('id', characterId).maybeSingle();
  return data?.name ?? null;
}
