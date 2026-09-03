/**
 * Chemistry Dimensions — Vantrix (Feature 3, dating master spec)
 *
 * NOT a replacement for chemistry-engine.ts (that stays exactly what it
 * is — a cheap per-turn "is there spark in this exchange right now"
 * signal fed into the live chat prompt). This module answers a different,
 * slower question the dating spec asks for: an evolving, multi-dimensional
 * match profile a user can actually see (conversation compatibility,
 * emotional depth, humor, playfulness, intellectual fit, adventure,
 * affection, directness, mystery, pacing, engagement, progression).
 *
 * Composed entirely from existing systems — nothing here re-implements a
 * signal that's already computed elsewhere:
 *   - attachment-engine.ts's getPsychology()      → affection/attachment/trust
 *   - compatibility-engine.ts's computeCompatibilityState() → communication
 *     fit, interest overlap, values alignment (already 0-1 scored + reasoned)
 *   - recommendations/engine.ts's tag-weight approach (liked-tag overlap),
 *     reused here as the humor/playfulness/intellectual/adventure signal
 *     rather than re-querying swipes from scratch
 *   - dating_matches row (bond_score, streak_days, conversation_count) →
 *     engagement + progression + pacing
 *
 * No LLM calls, no new DB tables/migrations, no new persisted signal —
 * this is a read-time composition layer. If a future turn adds a real
 * rolling humor/playfulness signal (would require persisting
 * chemistry-engine.ts's per-turn spark, which today is ephemeral), that
 * can slot in here as an additional weighted input without changing this
 * module's shape.
 */

import type { PsychologyState } from '@/lib/ai/attachment-engine';
import type { CompatibilityState } from '@/lib/ai/compatibility-engine';

// ── Tag → dimension maps ───────────────────────────────────────────────
// Same pattern as recommendations/engine.ts's MOOD_TAG_MAP — a fixed,
// human-reviewed keyword set, not inferred.

const HUMOR_TAGS        = ['funny', 'humor', 'witty', 'sarcastic', 'jokes', 'comedic'];
const PLAYFUL_TAGS      = ['playful', 'flirty', 'tease', 'archetype:tsundere', 'silly', 'lighthearted'];
const INTELLECTUAL_TAGS = ['intellectual', 'deep', 'philosophical', 'nerd', 'archetype:mentor', 'curious'];
const ADVENTURE_TAGS    = ['adventurous', 'bold', 'spontaneous', 'archetype:adventurer', 'free-spirit', 'outdoors'];
const DIRECT_ARCHETYPES: Record<string, number> = {
  dominant: 85, romantic: 60, playful: 55, warm: 50, adventurous: 65, intellectual: 45, mysterious: 20, guarded: 15,
};
const MYSTERY_ARCHETYPES: Record<string, number> = {
  mysterious: 90, guarded: 75, intellectual: 45, romantic: 35, adventurous: 30, playful: 20, warm: 15, dominant: 25,
};

export interface ChemistryDimensions {
  conversation:   number; // communication fit, 0-100
  emotionalDepth: number; // 0-100
  humor:          number; // 0-100
  playfulness:    number; // 0-100
  intellectual:   number; // 0-100
  adventure:      number; // 0-100
  affection:      number; // 0-100
  directness:     number; // 0-100
  mystery:        number; // 0-100
  engagement:     number; // 0-100, from conversation_count
  progression:    number; // 0-100, == bond_score (kept distinct name for UI clarity)
  pacing:         'slow_burn' | 'steady' | 'fast';
  headline: {
    // The 2-3 numbers the spec's Tonight's Match example shows
    // ("Chemistry 91% / Conversation 94% / Attraction 88%").
    chemistry:    number;
    conversation: number;
    attraction:   number;
  };
  reason: string; // explainable summary — grounded in the inputs above only
}

export interface ChemistryDimensionsInput {
  psychology: PsychologyState;
  compatibility: CompatibilityState;
  characterTags: string[];
  archetype: string;
  bondScore: number;
  conversationCount: number;
  streakDays: number;
}

function tagOverlapScore(tags: string[], dimensionTags: string[]): number {
  const lower = tags.map(t => t.toLowerCase());
  const hits = dimensionTags.filter(d => lower.some(t => t.includes(d))).length;
  if (dimensionTags.length === 0) return 0;
  return Math.round((hits / dimensionTags.length) * 100 * 2.2); // scaled — a couple of real hits should read as strong, not marginal
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function computeChemistryDimensions(input: ChemistryDimensionsInput): ChemistryDimensions {
  const { psychology, compatibility, characterTags, archetype, bondScore, conversationCount, streakDays } = input;
  const arch = archetype?.toLowerCase() ?? '';

  const conversation   = clamp(compatibility.communicationFit.score * 100);
  const emotionalDepth = clamp(psychology.attachment);
  const humor           = clamp(tagOverlapScore(characterTags, HUMOR_TAGS));
  const playfulness      = clamp(tagOverlapScore(characterTags, PLAYFUL_TAGS));
  const intellectual      = clamp(tagOverlapScore(characterTags, INTELLECTUAL_TAGS) * 0.6 + compatibility.valuesAlignment.score * 100 * 0.4);
  const adventure          = clamp(tagOverlapScore(characterTags, ADVENTURE_TAGS));
  const affection            = clamp(psychology.affection);
  const directness             = clamp(DIRECT_ARCHETYPES[arch] ?? 45);
  const mystery                  = clamp(MYSTERY_ARCHETYPES[arch] ?? 30);
  const engagement                 = clamp(conversationCount * 5);
  const progression                  = clamp(bondScore);

  // Pacing: how fast bond has moved relative to how many conversations it
  // took to get there. A high bond reached over few conversations = fast;
  // a modest bond over many conversations = slow burn.
  const pace = conversationCount > 0 ? bondScore / conversationCount : 0;
  const pacing: ChemistryDimensions['pacing'] = pace >= 4 ? 'fast' : pace >= 1.5 ? 'steady' : 'slow_burn';

  // Headline blend — deliberately simple weighted averages of the
  // dimensions above, not a new independent score.
  const chemistryHeadline    = clamp((playfulness + humor + emotionalDepth + conversation) / 4);
  const attractionHeadline   = clamp((affection + directness * 0.4 + mystery * 0.3 + progression * 0.3) / 1.7 * 0.9);

  const reasonParts: string[] = [];
  if (conversation >= 70) reasonParts.push('strong conversational fit');
  if (playfulness >= 60 || humor >= 60) reasonParts.push('shared playful energy');
  if (intellectual >= 60) reasonParts.push('intellectual overlap');
  if (adventure >= 60) reasonParts.push('adventurous alignment');
  if (streakDays >= 3) reasonParts.push(`a ${streakDays}-day streak already building`);
  const reason = reasonParts.length
    ? reasonParts.join(', ')
    : 'still early — not enough signal yet for a strong read';

  return {
    conversation, emotionalDepth, humor, playfulness, intellectual, adventure,
    affection, directness, mystery, engagement, progression, pacing,
    headline: {
      chemistry: chemistryHeadline,
      conversation,
      attraction: attractionHeadline,
    },
    reason,
  };
}
