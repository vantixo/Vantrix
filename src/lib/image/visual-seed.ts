/**
 * Visual seed — pure, client-safe consistency-anchor builder.
 *
 * STUDIO-CRASH-FIX: this used to live in in-chat-image.ts, which does
 * `import { logger } from '@/lib/logger'` at module scope, and logger.ts
 * does `import { AsyncLocalStorage } from 'async_hooks'` — a Node-only API.
 * image-studio.tsx ("use client") imported buildVisualSeed from
 * in-chat-image.ts, which pulled logger.ts (and async_hooks) into the
 * browser bundle. Webpack's browser polyfill for async_hooks has no real
 * AsyncLocalStorage constructor, so evaluating that module in the browser
 * threw "TypeError: _.AsyncLocalStorage is not a constructor" — crashing
 * the entire chunk and taking down /studio with Next's generic "Page
 * error" boundary. Same root cause, same fix pattern as the earlier
 * /chat/[id] crash (see detect-photo-request.ts).
 *
 * buildVisualSeed() and its helpers have no server-only dependencies —
 * they're pure string builders — so they live here, and in-chat-image.ts
 * re-exports them for existing server-side imports (API routes) to keep
 * working unchanged. Client components must import from THIS file
 * directly, never from in-chat-image.ts, or the same crash comes back.
 */

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface CharacterAppearance {
  id?:          string | null;
  name:         string;
  gender?:      string | null;
  age?:         number | null;
  description?: string | null;
  personality?: string | null;
  hair_color?:  string | null;
  eye_color?:   string | null;
  body_type?:   string | null;
  skin_tone?:   string | null;
  art_style?:   'realistic' | 'anime' | 'artistic' | null;
  clothing?:    string | null;
  occupation?:  string | null;
  // v2 field — stored in DB once generated
  visual_seed?: string | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Visual seed — canonical locked descriptor
// ────────────────────────────────────────────────────────────────────────────

/**
 * Builds a deterministic visual seed string for a character.
 *
 * The seed is a compact, ordered descriptor that locks the character's
 * core visual identity. It should be:
 *   - Generated once and stored in characters.visual_seed
 *   - Prepended verbatim to every image prompt
 *   - Never modified after first generation (breaks visual consistency)
 *
 * Format: "[gender], [age], [skin_tone] skin, [hair], [eyes], [body_type]"
 * Example: "young woman, 23 years old, light tan skin, long dark brown
 *           wavy hair, bright green almond-shaped eyes, slender athletic build"
 *
 * The high specificity and deliberate ordering (age before hair before eyes)
 * mirrors how SDXL / FLUX attention layers parse subject descriptors.
 */
export function buildVisualSeed(char: CharacterAppearance): string {
  const parts: string[] = [];

  // 1. Gender + age — establishes subject class early
  // GENDER-IMAGE-FIX: this previously defaulted to 'young woman' for
  // ANYTHING that wasn't exactly 'male' — including 'anime', 'other', or a
  // missing gender entirely. Because this seed is generated once and then
  // persisted verbatim to characters.visual_seed for the life of the
  // character, a single wrong default here permanently locked a
  // non-male, non-explicitly-female character into a female appearance
  // across every future image, with no way to self-correct. Now: 'male'
  // and 'female' map explicitly; anything else (anime/other/missing) gets
  // a neutral, non-gendered subject token instead of silently guessing
  // female, so the rest of the descriptor (hair/eyes/build/description)
  // does the work instead of a wrong assumption.
  const gender =
    char.gender === 'male'   ? 'young man' :
    char.gender === 'female' ? 'young woman' :
    'young person';
  const age    = char.age
    ? `${char.age} years old`
    : char.gender === 'male' ? '25 years old' : char.gender === 'female' ? '22 years old' : '23 years old';
  parts.push(`${gender}, ${age}`);

  // 2. Skin tone — early anchor for lighting/shading layer
  if (char.skin_tone) {
    const toneMap: Record<string, string> = {
      light:        'fair porcelain skin',
      tan:          'light tan skin',
      medium:       'warm medium complexion',
      olive:        'olive-toned skin',
      brown:        'rich brown skin',
      dark:         'deep dark complexion',
      'light brown': 'light brown skin',
    };
    parts.push(toneMap[char.skin_tone.toLowerCase()] ?? `${char.skin_tone} skin`);
  }

  // 3. Hair — color + length/style if available in description
  if (char.hair_color) {
    const hairDesc = extractHairDetail(char.description, char.hair_color);
    parts.push(hairDesc);
  }

  // 4. Eyes — color + shape hint
  if (char.eye_color) {
    const eyeDesc = `${char.eye_color} eyes`;
    parts.push(eyeDesc);
  }

  // 5. Body type
  if (char.body_type) {
    const bodyMap: Record<string, string> = {
      slim:       'slim delicate build',
      slender:    'slender graceful build',
      athletic:   'lean athletic build',
      curvy:      'soft curvy figure',
      petite:     'petite compact frame',
      tall:       'tall statuesque figure',
      muscular:   'toned muscular build',
      average:    'average natural build',
    };
    parts.push(bodyMap[char.body_type.toLowerCase()] ?? `${char.body_type} build`);
  }

  // 6. Distinctive feature from description (e.g. freckles, dimples, tattoo)
  const distinctive = extractDistinctiveFeature(char.description);
  if (distinctive) parts.push(distinctive);

  return parts.join(', ');
}

/** Extract hair detail from free-text description if available */
function extractHairDetail(description: string | null | undefined, hairColor: string): string {
  if (!description) return `${hairColor} hair`;
  const lower = description.toLowerCase();

  const lengths = ['long', 'short', 'medium-length', 'shoulder-length', 'waist-length'];
  const styles  = ['wavy', 'curly', 'straight', 'braided', 'tied up', 'ponytail', 'bun'];

  const length  = lengths.find(l => lower.includes(l)) ?? '';
  const style   = styles.find(s => lower.includes(s)) ?? '';
  const parts   = [length, hairColor, style, 'hair'].filter(Boolean);
  return parts.join(' ');
}

/** Extract a single distinctive physical feature from description */
function extractDistinctiveFeature(description: string | null | undefined): string | null {
  if (!description) return null;
  const lower = description.toLowerCase();

  const features: [RegExp, string][] = [
    [/freckles?/,       'soft freckles'],
    [/dimples?/,        'cute dimples'],
    [/mole/,            'small beauty mole'],
    [/scar/,            'faint scar'],
    [/tattoo/,          'small tattoo'],
    [/piercings?/,      'subtle piercings'],
    [/glasses/,         'stylish glasses'],
  ];

  for (const [re, label] of features) {
    if (re.test(lower)) return label;
  }
  return null;
}
