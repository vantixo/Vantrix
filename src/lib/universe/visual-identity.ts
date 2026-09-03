/**
 * Visual Identity Engine — Vantrix Legacy Systems
 *
 * "Every major entity requires recognizable symbolism. The universe should
 * possess a cohesive visual language. A screenshot should be recognizable
 * instantly."
 *
 * This engine generates deterministic symbolic identity for factions and
 * cities — mottos and sigil/emblem descriptions — using their existing
 * ideology, culture, and government_type data. It's a text-domain generator
 * (no image model call), designed to backfill the `motto` / `sigil_description`
 * / `emblem_description` / `seal_motto` columns added by the migration.
 *
 * If you want actual generated artwork, feed `sigil_description` /
 * `emblem_description` into your imagegen pipeline as the prompt — these
 * are written to read well as image-generation prompts.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';

// ── Symbolic vocabulary ─────────────────────────────────────────────────────────

const GOVERNMENT_SYMBOLS: Record<string, string[]> = {
  democracy:   ['an open hand', 'a ring of raised torches', 'an unlocked gate'],
  oligarchy:   ['seven interlocking rings', 'a closed vault door', 'a crown without a face'],
  council:     ['a circle of seven chairs seen from above', 'an unbroken ring', 'a round table cut from old wood'],
  theocracy:   ['an eye inside a flame', 'a single descending light', 'an open book with no visible text'],
  anarchy:     ['a broken chain still moving', 'scattered seeds mid-fall', 'an unfinished circle'],
  corporate:   ['a stylised tower of light', 'an ascending bar chart rendered as architecture', 'a sharp angular monogram'],
  meritocracy: ['a balanced scale holding a single open book', 'an ascending staircase', 'a laurel made of small gears'],
  technocracy: ['a perfect hexagon containing a pulse line', 'a network of glowing nodes', 'a circuit shaped like a constellation'],
  syndicate:   ['a closed fist holding a coin', 'a key crossed with a blade', 'three interlocked rings, one cracked'],
  union:       ['two crossed tools beneath a rising sun', 'a raised fist holding a gear', 'interlocked hands forming a wheel'],
  plutocracy:  ['a coin stamped with a face too small to read', 'a gate of gold bars', 'an ornate vault wheel'],
  neutral:     ['a compass with no needle', 'a bridge seen from below', 'an unmarked seal, deliberately blank'],
};

const CULTURE_TEXTURES: Record<string, string[]> = {
  ambitious:    ['rendered in sharp angular lines', 'with an upward, reaching composition'],
  artistic:     ['hand-drawn, slightly imperfect on purpose', 'with visible brushwork in the linework'],
  ancient:      ['weathered at the edges', 'carved rather than printed, worn smooth in places'],
  industrial:   ['stamped in heavy iron-toned metal', 'composed of riveted, mechanical shapes'],
  wealthy:      ['gilded at the edges', 'rendered in deep saturated colour with gold filigree'],
  dangerous:    ['rendered mostly in shadow, with one sharp point of light'],
  intellectual: ['composed of precise geometric shapes', 'built from overlapping circles, like orbits'],
  mysterious:   ['partially obscured, as if seen through fog', 'with negative space doing as much work as the lines'],
  free:         ['loose, asymmetrical, deliberately unpolished'],
  formal:       ['perfectly symmetrical', 'rendered with rigid, classical proportion'],
};

const MOTTO_TEMPLATES: Record<string, string[]> = {
  democracy:   ['Every Voice, One City', 'By the Many, For the Many', 'Open Doors, Open Hands'],
  oligarchy:   ['What Is Built, Endures', 'Order Through Ownership', 'The Few Who Carry the Weight'],
  council:     ['Seven Voices, One Decision', 'The Circle Does Not Break', 'Long Memory, Slow Hand'],
  theocracy:   ['Light Before Law', 'What Was Written, Holds', 'Faith Is the First Infrastructure'],
  anarchy:     ['No Crown, No Cage', 'We Decide As We Go', 'Nothing Owns Us'],
  corporate:   ['Growth Is the Only Doctrine', 'Build Higher', 'Efficiency Above All'],
  meritocracy: ['Earned, Never Given', 'Knowledge Outranks Birth', 'The Best Ideas Win'],
  technocracy: ['Optimise Everything', 'The System Improves Itself', 'Bias Is the Only Enemy'],
  syndicate:   ['We Handle What Others Won\'t', 'Quiet Order, Loud Consequence', 'Control the Supply, Keep the Peace'],
  union:       ['One Worker, One Vote', 'Built By Hands That Remember', 'No One Carries Alone'],
  plutocracy:  ['Capital Is Citizenship', 'Standards, Not Sentiment', 'Excellence Has a Price'],
  neutral:     ['Open to All, Owned By None', 'Neutral Ground, Permanent Peace', 'The Bridge Holds'],
};

// ── Generation ─────────────────────────────────────────────────────────────────

export function generateFactionSigil(faction: {
  ideology: string; culture?: string;
}): { motto: string; sigilDescription: string } {
  const govKey = inferGovKeyFromIdeology(faction.ideology);
  const symbolPool = GOVERNMENT_SYMBOLS[govKey] ?? GOVERNMENT_SYMBOLS['neutral']!;
  const symbol = pick(symbolPool);

  const textureKey = inferTextureFromIdeology(faction.culture ?? faction.ideology);
  const texture = pick(CULTURE_TEXTURES[textureKey] ?? CULTURE_TEXTURES['formal']!);

  const mottoPool = MOTTO_TEMPLATES[govKey] ?? MOTTO_TEMPLATES['neutral']!;
  const motto = pick(mottoPool);

  return {
    motto,
    sigilDescription: `A sigil built around ${symbol}, ${texture}. The symbolism reflects: ${faction.ideology}.`,
  };
}

export function generateCityEmblem(city: {
  government_type: string; culture: string;
}): { sealMotto: string; emblemDescription: string } {
  const symbolPool = GOVERNMENT_SYMBOLS[city.government_type] ?? GOVERNMENT_SYMBOLS['neutral']!;
  const symbol = pick(symbolPool);

  const textureKey = inferTextureFromIdeology(city.culture);
  const texture = pick(CULTURE_TEXTURES[textureKey] ?? CULTURE_TEXTURES['formal']!);

  const mottoPool = MOTTO_TEMPLATES[city.government_type] ?? MOTTO_TEMPLATES['neutral']!;
  const motto = pick(mottoPool);

  return {
    sealMotto: motto,
    emblemDescription: `A civic seal centred on ${symbol}, ${texture}. The culture it represents: ${city.culture}.`,
  };
}

// ── Backfill tick ──────────────────────────────────────────────────────────────

export async function tickVisualIdentityBackfill(): Promise<{ factions: number; cities: number }> {
  let factions = 0;
  let cities   = 0;

  const { data: pendingFactions } = await supabaseAdmin
    .from('factions')
    .select('id, ideology, culture')
    .or('motto.is.null,sigil_description.is.null')
    .limit(50);

  for (const f of pendingFactions ?? []) {
    const { motto, sigilDescription } = generateFactionSigil(f);
    await supabaseAdmin.from('factions').update({ motto, sigil_description: sigilDescription }).eq('id', f.id);
    factions++;
  }

  const { data: pendingCities } = await supabaseAdmin
    .from('world_locations')
    .select('id, government_type, culture')
    .or('seal_motto.is.null,emblem_description.is.null')
    .limit(20);

  for (const c of pendingCities ?? []) {
    const { sealMotto, emblemDescription } = generateCityEmblem(c);
    await supabaseAdmin.from('world_locations').update({ seal_motto: sealMotto, emblem_description: emblemDescription }).eq('id', c.id);
    cities++;
  }

  logger.info('visual-identity:backfill:complete', { factions, cities });
  return { factions, cities };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function inferGovKeyFromIdeology(ideology: string): string {
  const lower = ideology.toLowerCase();
  const map: Record<string, string> = {
    labour: 'union', labor: 'union',
    union: 'union',
    technocrat: 'technocracy',
    meritocrat: 'meritocracy', merit: 'meritocracy',
    conservative: 'oligarchy', tradition: 'oligarchy', inherited: 'oligarchy',
    radical: 'anarchy', transparency: 'anarchy',
    pragmatic: 'council', governance: 'council', council: 'council',
    democra: 'democracy',
    theocra: 'theocracy', faith: 'theocracy', religio: 'theocracy',
    corporate: 'corporate', profit: 'corporate',
    criminal: 'syndicate', syndicate: 'syndicate', underworld: 'syndicate',
    plutocra: 'plutocracy', wealth: 'plutocracy',
  };
  for (const [key, govKey] of Object.entries(map)) {
    if (lower.includes(key)) return govKey;
  }
  return 'neutral';
}

function inferTextureFromIdeology(text: string): string {
  const lower = text.toLowerCase();
  for (const key of Object.keys(CULTURE_TEXTURES)) {
    if (lower.includes(key)) return key;
  }
  if (lower.includes('profit') || lower.includes('wealth')) return 'wealthy';
  if (lower.includes('art') || lower.includes('creative')) return 'artistic';
  if (lower.includes('order') || lower.includes('control')) return 'formal';
  return 'formal';
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}
