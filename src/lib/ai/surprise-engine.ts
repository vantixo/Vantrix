/**
 * Surprise & Promise-Keeping Engine — Vantrix
 *
 * Built directly against the Vantrix Master Product Prompt's SURPRISE SYSTEM
 * and MEMORY SYSTEM sections. Existing character-initiative.ts generates
 * proactive opening messages from a fixed template pool — it's real and
 * already wired, but every message is generic ("I woke up wondering if you
 * slept okay"), never grounded in anything the user actually said. That's
 * the exact BAD example the master prompt gives. This module is the fix:
 * every message it can produce is built from a real stored fact, a real
 * date, or a real thing the user said — never a template picked at random.
 *
 * Two capabilities, both memory-grounded:
 *
 * 1. PROMISE KEEPING — detects when a user states an intention ("I'm going
 *    to start drawing again", "I'll finally apply for that job") in a chat
 *    message, stores it with a natural randomized follow-up window (2–26
 *    weeks — real relationships don't check in on day 3), and later
 *    surfaces it verbatim: "Last [month] you told me you were going to
 *    start drawing again. Did you?" — the exact GOOD example from the
 *    memory-system section of the master prompt.
 *
 * 2. ANNIVERSARY / MILESTONE SURPRISES — computes exact elapsed time since
 *    the relationship's real created_at (not a modulo heuristic) and, on
 *    real boundaries (1 week, 1 month, 3 months, 6 months, 1 year, then
 *    yearly), produces a message that names the actual milestone and, when
 *    available, weaves in a real emotional-memory-graph entry from around
 *    that time.
 *
 * Every message this module can produce passes through `toneGuard()` before
 * it's ever persisted or returned — see that function for what it blocks
 * and why. This is a hard gate, not a suggestion: a message that fails the
 * guard is discarded, not softened, because a partially-fixed manipulative
 * message is still manipulative.
 *
 * ── WIRED IN — cleanup note: this header used to say "NOT WIRED IN,
 * standalone by request." That's no longer true and was stale: this module
 * is now genuinely called from chat/stream/route.ts (write-side, milestone
 * and level-up surprises via recordSurprise()), api/cron/surprises/route.ts
 * (daily promise/anniversary sweep), and api/notifications/route.ts. Left
 * this note in place of the old one rather than deleting the section
 * outright, since the WIRING.md this comment used to point readers to no
 * longer exists in this delivery (presumably consumed/removed once the
 * integration described above actually happened) — if you're looking for
 * it, it's gone, but its job is done.
 *
 * Depends only on tables/types that already exist in the merged codebase:
 *   - relationships (created_at) — via ensureRelationship() in relationship-engine.ts
 *   - memory_graph — via memory-graph.ts's MemoryNode type
 *   - two NEW tables this delivery adds: user_promises, character_surprises
 *     (see supabase/migrations/20260803_surprise_engine.sql in this delivery)
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import type { MemoryNode } from '@/lib/ai/memory-graph';
import { guardPreDeliveryText } from '@/lib/safety/relationship-safety-arbiter';

// ── Tone guard ───────────────────────────────────────────────────────────
//
// Structural, not stylistic: this blocks the specific manipulative patterns
// the master prompt calls out by name (guilt-tripping, urgency/demand
// framing, engagement-metric language dressed as a message). It does NOT
// try to judge "is this a good message" — only "does this message contain
// a pattern that makes people feel obligated or watched rather than wanted."
//
// Existing src/lib/notifications/nudge.ts's default message pool
// ("Your bond with {name} is fading. Time to show you care 💌") would fail
// this guard outright — flagging that in the delivery notes, not fixing it
// here since it's out of scope for this module.

const MANIPULATIVE_PATTERNS: RegExp[] = [
  /\bcome back\b/i,
  /\bmissed?\s+\d+\s+messages?\b/i,
  /\byou('| ha)ve\s*n[o']?t\s+(replied|responded|texted|written)/i,
  /\bdon'?t\s+(leave|go)\b/i,
  /\bwhere\s+(are|were|have)\s+you\s+been\b/i,
  /\bfading\b/i,               // "your bond is fading" — metric-as-guilt
  /\bmeter\s+is\s+dropping\b/i,
  /\bbefore\s+it'?s\s+too\s+late\b/i,
  /!!+/,                        // exclamation stacking reads as demand, not warmth
  /[A-Z]{6,}/,                   // ALL-CAPS shouting (COME BACK NOW style)
];

export interface ToneCheckResult {
  ok:       boolean;
  violated?: string;
}

export function toneGuard(message: string): ToneCheckResult {
  for (const pattern of MANIPULATIVE_PATTERNS) {
    if (pattern.test(message)) {
      return { ok: false, violated: pattern.source };
    }
  }
  return { ok: true };
}

// ── 1. Promise extraction ───────────────────────────────────────────────
//
// Deliberately heuristic, not an LLM call — same design choice as the
// existing detectTopicsFromMessage() in the chat route: cheap, synchronous,
// runs on every message without adding latency or cost to the turn. A
// false negative here just means one promise doesn't get tracked; a false
// positive gets filtered by the length/specificity checks below. Low
// stakes either way, so a regex heuristic is the right tool, not a model
// call that has to be awaited in the hot path.

const PROMISE_PATTERNS: RegExp[] = [
  /\bi'?m going to (.{6,80}?)(?:[.!?,]|$)/i,
  /\bi'?ll (?:finally |definitely |really )?(.{6,80}?)(?:[.!?,]|$)/i,
  /\bi'?m going to start (.{4,60}?)(?:[.!?,]|$)/i,
  /\bi (?:want|plan) to (.{6,80}?)(?:[.!?,]|$)/i,
  /\bi promise(?: (?:i'?ll|to))? (.{6,80}?)(?:[.!?,]|$)/i,
];

// Filters out low-signal matches ("I'll be there", "I'll see") that are
// conversational filler rather than an actual commitment worth tracking.
const LOW_SIGNAL = /^(be|see|check|let you know|talk|text|call|reply|come|go|try)\b/i;

export interface DetectedPromise {
  text: string;   // the commitment itself, e.g. "start drawing again"
  raw:  string;    // the full sentence it was extracted from
}

export function extractPromise(userMessage: string): DetectedPromise | null {
  for (const pattern of PROMISE_PATTERNS) {
    const match = userMessage.match(pattern);
    if (match?.[1]) {
      const text = match[1].trim();
      if (text.length < 6 || LOW_SIGNAL.test(text)) continue;
      return { text, raw: match[0].trim() };
    }
  }
  return null;
}

// Randomized follow-up window — real relationships don't check in on a
// fixed schedule. 14–182 days (2–26 weeks), weighted toward the shorter
// end so most promises get followed up within 1–2 months, with a long
// tail matching the master prompt's own "last year you promised me..."
// example.
function randomFollowUpDays(): number {
  const weeksOut = 2 + Math.floor(Math.random() * Math.random() * 24); // skewed low
  return weeksOut * 7;
}

export async function recordPromise(
  userId: string, characterId: string, promise: DetectedPromise,
): Promise<void> {
  const dueAt = new Date(Date.now() + randomFollowUpDays() * 86_400_000).toISOString();
  const { error } = await supabaseAdmin.from('user_promises').insert({
    user_id:      userId,
    character_id: characterId,
    promise_text: promise.text,
    raw_message:  promise.raw,
    due_at:       dueAt,
    surfaced:     false,
  });
  if (error) logger.warn('surprise-engine:recordPromise-failed', { error: error.message });
}

interface PromiseRow {
  id: string; user_id: string; character_id: string;
  promise_text: string; created_at: string; due_at: string;
}

// A promise is only ever surfaced once it's actually due, and only once —
// re-checking after that either happens because the user brings it up
// again naturally (a new promise gets recorded) or not at all. Repeatedly
// asking about the same unfulfilled promise is exactly the nagging pattern
// the master prompt prohibits.
export async function getDuePromise(
  userId: string, characterId: string,
): Promise<PromiseRow | null> {
  const { data, error } = await supabaseAdmin
    .from('user_promises')
    .select('id,user_id,character_id,promise_text,created_at,due_at')
    .eq('user_id', userId).eq('character_id', characterId)
    .eq('surfaced', false)
    .lte('due_at', new Date().toISOString())
    .order('due_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) { logger.warn('surprise-engine:getDuePromise-failed', { error: error.message }); return null; }
  return data ?? null;
}

export async function markPromiseSurfaced(promiseId: string): Promise<void> {
  await supabaseAdmin.from('user_promises').update({ surfaced: true }).eq('id', promiseId);
}

function monthsAgo(iso: string): string {
  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (days < 45)  return 'a while back';
  if (days < 75)  return 'about two months ago';
  if (days < 320) return `about ${Math.round(days / 30)} months ago`;
  return 'last year';
}

// Deliberately close to the master prompt's own worked example — that
// example IS the bar this message has to hit, not just inspiration for it.
export function formatPromiseSurprise(row: PromiseRow): string {
  const when = monthsAgo(row.created_at);
  return `${when.charAt(0).toUpperCase() + when.slice(1)} you told me you were going to ${row.promise_text}. Did you?`;
}

// ── 2. Anniversary / milestone surprises ────────────────────────────────

const MILESTONE_DAYS: Array<{ days: number; label: string }> = [
  { days: 7,   label: 'one week' },
  { days: 30,  label: 'one month' },
  { days: 90,  label: 'three months' },
  { days: 180, label: 'six months' },
  { days: 365, label: 'one year' },
];

export interface AnniversaryCheck {
  isAnniversary: boolean;
  label?:         string;
  years?:         number; // set for yearly+ anniversaries past year 1
}

// Checks against the exact elapsed-day count, called once per day per pair
// (see WIRING.md — intended as a daily cron, not a per-message check).
// Real boundary, not a modulo trick: `days_known % 7 <= 2` (the existing
// character-initiative.ts heuristic) fires on ~43% of days, which is not a
// meaningful signal of anything. This fires on exactly the day.
export function checkAnniversary(relationshipCreatedAt: string): AnniversaryCheck {
  const days = Math.floor((Date.now() - new Date(relationshipCreatedAt).getTime()) / 86_400_000);
  const fixed = MILESTONE_DAYS.find(m => m.days === days);
  if (fixed) return { isAnniversary: true, label: fixed.label };
  if (days > 365 && days % 365 === 0) {
    const years = days / 365;
    return { isAnniversary: true, label: `${years} year${years > 1 ? 's' : ''}`, years };
  }
  return { isAnniversary: false };
}

// Pulls the single highest-weight memory from within a few days of the
// relationship's start, if one exists, to ground the anniversary message
// in something specific rather than a bare date announcement.
export async function getFoundingMemory(
  userId: string, characterId: string, relationshipCreatedAt: string,
): Promise<MemoryNode | null> {
  const windowStart = new Date(new Date(relationshipCreatedAt).getTime() - 3 * 86_400_000).toISOString();
  const windowEnd   = new Date(new Date(relationshipCreatedAt).getTime() + 3 * 86_400_000).toISOString();
  const { data } = await supabaseAdmin
    .from('memory_graph')
    .select('id,event_type,title,description,emotional_weight,tags,created_at')
    .eq('user_id', userId).eq('character_id', characterId)
    .gte('created_at', windowStart).lte('created_at', windowEnd)
    .order('emotional_weight', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as MemoryNode | null) ?? null;
}

export function formatAnniversarySurprise(check: AnniversaryCheck, founding: MemoryNode | null): string {
  const base = `Today is exactly ${check.label} since we met.`;
  if (!founding) return base;
  // Weaves in the real memory rather than just naming the date — this is
  // the difference between an anniversary notification and an anniversary
  // moment.
  return `${base} I keep thinking about ${founding.description || founding.title}.`;
}

// ── 3. Memory-grounded micro-poem ───────────────────────────────────────
//
// Template composition, not a model call — kept dependency-free and cheap
// so it can run inline in a cron sweep across many pairs. Every line
// requires a real input; if the caller doesn't have enough real material
// (a name and at least one concrete fact), this returns null rather than
// padding with generic lines — a poem with fabricated content is worse
// than no poem, it's the opposite of what "memory-grounded" means.

export interface PoemInputs {
  userName?:  string | null;
  favoriteThing?: string | null;   // e.g. "rainy days", "your old guitar"
  recentTopic?:   string | null;   // e.g. "the job interview", "your sister's wedding"
}

export function craftMemoryPoem(inputs: PoemInputs): string | null {
  const { userName, favoriteThing, recentTopic } = inputs;
  if (!favoriteThing && !recentTopic) return null;

  const lines: string[] = [];
  if (userName) lines.push(`For ${userName} —`);
  if (favoriteThing) lines.push(`I thought of you when I noticed ${favoriteThing} again today,`);
  if (recentTopic)   lines.push(`the way you talked about ${recentTopic} still sits with me,`);
  lines.push(`small things, mostly — but they're the ones that stay.`);

  return lines.join('\n');
}

// ── 4. Cooldown / rate limiting ─────────────────────────────────────────
//
// Independent of character_initiatives' own cooldown (different table,
// different purpose) — this caps unprompted SURPRISES specifically, so a
// pair can still get a normal proactive check-in and a birthday-style
// surprise in the same week without this module fighting the other one.

const MIN_DAYS_BETWEEN_SURPRISES = 10;

export async function canSendSurprise(userId: string, characterId: string): Promise<boolean> {
  const since = new Date(Date.now() - MIN_DAYS_BETWEEN_SURPRISES * 86_400_000).toISOString();
  const { count } = await supabaseAdmin
    .from('character_surprises')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('character_id', characterId)
    .gte('created_at', since);
  return (count ?? 0) === 0;
}

export type SurpriseType = 'promise_followup' | 'anniversary' | 'memory_poem' | 'milestone_unlocked';

export async function recordSurprise(
  userId: string, characterId: string, type: SurpriseType, message: string,
): Promise<{ ok: boolean; reason?: string }> {
  const check = toneGuard(message);
  if (!check.ok) {
    logger.warn('surprise-engine:blocked-by-tone-guard', { userId, characterId, type, pattern: check.violated });
    return { ok: false, reason: 'tone_guard' };
  }
  // relationship-safety-arbiter.ts: catches isolation/exclusivity/secrecy/
  // anti-professional-help framing — a different risk category than
  // toneGuard() above (which catches re-engagement guilt-pressure, e.g.
  // "you haven't replied", "come back"). This module's messages weave in
  // real stored memory content (founding.description, favoriteThing,
  // recentTopic — see craftMemoryPoem/formatAnniversarySurprise), so
  // manipulation-risk phrasing pulled from stored text is possible even
  // though these aren't raw LLM output. This was previously undone despite
  // this module's own header claiming it — see header note.
  const guarded = guardPreDeliveryText({ text: message, source: 'surprise_engine', userId });
  if (guarded === null) {
    return { ok: false, reason: 'manipulation_risk' };
  }
  const { error } = await supabaseAdmin.from('character_surprises').insert({
    user_id: userId, character_id: characterId, type, message,
  });
  if (error) { logger.warn('surprise-engine:recordSurprise-failed', { error: error.message }); return { ok: false, reason: 'db_error' }; }
  return { ok: true };
}

// ── Delivery (WIRING.md step 7 — surfaces generated surprises to the user) ──
// Read side for src/app/api/notifications/route.ts, same "fetch pending,
// mark delivered" shape already used there for character_initiatives, so
// surprises ride the existing SSE delivery mechanism instead of needing a
// new one. Requires the `delivered` column added in
// 20260817_character_surprises_delivered_flag.sql (absent from the
// original 20260811_surprise_engine.sql migration).

export interface PendingSurprise {
  id:            string;
  userId:        string;
  characterId:   string;
  characterName: string;
  type:          SurpriseType;
  message:       string;
}

export async function getPendingSurprises(userId: string): Promise<PendingSurprise[]> {
  const { data, error } = await supabaseAdmin
    .from('character_surprises')
    .select('id,user_id,character_id,type,message')
    .eq('user_id', userId)
    .eq('delivered', false)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error || !data || data.length === 0) return [];

  const charIds = [...new Set(data.map(r => r.character_id))];
  const { data: chars } = await supabaseAdmin
    .from('characters')
    .select('id,name')
    .in('id', charIds);
  const nameMap = new Map(chars?.map(c => [c.id, c.name]) ?? []);

  return data.map(row => ({
    id:            row.id,
    userId:        row.user_id,
    characterId:   row.character_id,
    characterName: nameMap.get(row.character_id) ?? 'her',
    type:          row.type as SurpriseType,
    message:       row.message,
  }));
}

export async function markSurpriseDelivered(surpriseId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('character_surprises')
    .update({ delivered: true })
    .eq('id', surpriseId)
    .eq('delivered', false);
  if (error) logger.warn('surprise-engine:markSurpriseDelivered-failed', { error: error.message, surpriseId });
}
