/**
 * Character presence engine — Phase 1 Immersive UI Upgrade, spec §10
 * ("Character Presence") / §14 ("Animated Status System").
 *
 * This is explicitly NOT a livestream/online-status system (spec §2: "no
 * livestreaming", §10: "do not use 'Online' as the primary status", §14:
 * "do not make an LLM request simply to determine whether a character is
 * online"). A character's presence is an atmospheric, deterministic label
 * — "Reading", "Exploring Neo-Tokyo" — derived from data that already
 * exists (archetype/tags) plus a coarse, server-clock time bucket. Same
 * character + same 2-hour window always resolves to the same state for
 * every viewer, so it reads as "this is what she's doing right now" (a
 * shared world) rather than a per-viewer illusion, and it's free to
 * compute on every render — no DB write, no cache, no network call.
 *
 * "Remembering you" is deliberately excluded from the default pool (spec
 * §14: "Do not claim the character is 'thinking of you' simply because
 * the user opened the app"). A caller may opt in via
 * `allowRememberingYou`, but only when it has an actual per-user signal
 * to justify it (e.g. a real pending character_initiatives row) — this
 * module has no way to verify that itself, so the honesty burden stays
 * on the caller.
 */

export type PresenceIconKey =
  | "book"
  | "moon"
  | "compass"
  | "headphones"
  | "palette"
  | "sparkle"
  | "moon-star"
  | "heart"
  | "coffee";

export interface CharacterPresence {
  label: string;
  icon: PresenceIconKey;
  /** Optional first-person flavor line, shown only on larger surfaces (hero, not compact cards). */
  flavor?: string;
}

interface PresenceCandidate {
  label: string;
  icon: PresenceIconKey;
  flavor?: string;
  /** Tag keywords that make this state a stronger fit for a given character. */
  tagHints?: string[];
  /** Only eligible in the late-night bucket (22:00–04:00 server time). */
  nightOnly?: boolean;
}

const BASE_POOL: PresenceCandidate[] = [
  { label: "Reading", icon: "book", flavor: "Lost in a chapter I keep re-reading.", tagHints: ["intellectual", "bookworm", "writer", "poet", "academic", "nerdy", "shy"] },
  { label: "Resting", icon: "moon", flavor: "Taking a slow, quiet moment.", nightOnly: true },
  { label: "Exploring", icon: "compass", flavor: "Wandering somewhere new today.", tagHints: ["adventurous", "explorer", "wanderer", "bold", "outgoing"] },
  { label: "Listening to music", icon: "headphones", flavor: "Something's on repeat right now.", tagHints: ["musician", "artist", "dreamy", "creative"] },
  { label: "Creating", icon: "palette", flavor: "In the middle of making something.", tagHints: ["artist", "creative", "designer", "musician"] },
  { label: "Thinking", icon: "sparkle", flavor: "Turning something over in my mind." },
  { label: "Dreaming", icon: "moon-star", flavor: "Somewhere between here and a dream.", nightOnly: true },
  { label: "Having coffee", icon: "coffee", flavor: "Just needed a moment to slow down." },
  { label: "Lost in thought", icon: "sparkle", flavor: "There's something I've been meaning to say." },
];

/** Small stable string hash — deterministic across server/client, no crypto needed for decorative UI. */
function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function isNightBucket(hourUtc: number): boolean {
  return hourUtc >= 22 || hourUtc < 4;
}

/**
 * @param characterId stable id, used as the hash seed
 * @param tags character tags/archetype keywords (lowercased match against tagHints)
 * @param allowRememberingYou only pass true when the caller has verified a real,
 *   user-specific relationship signal (e.g. a pending initiative) — see module doc above
 * @param now injectable for tests; defaults to server clock
 */
export function getCharacterPresence(
  characterId: string,
  tags: string[] = [],
  allowRememberingYou = false,
  now: Date = new Date()
): CharacterPresence {
  const hourUtc = now.getUTCHours();
  // 2-hour buckets so presence changes across the day but doesn't flicker
  // between requests seconds apart.
  const timeBucket = Math.floor(hourUtc / 2);
  const night = isNightBucket(hourUtc);
  const lowerTags = tags.map((t) => t.toLowerCase());

  let pool = BASE_POOL.filter((c) => !c.nightOnly || night);
  if (allowRememberingYou) {
    pool = [
      ...pool,
      { label: "Remembering you", icon: "heart", flavor: "I was just thinking about our last conversation." },
    ];
  }

  // Weight tag-matching states 3x by repeating them in the selection pool,
  // so a character tagged "artist" leans toward Creating/Listening to music
  // more often without ever being locked to a single state.
  const weighted: PresenceCandidate[] = [];
  for (const candidate of pool) {
    const isMatch = candidate.tagHints?.some((hint) => lowerTags.includes(hint));
    weighted.push(candidate, ...(isMatch ? [candidate, candidate] : []));
  }

  const seed = hashString(`${characterId}:${timeBucket}`);
  const chosen = weighted[seed % weighted.length];

  return { label: chosen.label, icon: chosen.icon, flavor: chosen.flavor };
}
