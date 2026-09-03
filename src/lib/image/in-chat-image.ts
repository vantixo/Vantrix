/**
 * In-Chat Image Generation Engine — Visual Consistency Edition
 *
 * Key upgrade over v1: deterministic visual seed system.
 *
 * Candy AI's #1 moat is that the same character looks the same across
 * every generated image. They do this via a locked "appearance anchor" —
 * a canonical set of visual tokens that are prepended verbatim to every
 * generation prompt, giving the model a stable reference frame.
 *
 * This file implements that pattern:
 *   1. buildVisualSeed()     — canonical one-time descriptor stored in DB
 *   2. buildAppearancePrompt() — uses seed + scene context for each image
 *   3. buildConsistencyNegative() — negative prompt for off-model drifts
 *
 * The seed is generated once per character and stored in
 * characters.visual_seed (TEXT column). If it doesn't exist yet,
 * buildVisualSeed() generates and returns it — the caller should
 * persist it back to the DB.
 *
 * Prompt construction order (image models weight early tokens most):
 *   1. Art style token
 *   2. VISUAL SEED (locked canonical descriptor)
 *   3. Scene context (current outfit/setting from conversation)
 *   4. Emotional/mood modifier
 *   5. Lighting/composition tail
 *   6. Quality boosters
 */

import { sanitizeField } from '@/lib/sanitize';
import { logger }        from '@/lib/logger';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

// CharacterAppearance now lives in visual-seed.ts (pure, client-safe) and is
// re-exported here so existing server-side imports of it from this file
// keep working unchanged. See STUDIO-CRASH-FIX note below.
export type { CharacterAppearance } from './visual-seed';
import type { CharacterAppearance } from './visual-seed';

export interface SceneContext {
  outfit?:       string;
  setting?:      string;
  action?:       string;
  mood?:         string;
  lighting?:     'natural' | 'soft' | 'dramatic' | 'neon' | 'golden_hour';
  angle?:        'portrait' | 'full_body' | 'close_up' | 'over_shoulder' | 'selfie';
  isExplicit?:   boolean;
}

export interface ImagePromptResult {
  positive:   string;
  negative:   string;
  seedUsed:   string;
  newSeed:    boolean; // true = caller should persist to DB
}

// ────────────────────────────────────────────────────────────────────────────
// Trigger detection — moved to detect-photo-request.ts (client-safe, no
// server-only deps) so client components can import it without pulling in
// logger.ts/async_hooks. Re-exported here so existing server-side imports
// of `detectPhotoRequest` from this file keep working unchanged.
// ────────────────────────────────────────────────────────────────────────────

export { detectPhotoRequest } from './detect-photo-request';

// ────────────────────────────────────────────────────────────────────────────
// Visual seed — moved to visual-seed.ts (pure, client-safe, no server-only
// deps) so client components (e.g. the Image Studio) can import
// buildVisualSeed without pulling in logger.ts/async_hooks. Re-exported
// here so existing server-side imports of `buildVisualSeed` from this file
// keep working unchanged — but new client-side callers should import
// directly from './visual-seed' instead of through this module.
// ────────────────────────────────────────────────────────────────────────────

export { buildVisualSeed } from './visual-seed';
import { buildVisualSeed } from './visual-seed';

// ────────────────────────────────────────────────────────────────────────────
// Scene context extraction from chat messages
// ────────────────────────────────────────────────────────────────────────────

const SETTING_PATTERNS: [RegExp, string][] = [
  [/beach|ocean|sea/i,         'at the beach, ocean background'],
  [/bedroom|bed/i,             'in her bedroom'],
  [/cafe|coffee\s+shop/i,      'in a cozy cafe'],
  [/gym|workout/i,             'at the gym'],
  [/office|work/i,             'in a modern office'],
  [/park|outdoor/i,            'outdoors in a park'],
  [/pool|swimming/i,           'by the pool'],
  [/rooftop/i,                 'on a rooftop terrace at sunset'],
  [/kitchen/i,                 'in the kitchen'],
  [/shower|bathroom/i,         'in a clean modern bathroom'],
];

const MOOD_TO_LIGHTING: Record<string, string> = {
  happy:      'warm natural lighting',
  playful:    'bright airy lighting',
  romantic:   'soft warm candlelight',
  mysterious: 'dramatic low-key lighting',
  nostalgic:  'golden hour warm light',
  vulnerable: 'soft diffused window light',
  excited:    'vibrant bright lighting',
};

export function extractSceneFromMessages(
  messages: Array<{ role: string; content: string }>,
  characterMood?: string,
): SceneContext {
  // Look at last 4 messages for scene context
  const recent = messages.slice(-4).map(m => m.content.toLowerCase()).join(' ');

  const scene: SceneContext = {};

  // Setting
  for (const [pattern, setting] of SETTING_PATTERNS) {
    if (pattern.test(recent)) {
      scene.setting = setting;
      break;
    }
  }

  // Outfit hints
  const outfitPatterns: [RegExp, string][] = [
    [/swimsuit|bikini/i,  'in a bikini'],
    [/dress/i,            'wearing a pretty dress'],
    [/lingerie/i,         'in lacy lingerie'],
    [/casual|jeans/i,     'in casual clothes'],
    [/formal|gown/i,      'in a formal gown'],
    [/workout|gym\s+wear/i, 'in workout clothes'],
    [/pajama|pjs/i,       'in cozy pajamas'],
    [/nothing|naked|nude/i, 'tastefully nude'],
  ];
  for (const [p, o] of outfitPatterns) {
    if (p.test(recent)) { scene.outfit = o; break; }
  }

  // Mood → lighting
  if (characterMood && MOOD_TO_LIGHTING[characterMood]) {
    scene.lighting = 'soft';
    scene.mood     = MOOD_TO_LIGHTING[characterMood];
  }

  return scene;
}

// ────────────────────────────────────────────────────────────────────────────
// Main prompt builder
// ────────────────────────────────────────────────────────────────────────────

/**
 * Builds a complete image generation prompt with visual consistency.
 *
 * @param char   — character from DB (must include visual_seed if previously generated)
 * @param scene  — extracted from current chat context
 * @returns      ImagePromptResult with positive + negative prompts + seed metadata
 *
 * newSeed = true means caller should persist seed to characters.visual_seed
 */
export function buildImagePrompt(
  char:  CharacterAppearance,
  scene: SceneContext = {},
): ImagePromptResult {
  // Resolve or generate seed
  const existingSeed = char.visual_seed?.trim();
  const newSeed      = !existingSeed;
  const seed         = existingSeed ?? buildVisualSeed(char);

  const parts: string[] = [];

  // 1. Art style token (image models weight first tokens heavily)
  const style = char.art_style ?? 'realistic';
  if (style === 'anime') {
    parts.push('anime illustration, high quality anime art');
  } else if (style === 'artistic') {
    parts.push('digital art portrait, painterly style');
  } else {
    parts.push('photorealistic photograph, professional photography');
  }

  // 2. VISUAL SEED — the consistency anchor
  parts.push(seed);

  // 3. Scene setting
  if (scene.setting) parts.push(scene.setting);

  // 4. Outfit/clothing (scene override > character default)
  if (scene.outfit) {
    parts.push(scene.outfit);
  } else if (char.clothing) {
    parts.push(`wearing ${sanitizeField(char.clothing)}`);
  }

  // 5. Mood / expression
  if (scene.mood) {
    parts.push(scene.mood);
  }

  // 6. Angle / composition
  const angleMap: Record<string, string> = {
    portrait:       'portrait shot, face and shoulders',
    full_body:      'full body shot',
    close_up:       'close-up portrait',
    over_shoulder:  'over-the-shoulder shot',
    selfie:         'selfie angle, slightly above eye level',
  };
  if (scene.angle && angleMap[scene.angle]) {
    parts.push(angleMap[scene.angle]);
  } else {
    parts.push('portrait shot');
  }

  // 7. Lighting
  const lightingMap: Record<string, string> = {
    natural:      'natural soft lighting',
    soft:         'soft diffused lighting, gentle shadows',
    dramatic:     'dramatic chiaroscuro lighting',
    neon:         'neon ambient glow, cyberpunk lighting',
    golden_hour:  'golden hour warm sunlight',
  };
  if (scene.lighting && lightingMap[scene.lighting]) {
    parts.push(lightingMap[scene.lighting]);
  } else {
    parts.push('soft natural lighting');
  }

  // 8. Quality tail — always last
  if (style === 'anime') {
    parts.push(
      'detailed anime art, vibrant colors, clean linework',
      'by top anime artist, trending on Danbooru',
    );
  } else {
    parts.push(
      'sharp focus, high detail',
      '8k resolution, professional portrait photography',
      'bokeh background',
      'no watermark, no logo, no text',
    );
  }

  const positive = parts.filter(Boolean).join(', ');
  const negative = buildConsistencyNegative(style);

  logger.debug('image_prompt_built', {
    characterId: char.id,
    newSeed,
    seedLength: seed.length,
    promptLength: positive.length,
  });

  return { positive, negative, seedUsed: seed, newSeed };
}

// ────────────────────────────────────────────────────────────────────────────
// Negative prompt
// ────────────────────────────────────────────────────────────────────────────

/**
 * Negative prompt tuned to prevent common visual drift / quality issues.
 * Consistency-specific negatives prevent model from changing:
 *   - Hair color/style
 *   - Eye color
 *   - Face shape / age
 */
export function buildConsistencyNegative(
  style: 'realistic' | 'anime' | 'artistic' | null = 'realistic',
): string {
  const base = [
    'deformed', 'distorted', 'disfigured', 'bad anatomy',
    'extra limbs', 'missing limbs', 'floating limbs',
    'extra fingers', 'missing fingers', 'fused fingers',
    'too many fingers', 'mutation', 'mutated',
    'ugly', 'poorly drawn', 'blurry', 'low quality',
    'worst quality', 'jpeg artifacts', 'watermark', 'logo',
    'text', 'username', 'signature',
    // Consistency-specific
    'different hair color', 'different eye color',
    'changed appearance', 'different person',
    'inconsistent features',
  ];

  if (style === 'realistic') {
    base.push(
      'cartoon', 'anime', 'painting', 'illustration',
      'cgi', 'render', 'airbrushed',
      'overexposed', 'underexposed', 'grainy',
    );
  } else if (style === 'anime') {
    base.push(
      'realistic photograph', 'photo', '3d render',
      'western cartoon', 'ugly face', 'off-model',
      'poorly drawn eyes', 'bad proportions',
    );
  }

  return base.join(', ');
}

// ────────────────────────────────────────────────────────────────────────────
// Convenience: get-or-create seed (for use in the API route)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Returns the existing visual seed from DB, or generates one and signals
 * that it should be persisted back to characters.visual_seed.
 *
 * Usage in /api/chat/image route:
 *
 *   const { seed, shouldPersist } = getOrCreateSeed(character);
 *   if (shouldPersist) {
 *     supabaseAdmin
 *       .from('characters')
 *       .update({ visual_seed: seed })
 *       .eq('id', character.id);
 *   }
 */
export function getOrCreateSeed(char: CharacterAppearance): {
  seed:          string;
  shouldPersist: boolean;
} {
  if (char.visual_seed?.trim()) {
    return { seed: char.visual_seed.trim(), shouldPersist: false };
  }
  const seed = buildVisualSeed(char);
  return { seed, shouldPersist: true };
}

/**
 * buildAppearancePrompt — appearance-locking prompt fragment for the
 * Image Studio (batch generation). Combines the art-style token, the
 * consistency seed, and the character's default clothing into a single
 * comma-joined string fragment. Scene-specific details (outfit override,
 * pose, background, expression, angle) are appended separately by the
 * caller so each generated image can vary while the character's core
 * appearance stays locked via the seed.
 */
export function buildAppearancePrompt(char: CharacterAppearance): string {
  const seed = char.visual_seed?.trim() || buildVisualSeed(char);

  const parts: string[] = [];

  const style = char.art_style ?? 'realistic';
  if (style === 'anime') {
    parts.push('anime illustration, high quality anime art');
  } else if (style === 'artistic') {
    parts.push('digital art portrait, painterly style');
  } else {
    parts.push('photorealistic photograph, professional photography');
  }

  parts.push(seed);

  if (char.clothing) {
    parts.push(`wearing ${sanitizeField(char.clothing)}`);
  }

  return parts.join(', ');
}
