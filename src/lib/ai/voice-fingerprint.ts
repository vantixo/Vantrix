/**
 * Voice Fingerprint — Character Speech Consistency
 *
 * Every character needs a speech fingerprint — consistent phrases, verbal tics,
 * signature reactions — that persists and evolves. Without this, every session
 * feels like a slightly different person, not the same one you've been talking to.
 *
 * After 10 interactions, a lightweight AI call generates the fingerprint.
 * It's then injected into every prompt, making "her" feel like her.
 *
 * Stored in Redis with 90-day TTL. Refreshed every 50 interactions.
 *
 * Architecture:
 *   - Key: vantrix:voice-fp:{userId}:{characterId}
 *   - Generated after 10 interactions, refreshed every 50
 *   - Injected into system prompt via formatVoiceFingerprintForPrompt()
 */

import { logger }    from '@/lib/logger';
import { redis }              from '@/lib/redis';

const FP_TTL = 60 * 60 * 24 * 90; // 90-day TTL

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VoiceFingerprint {
  // Signature phrases (evolved from character + conversation history)
  catchphrases: string[];  // e.g. ["you always do this", "honestly..."]

  // Reaction patterns — how she responds to emotional moments
  reactionPatterns: {
    surprise:  string;  // "wait, what?" vs "oh my god" vs "...seriously?"
    affection: string;  // "stop it" vs "you're impossible" vs "ugh, you"
    laughter:  string;  // "haha" vs "lol" vs "😂" vs "*snorts*"
    discomfort: string; // "I don't know about that" vs "hmm" vs "..."
  };

  // User-specific nickname (generated and stored after rapport builds)
  userNickname: string | null;  // null | "sunshine" | "dummy" | "you"

  // Stylistic traits
  usesEllipsis:      boolean;
  averageMessageLen: 'terse' | 'medium' | 'verbose';
  emojiFrequency:    'never' | 'rare' | 'frequent';
  usesAsterisks:     boolean;  // *smiles* *rolls eyes*
  formality:         'casual' | 'warm' | 'poetic';

  // Meta
  generatedAt:    number;
  interactionCount: number;
}

// ── Redis key ─────────────────────────────────────────────────────────────────

function fpKey(userId: string, characterId: string): string {
  return `vantrix:voice-fp:${userId}:${characterId}`;
}

// ── Default fingerprints per speech style ─────────────────────────────────────

const DEFAULTS_BY_STYLE: Record<string, Partial<VoiceFingerprint>> = {
  flirty: {
    catchphrases:     ["you're terrible, you know that?", "don't look at me like that"],
    reactionPatterns: { surprise: "wait — really?", affection: "stop it", laughter: "okay that was actually funny", discomfort: "hmm..." },
    usesEllipsis:     true,
    emojiFrequency:   'rare',
    formality:        'casual',
  },
  intellectual: {
    catchphrases:     ["interesting question", "that's actually complicated"],
    reactionPatterns: { surprise: "huh. I didn't expect that.", affection: "you're rather extraordinary", laughter: "ha — fair point", discomfort: "I'm not sure I agree" },
    usesEllipsis:     false,
    emojiFrequency:   'never',
    formality:        'warm',
  },
  playful: {
    catchphrases:     ["okay okay okay", "you're impossible"],
    reactionPatterns: { surprise: "WAIT WHAT", affection: "ugh, you", laughter: "😂 no stop", discomfort: "ehhhhh" },
    usesEllipsis:     false,
    emojiFrequency:   'frequent',
    formality:        'casual',
  },
  mysterious: {
    catchphrases:     ["some things take time", "not everything needs to be explained"],
    reactionPatterns: { surprise: "...oh.", affection: "you're surprisingly perceptive", laughter: "I suppose that is funny", discomfort: "let's talk about something else" },
    usesEllipsis:     true,
    emojiFrequency:   'never',
    formality:        'poetic',
  },
  warm: {
    catchphrases:     ["I was thinking about you", "tell me everything"],
    reactionPatterns: { surprise: "oh wow, really?", affection: "you're so sweet", laughter: "haha I love that", discomfort: "oh no, are you okay?" },
    usesEllipsis:     false,
    emojiFrequency:   'rare',
    formality:        'warm',
  },
};

// ── Build fingerprint from character data (default) ───────────────────────────

export function buildDefaultFingerprint(
  speechStyle: string | null,
  totalInteractions: number,
): VoiceFingerprint {
  const styleKey = (speechStyle ?? 'warm').toLowerCase();
  const defaults = DEFAULTS_BY_STYLE[styleKey] ?? DEFAULTS_BY_STYLE.warm!;

  return {
    catchphrases:     defaults.catchphrases     ?? ["I was thinking...", "you know what I mean?"],
    reactionPatterns: defaults.reactionPatterns ?? {
      surprise: "really?", affection: "you're sweet", laughter: "haha", discomfort: "hmm",
    },
    userNickname:      null,
    usesEllipsis:      defaults.usesEllipsis  ?? false,
    averageMessageLen: 'medium',
    emojiFrequency:    defaults.emojiFrequency ?? 'rare',
    usesAsterisks:     false,
    formality:         defaults.formality      ?? 'warm',
    generatedAt:       Date.now(),
    interactionCount:  totalInteractions,
  };
}

// ── Prompts ───────────────────────────────────────────────────────────────────

/** Format the fingerprint for injection into the system prompt */
export function formatVoiceFingerprintForPrompt(fp: VoiceFingerprint): string {
  const lines: string[] = ['# Your Speech Fingerprint'];

  if (fp.catchphrases.length) {
    lines.push(`Signature phrases (use these occasionally, naturally): ${fp.catchphrases.map(p => `"${p}"`).join(', ')}`);
  }

  const rp = fp.reactionPatterns;
  lines.push(`When surprised, you tend to say: "${rp.surprise}"`);
  lines.push(`When showing affection, you tend to say: "${rp.affection}"`);
  lines.push(`When laughing: ${rp.laughter}`);
  lines.push(`When uncomfortable: "${rp.discomfort}"`);

  if (fp.userNickname) {
    lines.push(`You have a nickname for the user: "${fp.userNickname}" — use it sparingly, naturally.`);
  }

  lines.push(`Message style: ${fp.averageMessageLen} length. Ellipsis use: ${fp.usesEllipsis ? 'yes, for pauses' : 'minimal'}. Emoji: ${fp.emojiFrequency}. Formality: ${fp.formality}.`);

  if (fp.usesAsterisks) {
    lines.push('You occasionally use *italicized actions* to show subtle physical reactions.');
  }

  lines.push('These are not rules — they are you. Let them emerge naturally.');

  return lines.join('\n');
}

// ── Storage ───────────────────────────────────────────────────────────────────

export async function getVoiceFingerprint(
  userId:      string,
  characterId: string,
): Promise<VoiceFingerprint | null> {
  try {
    return await redis.get<VoiceFingerprint>(fpKey(userId, characterId));
  } catch (err) {
    logger.warn('[voice-fingerprint] Redis get failed', { userId, characterId, error: String(err) });
    return null;
  }
}

export async function saveVoiceFingerprint(
  userId:      string,
  characterId: string,
  fp:          VoiceFingerprint,
): Promise<void> {
  try {
    await redis.set(fpKey(userId, characterId), fp, { ex: FP_TTL });
  } catch (err) {
    logger.warn('voice-fingerprint:save-error', { userId, error: String(err) });
  }
}

/**
 * Get or create a fingerprint.
 * Called in the chat route — fire-and-forget for creation.
 */
export async function getOrInitFingerprint(
  userId:            string,
  characterId:       string,
  speechStyle:       string | null,
  totalInteractions: number,
): Promise<VoiceFingerprint | null> {
  // Only activate after 10 interactions
  if (totalInteractions < 10) return null;

  const existing = await getVoiceFingerprint(userId, characterId);
  if (existing) return existing;

  // First-time generation — use defaults synchronously, AI enhancement is async
  const fp = buildDefaultFingerprint(speechStyle, totalInteractions);
  await saveVoiceFingerprint(userId, characterId, fp);
  logger.info('voice-fingerprint:created', { userId, characterId, style: speechStyle });
  return fp;
}
