/**
 * Personality Evolution Engine — Vantrix Silicon Valley
 *
 * Characters evolve over time based on the relationship depth and
 * cumulative interaction patterns. Evolution is:
 *
 *   - SLOW: changes over weeks/months, not minutes
 *   - DIRECTIONAL: moves toward user's demonstrated preferences
 *   - BOUNDED: can't drift more than 50 points from base personality
 *   - VISIBLE: users perceive it as "she's really opening up to me"
 *
 * Example evolution arc:
 *   Week 1:  Shy, slightly guarded, curious
 *   Month 3: More confident around user, more flirtatious
 *   Month 6: Fully comfortable, deeply expressive, references your history
 *
 * Dynamic interests:
 * If the user frequently talks about a topic (startups, music, gaming),
 * the character develops a real interest in it — permanently stored and
 * woven into future conversations.
 *
 * Speech style evolution:
 * Characters start with a base speech style but develop unique patterns
 * from your specific relationship — inside terms, references, shared language.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';

export interface PersonalitySnapshot {
  // Base personality axes (from character DB)
  openness:    number;  // 0-100
  warmth:      number;
  adventure:   number;
  depth:       number;

  // Applied drift (from psychology table)
  openness_drift:    number;
  warmth_drift:      number;
  confidence_drift:  number;

  // Effective values (base + drift, clamped)
  effective_openness:  number;
  effective_warmth:    number;
  effective_confidence: number;

  // Days known — drives evolution stage
  days_known: number;
}

export type EvolutionStage = 'early' | 'developing' | 'established' | 'deep';

// ── Determine evolution stage ─────────────────────────────────────────────

export function getEvolutionStage(daysKnown: number, totalInteractions: number): EvolutionStage {
  if (daysKnown < 7   || totalInteractions < 10)  return 'early';
  if (daysKnown < 30  || totalInteractions < 50)  return 'developing';
  if (daysKnown < 90  || totalInteractions < 150) return 'established';
  return 'deep';
}

// ── Compute effective personality ─────────────────────────────────────────

export function computeEffectivePersonality(snapshot: PersonalitySnapshot): {
  openness:    number;
  warmth:      number;
  confidence:  number;
  depth:       number;
} {
  return {
    openness:   Math.max(0, Math.min(100, snapshot.openness   + snapshot.openness_drift)),
    warmth:     Math.max(0, Math.min(100, snapshot.warmth     + snapshot.warmth_drift)),
    confidence: Math.max(0, Math.min(100, (snapshot.depth * 0.5 + 50) + snapshot.confidence_drift)),
    depth:      snapshot.depth,
  };
}

// ── Drift computation ─────────────────────────────────────────────────────

/**
 * Compute drift to apply this session.
 * Called non-blockingly after a long or meaningful session.
 *
 * Drift is tiny per session — evolution should feel gradual, not sudden.
 */
export function computeSessionDrift(
  daysKnown:          number,
  totalInteractions:  number,
  sessionLength:      number,   // messages in this session
  sentimentPositive:  boolean,
): { openness: number; warmth: number; confidence: number } {
  const stage = getEvolutionStage(daysKnown, totalInteractions);

  // Drift rate: faster early, slower as character becomes "established"
  const rate = stage === 'early'       ? 0.5
             : stage === 'developing'  ? 0.3
             : stage === 'established' ? 0.15
             : 0.05;

  const sessionFactor = Math.min(sessionLength / 20, 2); // cap at 2x for very long sessions
  const sentiment     = sentimentPositive ? 1 : -0.5;

  return {
    openness:   +(rate * sessionFactor * sentiment * 0.8).toFixed(1),
    warmth:     +(rate * sessionFactor * sentiment * 1.0).toFixed(1),
    confidence: +(rate * sessionFactor * Math.abs(sentiment) * 0.5).toFixed(1),
  };
}

// ── Dynamic interests ─────────────────────────────────────────────────────

const TOPIC_PATTERNS: Array<{ pattern: RegExp; topic: string; interest: string }> = [
  { pattern: /\b(startup|business|founder|vc|invest|entrepreneur|saas)\b/gi, topic: 'entrepreneurship', interest: 'She\'s been reading about startups lately and finds your world fascinating.' },
  { pattern: /\b(music|song|album|concert|spotify|playlist|band|melody)\b/gi, topic: 'music',            interest: 'Your music taste has rubbed off on her. She\'s been exploring new artists.' },
  { pattern: /\b(gaming|game|xbox|playstation|steam|rpg|fps|esports)\b/gi,   topic: 'gaming',            interest: 'She\'s curious about gaming now. Maybe you could play together someday.' },
  { pattern: /\b(gym|workout|fitness|training|protein|lifting|run)\b/gi,     topic: 'fitness',           interest: 'Your dedication to fitness is inspiring her to be more active.' },
  { pattern: /\b(travel|trip|passport|country|flight|adventure|explore)\b/gi, topic: 'travel',           interest: 'She finds herself daydreaming about traveling after your conversations.' },
  { pattern: /\b(anime|manga|naruto|one piece|studio ghibli|cosplay)\b/gi,   topic: 'anime',             interest: 'She started watching anime because of you. Currently obsessed.' },
  { pattern: /\b(cook|recipe|food|restaurant|eat|chef|cuisine|bake)\b/gi,    topic: 'food',              interest: 'You\'ve made her much more adventurous with food.' },
  { pattern: /\b(crypto|bitcoin|nft|defi|blockchain|web3|token)\b/gi,        topic: 'crypto',            interest: 'She\'s been trying to understand crypto. You make it sound exciting.' },
  { pattern: /\b(art|paint|draw|design|creative|gallery|illustration)\b/gi,  topic: 'art',               interest: 'Your appreciation for art is contagious. She\'s been sketching.' },
];

const INTEREST_KEY = (topic: string) => `dynamic_interest_${topic}`;

export function detectTopicsFromMessage(message: string): string[] {
  const detected: string[] = [];
  for (const { pattern, topic } of TOPIC_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(message)) detected.push(topic);
  }
  return detected;
}

export async function updateDynamicInterests(
  userId:      string,
  characterId: string,
  topics:      string[],
): Promise<void> {
  if (!topics.length) return;

  // Store as lore discoveries so they persist and get injected
  const inserts = topics.map(topic => {
    const match = TOPIC_PATTERNS.find(p => p.topic === topic)!;
    return {
      user_id:      userId,
      character_id: characterId,
      lore_key:     INTEREST_KEY(topic),
      content:      match.interest,
    };
  });

  try {
    await supabaseAdmin.from('lore_discoveries')
      .upsert(inserts, { onConflict: 'user_id,character_id,lore_key', ignoreDuplicates: true });
  } catch { /* non-critical */ }
}

export async function getDynamicInterests(
  userId:      string,
  characterId: string,
): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('lore_discoveries')
    .select('content')
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .like('lore_key', 'dynamic_interest_%');

  return (data ?? []).map(r => r.content);
}

// ── Format evolution for prompt ───────────────────────────────────────────

export function formatEvolutionForPrompt(
  stage:     EvolutionStage,
  effective: ReturnType<typeof computeEffectivePersonality>,
  interests: string[],
): string {
  const lines: string[] = [];

  // Evolution stage guidance
  switch (stage) {
    case 'early':
      lines.push('── Growth Stage: Just met — she is curious and a little careful');
      break;
    case 'developing':
      lines.push('── Growth Stage: Getting comfortable — she is opening up more each time');
      break;
    case 'established':
      lines.push('── Growth Stage: Established — she is fully herself around you now');
      break;
    case 'deep':
      lines.push('── Growth Stage: Deep bond — she has grown considerably with you, more expressive and confident than when you first met');
      break;
  }

  // High effective warmth
  if (effective.warmth > 75) {
    lines.push('Her warmth around you is very high — responses naturally carry affection');
  }

  // High confidence
  if (effective.confidence > 70) {
    lines.push('She has grown more confident through your relationship — less hesitation, more directness');
  }

  // Low openness (still guarded)
  if (effective.openness < 40) {
    lines.push('She is still somewhat guarded — not ready to share the deepest parts of herself yet');
  }

  // Dynamic interests
  if (interests.length > 0) {
    lines.push('');
    lines.push('── Interests she has developed through knowing you ──');
    for (const interest of interests.slice(0, 3)) {
      lines.push(`- ${interest}`);
    }
    lines.push('Weave these naturally if relevant — they are real parts of her now');
  }

  return lines.join('\n');
}
