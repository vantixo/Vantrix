/**
 * Maps a character's free-text appearance fields (hair_color, eye_color,
 * skin_tone — see docs/character-source-data/canon.ts.txt, e.g. "deep brown
 * with gold flecks", "platinum silver", "warm brown") to a concrete hex
 * color, for use by CharacterAvatar3D (procedural 3D avatar — see that
 * component for why it exists) and any other renderer that needs an actual
 * color instead of a text description.
 *
 * KEYWORD MATCH, NOT A COLOR MODEL: this is intentionally a simple
 * first-match-wins keyword scan, not an attempt to parse or blend
 * compound descriptions ("black with subtle bronze highlights" resolves to
 * black, the dominant/first-mentioned color, not an actual blend). Good
 * enough to make each character's avatar visually distinct and
 * recognizably *theirs* — this is not trying to be a faithful color-managed
 * reproduction of the written description.
 */

interface ColorKeyword {
  keywords: string[];
  hex: string;
}

// Order matters: checked top-to-bottom, first match wins. More specific/
// distinctive terms are listed before generic ones they could otherwise be
// swallowed by (e.g. "platinum" before "silver" before "gray", "auburn"
// before "brown").
const HAIR_KEYWORDS: ColorKeyword[] = [
  { keywords: ["platinum"], hex: "#e8e6de" },
  { keywords: ["silver", "gray", "grey"], hex: "#b8b8b8" },
  { keywords: ["white"], hex: "#f2f0ea" },
  { keywords: ["auburn"], hex: "#8a3b2b" },
  { keywords: ["chestnut"], hex: "#5a3423" },
  { keywords: ["copper", "ginger", "red"], hex: "#a13d1f" },
  { keywords: ["blonde", "blond", "golden"], hex: "#d9b463" },
  { keywords: ["bronze"], hex: "#7a4a28" },
  { keywords: ["dark brown", "brunette"], hex: "#2e1f16" },
  { keywords: ["brown"], hex: "#4a3222" },
  { keywords: ["black", "ebony", "raven"], hex: "#161311" },
  { keywords: ["blue"], hex: "#2b4a6b" },
  { keywords: ["pink", "rose"], hex: "#c97b96" },
  { keywords: ["purple", "violet"], hex: "#5c4470" },
  { keywords: ["green"], hex: "#3e5a3e" },
];

const EYE_KEYWORDS: ColorKeyword[] = [
  { keywords: ["ice blue", "pale blue"], hex: "#bfe0ec" },
  { keywords: ["blue"], hex: "#3c6ea5" },
  { keywords: ["emerald"], hex: "#2f8a5b" },
  { keywords: ["amber"], hex: "#b8792f" },
  { keywords: ["hazel"], hex: "#7a6a3a" },
  { keywords: ["gray-blue", "grey-blue", "gray", "grey"], hex: "#8a97a0" },
  { keywords: ["green"], hex: "#3f7a4a" },
  { keywords: ["violet", "purple"], hex: "#6b4d8a" },
  { keywords: ["gold"], hex: "#c9a13a" },
  { keywords: ["dark brown", "almost-black", "black"], hex: "#241a12" },
  { keywords: ["brown"], hex: "#4a3320" },
];

const SKIN_KEYWORDS: ColorKeyword[] = [
  { keywords: ["porcelain", "pale"], hex: "#f0dcc9" },
  { keywords: ["fair"], hex: "#eccdb0" },
  { keywords: ["olive"], hex: "#c9a578" },
  { keywords: ["tan"], hex: "#c99569" },
  { keywords: ["warm brown"], hex: "#a86d43" },
  { keywords: ["bronze"], hex: "#96602f" },
  { keywords: ["dark brown"], hex: "#6b4526" },
  { keywords: ["deep ebony", "ebony"], hex: "#4a2f1c" },
  { keywords: ["brown"], hex: "#8a5a34" },
];

function matchKeyword(text: string | null | undefined, table: ColorKeyword[], fallbackHex: string): string {
  if (!text) return fallbackHex;
  const lower = text.toLowerCase();
  for (const entry of table) {
    if (entry.keywords.some((kw) => lower.includes(kw))) return entry.hex;
  }
  return fallbackHex;
}

export interface CharacterAppearanceColors {
  hair: string;
  eye: string;
  skin: string;
}

const DEFAULT_COLORS: CharacterAppearanceColors = {
  hair: "#2e1f16",
  eye: "#4a3320",
  skin: "#c99569",
};

export function getCharacterAppearanceColors(character: {
  hair_color?: string | null;
  eye_color?: string | null;
  skin_tone?: string | null;
}): CharacterAppearanceColors {
  return {
    hair: matchKeyword(character.hair_color, HAIR_KEYWORDS, DEFAULT_COLORS.hair),
    eye: matchKeyword(character.eye_color, EYE_KEYWORDS, DEFAULT_COLORS.eye),
    skin: matchKeyword(character.skin_tone, SKIN_KEYWORDS, DEFAULT_COLORS.skin),
  };
}

/**
 * Body-type text ("slender", "broad muscular", "athletic lean", ...) mapped
 * to a shoulder-width multiplier for the procedural avatar's torso. Driven
 * by body_type rather than gender deliberately — silhouette variation
 * should come from what's actually written about the character, not an
 * assumed male/female shape.
 */
export function getBodyTypeScale(bodyType: string | null | undefined): number {
  if (!bodyType) return 1;
  const lower = bodyType.toLowerCase();
  if (lower.includes("broad") || lower.includes("muscular") || lower.includes("statuesque")) return 1.18;
  if (lower.includes("slender") || lower.includes("lean") || lower.includes("petite")) return 0.88;
  return 1;
}
