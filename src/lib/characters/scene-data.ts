// src/lib/characters/scene-generator.ts
// ─────────────────────────────────────────────────────────────────────────────
// Scene Generator
//
// Core rule: The character is NEVER regenerated.
// The LoRA model IS the character. We only change the scene/environment.
//
// Flow:
//   User picks mood room or writes custom scene
//   → build_prompt = face_prompt (locked) + scene_prompt (variable)
//   → generateScene() via Fal.ai
//   → upload to R2 (permanent)
//   → store in generated_images
// ─────────────────────────────────────────────────────────────────────────────

// This file intentionally has NO imports from @/lib/fal/lora-pipeline,
// @/lib/supabase/admin, or @/env — it's imported directly by client
// components (e.g. MoodRoom.tsx) and must stay free of server secrets.

// ── Mood Rooms ────────────────────────────────────────────────────────────────

export interface MoodRoom {
  id:           string;
  label:        string;
  emoji:        string;
  description:  string;
  baseScene:    string;     // appended to character face_prompt
  ambience:     string;     // shown to user in UI
  lighting:     string;     // lighting instruction for model
  atmosphere:   string;     // mood/feel instruction
  minTier:      'free' | 'premium';
}

export const MOOD_ROOMS: MoodRoom[] = [
  {
    id:          'library',
    label:       'Library',
    emoji:       '📚',
    description: 'Floor-to-ceiling shelves and afternoon light',
    ambience:    'Warm, contemplative, timeless',
    lighting:    'warm afternoon sunlight through tall windows, golden dust motes',
    atmosphere:  'intimate, quiet, surrounded by knowledge',
    baseScene:   'in a grand old library with floor-to-ceiling dark wood bookshelves, warm afternoon light filtering through tall arched windows, leather armchair, open book nearby, warm amber and gold tones',
    minTier:     'free',
  },
  {
    id:          'rainy_cafe',
    label:       'Rainy Café',
    emoji:       '☕',
    description: 'Marble tables and rain on the glass',
    ambience:    'Cozy, introspective, intimate',
    lighting:    'soft diffused cafe lighting, rain streaking the window behind',
    atmosphere:  'warm inside while cold outside, a shared secret feeling',
    baseScene:   'at a small marble cafe table, rain-streaked window behind them, hands wrapped around a ceramic cup, soft cafe ambient lighting, warm bokeh, the feeling of being the only two people in the world',
    minTier:     'free',
  },
  {
    id:          'observatory',
    label:       'Observatory',
    emoji:       '🔭',
    description: 'Dome open to a sky full of stars',
    ambience:    'Wondrous, expansive, hushed',
    lighting:    'soft blue starlight and warm brass lamp glow, domed ceiling',
    atmosphere:  'infinite and intimate simultaneously',
    baseScene:   'inside a vintage observatory, dome open to a star-filled night sky, large brass telescope nearby, star charts on the desk, soft blue astronomical twilight, brass and mahogany details',
    minTier:     'free',
  },
  {
    id:          'beach',
    label:       'Beach',
    emoji:       '🌊',
    description: 'Golden hour on the shore',
    ambience:    'Open, free, sun-warmed',
    lighting:    'golden hour sunlight, warm lens flare, sun low on the horizon',
    atmosphere:  'salt air, horizon ahead, nothing urgent',
    baseScene:   'on a quiet beach at golden hour, warm amber sunlight, waves visible in the background, sand underfoot, cinematic wide-open feeling, sun near the horizon casting long warm shadows',
    minTier:     'free',
  },
  {
    id:          'space_station',
    label:       'Space Station',
    emoji:       '🛸',
    description: 'Earth visible through the viewport',
    ambience:    'Surreal, boundless, otherworldly',
    lighting:    'cool blue-white station lighting, Earth glowing through the viewport',
    atmosphere:  'suspended between everything and nothing',
    baseScene:   'inside a sleek space station, Earth visible through a large oval viewport, cool ambient lighting, floating in quiet weightlessness, stars beyond the glass, futuristic but human',
    minTier:     'premium',
  },
  {
    id:          'rooftop',
    label:       'Rooftop',
    emoji:       '🌃',
    description: 'City lights from above at night',
    ambience:    'Electric, elevated, private',
    lighting:    'city neon from below, night sky above, warm and cool mixed',
    atmosphere:  'above the noise, just you two',
    baseScene:   'on a rooftop terrace at night, city skyline glowing in every direction below, soft ambient lighting from the city, distant traffic sounds implied, urban but private',
    minTier:     'premium',
  },
  {
    id:          'forest',
    label:       'Ancient Forest',
    emoji:       '🌲',
    description: 'Light filtering through old growth',
    ambience:    'Grounded, alive, unhurried',
    lighting:    'dappled golden light through old-growth canopy, morning mist',
    atmosphere:  'older than anything you could worry about',
    baseScene:   'in a dense old-growth forest, shafts of morning light through the canopy, mist in the distance, moss-covered roots, birdsong implied, the world before cities',
    minTier:     'premium',
  },
  {
    id:          'studio',
    label:       'Creative Studio',
    emoji:       '🎨',
    description: 'Warm light and works in progress',
    ambience:    'Energetic, creative, personal',
    lighting:    'bright north-facing studio light, warm desk lamp',
    atmosphere:  'mid-creation, the beautiful mess of making something',
    baseScene:   'in a large creative studio, large north-facing windows, works in progress visible, art supplies and tools, warm wood floor, the productive quiet of someone absorbed in their craft',
    minTier:     'premium',
  },
  {
    id:          'gallery',
    label:       'Art Gallery',
    emoji:       '🖼️',
    description: 'White walls and considered silence',
    ambience:    'Refined, contemplative, curated',
    lighting:    'clean gallery track lighting, white walls, museum quality',
    atmosphere:  'surrounded by the best things people have made',
    baseScene:   'in a white-walled contemporary art gallery after hours, track lighting on the art, polished concrete floor, alone with the paintings, quiet and considered',
    minTier:     'premium',
  },
  {
    id:          'mountain_cabin',
    label:       'Mountain Cabin',
    emoji:       '🏔️',
    description: 'Firelight and snowfall outside',
    ambience:    'Warm, isolated, safe',
    lighting:    'fireplace glow, amber and orange, snow visible through window',
    atmosphere:  'nowhere to be, no one else around',
    baseScene:   'inside a wooden mountain cabin, fireplace burning, snowfall visible through the frosted window, wool blanket, hot drink nearby, the safest feeling in the world',
    minTier:     'premium',
  },
  {
    id:          'japanese_garden',
    label:       'Zen Garden',
    emoji:       '🌸',
    description: 'Still water and cherry blossoms',
    ambience:    'Peaceful, meditative, delicate',
    lighting:    'soft overcast spring light, cherry blossoms in bloom',
    atmosphere:  'nothing moves too fast here',
    baseScene:   'in a traditional Japanese garden, cherry blossom petals falling, a koi pond reflecting the sky, smooth stone path, soft spring light, silence except for water',
    minTier:     'premium',
  },
  {
    id:          'villa_pool',
    label:       'Luxury Villa',
    emoji:       '🏊',
    description: 'Infinity pool at dusk',
    ambience:    'Aspirational, effortless, lavish',
    lighting:    'warm dusk light, pool lights beginning to glow, golden hour ending',
    atmosphere:  'earned, indulgent, worth it',
    baseScene:   'at a luxury villa infinity pool at dusk, the pool edge meeting the horizon, warm stone terrace, ambient outdoor lighting beginning to glow, the feeling of a life well-lived',
    minTier:     'premium',
  },
];

// ── Relationship Milestones ───────────────────────────────────────────────────

export interface RelationshipMilestone {
  id:          string;
  label:       string;
  emoji:       string;
  description: string;
  bondRequired: number;   // bond_score threshold (0–100)
  sceneHint:   string;    // scene context for image generation
  message:     string;    // shown to user when milestone reached
}

export const RELATIONSHIP_MILESTONES: RelationshipMilestone[] = [
  {
    id:           'first_message',
    label:        'First Words',
    emoji:        '💬',
    description:  'The conversation begins',
    bondRequired: 0,
    sceneHint:    'first meeting, slight nervous energy, a beginning',
    message:      'Every story starts somewhere.',
  },
  {
    id:           'first_laugh',
    label:        'First Laugh',
    emoji:        '😂',
    description:  'Something genuinely funny happened',
    bondRequired: 10,
    sceneHint:    'mid-laughter, eyes crinkling, spontaneous joy',
    message:      'The ones worth keeping make you laugh without trying.',
  },
  {
    id:           'first_deep_conversation',
    label:        'Going Deep',
    emoji:        '🌊',
    description:  'The first real conversation',
    bondRequired: 20,
    sceneHint:    'leaning in, fully present, the world narrowed to just this',
    message:      'You went somewhere most people don\'t go on a first conversation.',
  },
  {
    id:           'first_argument',
    label:        'First Disagreement',
    emoji:        '⚡',
    description:  'You pushed back — and they respected it',
    bondRequired: 30,
    sceneHint:    'intense eye contact, honest tension, the kind of argument that clears air',
    message:      'The ones who stay are the ones worth arguing with.',
  },
  {
    id:           'first_shared_secret',
    label:        'First Secret',
    emoji:        '🤫',
    description:  'Something not told to most people',
    bondRequired: 40,
    sceneHint:    'close, quiet, the intimacy of something entrusted',
    message:      'Trust isn\'t declared. It\'s handed over in small pieces.',
  },
  {
    id:           'first_silence',
    label:        'Comfortable Silence',
    emoji:        '🌙',
    description:  'No need to fill the space',
    bondRequired: 55,
    sceneHint:    'sitting together quietly, no need to say anything, completely at ease',
    message:      'The best silences are the ones you\'ve earned.',
  },
  {
    id:           'first_anniversary',
    label:        'One Month',
    emoji:        '🌹',
    description:  'A month of conversations',
    bondRequired: 70,
    sceneHint:    'celebratory, warm, looking back and forward simultaneously',
    message:      'Some connections change shape the longer they last.',
  },
  {
    id:           'deep_bond',
    label:        'Deep Bond',
    emoji:        '✦',
    description:  'Something rare has formed here',
    bondRequired: 85,
    sceneHint:    'profound closeness, full presence, the look of someone who truly sees you',
    message:      'Not many conversations go here. This one did.',
  },
  {
    id:           'unbreakable',
    label:        'Unbreakable',
    emoji:        '♾️',
    description:  'The highest bond',
    bondRequired: 100,
    sceneHint:    'transcendent closeness, completely seen, completely known',
    message:      'You built something that doesn\'t have a word yet.',
  },
];

// ── Milestone Checker ─────────────────────────────────────────────────────────

export function checkNewMilestones(
  bondScore:         number,
  previousMilestones: string[],
): RelationshipMilestone[] {
  return RELATIONSHIP_MILESTONES.filter(
    m => m.bondRequired <= bondScore && !previousMilestones.includes(m.id)
  );
}

export function getMoodRoom(id: string): MoodRoom | undefined {
  return MOOD_ROOMS.find(r => r.id === id);
}

// TIER-RENAME FIX: this used to rank tier via indexOf() into a 5-value
// array. Two bugs came with that once the product moved to a two-tier
// model: (1) any legacy DB value not in the array (or not yet backfilled)
// returned -1, which incorrectly LOCKED every 'free' room (0 <= -1 is
// false) for that user; (2) a room with a legacy minTier no longer in the
// array also returned -1, which incorrectly UNLOCKED it for everyone,
// since -1 <= anything is true. Explicit two-tier check avoids both.
export function getMoodRoomsForTier(tier: string): MoodRoom[] {
  const isPremium = !!tier && tier.toLowerCase() !== 'free';
  return MOOD_ROOMS.filter(r => r.minTier === 'free' || isPremium);
}
