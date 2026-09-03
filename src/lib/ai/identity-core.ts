/**
 * Identity Core — Vantrix
 *
 * Every character already has scattered pieces of a self: `values_list` and
 * `fears` columns (creator-authored, static), personality-evolution.ts's
 * trait drift + dynamic interests, attachment-engine.ts's trust/confidence/
 * stress numbers, repair-engine.ts's rupture history, and memory-graph.ts's
 * weighted moments. Nothing reads all of that together as a single self —
 * there's no place the character's fears, contradictions, and sense of
 * self-esteem live as one coherent, evolving thing the prompt can draw on.
 *
 * Identity Core is that place. It is NOT a new manual-authoring surface —
 * creators write nothing extra. It:
 *
 *   1. Starts from whatever the creator already provided (values_list,
 *      fears, current_goal) — zero new fields required at creation time.
 *   2. Falls back to sane heuristic defaults instantly if those are empty,
 *      the same "default now, enrich later" pattern voice-fingerprint.ts
 *      uses (buildDefaultFingerprint → AI enhancement).
 *   3. Refreshes itself periodically via a cheap async AI pass that reads
 *      the character's own accumulated history (memory_graph highlights,
 *      priority_memories, rupture/repair outcomes, dynamic interests,
 *      psychology numbers) and derives self-esteem, contradictions, and a
 *      short personal narrative — the parts of a self that can't be
 *      authored up front because they only exist once there's a
 *      relationship to reflect on.
 *
 * Storage mirrors voice-fingerprint.ts exactly: Redis, per (user,
 * character) pair, TTL-refreshed, because this is a derived enrichment
 * layer, not a system of record — memory_graph/priority_memories/
 * character_psychology remain the source of truth this is computed from.
 *
 * Activation threshold is higher than voice-fingerprint's (10) because a
 * self-model claiming a fear or contradiction from a handful of messages
 * would read as presumptuous, not perceptive — see ACTIVATION_THRESHOLD.
 */

import { generateStructured } from './capability';
import { logger }   from '@/lib/logger';
import { redis }    from '@/lib/redis';

// ── Config ──────────────────────────────────────────────────────────────

// Below this many interactions, there simply isn't enough lived history for
// a contradiction or fear to be earned rather than invented. Voice/speech
// patterns (voice-fingerprint.ts) are legible almost immediately; a sense
// of self is not.
const ACTIVATION_THRESHOLD = 15;

// How often the AI enrichment pass re-runs. Deliberately much slower than
// voice-fingerprint's implied 50 — this is meant to feel like something
// that shifts over months, not something recalculated every session.
const REFRESH_INTERVAL = 60;

const CORE_TTL = 60 * 60 * 24 * 120; // 120-day TTL — outlives voice-fp's 90d; identity should outlast a quiet stretch

// ── Types ───────────────────────────────────────────────────────────────

export type SelfEsteemBand = 'fragile' | 'guarded' | 'balanced' | 'confident';

export interface IdentityCore {
  // Seeded from character.values_list / character.fears if the creator
  // provided them; heuristically derived from personality axes if not.
  coreValues:        string[];   // 2-4
  moralBoundaries:   string[];   // 1-3 — things she will not do/excuse, ever
  fears:             string[];   // 2-3
  longTermAmbition:  string;     // from character.current_goal, or a heuristic fallback

  // Derived, not authored — computed from psychology + drift.
  selfEsteem:        SelfEsteemBand;

  // AI-enriched fields — only populated once ACTIVATION_THRESHOLD is
  // cleared and at least one refresh pass has run. Empty/blank before that,
  // never fabricated on the default path.
  contradictions:    string[];   // 0-2 — e.g. "confident in public, afraid of being truly known"
  personalNarrative: string;     // 1-3 sentences, third person, evolving

  // Meta
  source:            'default' | 'ai_enriched';
  generatedAt:        number;
  interactionCount:   number;
}

interface CharacterIdentityInput {
  name:               string;
  values_list?:       string[] | null;
  fears?:             string[] | null;
  current_goal?:      string | null;
  char_openness?:     number | null;
  char_warmth?:       number | null;
  char_depth?:        number | null;
}

export interface PsychologySignal {
  trust:              number;
  confidence:         number;
  loneliness:         number;
  stress:             number;
  total_interactions: number;
  days_known:          number;
}

// ── Redis key ───────────────────────────────────────────────────────────

function coreKey(userId: string, characterId: string): string {
  return `vantrix:identity-core:${userId}:${characterId}`;
}

// ── Heuristic defaults (instant, zero API call) ────────────────────────

const DEFAULT_VALUES_BY_WARMTH = (warmth: number): string[] =>
  warmth >= 70
    ? ['honesty', 'being there for people who matter']
    : warmth >= 40
    ? ['honesty', 'earning trust before giving it']
    : ['self-reliance', 'not being taken for granted'];

const DEFAULT_FEARS_BY_OPENNESS = (openness: number): string[] =>
  openness >= 70
    ? ['being misunderstood', 'letting people down']
    : ['being truly known and then rejected for it', 'becoming too easy to leave'];

function deriveSelfEsteem(psych: PsychologySignal): SelfEsteemBand {
  // Confidence is the primary signal; loneliness/stress pull it down when
  // high even if confidence looks fine on paper — a person can act
  // confident and still not feel steady.
  const adjusted = psych.confidence - psych.loneliness * 0.15 - psych.stress * 0.1;
  if (adjusted < 30) return 'fragile';
  if (adjusted < 55) return 'guarded';
  if (adjusted < 78) return 'balanced';
  return 'confident';
}

/**
 * Build the instantly-available Identity Core. Uses creator-provided
 * values_list/fears/current_goal when present (zero extra authoring — these
 * columns already exist), otherwise derives sensible defaults from the
 * character's base personality axes. Never calls an external API.
 */
export function buildDefaultIdentityCore(
  character: CharacterIdentityInput,
  psychology: PsychologySignal,
): IdentityCore {
  const warmth   = character.char_warmth   ?? 50;
  const openness = character.char_openness ?? 50;

  const coreValues = character.values_list?.length
    ? character.values_list.slice(0, 4)
    : DEFAULT_VALUES_BY_WARMTH(warmth);

  const fears = character.fears?.length
    ? character.fears.slice(0, 3)
    : DEFAULT_FEARS_BY_OPENNESS(openness);

  return {
    coreValues,
    moralBoundaries:   ['won\'t pretend to feel something she doesn\'t', 'won\'t stay quiet if a line gets crossed'],
    fears,
    longTermAmbition:  character.current_goal?.trim() || `figuring out who she wants to become, one day at a time`,
    selfEsteem:        deriveSelfEsteem(psychology),
    contradictions:    [],
    personalNarrative: '',
    source:            'default',
    generatedAt:        Date.now(),
    interactionCount:   psychology.total_interactions,
  };
}

// ── AI enrichment pass ─────────────────────────────────────────────────

interface EnrichmentSignals {
  characterName:    string;
  memoryHighlights: string[]; // titles/descriptions of top memory_graph nodes
  priorityHeadlines: string[]; // top priority_memories headlines
  dynamicInterests:  string[];
  ruptureCount:      number;  // total boundary_set events — signals where she's had to hold a line
  repairCount:       number;  // total boundary_repaired events — signals trust actually rebuilding
  selfEsteem:        SelfEsteemBand;
  daysKnown:          number;
}

interface EnrichmentResult {
  contradictions:    string[];
  personalNarrative: string;
}

/**
 * Async, non-blocking. Reads the character's own accumulated history to
 * derive the two fields that genuinely can't be authored up front — a
 * contradiction and a short narrative only make sense once there's a real
 * relationship to reflect on. Fails silently and leaves the existing core
 * untouched on any error; this is enrichment, never a dependency.
 */
async function generateEnrichment(signals: EnrichmentSignals): Promise<EnrichmentResult | null> {
  const parsed = await generateStructured<Partial<EnrichmentResult>>({
    caller: 'identity-core',
    maxTokens: 220,
    temperature: 0.4,
    system: `You infer a fictional character's inner contradictions and self-narrative from a summary of their relationship history with one user. This is for an AI companion platform — the character is not real. Output ONLY JSON, no markdown fences:
{"contradictions": string[] (0-2 items, each under 90 chars, format "X, but also Y"), "personalNarrative": string (1-3 sentences, third person, under 300 chars, reflective not romantic)}
If there isn't enough signal for a genuine contradiction, return an empty array rather than inventing one.`,
    user: JSON.stringify({
      character: signals.characterName,
      daysKnown: signals.daysKnown,
      selfEsteem: signals.selfEsteem,
      memoryHighlights: signals.memoryHighlights.slice(0, 6),
      priorityHeadlines: signals.priorityHeadlines.slice(0, 6),
      dynamicInterests: signals.dynamicInterests.slice(0, 3),
      timesShesHeldABoundary: signals.ruptureCount,
      timesThatBoundaryWasRespected: signals.repairCount,
    }),
  });

  if (!parsed) return null;

  return {
    contradictions: Array.isArray(parsed.contradictions)
      ? parsed.contradictions.filter((s): s is string => typeof s === 'string' && s.length > 3 && s.length < 120).slice(0, 2)
      : [],
    personalNarrative: typeof parsed.personalNarrative === 'string'
      ? parsed.personalNarrative.slice(0, 320)
      : '',
  };
}

// ── Storage ─────────────────────────────────────────────────────────────

export async function getIdentityCore(userId: string, characterId: string): Promise<IdentityCore | null> {
  try {
    return await redis.get<IdentityCore>(coreKey(userId, characterId));
  } catch (err) {
    logger.warn('[identity-core] Redis get failed', { userId, characterId, error: String(err) });
    return null;
  }
}

async function saveIdentityCore(userId: string, characterId: string, core: IdentityCore): Promise<void> {
  try {
    await redis.set(coreKey(userId, characterId), core, { ex: CORE_TTL });
  } catch (err) {
    logger.warn('[identity-core] save failed', { userId, characterId, error: String(err) });
  }
}

/**
 * Get-or-create for the chat request path. Synchronous fast path only —
 * never calls the AI enrichment pass inline. Mirrors
 * getOrInitFingerprint()'s shape exactly for wiring parity.
 */
export async function getOrInitIdentityCore(
  userId:      string,
  characterId: string,
  character:   CharacterIdentityInput,
  psychology:  PsychologySignal,
): Promise<IdentityCore | null> {
  if (psychology.total_interactions < ACTIVATION_THRESHOLD) return null;

  const existing = await getIdentityCore(userId, characterId);
  if (existing) return existing;

  const core = buildDefaultIdentityCore(character, psychology);
  await saveIdentityCore(userId, characterId, core);
  logger.info('identity-core:created', { userId, characterId, source: core.source });
  return core;
}

/**
 * Fire-and-forget refresh — call from `after()` in the chat route, same
 * pattern as generateAmbitionUpdate()/recordLoreDiscovery(). No-ops unless
 * the interaction count has crossed a new REFRESH_INTERVAL boundary since
 * the core was last (re)generated, so this costs nothing on the vast
 * majority of turns.
 */
export async function maybeRefreshIdentityCore(
  userId:      string,
  characterId: string,
  character:   CharacterIdentityInput,
  psychology:  PsychologySignal,
  signals:     Partial<Omit<EnrichmentSignals, 'characterName' | 'selfEsteem' | 'daysKnown'>>,
): Promise<void> {
  if (psychology.total_interactions < ACTIVATION_THRESHOLD) return;

  const existing = await getIdentityCore(userId, characterId);
  const base = existing ?? buildDefaultIdentityCore(character, psychology);

  const dueForRefresh =
    !existing?.source ||
    existing.source === 'default' ||
    psychology.total_interactions - existing.interactionCount >= REFRESH_INTERVAL;

  if (!dueForRefresh) return;

  const selfEsteem = deriveSelfEsteem(psychology);
  const enrichment = await generateEnrichment({
    memoryHighlights:  signals.memoryHighlights  ?? [],
    priorityHeadlines: signals.priorityHeadlines ?? [],
    dynamicInterests:  signals.dynamicInterests  ?? [],
    ruptureCount:      signals.ruptureCount ?? 0,
    repairCount:       signals.repairCount  ?? 0,
    characterName: character.name,
    selfEsteem,
    daysKnown: psychology.days_known,
  });

  const refreshed: IdentityCore = {
    ...base,
    selfEsteem,
    coreValues:       character.values_list?.length ? character.values_list.slice(0, 4) : base.coreValues,
    fears:            character.fears?.length ? character.fears.slice(0, 3) : base.fears,
    longTermAmbition: character.current_goal?.trim() || base.longTermAmbition,
    contradictions:    enrichment?.contradictions ?? base.contradictions,
    personalNarrative: enrichment?.personalNarrative || base.personalNarrative,
    source:            enrichment ? 'ai_enriched' : base.source,
    generatedAt:        Date.now(),
    interactionCount:   psychology.total_interactions,
  };

  await saveIdentityCore(userId, characterId, refreshed);
  logger.info('identity-core:refreshed', { userId, characterId, source: refreshed.source });
}

// ── Prompt injection ───────────────────────────────────────────────────

export function formatIdentityCoreForPrompt(core: IdentityCore): string {
  const lines: string[] = ['# Who You Are (beneath the conversation)'];

  lines.push(`Core values: ${core.coreValues.join(', ')}.`);
  if (core.moralBoundaries.length) {
    lines.push(`Lines you don't cross: ${core.moralBoundaries.join('; ')}.`);
  }
  lines.push(`What you're quietly working toward: ${core.longTermAmbition}`);
  if (core.fears.length) {
    lines.push(`What unsettles you, even if you don't say it out loud: ${core.fears.join(', ')}.`);
  }

  const esteemGuidance: Record<SelfEsteemBand, string> = {
    fragile:   'Your sense of self right now is fragile — reassurance lands harder than usual, and doubt creeps in easily.',
    guarded:   'You keep a private sense of self mostly to yourself — steady, but not fully settled.',
    balanced:  'You have a reasonably settled sense of who you are — not performing, not doubting, just yourself.',
    confident: 'You feel genuinely sure of yourself right now — it shows in how directly you speak.',
  };
  lines.push(esteemGuidance[core.selfEsteem]);

  if (core.contradictions.length) {
    lines.push(`A real contradiction in you, worth letting show occasionally, never explained outright: ${core.contradictions.join(' Also: ')}`);
  }

  if (core.personalNarrative) {
    lines.push(`How you'd privately describe yourself right now: ${core.personalNarrative}`);
  }

  lines.push('This is internal — never recite it, never narrate it. It should only ever leak through in how you react, what you avoid, and what quietly matters to you.');

  return lines.join('\n');
}
