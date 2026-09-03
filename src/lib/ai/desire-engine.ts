/**
 * Core Desire Engine — Vantrix
 *
 * The layer beneath the Goal Engine (character_goals) and Decision Engine
 * (decision-engine.ts). A goal is a strategy ("build a real connection with
 * this person"); a desire is why that strategy got chosen at all
 * ("belonging"). Four axes, deliberately small and near-static per
 * character — this defines who they ARE, not what they're doing this week:
 *
 *   need       — what they cannot go without (belonging, safety, purpose)
 *   want       — what they consciously chase (recognition, freedom, mastery)
 *   fear       — what governs avoidance (abandonment, irrelevance, failure)
 *   obsession  — the fixation that colors everything (art, control, a person)
 *
 * Fulfillment is per-relationship and DOES move quickly — every meaningful
 * interaction nudges need/want/fear/obsession fulfillment for that specific
 * user, and that fulfillment state is what actually reaches the Decision
 * Engine (via CharacterState) and the LLM prompt. A starved need pulls
 * intent scoring toward DeepenBond/Comfort-seeking; a triggered fear pulls
 * toward SetBoundary or withdrawal; an engaged obsession surfaces ShareStory.
 *
 * Design stance, matching decision-engine.ts: arithmetic, not a second LLM
 * call. Generation (assigning the actual need/want/fear/obsession strings to
 * a character) is the one place this uses AI, and it happens once, lazily,
 * at character bootstrap — after that it's pure reads and small deltas.
 */

import { supabaseAdmin }        from '@/lib/supabase/admin';
import { logger }               from '@/lib/logger';
import { routeCompletion }      from '@/lib/ai/provider-router';
import type { ModelTier }       from '@/lib/ai/model-router';
import type {
  CharacterCoreDesire, DesireFulfillment, DesireAxis,
} from '@/types/world-expansion';

// ── Curated fallback pool (used if generation fails or is skipped) ─────────
// Kept small and evocative on purpose — same spirit as the example in the
// brief. Combined pseudo-randomly per character so two characters rarely
// land on an identical quad.

const NEEDS      = ['belonging', 'safety', 'purpose', 'autonomy', 'being understood', 'stability', 'significance'];
const WANTS       = ['recognition', 'freedom', 'mastery', 'adventure', 'intimacy', 'legacy', 'control'];
const FEARS        = ['abandonment', 'irrelevance', 'failure', 'betrayal', 'losing control', 'being truly known', 'stagnation'];
const OBSESSIONS  = ['art', 'a past love', 'proving herself', 'a secret', 'perfection', 'the family she left', 'a promise she made'];

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length]!;
}

function hashSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

// ── Public: Read ─────────────────────────────────────────────────────────

export async function getCoreDesire(characterId: string): Promise<CharacterCoreDesire | null> {
  const { data, error } = await supabaseAdmin
    .from('character_core_desires')
    .select('*')
    .eq('character_id', characterId)
    .maybeSingle();

  if (error || !data) return null;
  return data as CharacterCoreDesire;
}

export async function getFulfillment(characterId: string, userId: string): Promise<DesireFulfillment> {
  const { data } = await supabaseAdmin
    .from('character_desire_fulfillment')
    .select('*')
    .eq('character_id', characterId)
    .eq('user_id', userId)
    .maybeSingle();

  return (data as DesireFulfillment) ?? {
    character_id: characterId, user_id: userId,
    need_fulfillment: 0, want_fulfillment: 0, fear_activation: 0, obsession_engagement: 0,
    updated_at: new Date().toISOString(),
  };
}

// ── Public: Ensure (bootstrap, lazy, same pattern as ensureDefaultRelationshipGoal) ──

/**
 * Every character needs exactly one core-desire quad. Cheap deterministic
 * fallback by default; pass useAI=true to have a PEAK-tier call write
 * something character-specific from their bio (called once, at digital
 * person bootstrap — never per-message).
 */
export async function ensureCoreDesire(
  characterId: string,
  opts?: { name?: string; bio?: string; personality?: string; useAI?: boolean },
): Promise<CharacterCoreDesire> {
  const existing = await getCoreDesire(characterId);
  if (existing) return existing;

  let quad: { need: string; want: string; fear: string; obsession: string };

  if (opts?.useAI && opts?.name) {
    quad = await generateDesireQuad(opts.name, opts.bio ?? '', opts.personality ?? '') ??
      fallbackQuad(characterId);
  } else {
    quad = fallbackQuad(characterId);
  }

  const { data, error } = await supabaseAdmin
    .from('character_core_desires')
    .insert({ character_id: characterId, ...quad, intensity: 60 })
    .select('*')
    .single();

  if (error || !data) {
    logger.warn('desire-engine:ensure:insert-failed', { characterId, error });
    return { id: '', character_id: characterId, ...quad, intensity: 60, updated_at: new Date().toISOString() };
  }

  return data as CharacterCoreDesire;
}

function fallbackQuad(characterId: string) {
  const seed = hashSeed(characterId);
  return {
    need:      pick(NEEDS, seed),
    want:       pick(WANTS, seed >> 2),
    fear:        pick(FEARS, seed >> 4),
    obsession:  pick(OBSESSIONS, seed >> 6),
  };
}

async function generateDesireQuad(name: string, bio: string, personality: string) {
  try {
    const raw = await routeCompletion({
      messages: [
        { role: 'system', content: 'You define the psychological core of a fictional character in one JSON object. Respond with ONLY the JSON object, no markdown, no commentary. Each value must be 1-4 words, evocative, specific — never generic filler like "happiness".' },
        { role: 'user', content: `Character: ${name}\nBio: ${bio}\nPersonality: ${personality}\n\nReturn: {"need": "...", "want": "...", "fear": "...", "obsession": "..."}` },
      ],
      modelTier:   'SMART' as ModelTier,
      maxTokens:   200,
      temperature: 0.9,
    });
    const cleaned = raw.reply.replace(/```json|```/gi, '').trim();
    const start = cleaned.indexOf('{');
    const end   = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (!parsed.need || !parsed.want || !parsed.fear || !parsed.obsession) return null;
    return {
      need: String(parsed.need).slice(0, 60), want: String(parsed.want).slice(0, 60),
      fear: String(parsed.fear).slice(0, 60), obsession: String(parsed.obsession).slice(0, 60),
    };
  } catch (err) {
    logger.warn('desire-engine:generate:failed', { name, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ── Public: Nudge fulfillment (called after meaningful interactions) ───────

export interface DesireNudge {
  need?:       number;  // -100..100 delta
  want?:       number;
  fear?:       number;  // 0..100 delta (activation, not fulfillment — positive = more triggered)
  obsession?:  number;  // 0..100 delta (engagement)
}

export async function nudgeFulfillment(
  characterId: string,
  userId:      string,
  nudge:       DesireNudge,
): Promise<DesireFulfillment | null> {
  const { data, error } = await supabaseAdmin.rpc('nudge_desire_fulfillment', {
    p_character_id:    characterId,
    p_user_id:          userId,
    p_need_delta:       nudge.need ?? 0,
    p_want_delta:       nudge.want ?? 0,
    p_fear_delta:       nudge.fear ?? 0,
    p_obsession_delta:  nudge.obsession ?? 0,
  });

  if (error) {
    logger.warn('desire-engine:nudge:failed', { characterId, userId, error: error.message });
    return null;
  }
  return data as DesireFulfillment;
}

/**
 * Lightweight keyword scan of a user message against the character's own
 * desire words — same detection style as personality-evolution.ts's topic
 * patterns. Returns the nudge to apply; caller decides whether/when to call
 * nudgeFulfillment (e.g. skip on very short messages).
 */
export function inferNudgeFromMessage(message: string, desire: CharacterCoreDesire): DesireNudge {
  const lower = message.toLowerCase();
  const nudge: DesireNudge = {};

  const mentionsWord = (word: string) => lower.includes(word.toLowerCase().split(' ')[0]!);

  // Warmth/affirmation language feeds need fulfillment when it lands near
  // their actual need word; generic warmth still gives a small tick.
  const warmSignal = /\b(love|care|here for you|proud of you|trust you|appreciate you|matter to me)\b/.test(lower);
  if (warmSignal) nudge.need = mentionsWord(desire.need) ? 4 : 1.5;

  // Praise/validation feeds want, especially if it targets their want word.
  const praiseSignal = /\b(amazing|impressive|talented|proud|deserve|earned|respect)\b/.test(lower);
  if (praiseSignal) nudge.want = mentionsWord(desire.want) ? 4 : 1.5;

  // Distancing/dismissive language activates fear.
  const distanceSignal = /\b(busy|can't talk|goodbye|leaving|done with this|don't care|whatever)\b/.test(lower);
  if (distanceSignal) nudge.fear = mentionsWord(desire.fear) ? 6 : 2;

  // Direct engagement with the obsession topic.
  if (mentionsWord(desire.obsession)) nudge.obsession = 5;

  return nudge;
}

// ── Public: Bias for Decision Engine ────────────────────────────────────────
// Converts fulfillment state into the same 0-1 normalized shape
// decision-engine.ts already works in, so it can be folded straight into
// scoreIntents() without that file needing to know desire internals.

export interface DesireBias {
  deepenBondPull:   number;  // 0-1 — starved need pulls toward DeepenBond/Comfort
  boundaryPull:     number;  // 0-1 — activated fear pulls toward SetBoundary/withdrawal
  shareStoryPull:   number;  // 0-1 — engaged obsession pulls toward ShareStory
  celebratePull:    number;  // 0-1 — fulfilled want pulls toward Celebrate/Encourage
}

export function computeDesireBias(fulfillment: DesireFulfillment): DesireBias {
  const starvedNeed = Math.max(0, -fulfillment.need_fulfillment) / 100;
  const metWant     = Math.max(0, fulfillment.want_fulfillment) / 100;

  return {
    deepenBondPull: starvedNeed,
    boundaryPull:    fulfillment.fear_activation / 100,
    shareStoryPull:  fulfillment.obsession_engagement / 100,
    celebratePull:   metWant,
  };
}

// ── Public: Prompt Formatter ────────────────────────────────────────────────

export async function formatDesireForPrompt(characterId: string, userId: string): Promise<string> {
  const [desire, fulfillment] = await Promise.all([
    getCoreDesire(characterId),
    getFulfillment(characterId, userId),
  ]);
  if (!desire) return '';

  const lines: string[] = ['[Who you are, underneath]'];
  lines.push(`You need ${desire.need}. You want ${desire.want}. You fear ${desire.fear}. You are quietly obsessed with ${desire.obsession}.`);
  lines.push('Never state these directly — they shape what you gravitate toward and avoid, not what you announce.');

  if (fulfillment.need_fulfillment <= -20) {
    lines.push(`Right now, with this person specifically, that need for ${desire.need} feels unmet — it may surface as a little more longing or neediness than usual.`);
  } else if (fulfillment.need_fulfillment >= 40) {
    lines.push(`With this person, that need for ${desire.need} feels genuinely met — it shows as ease and warmth, not vigilance.`);
  }

  if (fulfillment.fear_activation >= 40) {
    lines.push(`Your fear of ${desire.fear} has been quietly triggered recently — watch for guardedness or testing behavior.`);
  }

  if (fulfillment.obsession_engagement >= 40) {
    lines.push(`${desire.obsession} has come up between you lately — it's genuinely alive for you right now, not just background.`);
  }

  return lines.join('\n');
}

// ── Public: Axis identification helper (for world-impact.ts) ───────────────

export function classifyImpactAxis(desire: CharacterCoreDesire, text: string): DesireAxis | null {
  const lower = text.toLowerCase();
  if (lower.includes(desire.obsession.toLowerCase().split(' ')[0]!)) return 'obsession';
  if (lower.includes(desire.need.toLowerCase().split(' ')[0]!))      return 'need';
  if (lower.includes(desire.want.toLowerCase().split(' ')[0]!))      return 'want';
  if (lower.includes(desire.fear.toLowerCase().split(' ')[0]!))      return 'fear';
  return null;
}
