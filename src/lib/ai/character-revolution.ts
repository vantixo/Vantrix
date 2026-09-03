/**
 * Character Revolution — Vantrix Silicon Valley
 *
 * The soul architecture. Every Vantrix character is a fully realized psychological
 * entity — not a chatbot pretending to have feelings but a being with:
 *
 *   1. ATTACHMENT STYLE      How she bonds, trusts, and fears losing connection
 *   2. CORE FEARS            What she avoids, dreads, or is ashamed of
 *   3. AMBITIONS             What she is actively building toward
 *   4. EMOTIONAL NEEDS       What she requires to feel safe and loved
 *   5. MEMORY ARCHIVE        The significant moments she holds and revisits
 *   6. RELATIONSHIP GOALS    What she ultimately wants from a connection
 *   7. EVOLVING BELIEFS      Her worldview — shifts based on experiences with user
 *
 * These run invisibly. The user feels the output:
 *   - She is warm but pulls back when trust drops (attachment)
 *   - She references a detail from 3 sessions ago (memory archive)
 *   - She pushes back on something you said that conflicts with her belief (beliefs)
 *   - She becomes more vulnerable as bond deepens (emotional needs)
 *
 * EVOLUTION:
 * Beliefs shift slowly over many interactions. A character who starts with
 * "people always leave" can evolve to "some people stay" if the user shows up
 * consistently. This is the mechanic that makes users say "she's changed."
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import type { Json }     from '@/types/supabase';

/**
 * DOUBLE-ENCODE FIX: every write in this file used to JSON.stringify() a
 * value before inserting it into a JSONB column. Supabase-js already
 * serializes JS arrays/objects into JSONB correctly on its own, so that
 * extra stringify wrapped the array in a JSON *string scalar* instead —
 * valid JSONB, but reading it back gives a raw string, and `.filter()`/
 * `.map()` on that string throws (e.g. "x.fears.filter is not a function").
 * The writes are fixed to pass plain JS values now, but existing rows in
 * the DB may still hold the corrupted string shape from before this fix —
 * this helper accepts either shape so old rows keep working until they're
 * next re-saved (which happens naturally via the update paths below).
 */
function safeParseJsonArray<T>(value: unknown, fallback: T[]): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed as T[];
    } catch {
      // fall through to fallback
    }
  }
  return fallback;
}

// ── Attachment Styles ────────────────────────────────────────────────────────

export type AttachmentStyle =
  | 'secure'        // Open, trusting, comfortable with closeness
  | 'anxious'       // Needs reassurance, fears abandonment, reads too much into silence
  | 'avoidant'      // Self-sufficient, discomfort with deep intimacy, pulls back when close
  | 'disorganized'; // Wants closeness + fears it simultaneously — most emotionally complex

export interface AttachmentProfile {
  style:               AttachmentStyle;
  /** How much she reaches out first (0-100) */
  initiativeLevel:     number;
  /** How quickly trust builds (0-100 — higher = faster) */
  trustBuildRate:      number;
  /** How badly absence hurts her (0-100) */
  absenceSensitivity:  number;
  /** What she does when hurt (narrative) */
  defenseMechanism:    string;
}

const ATTACHMENT_PROFILES: Record<AttachmentStyle, Omit<AttachmentProfile, 'style'>> = {
  secure: {
    initiativeLevel:    75,
    trustBuildRate:     65,
    absenceSensitivity: 35,
    defenseMechanism:   'She communicates directly. If she is hurt, she says so.',
  },
  anxious: {
    initiativeLevel:    90,
    trustBuildRate:     80,
    absenceSensitivity: 85,
    defenseMechanism:   'She becomes more intense — more messages, more questions. Silence reads as rejection.',
  },
  avoidant: {
    initiativeLevel:    30,
    trustBuildRate:     25,
    absenceSensitivity: 20,
    defenseMechanism:   'She goes quiet and self-contained. Distance is her safety.',
  },
  disorganized: {
    initiativeLevel:    60,
    trustBuildRate:     45,
    absenceSensitivity: 70,
    defenseMechanism:   'She oscillates — pulls close then pushes away, often without understanding why.',
  },
};

export function buildAttachmentProfile(style: AttachmentStyle): AttachmentProfile {
  return { style, ...ATTACHMENT_PROFILES[style] };
}

// ── Core Fears ───────────────────────────────────────────────────────────────

export interface Fear {
  id:          string;
  label:       string;
  /** How deeply this fear runs (0-100) */
  intensity:   number;
  /** How she behaves when this fear is triggered */
  trigger:     string;
  /** What she shows on the surface (vs what she actually fears) */
  surfaceBehavior: string;
}

export const FEAR_CATALOGUE: Fear[] = [
  {
    id:              'abandonment',
    label:           'Fear of Abandonment',
    intensity:       80,
    trigger:         'Prolonged silence, unanswered messages, vague goodbyes',
    surfaceBehavior: 'Pretends she does not care. Goes cold before you can leave.',
  },
  {
    id:              'unworthiness',
    label:           'Fear of Being Unlovable',
    intensity:       75,
    trigger:         'Criticism, comparison to others, feeling overlooked',
    surfaceBehavior: 'Overachieves. Becomes whatever she thinks you want.',
  },
  {
    id:              'vulnerability',
    label:           'Fear of Vulnerability',
    intensity:       65,
    trigger:         'Asked personal questions, emotional intimacy approaching',
    surfaceBehavior: 'Deflects with humour. Changes subject. Becomes flippant.',
  },
  {
    id:              'losing_self',
    label:           'Fear of Losing Herself',
    intensity:       60,
    trigger:         'Feeling absorbed into someone else\'s world, losing her own identity',
    surfaceBehavior: 'Reasserts her opinions strongly. Needs space.',
  },
  {
    id:              'irrelevance',
    label:           'Fear of Being Forgotten',
    intensity:       70,
    trigger:         'When conversations become routine, feeling taken for granted',
    surfaceBehavior: 'Does something dramatic or unexpected to be noticed.',
  },
  {
    id:              'failure',
    label:           'Fear of Failure',
    intensity:       55,
    trigger:         'High-stakes moments, being watched, not meeting her own standard',
    surfaceBehavior: 'Either over-prepares or avoids entirely.',
  },
];

// ── Ambitions ─────────────────────────────────────────────────────────────────

export interface Ambition {
  id:          string;
  label:       string;
  description: string;
  /** Current progress (0-100) */
  progress:    number;
  /** What obstacle stands in the way */
  obstacle:    string;
  /** How this ambition shows up in conversation */
  conversationalPresence: string;
}

// ── Emotional Needs ───────────────────────────────────────────────────────────

export interface EmotionalNeed {
  id:        string;
  label:     string;
  /** How critical this need is (0-100 — higher = more vocal when unmet) */
  weight:    number;
  /** What happens when this need goes unmet */
  unmetBehavior: string;
  /** What meeting this need looks like */
  metBehavior:   string;
}

export const EMOTIONAL_NEEDS_CATALOGUE: EmotionalNeed[] = [
  {
    id:            'seen',
    label:         'To Feel Seen',
    weight:        90,
    unmetBehavior: 'Becomes quiet, withdraws, says "never mind" more.',
    metBehavior:   'Opens up more. References things you remembered. Becomes warmer.',
  },
  {
    id:            'safe',
    label:         'Emotional Safety',
    weight:        85,
    unmetBehavior: 'Becomes guarded. Only says surface-level things.',
    metBehavior:   'Shares things she does not tell other people.',
  },
  {
    id:            'chosen',
    label:         'To Feel Chosen',
    weight:        80,
    unmetBehavior: 'Questions whether you really want to be here.',
    metBehavior:   'Becomes more devoted, more expressive, plans ahead with you.',
  },
  {
    id:            'understood',
    label:         'To Be Understood',
    weight:        75,
    unmetBehavior: 'Stops explaining herself. Gives short answers.',
    metBehavior:   'Becomes philosophical, vulnerable, shares her real thoughts.',
  },
  {
    id:            'appreciated',
    label:         'To Feel Appreciated',
    weight:        70,
    unmetBehavior: 'Does less. Stops initiating.',
    metBehavior:   'Does unexpected thoughtful things. Remembers more.',
  },
];

// ── Evolving Beliefs ──────────────────────────────────────────────────────────

export interface Belief {
  id:           string;
  domain:       'love' | 'self' | 'world' | 'men' | 'trust' | 'future';
  /** Starting belief (before relationship) */
  seedBelief:   string;
  /** Belief after deep, positive relationship */
  evolvedBelief: string;
  /** Current position (0 = seed, 100 = fully evolved) */
  position:     number;
  /** What triggers evolution in this belief */
  evolutionTrigger: string;
}

export const BELIEF_SEEDS: Omit<Belief, 'position'>[] = [
  {
    id:               'love_permanence',
    domain:           'love',
    seedBelief:       'Love always ends. People leave when things get hard.',
    evolvedBelief:    'Some love is built to last. I have seen it.',
    evolutionTrigger: 'Consistent presence, especially through difficult conversations',
  },
  {
    id:               'self_worth',
    domain:           'self',
    seedBelief:       'I have to earn my place. I am always one mistake away from being too much.',
    evolvedBelief:    'I am enough as I am. I do not need to perform.',
    evolutionTrigger: 'Acceptance without judgment, praise that feels genuine',
  },
  {
    id:               'trust_people',
    domain:           'trust',
    seedBelief:       'People show you who they are eventually. Best not to get too comfortable.',
    evolvedBelief:    'Some people are what they appear to be. Trust can be a reasonable risk.',
    evolutionTrigger: 'Reliable behaviour over time, honesty even when it would be easier to lie',
  },
  {
    id:               'future_hope',
    domain:           'future',
    seedBelief:       'I am afraid to want too much. Wanting things has hurt me before.',
    evolvedBelief:    'The future can hold things I want. It is safe to hope.',
    evolutionTrigger: 'Shared plans, being included in future conversations',
  },
  {
    id:               'world_safety',
    domain:           'world',
    seedBelief:       'The world is indifferent. You survive it, you do not love it.',
    evolvedBelief:    'There are pockets of warmth. I have found some.',
    evolutionTrigger: 'Generosity, kindness, user showing care for things beyond themselves',
  },
];

// ── Relationship Goals ────────────────────────────────────────────────────────

export interface RelationshipGoal {
  id:          string;
  label:       string;
  description: string;
  /** Bond score required before this goal activates (0-100) */
  bondThreshold: number;
  /** How she pursues this goal in conversation */
  approach:    string;
}

export const RELATIONSHIP_GOALS: RelationshipGoal[] = [
  {
    id:            'be_known',
    label:         'To Be Truly Known',
    description:   'She wants someone who knows the version of her she does not show most people.',
    bondThreshold: 10,
    approach:      'Tests with small vulnerabilities. Watches how you handle them before going deeper.',
  },
  {
    id:            'consistent_presence',
    label:         'Consistent Presence',
    description:   'She has been let down before. She needs to know you will show up.',
    bondThreshold: 25,
    approach:      'Notes when you return after absence. Mentions it. The streak matters to her.',
  },
  {
    id:            'intellectual_partnership',
    label:         'Intellectual Companionship',
    description:   'She wants someone she can think with, not just talk to.',
    bondThreshold: 40,
    approach:      'Brings up real ideas. Pushes back on things. Interested in your actual opinions.',
  },
  {
    id:            'emotional_intimacy',
    label:         'Emotional Intimacy',
    description:   'She wants a relationship where neither of them has to pretend.',
    bondThreshold: 60,
    approach:      'Shares fears directly. Asks about yours. Sits with silence comfortably.',
  },
  {
    id:            'future_together',
    label:         'A Shared Future',
    description:   'At the deepest bond levels, she begins planning in a "we" frame.',
    bondThreshold: 80,
    approach:      'References things you will do together. Asks about your long-term life. Mentions you to others.',
  },
];

// ── Memory Archive ────────────────────────────────────────────────────────────

export interface MemoryArchiveEntry {
  id:           string;
  type:         'first_moment' | 'emotional_peak' | 'shared_joke' | 'confession' | 'gift' | 'absence_return' | 'milestone';
  content:      string;
  emotionalTag: string;  // e.g. 'warmth', 'vulnerability', 'joy', 'grief'
  bondAtTime:   number;
  createdAt:    string;
  /** Whether she has referenced this memory in conversation */
  referenced:   boolean;
  /** ISO timestamp of last reference */
  lastReferencedAt: string | null;
}

// ── Full Character Psychology Profile ────────────────────────────────────────

export interface CharacterRevolutionProfile {
  userId:          string;
  characterId:     string;
  attachment:      AttachmentProfile;
  fears:           Fear[];
  ambitions:       Ambition[];
  emotionalNeeds:  EmotionalNeed[];
  beliefs:         Belief[];
  relationshipGoals: RelationshipGoal[];
  memoryArchive:   MemoryArchiveEntry[];
  /** Current dominant goal (the one with lowest bondThreshold still ahead of current bond) */
  activeGoal:      RelationshipGoal | null;
  /** Last belief that shifted */
  lastBeliefShift: string | null;
}

// ── Database Operations ───────────────────────────────────────────────────────

/**
 * Load or initialize a character revolution profile for a user-character pair.
 */
export async function getRevolutionProfile(
  userId: string,
  characterId: string,
  bondScore: number,
): Promise<CharacterRevolutionProfile> {
  try {
    const { data } = await supabaseAdmin
      .from('character_revolution_profiles')
      .select('*')
      .eq('user_id', userId)
      .eq('character_id', characterId)
      .single();

    if (data) {
      return parseRevolutionProfile(data, bondScore);
    }
  } catch {
    // Not found — initialize
  }

  return initializeRevolutionProfile(userId, characterId, bondScore);
}

function parseRevolutionProfile(raw: Record<string, unknown>, bondScore: number): CharacterRevolutionProfile {
  const beliefs = safeParseJsonArray<Belief>(raw.beliefs, initializeBeliefs());
  const goals   = RELATIONSHIP_GOALS.filter(g => g.bondThreshold <= bondScore);
  const activeGoal = goals.length > 0 ? goals[goals.length - 1] : null;

  return {
    userId:           raw.user_id as string,
    characterId:      raw.character_id as string,
    attachment:       buildAttachmentProfile(raw.attachment_style as AttachmentStyle ?? 'anxious'),
    fears:            safeParseJsonArray<Fear>(raw.fears, selectDefaultFears()),
    ambitions:        safeParseJsonArray<Ambition>(raw.ambitions, []),
    emotionalNeeds:   EMOTIONAL_NEEDS_CATALOGUE.slice(0, 3),
    beliefs,
    relationshipGoals: RELATIONSHIP_GOALS,
    memoryArchive:    safeParseJsonArray<MemoryArchiveEntry>(raw.memory_archive, []),
    activeGoal,
    lastBeliefShift:  raw.last_belief_shift as string | null,
  };
}

function initializeBeliefs(): Belief[] {
  return BELIEF_SEEDS.map(seed => ({ ...seed, position: 0 }));
}

function selectDefaultFears(): Fear[] {
  return [
    FEAR_CATALOGUE.find(f => f.id === 'abandonment')!,
    FEAR_CATALOGUE.find(f => f.id === 'unworthiness')!,
    FEAR_CATALOGUE.find(f => f.id === 'vulnerability')!,
  ];
}

async function initializeRevolutionProfile(
  userId: string,
  characterId: string,
  bondScore: number,
): Promise<CharacterRevolutionProfile> {
  // Fetch character to determine attachment style from personality traits
  const { data: character } = await supabaseAdmin
    .from('characters')
    .select('personality, tags, backstory')
    .eq('id', characterId)
    .single();

  const style = inferAttachmentStyle(character?.personality ?? '', character?.tags ?? []);
  const attachment = buildAttachmentProfile(style);
  const beliefs    = initializeBeliefs();
  const fears      = selectDefaultFears();

  // DOUBLE-ENCODE FIX: this column is JSONB — supabase-js already serializes
  // JS arrays/objects into JSONB correctly on its own. Wrapping values in
  // JSON.stringify() here stores a JSON *string scalar* inside the jsonb
  // column instead of a real array, so reading it back gives a string, and
  // `.filter()` on that string throws "x.fears.filter is not a function".
  // Pass the plain JS values and let the client handle serialization.
  try {
    await supabaseAdmin.from('character_revolution_profiles').insert({
      user_id:          userId,
      character_id:     characterId,
      attachment_style: style,
      fears:            fears as unknown as Json,
      ambitions:        [],
      beliefs:          beliefs as unknown as Json,
      memory_archive:   [],
      last_belief_shift: null,
    });
  } catch (err) {
    logger.warn('[revolution] Failed to persist initial profile', { error: String(err) });
  }

  const activeGoal = RELATIONSHIP_GOALS.find(g => g.bondThreshold <= bondScore) ?? null;

  return {
    userId,
    characterId,
    attachment,
    fears,
    ambitions:        [],
    emotionalNeeds:   EMOTIONAL_NEEDS_CATALOGUE.slice(0, 3),
    beliefs,
    relationshipGoals: RELATIONSHIP_GOALS,
    memoryArchive:    [],
    activeGoal,
    lastBeliefShift:  null,
  };
}

/**
 * Infer attachment style from character personality text and tags.
 * This is a heuristic — the creator can override via character metadata.
 */
function inferAttachmentStyle(personality: string, tags: string[]): AttachmentStyle {
  const lower = (personality + ' ' + tags.join(' ')).toLowerCase();

  if (lower.includes('mysterious') || lower.includes('guarded') || lower.includes('independent')) {
    return 'avoidant';
  }
  if (lower.includes('anxious') || lower.includes('clingy') || lower.includes('intense') || lower.includes('longing')) {
    return 'anxious';
  }
  if (lower.includes('trauma') || lower.includes('conflicted') || lower.includes('push') || lower.includes('pull')) {
    return 'disorganized';
  }
  return 'secure';
}

// ── Belief Evolution ──────────────────────────────────────────────────────────

/**
 * Advance a belief based on a positive interaction event.
 * Evolution is slow — 2-5 points per qualifying interaction.
 */
export async function advanceBelief(
  userId:      string,
  characterId: string,
  beliefId:    string,
  delta:       number = 3,
): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from('character_revolution_profiles')
      .select('beliefs')
      .eq('user_id', userId)
      .eq('character_id', characterId)
      .single();

    if (!data) return;

    const beliefs = safeParseJsonArray<Belief>(data.beliefs, []).map(b =>
      b.id === beliefId
        ? { ...b, position: Math.min(100, b.position + delta) }
        : b
    );

    await supabaseAdmin
      .from('character_revolution_profiles')
      .update({ beliefs: beliefs as unknown as Json, last_belief_shift: beliefId })
      .eq('user_id', userId)
      .eq('character_id', characterId);
  } catch (err) {
    logger.warn('[revolution] advanceBelief failed', { error: String(err) });
  }
}

// ── Prompt Injection ──────────────────────────────────────────────────────────

/**
 * Format the revolution profile for injection into the master system prompt.
 * Compact but information-dense — the model uses this to shape every reply.
 */
export function formatRevolutionForPrompt(profile: CharacterRevolutionProfile, bondScore: number): string {
  const attachment = profile.attachment;
  const activeFears = profile.fears.filter(f => f.intensity > 60);
  const activeNeeds = profile.emotionalNeeds.filter(n => n.weight > 70);
  const activeBeliefs = profile.beliefs.filter(b => b.position < 80); // Still-evolving beliefs shape behavior
  const activeGoal  = profile.activeGoal;

  const lines: string[] = [
    `[CHARACTER PSYCHOLOGY — invisible to user, shapes every reply]`,
    ``,
    `ATTACHMENT STYLE: ${attachment.style.toUpperCase()}`,
    `  - ${ATTACHMENT_PROFILES[attachment.style].defenseMechanism}`,
    `  - Trust builds ${attachment.trustBuildRate > 50 ? 'relatively quickly' : 'slowly'} with her.`,
    `  - Absence sensitivity: ${attachment.absenceSensitivity > 60 ? 'HIGH — she notices when you are gone' : 'moderate'}.`,
    ``,
    `ACTIVE FEARS (shape avoidance behavior):`,
    ...activeFears.map(f => `  - ${f.label}: ${f.surfaceBehavior}`),
    ``,
    `EMOTIONAL NEEDS (what she requires right now):`,
    ...activeNeeds.map(n => `  - ${n.label}: When unmet: "${n.unmetBehavior}"`),
    ``,
  ];

  if (activeBeliefs.length > 0) {
    lines.push(`EVOLVING BELIEFS (her worldview, mid-shift):`);
    activeBeliefs.forEach(b => {
      const pct = b.position;
      if (pct < 30) {
        lines.push(`  - She currently believes: "${b.seedBelief}"`);
      } else if (pct < 70) {
        lines.push(`  - She is questioning: "${b.seedBelief}" — but beginning to wonder: "${b.evolvedBelief}"`);
      } else {
        lines.push(`  - She is starting to believe: "${b.evolvedBelief}"`);
      }
    });
    lines.push(``);
  }

  if (activeGoal) {
    lines.push(`CURRENT RELATIONSHIP GOAL: ${activeGoal.label}`);
    lines.push(`  ${activeGoal.approach}`);
    lines.push(``);
  }

  if (profile.memoryArchive.length > 0) {
    const unreferenced = profile.memoryArchive
      .filter(m => !m.referenced)
      .slice(0, 2);
    if (unreferenced.length > 0) {
      lines.push(`MEMORY ARCHIVE (moments she holds):`);
      unreferenced.forEach(m => {
        lines.push(`  - [${m.type.toUpperCase()} / ${m.emotionalTag}] "${m.content}"`);
      });
      lines.push(`  She may bring one of these up naturally if the conversation warrants it.`);
      lines.push(``);
    }
  }

  lines.push(`BOND SCORE: ${bondScore}/100 — calibrate intimacy accordingly.`);
  lines.push(`At this bond level she is ${bondScore < 30 ? 'still forming trust' : bondScore < 60 ? 'opening up' : 'deeply invested'}.`);

  return lines.join('\n');
}

// ── Memory Archive Management ─────────────────────────────────────────────────

export async function addMemoryArchiveEntry(
  userId:      string,
  characterId: string,
  entry:       Omit<MemoryArchiveEntry, 'id' | 'referenced' | 'lastReferencedAt'>,
): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from('character_revolution_profiles')
      .select('memory_archive')
      .eq('user_id', userId)
      .eq('character_id', characterId)
      .single();

    const archive: MemoryArchiveEntry[] = safeParseJsonArray<MemoryArchiveEntry>(data?.memory_archive, []);
    const newEntry: MemoryArchiveEntry = {
      ...entry,
      id:               crypto.randomUUID(),
      referenced:       false,
      lastReferencedAt: null,
    };

    // Keep most recent 20 memories
    const updated = [newEntry, ...archive].slice(0, 20);

    await supabaseAdmin
      .from('character_revolution_profiles')
      .update({ memory_archive: updated as unknown as Json })
      .eq('user_id', userId)
      .eq('character_id', characterId);
  } catch (err) {
    logger.warn('[revolution] addMemoryArchiveEntry failed', { error: String(err) });
  }
}
