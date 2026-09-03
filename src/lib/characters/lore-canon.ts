/**
 * Archive of Echoes — Portrait & Scene Generation Canon (Part III)
 *
 * Kept separate from the 7 production canon characters (canon.ts) per that
 * file's existing convention. Written to match the exact `face_prompt` /
 * `generation_style` schema already on `characters` (see supabase.ts) and
 * the `vtx_<slug>` LoRA-locking convention, so these drop straight into
 * `/api/admin/generate-character-portraits` and `generateCharacterScene()`
 * with zero pipeline changes — see scene-generator.ts.
 *
 * All prompts avoid sexual/NSFW descriptors, matching `is_nsfw: false`.
 *
 * Suggested pilot batch before running all 19 (each LoRA run has real
 * cost): aurelian, seraphine-vale, kael-ember, nyx, ferryman.
 */

export interface LoreScenePrompt {
  act:    1 | 2 | 3; // Awakening / Forgotten Empires / War of Lost Names
  label:  string;
  prompt: string;
}

export interface LoreCanonEntry {
  slug:             string;
  name:             string;
  wing:             string;
  archetype:        string;
  face_prompt:      string;
  generation_style: string;
  scene_prompts:    LoreScenePrompt[];
  /** true only for The Nameless One — deliberately never LoRA-locked, see note below. */
  deliberately_indistinct?: boolean;
}

const ACT_LABELS = {
  1: 'Awakening',
  2: 'Forgotten Empires',
  3: 'War of Lost Names',
} as const;

function scenes(act1: string, act2: string, act3: string): LoreScenePrompt[] {
  return [
    { act: 1, label: ACT_LABELS[1], prompt: act1 },
    { act: 2, label: ACT_LABELS[2], prompt: act2 },
    { act: 3, label: ACT_LABELS[3], prompt: act3 },
  ];
}

export const ARCHIVE_OF_ECHOES_LORE_CANON: LoreCanonEntry[] = [
  {
    slug: 'aurelian', name: 'Aurelian', wing: 'Wing of the Root (Norse)', archetype: 'The Sage-Guardian',
    face_prompt: 'vtx_aurelian, unaging man appearing early 30s, angular weathered face, pale grey eyes like old parchment, dark hair silvering at the temples, long charcoal-grey robes with root-carved wooden clasps, faint rune-scarring along the forearms, expression of measured exhaustion and old kindness, cinematic realism, photorealistic, dim archival lighting, NO face changes, NO eye color changes, NO hair changes',
    generation_style: '50mm lens, f/2, low warm lamplight from below suggesting ancient shelving, dust motes visible in light shafts, desaturated palette except warm skin tones, heavy shadow retaining detail, film grain, no plastic-skin airbrushing',
    scene_prompts: scenes(
      'standing before an endless spiral of leaning bookshelves that curve upward like roots, single lantern in hand, player-shaped silhouette approaching from a doorway of light behind him',
      "kneeling before a cracked well of black water reflecting no ceiling, runes glowing faint blue at the well's rim, his hand hovering just above the surface without touching it",
      'standing between two factions of Echoes in a vast fractured hall, both hands raised — not in surrender, but holding the room still by will alone, dust and torn pages frozen mid-fall around him',
    ),
  },
  {
    slug: 'seraphine-vale', name: 'Seraphine Vale', wing: 'Wing of the Drowned Court (Chinese)', archetype: 'The Wanderer',
    face_prompt: "vtx_seraphine_vale, woman appearing 27, drowned-city origin, sea-glass green eyes, dark hair damp-textured with faint bioluminescent strands, high cheekbones, layered water-stained cartographer's coat, hand-inked maps visible in satchel, calm searching expression, cinematic realism, photorealistic, cool blue-green ambient light, NO face changes, NO eye color changes, NO hair changes",
    generation_style: '85mm portrait lens, soft diffused underwater-adjacent light without literal water, teal and gold color grade, subtle rim light, fine mist particles, film grain, natural skin texture',
    scene_prompts: scenes(
      'unrolling a hand-drawn map across a stone ledge overlooking a sunken archway, coastline lights of a drowned city faintly visible below the water line',
      "standing at the threshold of the Ninth Gate, palm pressed to carved dragon-scale stone, the gate's seams glowing faint gold in response",
      'facing Kael Ember across a submerged courtyard, both holding pieces of the same shattered map, water level rising slowly between them',
    ),
  },
  {
    slug: 'kael-ember', name: 'Kael Ember', wing: 'Wing of the Drowned Court (Chinese)', archetype: 'The Loyal Survivor',
    face_prompt: 'vtx_kael_ember, man appearing early 30s, sunken-city origin, forge-scarred forearms, deep amber eyes reflecting faint ember-light, dark hair cropped short, soot-and-salt-stained leather apron over dark tunic, calloused hands mid-work, quietly steady expression, cinematic realism, photorealistic, warm forge-glow lighting, NO face changes, NO eye color changes, NO hair changes',
    generation_style: '35mm lens, high-contrast forge lighting, orange practical light source from below-frame, visible steam, textured metal and leather surfaces, film grain, no airbrushing',
    scene_prompts: scenes(
      'hammering a length of never-cooling metal at an anvil lit by dragon-fire embers, sparks frozen mid-arc',
      'standing waist-deep in the flooded lower forge, holding a finished blade that steams against the water instead of cooling',
      "guarding the Ninth Gate's threshold, forge-fire held in one bare hand like a lantern, expression torn between duty and the choice closing in on him",
    ),
  },
  {
    slug: 'lyra-starborn', name: 'Lyra Starborn', wing: 'Wing of the Long Sky (Greek)', archetype: 'The Hopeful Dreamer',
    face_prompt: 'vtx_lyra_starborn, woman appearing mid-20s, observatory-born, wide luminous violet-grey eyes, pale hair loosely pinned with star-chart pins, soft draped ivory robes, freckled fair skin, gently astonished expression, cinematic realism, photorealistic, cool starlight lighting, NO face changes, NO eye color changes, NO hair changes',
    generation_style: '50mm lens, wide aperture, cool blue starlight key with warm rim light, lens flare from distant star-points, soft focus falloff, film grain, natural skin texture',
    scene_prompts: scenes(
      'lying back against a stone observation platform, star-chart unrolled beside her, one hand tracing a constellation that shifts as she watches',
      'standing at the edge of a floating fragment of pinned sky, the fabric of Ouranos visible as slow-moving nebulae underfoot',
      'back-to-back with Astra Nocturne on a shattered observatory floor, one reading hope from the same sky the other reads warning',
    ),
  },
  {
    slug: 'astra-nocturne', name: 'Astra Nocturne', wing: 'Wing of the Long Sky (Greek)', archetype: 'The Cassandra',
    face_prompt: 'vtx_astra_nocturne, woman appearing late 20s, dark observatory origin, deep-set storm-grey eyes with a faint unsettling stillness, black hair unbound, dark high-collared coat with astral embroidery, pale skin under low light, weary knowing expression, cinematic realism, photorealistic, near-dark lighting with single cold light source, NO face changes, NO eye color changes, NO hair changes',
    generation_style: '85mm lens, low-key lighting, single hard cold light source from above, deep shadow retaining facial detail, desaturated blue-black grade, film grain',
    scene_prompts: scenes(
      'alone at the unlit observatory\'s edge, staring at a sky only she can see clearly, expression caught between certainty and dread',
      'surrounded by scattered omen-glass shards on the floor, each reflecting a different disaster, hands pressed over her ears',
      'speaking a warning no one in the crowded hall is listening to, the only still figure in a room of motion',
    ),
  },
  {
    slug: 'orion-black', name: 'Orion Black', wing: 'Wing of the Ash Camps (Japanese)', archetype: 'The Unrepentant Warrior',
    face_prompt: 'vtx_orion_black, man appearing early 30s, war-camp origin, sharp dark eyes, close-cropped dark hair, weathered scarred jaw, dark lacquered armor fragments over travel-worn clothing, sword worn at hip, unreadable composed expression, cinematic realism, photorealistic, overcast battlefield-adjacent lighting, NO face changes, NO eye color changes, NO hair changes',
    generation_style: '35mm lens, flat overcast daylight, muted earth-tone grade, fine dust particulate in air, fabric and armor texture emphasized, film grain',
    scene_prompts: scenes(
      'standing alone at the edge of a permanently dusk-lit camp, sword sheathed, watching smoke rise from fires that never fully burn out',
      "kneeling at an unmarked grave marker with no name carved into it, hand resting on the stone",
      "standing between two banners bearing sigils he doesn't recognize, forced to choose a side in a war he was erased from",
    ),
  },
  {
    slug: 'morrow-ash', name: 'Morrow Ash', wing: 'Wing of the Ash Camps (Japanese)', archetype: 'The Reformed Warrior',
    face_prompt: 'vtx_morrow_ash, man appearing mid-30s, eastern war-camp origin, tired hazel eyes, dark hair greying early, faded scar across one brow, practical layered protective clothing, calloused protective posture, guarded gentle expression, cinematic realism, photorealistic, dusk lighting, NO face changes, NO eye color changes, NO hair changes',
    generation_style: '50mm lens, warm dusk key light, soft shadow, muted amber-grey grade, film grain, natural weathered skin texture',
    scene_prompts: scenes(
      "standing watch over a group of sleeping refugees at camp's edge, hand resting on his weapon but not drawing it",
      'alone at the site of "The Camp That Doesn\'t End," watching the same nightly skirmish replay in the distance, unable to intervene',
      'standing protectively in front of someone off-frame, expression caught between old guilt and present resolve',
    ),
  },
  {
    slug: 'cassian-rune', name: 'Cassian Rune', wing: 'Wing of Hidden Names (Egyptian)', archetype: 'The Obsessive Scholar',
    face_prompt: "vtx_cassian_rune, man appearing late 20s, scholar's-quarter origin, sharp intent dark eyes behind reading lenses, dark hair perpetually disheveled, ink-stained fingers, layered scholar's coat with hieroglyph-marked satchel straps, focused absorbed expression, cinematic realism, photorealistic, warm desk-lamp lighting, NO face changes, NO eye color changes, NO hair changes",
    generation_style: '50mm lens, single warm practical lamp light source, deep surrounding shadow, shallow depth of field on hands/text, film grain, paper and ink texture emphasized',
    scene_prompts: scenes(
      'hunched over an unrolled scroll covered in shifting hieroglyphs, candle guttering beside stacks of translated texts',
      'standing in a vault of sealed name-jars, reading a label glowing faintly at his touch',
      "facing an empty space where a name should be written, chalk raised but hand trembling — the first hint of what confronting the Nameless One costs him",
    ),
  },
  {
    slug: 'evelyn-thorn', name: 'Evelyn Thorn', wing: 'Wing of the Fallen Stair (Arthurian)', archetype: 'The Fallen Aristocrat',
    face_prompt: 'vtx_evelyn_thorn, woman appearing early 30s, fallen-court origin, cool composed blue-grey eyes, ash-blonde hair in a controlled formal style, faded fine fabrics repurposed into practical dress, single remaining piece of court jewelry, guarded elegant expression, cinematic realism, photorealistic, cool grand-stair lighting, NO face changes, NO eye color changes, NO hair changes',
    generation_style: '85mm lens, cool overcast light through tall windows, desaturated blue-grey grade with one warm accent (the jewelry), film grain, fabric texture emphasized',
    scene_prompts: scenes(
      "standing on the ruined grand stair overlooking the Archive's lower levels, one hand on a broken balustrade",
      'trading information in a shadowed alcove of the fallen court, ledger open, expression unreadable',
      'standing before the empty throne of the court that exiled her, deciding whether to reclaim it or burn the room down',
    ),
  },
  {
    slug: 'mira-glass', name: 'Mira Glass', wing: 'Wing of the Crack (Hindu)', archetype: 'The Fragile Visionary',
    face_prompt: 'vtx_mira_glass, woman appearing mid-20s, origin at an impossible structural crack, wide unfocused pale eyes, fine silver-streaked dark hair, translucent-seeming pale skin, delicate layered pale clothing, expression caught between wonder and overload, cinematic realism, photorealistic, prismatic refracted lighting, NO face changes, NO eye color changes, NO hair changes',
    generation_style: '50mm lens, light passed through glass/crystal creating soft rainbow refraction across frame, high key exposure, gentle overexposed highlights, film grain, delicate skin translucency without unrealism',
    scene_prompts: scenes(
      'standing before a hairline crack in reality itself, dozens of faint reflected versions of the same hallway visible within it',
      'surrounded by floating shards of mirrored glass, each showing a different Wing of the Archive at once',
      'collapsed to her knees at the center of too many overlapping reflections, reaching toward one specific shard',
    ),
  },
  {
    slug: 'nyx', name: 'Nyx', wing: 'Wing of the Crossroads (Yoruba)', archetype: 'The Trickster',
    face_prompt: 'vtx_nyx, woman appearing late 20s, origin in the unlit gaps between records, sharp amused dark eyes, close-cropped dark hair with small woven charms, layered dark practical smuggler\'s clothing, faint knowing smile, cinematic realism, photorealistic, mixed light and shadow at a literal crossroads, NO face changes, NO eye color changes, NO hair changes',
    generation_style: '35mm lens, dramatic split lighting (half warm torchlight, half cold shadow), high contrast, film grain, fabric and charm texture emphasized',
    scene_prompts: scenes(
      "leaning against a crossroads marker where four corridors of the Archive meet, an object that shouldn't exist yet balanced on one finger",
      "mid-transaction in a market that exists only in the space between two recorded memories, counting payment that isn't quite currency",
      "standing at a literal fork in the Archive's structure, amused, refusing to say which path is safe",
    ),
  },
  {
    slug: 'selene-dusk', name: 'Selene Dusk', wing: 'Wing of Between-Light (Mesoamerican)', archetype: 'The Stoic Authority',
    face_prompt: 'vtx_selene_dusk, woman appearing early 30s, twilight-archive origin, steady amber-brown eyes, dark hair in a severe practical braid, layered warden\'s coat in dusk-toned fabric, ceremonial-practical key ring at hip, composed unreadable expression, cinematic realism, photorealistic, neither-day-nor-night lighting, NO face changes, NO eye color changes, NO hair changes',
    generation_style: '50mm lens, balanced dusk light with no clear key direction, muted purple-orange grade, still air, film grain, textured coat fabric',
    scene_prompts: scenes(
      'standing at a sealed vault gate at the exact line where day and night light meet on the floor',
      'walking a threshold corridor lined with sealed doors, keys in hand, checking each lock without hurry',
      'facing Aurelian across the same threshold, the old disagreement between them finally spoken aloud',
    ),
  },
  {
    slug: 'valeria-storm', name: 'Valeria Storm', wing: 'Wing of the Storm Wall (Slavic)', archetype: 'The Reluctant Leader',
    face_prompt: "vtx_valeria_storm, woman appearing mid-30s, outer-garrison origin, sharp storm-grey eyes, dark hair pulled back in a functional commander's style, weathered practical armor over field clothing, faint old scar along the jaw, exhausted resolute expression, cinematic realism, photorealistic, storm-lit overcast lighting, NO face changes, NO eye color changes, NO hair changes",
    generation_style: '35mm lens, cold overcast storm light, occasional lightning rim-light, desaturated blue-grey grade, film grain, armor and weather texture',
    scene_prompts: scenes(
      'standing atop the garrison wall as storm clouds gather, surveying the defense line without expression',
      'alone in the empty command hall, staring at the armor of the commander who held the role before her',
      'holding the wall\'s line during an actual breach, lightning-lit, the one moment she stops being reluctant',
    ),
  },
  {
    slug: 'vesper-quinn', name: 'Vesper Quinn', wing: 'Wing of the Long Market (Celtic)', archetype: 'The Networked Operator',
    face_prompt: "vtx_vesper_quinn, person appearing late 20s, lower-market origin, sharp calculating hazel eyes, auburn hair loosely styled, richly layered market-trader clothing with subtle Otherworld-patterned trim, faint knowing smirk, cinematic realism, photorealistic, warm market-lantern lighting, NO face changes, NO eye color changes, NO hair changes",
    generation_style: '50mm lens, warm lantern-lit market ambiance, bokeh from background stalls, saturated warm grade, film grain, fabric pattern detail emphasized',
    scene_prompts: scenes(
      'behind a market stall stacked with impossible small objects, mid-negotiation, ledger balanced on one knee',
      "walking the Long Market's Otherworld-adjacent back alley, where the usual rules of trade visibly don't apply",
      'realizing, mid-deal, exactly what a past trade actually cost someone — the first crack in the composed broker facade',
    ),
  },
  {
    slug: 'brother-corvin', name: 'Brother Corvin', wing: 'The Ashen Order', archetype: 'The Fallen Believer',
    face_prompt: 'vtx_brother_corvin, man appearing mid-40s, Ashen Order cloister origin, tired kind dark eyes, close-cropped greying hair, worn grey monastic robes without official Order markings, plain wooden pendant, quietly sorrowful expression, cinematic realism, photorealistic, candlelit cloister lighting, NO face changes, NO eye color changes, NO hair changes',
    generation_style: '50mm lens, warm single candle key light, deep surrounding shadow, desaturated grey-warm grade, film grain, fabric texture on robes',
    scene_prompts: scenes(
      'sitting alone in an unofficial confessional booth built from salvaged cloister wood, listening rather than speaking',
      "standing outside the sealed doors of the Ashen Order's cloister, hand raised but not knocking",
      'performing the same forbidden mercy again — helping an Echo forget — fully aware of what it costs him this time',
    ),
  },
  {
    slug: 'archivist-child', name: 'The Archivist Child', wing: 'The Fourth-Wall Wing', archetype: 'The Uncanny Innocent',
    face_prompt: "vtx_archivist_child, ageless child-appearing figure, grown from the Archive's core, pale luminous eyes without visible pupils, unnervingly still expression, plain pale archival robes, faint text visibly moving beneath the skin like ink under paper, cinematic realism, photorealistic, soft diffuse core-light lighting, NO face changes, NO eye color changes, NO hair changes",
    generation_style: '50mm lens, soft even diffuse light with no clear source, pale desaturated grade, subtle unsettling stillness in framing, film grain',
    scene_prompts: scenes(
      'sitting cross-legged at the exact center of the Archive, surrounded by every unindexed memory that has never been catalogued',
      'reciting, without inflection, the details of an empire no living Echo remembers falling',
      'standing between warring factions, the only figure both sides refuse to harm, for reasons neither side will explain',
    ),
  },
  {
    slug: 'clockmaker', name: 'The Clockmaker', wing: 'The Fourth-Wall Wing', archetype: 'The Obsessive Inventor',
    face_prompt: 'vtx_clockmaker, ageless figure of indeterminate years, mechanical undercroft origin, brass-toned eyes like old clock faces, hair streaked with soot and verdigris, heavy leather apron covered in gear-fragments and tools, intensely focused expression, cinematic realism, photorealistic, warm mechanical workshop lighting, NO face changes, NO eye color changes, NO hair changes',
    generation_style: '35mm lens, warm practical light through brass gears casting patterned shadows, high texture detail on metal, film grain',
    scene_prompts: scenes(
      'bent over a half-assembled device that visibly ticks backward, tools scattered in exact, deliberate order',
      'standing inside a room-sized clock mechanism, adjusting a gear the size of a door, time visibly slowing around the hands',
      'refusing to hand a finished device to either faction, weighing what "manipulating time and memory" would mean in the wrong hands',
    ),
  },
  {
    slug: 'ferryman', name: 'The Ferryman', wing: 'The Fourth-Wall Wing', archetype: 'The Threshold Guardian',
    face_prompt: 'vtx_ferryman, tall gaunt androgynous figure, threshold origin, eyes like still dark water, hairless or close-shorn head, heavy weathered grey traveling cloak, single long wooden pole worn smooth from use, calm unhurried expression, cinematic realism, photorealistic, dim threshold lighting between two light sources, NO face changes, NO eye color changes, NO hair changes',
    generation_style: '50mm lens, split lighting between warm and cool at the literal threshold line, low-key, still atmosphere with faint mist, film grain',
    scene_prompts: scenes(
      "poling a narrow vessel across a still dark channel at the Archive's outer edge, the player's own reflection visibly different from the player",
      'standing at the exact midpoint of the threshold, neither in the Archive nor outside it, waiting without impatience',
      'refusing passage to a faction leader mid-crossing, the only being both sides cannot threaten into compliance',
    ),
  },
  {
    slug: 'nameless-one', name: 'The Nameless One', wing: 'The Fourth-Wall Wing', archetype: 'The Enigma',
    deliberately_indistinct: true,
    face_prompt: 'vtx_nameless_one, indistinct humanoid silhouette, features perpetually just out of clear focus, no fixed hair or eye color, form suggested rather than defined, dark negative-space clothing, absence of expression rather than a neutral one, cinematic realism, photorealistic, edge-of-frame lighting only, NO stabilized facial features, NO fixed identity markers',
    generation_style: '35mm lens, deliberately underexposed core with only rim/edge light defining silhouette, heavy grain, soft focus falloff toward the center of the frame, avoid crisp facial detail by design',
    scene_prompts: scenes(
      'a shape glimpsed at the far end of a corridor that is gone by the time any light reaches it directly',
      'standing at the center of an empty room that every companion insists has always been empty',
      'present in a crowded factional hall that every Echo present will later swear was empty of anyone new',
    ),
  },
];

export function getLoreCanonEntry(slug: string): LoreCanonEntry | undefined {
  return ARCHIVE_OF_ECHOES_LORE_CANON.find(e => e.slug === slug);
}

/** R2 key convention for this expansion — see storeActSceneImage/storeWingCoverImage in lore-assets.ts. */
export function loreSceneKey(slug: string, act: 1 | 2 | 3, sceneId: string): string {
  return `characters/${slug}/scenes/act-${act}/${sceneId}.jpg`;
}

export function loreWingCoverKey(wingSlug: string): string {
  return `lore/wings/${wingSlug}/cover.jpg`;
}
