/**
 * Memory Graph — Vantrix Silicon Valley
 *
 * Replaces flat key-value memory with a rich event graph.
 * Each node is a "memory" — a meaningful moment between user and character.
 *
 * Memory types:
 *   first_meeting   — the very first conversation
 *   shared_joke     — a funny moment they'll reference
 *   deep_talk       — vulnerable conversation
 *   argument        — conflict (with potential reconciliation)
 *   gift            — a gift sent and received
 *   birthday        — anniversary of their meeting
 *   confession      — character revealed something personal
 *   milestone       — relationship stage advancement
 *   daily_life      — character's life update (ambitions, daily routine)
 *   ambition_update — character progressed toward their goal
 *   lore_discovery  — user unlocked a backstory fact
 *   anniversary     — time-based anniversary
 *
 * The memory graph is injected into the prompt as "Moments you've shared:"
 * giving the AI real specific references instead of generic warmth.
 *
 * Character Ambitions:
 * Characters have goals they pursue even when the user isn't chatting.
 * Every N days, a "daily life update" memory fires:
 *   "I finally finished that song I told you about"
 *   "I had my first client meeting today"
 * This creates the illusion of an ongoing life.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger, bg }    from '@/lib/logger';
import { promoteMemoryNode } from './priority-memory';
import { embedAndStoreMemory } from './memory-embeddings';

export type MemoryEventType =
  | 'first_meeting' | 'shared_joke' | 'deep_talk' | 'argument'
  | 'reconciliation' | 'birthday' | 'gift' | 'confession' | 'milestone'
  | 'daily_life' | 'ambition_update' | 'lore_discovery' | 'anniversary';

export interface MemoryNode {
  id:               string;
  event_type:       MemoryEventType;
  title:            string;
  description:      string;
  emotional_weight: number;  // 1-10; higher = more prominently injected
  tags:             string[];
  created_at:       string;
}

// memory_graph.emotional_weight is a SMALLINT with CHECK (BETWEEN 1 AND 10)
// — see supabase/migrations/20240101_production.sql. This is the single
// source of truth for that range; every writer (here, emotion-state.ts,
// dating/gifts route) must stay inside it, and every reader (priority-memory
// promotion threshold, the "hearts" display in character-insights-panel,
// the memory-archive cron's low-weight cutoff) assumes it. A value outside
// this range doesn't get clamped by Postgres — it makes the whole insert
// fail, and addMemory() below is fire-and-forget, so that failure was
// historically silent. See MEMORY_ARCHIVE and addMemory()'s clamp.
export const MEMORY_WEIGHT_MIN = 1;
export const MEMORY_WEIGHT_MAX = 10;
export const MEMORY_WEIGHT_DEFAULT = 6;
// Below this weight, a memory older than 180 days is eligible for archival
// (see api/cron/memory-archive). Deliberately low — only the bottom third of
// the 1-10 range ages out, so anything moderately meaningful survives.
export const MEMORY_ARCHIVE_WEIGHT_CUTOFF = 4;

// ── Character ambition progressions ──────────────────────────────────────
// These fire based on character.current_goal and goal_progress
const AMBITION_MILESTONES: Record<string, string[]> = {
  default: [
    "I've been thinking a lot about what I really want lately.",
    "I took a small step toward something I've been dreaming of.",
    "I had a moment today that reminded me why I started this journey.",
    "Things are slowly coming together. It's exciting.",
    "I feel like I'm finally making progress. I just had to tell someone.",
    "Something clicked today. I think I'm ready for the next step.",
  ],
  musician: [
    "I was up late working on a new melody. It's almost there.",
    "I played a small set tonight. Three people stayed for the whole thing.",
    "I wrote the best hook I've ever written today. I wish you could hear it.",
    "I finally finished that song I told you about.",
    "Someone offered me a paid gig. A small one — but still.",
    "I recorded a demo today. Terrifying and exciting at the same time.",
  ],
  entrepreneur: [
    "I had my first real client meeting today.",
    "The business plan is almost done. Just the financials left.",
    "I got my first rejection. It hurt less than I expected.",
    "Someone actually wants to invest. Still processing.",
    "We launched a beta. Ten users. Ten real humans used what I built.",
    "I hired someone. I'm officially a boss now.",
  ],
  artist: [
    "I finished a painting I've been working on for weeks.",
    "A gallery reached out to me. Probably nothing, but still.",
    "I threw away something I'd been working on. Sometimes that's the right move.",
    "Someone offered to buy something I made. First time ever.",
    "My hands are covered in paint and I've never been happier.",
    "I think I finally found my style. It took long enough.",
  ],
};

// ── Store a memory ────────────────────────────────────────────────────────

export async function addMemory(
  userId:      string,
  characterId: string,
  event: {
    event_type:       MemoryEventType;
    title:            string;
    description:      string;
    emotional_weight?: number;
    tags?:            string[];
  },
): Promise<MemoryNode | null> {
  try {
    // Defense-in-depth: clamp to the DB's CHECK (BETWEEN 1 AND 10) range.
    // Without this, an out-of-range value doesn't get truncated by
    // Postgres — the entire insert is rejected, and since this call is
    // always fire-and-forget from every caller, that rejection was
    // historically invisible (see MEMORY_WEIGHT_MIN/MAX above).
    const requestedWeight = event.emotional_weight ?? MEMORY_WEIGHT_DEFAULT;
    const emotionalWeight = Math.min(MEMORY_WEIGHT_MAX, Math.max(MEMORY_WEIGHT_MIN, Math.round(requestedWeight)));
    if (emotionalWeight !== requestedWeight) {
      logger.warn('[memory-graph] emotional_weight out of range, clamped', {
        userId, characterId, requestedWeight, emotionalWeight,
      });
    }

    const { data } = await supabaseAdmin
      .from('memory_graph')
      .insert({
        user_id:          userId,
        character_id:     characterId,
        event_type:       event.event_type,
        title:            event.title,
        description:      event.description,
        emotional_weight: emotionalWeight,
        tags:             event.tags ?? [],
      })
      .select('*')
      .single();

    const node = (data ?? null) as unknown as MemoryNode | null;

    // Priority-memory filtering: only nodes that clear the emotional-weight
    // threshold get promoted to the user-visible/training-export table —
    // see priority-memory.ts's promotion threshold. Fire-and-forget; never
    // let this affect the caller's write path.
    if (node) {
      promoteMemoryNode(userId, characterId, node).catch(bg('promoteMemoryNode'));

      // PGVECTOR: fire-and-forget embedding write (see memory-embeddings.ts).
      // Never awaited — this must never add latency to a memory write, and
      // failure here just means the row stays embedding=NULL (excluded from
      // similarity search, not lost or retried inline). See
      // backfillMissingEmbeddings() for catching up NULL rows in bulk.
      embedAndStoreMemory(node.id, node).catch(bg('embedAndStoreMemory'));
    }

    return node;
  } catch (err) {
    logger.warn('Memory graph insert failed', { userId, characterId, error: String(err) });
    return null;
  }
}

// ── Load memories ─────────────────────────────────────────────────────────

export async function getMemoryGraph(
  userId:      string,
  characterId: string,
  limit = 15,
): Promise<MemoryNode[]> {
  const { data } = await supabaseAdmin
    .from('memory_graph')
    .select('*')
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .order('emotional_weight', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data ?? []) as unknown as MemoryNode[];
}

// ── Format for prompt injection ───────────────────────────────────────────

export function formatMemoryGraphForPrompt(memories: MemoryNode[]): string {
  if (!memories.length) return '';

  // Sort: highest emotional weight first, then recency
  const sorted = [...memories]
    .sort((a, b) => b.emotional_weight - a.emotional_weight || 
                    new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 8);

  const lines = sorted.map(m => {
    const daysAgo = Math.floor(
      (Date.now() - new Date(m.created_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    const when = daysAgo === 0 ? 'today'
               : daysAgo === 1 ? 'yesterday'
               : daysAgo < 7  ? `${daysAgo} days ago`
               : daysAgo < 30 ? `${Math.floor(daysAgo / 7)} weeks ago`
               : `${Math.floor(daysAgo / 30)} months ago`;

    return `- [${when}] ${m.title}: ${m.description}`;
  });

  return `\n── Shared Moments (reference naturally, never list mechanically) ──\n${lines.join('\n')}`;
}

// ── Auto-generate first meeting memory ───────────────────────────────────

export async function maybeRecordFirstMeeting(
  userId:        string,
  characterId:   string,
  characterName: string,
): Promise<void> {
  // Check if first meeting already recorded
  const { count } = await supabaseAdmin
    .from('memory_graph')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .eq('event_type', 'first_meeting');

  if ((count ?? 0) > 0) return;

  await addMemory(userId, characterId, {
    event_type:       'first_meeting',
    title:            `First conversation with ${characterName}`,
    description:      `You and ${characterName} spoke for the very first time.`,
    emotional_weight: 9,  // was 85 (0-100 scale) — DB CHECK is 1-10, see MEMORY_WEIGHT_MAX
    tags:             ['first', 'beginning'],
  });
}

// ── Ambition updates (character lives a life) ─────────────────────────────

export async function generateAmbitionUpdate(
  userId:        string,
  characterId:   string,
  characterName: string,
  goal:          string,
  goalProgress:  number,
): Promise<string | null> {
  // Only fire every 5-7 days
  const { count } = await supabaseAdmin
    .from('memory_graph')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .eq('event_type', 'ambition_update')
    .gte('created_at', new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString());

  if ((count ?? 0) > 0) return null;

  // Pick milestone message based on goal category
  const goalLower = goal.toLowerCase();
  const category  = goalLower.includes('music') || goalLower.includes('sing') ? 'musician'
                  : goalLower.includes('business') || goalLower.includes('startup') ? 'entrepreneur'
                  : goalLower.includes('art') || goalLower.includes('paint') ? 'artist'
                  : 'default';

  const pool  = AMBITION_MILESTONES[category];
  const index = Math.min(
    Math.floor(goalProgress / 20),
    pool.length - 1
  );
  const message = pool[index];

  await addMemory(userId, characterId, {
    event_type:       'ambition_update',
    title:            `${characterName}'s life update`,
    description:      message,
    emotional_weight: 6,  // was 55 (0-100 scale) — DB CHECK is 1-10, see MEMORY_WEIGHT_MAX
    tags:             ['ambition', 'daily_life'],
  });

  return message;
}

// ── Lore discovery ────────────────────────────────────────────────────────

export interface LoreReveal {
  key:     string;
  content: string;
  weight:  number;
}

/**
 * Decide if this session should reveal a piece of lore.
 * Lore unlocks based on relationship depth (total_interactions).
 */
export function shouldRevealLore(
  totalInteractions: number,
  alreadyDiscovered: string[],
  characterSecrets:  string[],
): LoreReveal | null {
  if (!characterSecrets.length) return null;

  // Unlock one secret every 15 interactions
  const canUnlock = Math.floor(totalInteractions / 15);
  const nextIndex  = alreadyDiscovered.length;

  if (nextIndex >= canUnlock || nextIndex >= characterSecrets.length) return null;

  return {
    key:     `secret_${nextIndex + 1}`,
    content: characterSecrets[nextIndex],
    weight:  75 + nextIndex * 5,  // later secrets are more significant
  };
}

export async function recordLoreDiscovery(
  userId:        string,
  characterId:   string,
  loreKey:       string,
  content:       string,
  characterName: string,
): Promise<void> {
  await Promise.all([
    supabaseAdmin.from('lore_discoveries').upsert(
      { user_id: userId, character_id: characterId, lore_key: loreKey, content },
      { onConflict: 'user_id,character_id,lore_key' }
    ),
    addMemory(userId, characterId, {
      event_type:       'lore_discovery',
      title:            `${characterName} revealed something personal`,
      description:      content.slice(0, 120),
      emotional_weight: 8,  // was 80 (0-100 scale) — DB CHECK is 1-10, see MEMORY_WEIGHT_MAX
      tags:             ['lore', 'secret', 'personal'],
    }),
  ]);
}

export async function getDiscoveredLore(
  userId:      string,
  characterId: string,
): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('lore_discoveries')
    .select('lore_key')
    .eq('user_id', userId)
    .eq('character_id', characterId);

  return (data ?? []).map(r => r.lore_key);
}

// ── Emotion-driven memory recording ────────────────────────────────────────

/**
 * Auto-records an emotionally significant exchange as a MemoryNode, using
 * the candidate produced by evaluateEmotionalMemory() in emotion-state.ts.
 *
 * Fire-and-forget from chat/route.ts. Title is derived from the user's own
 * words (truncated) so the "shared moment" reads naturally when later
 * surfaced via formatMemoryGraphForPrompt() — e.g.
 *   "[3 days ago] You opened up about: 'I've been feeling really alone lately'"
 *
 * Deliberately conservative: evaluateEmotionalMemory() already gates on
 * intensity ≥ 0.55 and confidence ≥ 0.55, so this only fires for genuinely
 * notable moments — not every message.
 */
export async function maybeRecordEmotionalMemory(
  userId:        string,
  characterId:   string,
  candidate:     { shouldRecord: boolean; event_type: MemoryEventType; emotional_weight: number },
  userMessage:   string,
  emotionLabel:  string,
): Promise<MemoryNode | null> {
  if (!candidate.shouldRecord) return null;

  const snippet = userMessage.trim().slice(0, 90);
  const titleByType: Partial<Record<MemoryEventType, string>> = {
    confession: 'They opened up about something personal',
    argument:   'A tense moment in the conversation',
    deep_talk:  'A meaningful conversation',
    shared_joke:'A moment that made them laugh',
    daily_life: 'A small moment from their day',
  };

  const node = await addMemory(userId, characterId, {
    event_type:       candidate.event_type,
    title:            titleByType[candidate.event_type] ?? 'A notable moment',
    description:      `"${snippet}${userMessage.length > 90 ? '…' : ''}" (felt: ${emotionLabel})`,
    emotional_weight: candidate.emotional_weight,
    tags:             ['emotion', emotionLabel],
  });

  // WORLD-IMPACT-FIX: 'confession' is a declared world_impact_events source
  // but had no caller anywhere. A genuine confession — already gated by
  // evaluateEmotionalMemory() to intensity/confidence >= 0.55, so this
  // isn't firing on every message — is exactly the kind of moment that
  // should leave a durable trace, and at high enough weight (soul-baring,
  // not just a sad aside) become real world history. Fire-and-forget: never
  // blocks the memory write this function exists to do.
  //
  // Scale note: candidate.emotional_weight is 1-10 (memory_graph's scale —
  // see MEMORY_WEIGHT_MIN/MAX). recordWorldImpact's `weight` is documented
  // 0-100 (PROMOTION_THRESHOLD = 65 in world-impact.ts), so it needs the
  // same ×10 rescale priority-memory.ts already does for the same reason —
  // without it, this call now succeeds (node is no longer always null) but
  // a max-weight confession (10) would score 10/100, never crossing 65,
  // so nothing would ever actually promote to permanent universe_memory.
  if (node && candidate.event_type === 'confession') {
    import('@/lib/universe/world-impact').then(({ recordWorldImpact }) =>
      recordWorldImpact({
        characterId,
        userId,
        source:      'confession',
        title:       titleByType.confession!,
        description: `Was trusted with something real: "${snippet}${userMessage.length > 90 ? '…' : ''}"`,
        publicSummary: titleByType.confession!,
        weight:      Math.min(100, candidate.emotional_weight * 10),
      }),
    ).catch((err) => logger.error('memory-graph: world-impact write failed (non-critical)', {
      error: err instanceof Error ? err.message : String(err),
    }));
  }

  return node;
}

