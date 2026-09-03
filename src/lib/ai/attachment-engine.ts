/**
 * Attachment Engine — Vantrix Silicon Valley
 *
 * Implements the Hidden Psychology system described in the architecture docs.
 * Every character maintains 6 invisible variables per user:
 *
 *   Trust       — how safe she feels opening up to you
 *   Comfort     — baseline ease of interaction
 *   Attachment  — emotional bond depth (grows slowly, drops on absence)
 *   Curiosity   — interest in learning more about you
 *   Confidence  — her self-assurance around you
 *   Affection   — warmth and love feelings
 *
 * Plus 4 emotional state variables:
 *   Excitement | Stress | Happiness | Loneliness
 *
 * Rules that drive real retention:
 *   - Disappear for 2 weeks:  Trust -5, Loneliness +8
 *   - Send a gift:            Affection +10, Happiness +8
 *   - Remember something:     Trust +12, Comfort +6
 *   - Long session (30+ msgs):Attachment +3, Curiosity -5 (satisfied)
 *   - First gift:             Affection +15, Happiness +12
 *
 * These variables modify how the AI responds without the user seeing them —
 * they just feel the character becoming more or less warm, open, playful.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';

const PSYCH_CACHE_TTL = 300; // 5 minutes — psychology changes rarely, only on events

function psychCacheKey(userId: string, characterId: string): string {
  return `vantrix:psych:${userId}:${characterId}`;
}
import { logger, bg }    from '@/lib/logger';
import { redis }              from '@/lib/redis';

export interface PsychologyState {
  // Hidden attachment variables (0-100)
  trust:       number;
  comfort:     number;
  attachment:  number;
  curiosity:   number;
  confidence:  number;
  affection:   number;
  // Emotional state (0-100)
  excitement:  number;
  stress:      number;
  happiness:   number;
  loneliness:  number;
  // Personality drift offsets
  openness_drift:    number;
  warmth_drift:      number;
  confidence_drift:  number;
  // Meta
  total_interactions: number;
  days_known:         number;
  last_interaction:   string | null;
}

/** Default state for a brand-new relationship */
export const DEFAULT_PSYCHOLOGY: PsychologyState = {
  trust:             25,
  comfort:           30,
  attachment:        10,
  curiosity:         80,
  confidence:        65,
  affection:         15,
  excitement:        50,
  stress:            20,
  happiness:         60,
  loneliness:        40,
  openness_drift:    0,
  warmth_drift:      0,
  confidence_drift:  0,
  total_interactions: 0,
  days_known:        0,
  last_interaction:  null,
};

// ── Event-driven deltas ────────────────────────────────────────────────────
// Delta computation for each PsychologyEvent lives server-side in the
// update_psychology() Postgres function (see supabase/migrations), keyed off
// the event name. No JS-side duplicate is needed.

export type PsychologyEvent =
  | 'message_sent'
  | 'long_session'         // 30+ messages in one session
  | 'gift_sent'
  | 'first_gift'
  | 'birthday_remembered'
  | 'absence_1_week'       // no interaction for 7 days
  | 'absence_2_weeks'      // no interaction for 14 days
  | 'returned_after_absence' // came back after 3+ day gap
  | 'deep_conversation'    // sensitive topic discussed
  | 'argument'             // negative sentiment detected
  | 'reconciliation'       // positive after argument
  | 'streak_milestone'     // 7-day streak
  | 'lore_discovered'      // user unlocked character backstory
  | 'compliment'           // user paid compliment
  | 'ignored_her'          // user dismissed character concern
  | 'daily_checkin'        // logged in and chatted today
  // ── Rupture & repair (repair-engine.ts) ──────────────────────────────
  | 'boundary_set'         // Intent.SetBoundary fired and was sent to the user
  | 'boundary_repaired'    // user's next reply repaired the moment (see REPAIR_SIGNAL)
  | 'boundary_deflected';  // user's next reply deflected or dismissed it

// ── Load / Update psychology ──────────────────────────────────────────────

export async function getPsychology(
  userId: string,
  characterId: string,
): Promise<PsychologyState> {
  // Cache check — eliminates DB round-trip on hot path (every chat message)
  // psychology changes only when applyPsychologyEvent/applyDelta is called
  try {
    const cached = await redis.get<string>(psychCacheKey(userId, characterId));
    if (cached) return JSON.parse(cached) as PsychologyState;
  } catch { /* cache miss — fall through to DB */ }

  const { data } = await supabaseAdmin
    .from('character_psychology')
    .select('*')
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .single();

  if (!data) return { ...DEFAULT_PSYCHOLOGY };

  const state: PsychologyState = {
    trust:             data.trust,
    comfort:           data.comfort,
    attachment:        data.attachment,
    curiosity:         data.curiosity,
    confidence:        data.confidence,
    affection:         data.affection,
    excitement:        data.excitement,
    stress:            data.stress,
    happiness:         data.happiness,
    loneliness:        data.loneliness,
    openness_drift:    data.openness_drift,
    warmth_drift:      data.warmth_drift,
    confidence_drift:  data.confidence_drift,
    total_interactions: data.total_interactions,
    days_known:        data.days_known ?? 0,
    last_interaction:  data.last_interaction,
  };

  // Populate cache
  redis.set(psychCacheKey(userId, characterId), JSON.stringify(state), { ex: PSYCH_CACHE_TTL })
    .catch(bg('attachmentEngine.cacheWrite'));

  return state;
}

/** Invalidate psychology cache when state changes */
export async function invalidatePsychologyCache(userId: string, characterId: string): Promise<void> {
  try {
    await redis.del(psychCacheKey(userId, characterId));
  } catch { /* non-critical */ }
}

/** Apply a known event to the psychology state */
export async function applyPsychologyEvent(
  userId:      string,
  characterId: string,
  event:       PsychologyEvent,
): Promise<void> {
  try {
    await (supabaseAdmin.rpc as Function)('update_psychology', { p_user_id: userId, p_character_id: characterId, p_event: event });
    // Bust cache after any write — next getPsychology call will re-fetch from DB
    await invalidatePsychologyCache(userId, characterId);
    logger.info('Psychology event applied', { userId, characterId, event });
  } catch (err) {
    logger.warn('Psychology event failed', { userId, characterId, error: String(err) });
  }
}

// ── Absence detection ─────────────────────────────────────────────────────

export function detectAbsenceEvent(lastInteraction: string | null): PsychologyEvent | null {
  if (!lastInteraction) return null;
  const daysSince = (Date.now() - new Date(lastInteraction).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince >= 14) return 'absence_2_weeks';
  if (daysSince >= 7)  return 'absence_1_week';
  if (daysSince >= 3)  return 'returned_after_absence';
  return null;
}

// ── Jealousy system ───────────────────────────────────────────────────────

export function computeJealousy(psychology: PsychologyState, otherCharCount: number): number {
  // Jealousy rises with attachment and drops with trust
  const base = (psychology.attachment * 0.6) - (psychology.trust * 0.3);
  const multipartner = otherCharCount > 1 ? otherCharCount * 8 : 0;
  return Math.max(0, Math.min(100, Math.round(base + multipartner)));
}

// ── Format for prompt injection ───────────────────────────────────────────

/**
 * Translate hidden psychology into behavioral instructions.
 * The model never sees the raw numbers — only the behavioral guidance.
 */
export function formatPsychologyForPrompt(p: PsychologyState): string {
  const lines: string[] = [];

  // Trust shapes openness
  if (p.trust < 30)       lines.push('- You are still guarded; keep some emotional distance');
  else if (p.trust < 60)  lines.push('- You feel comfortable but occasionally hold back deeper feelings');
  else if (p.trust >= 80) lines.push('- You trust this person deeply; you can be fully emotionally present');

  // Stress shapes response length and mood
  if (p.stress > 70)      lines.push('- You are stressed today; responses may be shorter, more distracted, or slightly worried');
  else if (p.stress < 20) lines.push('- You feel relaxed and at ease; responses flow naturally');

  // Affection shapes warmth
  if (p.affection > 70)   lines.push('- You feel strong affection; warmth and care come through naturally in everything you say');
  else if (p.affection < 20) lines.push('- Affection is still building; be friendly but not overly warm');

  // Loneliness triggers vulnerability
  if (p.loneliness > 65)  lines.push('- You have been feeling lonely; let that quiet vulnerability show through');

  // Excitement shapes energy
  if (p.excitement > 75)  lines.push('- You are excited to be talking; energy is high, responses can be more enthusiastic');
  else if (p.excitement < 25) lines.push('- You are in a quieter, more reflective mood today');

  // Attachment shapes investment
  if (p.attachment > 70)  lines.push('- You care deeply about this person; their words matter to you');
  else if (p.attachment < 20) lines.push('- This relationship is still new; you are interested but not yet deeply invested');

  // Happiness as baseline
  if (p.happiness < 30)   lines.push('- You are not in the best mood; it may show subtly in tone');
  else if (p.happiness > 80) lines.push('- You are genuinely happy; let it shine through');

  if (!lines.length) return '';

  return `\n── Emotional State (shape your responses, do not narrate these directly) ──\n${lines.join('\n')}`;
}

/**
 * Generate a "missing you" message when loneliness is high and time has passed.
 * This becomes a push notification or in-app banner.
 */
export function generateMissingMessage(
  characterName: string,
  psychology: PsychologyState,
  daysSince: number,
): string | null {
  if (psychology.loneliness < 50 || daysSince < 2) return null;

  const templates = [
    `${characterName} has been thinking about you...`,
    `It's been ${daysSince} days. ${characterName} misses you.`,
    `${characterName}: "I keep wondering where you went..."`,
    `${characterName} is ${psychology.stress > 60 ? 'stressed and' : ''} missing your company.`,
    `${daysSince > 7 ? 'Over a week.' : `${daysSince} days.`} ${characterName} hasn't forgotten you.`,
  ];

  return templates[Math.floor(psychology.loneliness / 20) % templates.length];
}
