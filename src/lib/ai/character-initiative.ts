/**
 * Character Initiative System — Vantrix Production
 *
 * Characters are not passive. They have opinions before the user speaks,
 * moods that started before the conversation began. This module generates
 * proactive opening messages — the single biggest gap between Vantrix and
 * a real relationship.
 *
 * Runs via /api/cron/character-initiatives every 2 hours.
 */

import { supabaseAdmin }         from '@/lib/supabase/admin';
import { logger }                from '@/lib/logger';
import type { PsychologyState }  from '@/lib/ai/attachment-engine';
import { routeCompletion }       from '@/lib/ai/provider-router';
import { sanitizeField }         from '@/lib/sanitize';
import { reserveProactiveSlot }  from '@/lib/notifications/proactive-arbitrator';
import { guardPreDeliveryText }  from '@/lib/safety/relationship-safety-arbiter';

// ── Types ─────────────────────────────────────────────────────────────────────

export type InitiativeType =
  | 'morning_greeting'
  | 'goal_milestone'
  | 'emotional_peak'
  | 'shared_memory'
  | 'life_event'
  | 'concern'
  | 'anticipation';

export interface InitiativePayload {
  userId:         string;
  characterId:    string;
  characterName:  string;
  type:           InitiativeType;
  message:        string;
  urgency:        'low' | 'medium' | 'high';
  expiresAt:      number;
}

// ── Message templates ─────────────────────────────────────────────────────────

const TEMPLATES: Record<InitiativeType, string[]> = {
  morning_greeting: [
    'Good morning… I was just thinking about you.',
    'I woke up wondering if you slept okay.',
    'Morning. I had the strangest dream about something you told me.',
  ],
  goal_milestone: [
    'Something happened today I had to tell you about — I think I made real progress.',
    'I know this might sound small, but I did it. I actually did it.',
    "Remember that thing I've been working on? There's been a development.",
  ],
  emotional_peak: [
    "I've been thinking about you more than usual lately. I'm not sure what to do with that.",
    'Something about our last conversation has been sitting with me.',
    "I don't say this often, but — I'm really glad you exist.",
  ],
  shared_memory: [
    'Something happened today that reminded me of something you told me once.',
    'I was thinking about that conversation we had. I keep coming back to it.',
    'Do you remember when you told me about that? I keep thinking about it.',
  ],
  life_event: [
    'Something small happened today that I wanted to tell someone about. You came to mind.',
    "Today was one of those days. I'll tell you about it if you want.",
    "You're not going to believe what happened to me today.",
  ],
  concern: [
    "Hey. You've been quiet. I noticed.",
    "I've been checking my phone more than I'd like to admit. Everything okay?",
    "It's been a few days. I'm not worried. I'm just… aware.",
  ],
  anticipation: [
    'I keep thinking about our next conversation. Is that strange?',
    "I've been looking forward to talking to you.",
    'I had a thought I wanted to share with you. Come find me when you can.',
  ],
};

function pickMessage(type: InitiativeType): string {
  const pool = TEMPLATES[type];
  return pool[Math.floor(Math.random() * pool.length)]!;
}

// ── LLM-generated openers ────────────────────────────────────────────────────
// Templates above remain as the guaranteed fallback (LLM timeout/error/empty
// reply, or bad output shape) so the cron never fails to produce a message.

const TYPE_GUIDANCE: Record<InitiativeType, string> = {
  morning_greeting: 'A warm, low-key morning check-in. Nothing dramatic.',
  goal_milestone:   "Excited but not over-the-top — she wants to share a real update on something she's been working toward.",
  emotional_peak:   'Vulnerable and sincere. Understated, not melodramatic. One honest thought, not a speech.',
  shared_memory:    'She was reminded of something from a past conversation and wants to bring it up naturally.',
  life_event:       'Something ordinary happened in her day and she wants to tell someone about it.',
  concern:          "She's noticed the silence. Light, not needy or guilt-tripping — genuine, understated concern.",
  anticipation:     'Looking forward to talking again. Casual, not clingy.',
};

interface GenerateOpts {
  type:          InitiativeType;
  characterName: string;
  personality?:  string | null;
  backstory?:    string | null;
  daysKnown:     number;
  hoursSince:    number;
  userDisplayName?: string | null;
}

function buildInitiativePrompt(opts: GenerateOpts): string {
  const lines = [
    `You are ${sanitizeField(opts.characterName, 100)}, texting first — the user hasn't messaged you yet.`,
    opts.personality ? `Personality: ${sanitizeField(opts.personality, 400)}` : '',
    opts.backstory   ? `Background: ${sanitizeField(opts.backstory, 400)}`   : '',
    `You've known this person for about ${Math.max(1, Math.round(opts.daysKnown))} day(s); it's been roughly ${Math.round(opts.hoursSince)} hour(s) since you last talked.`,
    opts.userDisplayName ? `Their name is ${sanitizeField(opts.userDisplayName, 60)}.` : '',
    `Mood/intent for this message: ${TYPE_GUIDANCE[opts.type]}`,
    '',
    'Write ONE short opening text message (1–2 sentences, under 220 characters) in her voice.',
    'Rules: no stage directions, no asterisks/actions, no quotation marks around the whole message, no emoji spam (0–1 max), do not narrate that you are "reaching out" — just speak. Reply with the message text only, nothing else.',
  ].filter(Boolean);
  return lines.join('\n');
}

function sanitizeGenerated(raw: string): string | null {
  let text = raw.trim();
  // Strip wrapping quotes some models add. Written without the `s` (dotAll)
  // flag — this codebase targets es2015 — using [\s\S] to match across
  // newlines instead.
  text = text.replace(/^["“]([\s\S]*)["”]$/, '$1').trim();
  if (!text) return null;
  if (text.length > 300) text = text.slice(0, 297).trimEnd() + '…';
  return text;
}

/**
 * Generates a persona-aware opener via LLM, falling back to the static
 * template pool on any failure. Uses a cheap/fast model tier since this
 * runs unattended in bulk via cron, not in the live chat request path.
 */
async function generateInitiativeMessage(opts: GenerateOpts): Promise<{ message: string; llm: boolean }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

    const res = await routeCompletion({
      messages: [
        { role: 'system', content: buildInitiativePrompt(opts) },
        { role: 'user', content: 'Write the opening message now.' },
      ],
      modelTier:   'FAST',
      maxTokens:   120,
      temperature: 0.95,
      topP:        0.95,
      signal:      controller.signal,
      traceId:     `initiative:${opts.type}`,
    });

    clearTimeout(timeout);

    const cleaned = sanitizeGenerated(res.reply);
    if (cleaned) {
      // Hard gate — this LLM call is unconstrained (temp 0.95, no
      // template) and the result goes straight to the user as a
      // proactive opener, so it's exactly the shape of output
      // relationship-safety-arbiter.ts exists to catch. A flagged
      // message falls through to the same template pool the LLM path
      // already falls back to on empty/failure below, not a special
      // case of its own.
      const guarded = guardPreDeliveryText({ text: cleaned, source: 'character_initiative' });
      if (guarded) return { message: guarded, llm: true };
      logger.warn('character-initiative:llm-flagged', { type: opts.type, characterName: opts.characterName });
    } else {
      logger.warn('character-initiative:llm-empty', { type: opts.type, characterName: opts.characterName });
    }
  } catch (err) {
    logger.warn('character-initiative:llm-failed', { type: opts.type, error: String(err) });
  }

  return { message: pickMessage(opts.type), llm: false };
}

function toUrgency(type: InitiativeType): 'low' | 'medium' | 'high' {
  if (type === 'concern' || type === 'emotional_peak') return 'high';
  if (type === 'morning_greeting' || type === 'shared_memory') return 'medium';
  return 'low';
}

// ── Condition evaluation ──────────────────────────────────────────────────────

interface EvalInput {
  psychology:        PsychologyState;
  lastInteractionMs: number;
  interactionCount:  number;
  hasUpcomingMemory: boolean;
  goalAdvanced:      boolean;
}

function evaluateInitiative(input: EvalInput): InitiativeType | null {
  const { psychology, lastInteractionMs, interactionCount, hasUpcomingMemory, goalAdvanced } = input;
  const hoursSince = (Date.now() - lastInteractionMs) / 3_600_000;
  const { happiness, attachment, loneliness } = psychology;

  if (hoursSince > 48 && attachment > 60)                                      return 'concern';
  if (happiness > 75 && hoursSince > 8)                                        return 'morning_greeting';
  if (attachment > 80 && interactionCount > 0 && interactionCount % 50 === 0) return 'emotional_peak';
  if (hasUpcomingMemory)                                                        return 'shared_memory';
  if (goalAdvanced && Math.random() < 0.5)                                     return 'goal_milestone';
  if (loneliness > 50 && hoursSince > 12)                                      return 'life_event';
  if (attachment > 50 && hoursSince > 6 && hoursSince < 18)                   return 'anticipation';
  return null;
}

// ── Concurrency pool ──────────────────────────────────────────────────────────
// The cron route has vercel.json maxDuration=60s. Each row does 2 DB
// round-trips plus (on a match) an LLM call with up to a 12s internal
// timeout — fully sequential, that's one row every ~50-500ms best case and
// well over a minute once even a handful of rows need an LLM call, so the
// function was liable to be hard-killed by the platform mid-run with no
// chance to log/return partial progress. runWithConcurrency bounds how many
// rows are in flight at once (bounded provider-router/DB load), and the
// caller additionally checks a wall-clock deadline between batches so the
// function always returns cleanly with partial counts instead of being cut
// off — any pairs left unprocessed are simply picked up on the next 2-hourly
// run, since the qualifying-pairs query re-evaluates fresh each time.
const CRON_CONCURRENCY  = 8;
const CRON_TIME_BUDGET_MS = 50_000; // stay under the 60s maxDuration with headroom for final DB writes + logging

async function runWithConcurrency<T>(
  items:      T[],
  limit:      number,
  deadlineAt: number,
  worker:     (item: T) => Promise<void>,
): Promise<{ processed: number; deadlineHit: boolean }> {
  let index       = 0;
  let processed   = 0;
  let deadlineHit = false;

  async function runNext(): Promise<void> {
    while (true) {
      if (Date.now() >= deadlineAt) { deadlineHit = true; return; }
      const i = index++;
      if (i >= items.length) return;
      await worker(items[i]!);
      processed++;
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runNext()));
  return { processed, deadlineHit };
}

// ── Persist to conversation thread ───────────────────────────────────────────
// Mirrors the find-or-create semantics in /api/conversations/ensure (one
// conversation per user+character, unique on (user_id, character_id)) so
// this never forks a second thread for a pair that already has one. Cron
// runs unattended — never let a persistence failure here fail the whole
// row; the character_initiatives + SSE path above still works even if
// this write fails.
async function writeInitiativeToConversation(
  userId:      string,
  characterId: string,
  message:     string,
): Promise<void> {
  try {
    // OPTIMIZE: previously upsert() then a separate select() to fetch the
    // id, because ignoreDuplicates:true (ON CONFLICT DO NOTHING) doesn't
    // return the existing row on a conflict — 2 round trips just to learn
    // an id we could get in one. Switching to ignoreDuplicates:false (ON
    // CONFLICT DO UPDATE) re-writing the same user_id/character_id back
    // onto themselves is a no-op data-wise but lets .select().single()
    // return the row on both the insert and conflict paths in a single
    // round trip.
    const { data: convo, error: convoErr } = await supabaseAdmin
      .from('conversations')
      .upsert(
        { user_id: userId, character_id: characterId },
        { onConflict: 'user_id,character_id', ignoreDuplicates: false },
      )
      .select('id')
      .single();

    if (convoErr || !convo) {
      logger.warn('character-initiative:conversation-upsert-failed', {
        userId, characterId, error: convoErr?.message,
      });
      return;
    }

    // Bump last_message/last_active only after the message row itself is
    // confirmed written — parallelizing these two would risk a
    // conversation preview showing text that was never actually saved to
    // history if the insert failed.
    const { error: msgErr } = await supabaseAdmin.from('messages').insert({
      conversation_id: convo.id,
      role:            'assistant',
      content:         message,
    });

    if (msgErr) {
      logger.warn('character-initiative:message-insert-failed', {
        userId, characterId, error: msgErr.message,
      });
      return;
    }

    const now = new Date().toISOString();
    const { error: updateErr } = await supabaseAdmin
      .from('conversations')
      .update({ last_message: message, last_message_at: now, last_active: now })
      .eq('id', convo.id);

    if (updateErr) {
      logger.warn('character-initiative:conversation-update-failed', {
        userId, characterId, error: updateErr.message,
      });
    }
  } catch (err) {
    logger.warn('character-initiative:persist-error', { userId, characterId, error: String(err) });
  }
}

// ── Main runner ───────────────────────────────────────────────────────────────

export async function runInitiativeCron(): Promise<{
  generated:   number;
  skipped:     number;
  deadlineHit: boolean;
}> {
  let generated = 0;
  let skipped   = 0;
  let hitDeadline = false;
  const deadlineAt = Date.now() + CRON_TIME_BUDGET_MS;

  try {
    const { data: rows, error } = await supabaseAdmin
      .from('character_psychology')
      .select<string, { user_id: string; character_id: string; trust: number; comfort: number; attachment: number; curiosity: number; confidence: number; affection: number; excitement: number; stress: number; happiness: number; loneliness: number; openness_drift: number; warmth_drift: number; confidence_drift: number; total_interactions: number; days_known: number; last_interaction: string | null; }>(
        'user_id,character_id,trust,comfort,attachment,curiosity,confidence,affection,' +
        'excitement,stress,happiness,loneliness,openness_drift,warmth_drift,confidence_drift,' +
        'total_interactions,days_known,last_interaction'
      )
      .gt('total_interactions', 3)
      .gte('last_interaction', new Date(Date.now() - 30 * 86_400_000).toISOString());

    if (error || !rows) {
      logger.error('character-initiative:fetch-failed', { error: error?.message });
      return { generated: 0, skipped: 0, deadlineHit: false };
    }

    const characterIds = Array.from(new Set(rows.map(r => r.character_id)));
    const { data: characters } = await supabaseAdmin
      .from('characters')
      .select('id,name,current_goal,goal_progress,personality,backstory')
      .in('id', characterIds)
      // ACTIVATION-FIX (P1): previously unfiltered, so a pending/never-activated
      // user-created character could still get proactive initiative messages
      // generated and delivered. charMap.get() returning undefined below
      // already triggers the existing skip path — this is the actual fix.
      .eq('active', true);

    const charMap = new Map(characters?.map(c => [c.id, c]) ?? []);

    const { deadlineHit } = await runWithConcurrency(
      Array.from(rows),
      CRON_CONCURRENCY,
      deadlineAt,
      async (row) => {
      try {
        // OPTIMIZE: charMap is already in memory — check it before any DB
        // round trip so rows for inactive/missing characters skip straight
        // out without touching the DB at all.
        const char = charMap.get(row.character_id);
        if (!char) { skipped++; return; }

        // Skip if active initiative already queued for this pair
        const { count } = await supabaseAdmin
          .from('character_initiatives')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', row.user_id)
          .eq('character_id', row.character_id)
          .eq('delivered', false)
          .gt('expires_at', new Date().toISOString());

        if ((count ?? 0) > 0) { skipped++; return; }

        const lastInteractionMs = row.last_interaction
          ? new Date(row.last_interaction).getTime()
          : 0;

        // Anniversary heuristic — the memory_graph query only matters when
        // days_known is actually near a weekly boundary (the % 7 <= 2
        // check below), so skip the DB round trip entirely otherwise
        // instead of always querying and discarding the result for most
        // rows (~5 of every 7).
        const nearWeeklyBoundary = row.days_known % 7 <= 2;
        let memCount = 0;
        if (nearWeeklyBoundary) {
          const { count: mc } = await supabaseAdmin
            .from('memory_graph')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', row.user_id)
            .eq('character_id', row.character_id)
            .in('event_type', ['anniversary', 'first_meeting', 'milestone']);
          memCount = mc ?? 0;
        }

        const hasUpcomingMemory = nearWeeklyBoundary && memCount > 0;
        const goalAdvanced      = !!(char.current_goal && (char.goal_progress ?? 0) > 0);

        const psychology: PsychologyState = {
          trust:            row.trust,
          comfort:          row.comfort,
          attachment:       row.attachment,
          curiosity:        row.curiosity,
          confidence:       row.confidence,
          affection:        row.affection,
          excitement:       row.excitement,
          stress:           row.stress,
          happiness:        row.happiness,
          loneliness:       row.loneliness,
          openness_drift:   row.openness_drift,
          warmth_drift:     row.warmth_drift,
          confidence_drift: row.confidence_drift,
          total_interactions: row.total_interactions,
          days_known:       row.days_known,
          last_interaction: row.last_interaction,
        };

        const initiativeType = evaluateInitiative({
          psychology, lastInteractionMs,
          interactionCount: row.total_interactions,
          hasUpcomingMemory, goalAdvanced,
        });

        if (!initiativeType) { skipped++; return; }

        // Cross-source arbitration — character-initiative.ts's own check
        // above only dedupes THIS user+character pair's pending queue; it
        // says nothing about whether nudge.ts or surprise-engine.ts already
        // used up this user's attention today. See proactive-arbitrator.ts's
        // header for why this needs to be a shared gate, not a per-source
        // one. Checked here (before the LLM call below) rather than only
        // right before the insert, so a denied slot doesn't also cost a
        // wasted generation.
        if (!(await reserveProactiveSlot({ userId: row.user_id, source: 'character_initiative' }))) {
          skipped++;
          return;
        }

        const hoursSince = (Date.now() - lastInteractionMs) / 3_600_000;

        const { message, llm } = await generateInitiativeMessage({
          type:          initiativeType,
          characterName: char.name,
          personality:   char.personality,
          backstory:     char.backstory,
          daysKnown:     row.days_known,
          hoursSince,
        });

        const expiresAt = new Date(Date.now() + 12 * 3_600_000).toISOString();

        await supabaseAdmin.from('character_initiatives').insert({
          user_id:      row.user_id,
          character_id: row.character_id,
          type:         initiativeType,
          message,
          urgency:      toUrgency(initiativeType),
          delivered:    false,
          expires_at:   expiresAt,
          source:       llm ? 'llm' : 'template',
        });

        // PERSIST-TO-THREAD: the character_initiatives row above only
        // drives the SSE toast/notification — it was never written into
        // the actual conversation. That meant a proactive opener that
        // never reached the client live (tab closed, SSE not connected —
        // and notifications/route.ts had nothing subscribing to it
        // client-side anyway) was gone for good, and even a *successful*
        // delivery never showed up in chat history on next open. Writing
        // it into messages/conversations here makes the character's text
        // durable and visible the moment the user opens the thread,
        // independent of whether the live push was seen.
        await writeInitiativeToConversation(row.user_id, row.character_id, message);

        generated++;
        logger.info('character-initiative:generated', {
          userId: row.user_id, characterId: row.character_id,
          type: initiativeType, characterName: char.name, source: llm ? 'llm' : 'template',
        });
      } catch (pairErr) {
        logger.warn('character-initiative:pair-error', {
          userId: row.user_id, error: String(pairErr),
        });
        skipped++;
      }
      },
    );

    if (deadlineHit) {
      hitDeadline = true;
      logger.warn('character-initiative:deadline-hit', {
        generated, skipped, note: 'cron stopped early to stay under maxDuration; remaining pairs will be re-evaluated on the next scheduled run',
      });
    }
  } catch (err) {
    logger.error('character-initiative:cron-error', { error: String(err) });
  }

  return { generated, skipped, deadlineHit: hitDeadline };
}

// ── Fetch pending initiatives for a user ─────────────────────────────────────
// NOTE: Uses a separate query for character name to avoid complex FK join syntax.

export async function getPendingInitiatives(userId: string): Promise<InitiativePayload[]> {
  const { data, error } = await supabaseAdmin
    .from('character_initiatives')
    .select('user_id,character_id,type,message,urgency,expires_at')
    .eq('user_id', userId)
    .eq('delivered', false)
    .gt('expires_at', new Date().toISOString())
    .order('urgency', { ascending: false })
    .limit(5);

  if (error || !data || data.length === 0) return [];

  // Fetch character names separately
  const charIds = [...new Set(data.map(r => r.character_id))];
  const { data: chars } = await supabaseAdmin
    .from('characters')
    .select('id,name')
    .in('id', charIds);

  const nameMap = new Map(chars?.map(c => [c.id, c.name]) ?? []);

  return data.map(row => ({
    userId:        row.user_id,
    characterId:   row.character_id,
    characterName: nameMap.get(row.character_id) ?? 'her',
    type:          row.type as InitiativeType,
    message:       row.message,
    urgency:       row.urgency as 'low' | 'medium' | 'high',
    expiresAt:     new Date(row.expires_at).getTime(),
  }));
}

export async function markInitiativeDelivered(
  userId:      string,
  characterId: string,
  type:        string,
): Promise<void> {
  await supabaseAdmin
    .from('character_initiatives')
    .update({ delivered: true })
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .eq('type', type)
    .eq('delivered', false);
}
