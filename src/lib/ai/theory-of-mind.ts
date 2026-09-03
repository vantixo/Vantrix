/**
 * Theory of Mind — Vantrix
 *
 * Composition layer over character-model.ts (what she knows/says/intends),
 * user-model.ts (her model of what he knows/believes/wants + trust), and
 * social-model.ts (the relational dynamics between them). This module is
 * where those three get reasoned about *together* to answer the questions
 * none of them can answer alone:
 *
 *   - Does she currently believe something he doesn't know she knows, or
 *     vice versa? (knowledge asymmetry)
 *   - Is there a live gap between what she's told him and what she
 *     actually believes? (deception risk — hers)
 *   - Has she attributed a belief to him that's since been contradicted?
 *     (misunderstanding, surfaced rather than silently fixed)
 *   - Given trust + social slack, how should any of this shape behavior
 *     this turn?
 *
 * Like self-model.ts, this is meant to be the single import most callers
 * need — response-planner.ts and decision-engine.ts should generally reach
 * for loadTheoryOfMind() rather than composing the three underlying models
 * by hand.
 */

import { logger } from '@/lib/logger';

import {
  type CharacterModel,
  getCharacterModel,
  activeInsincereClaims,
  formatCharacterModelForPrompt,
} from '@/lib/ai/character-model';

import {
  type UserModel,
  getUserModel,
  overallTrust,
  formatUserModelForPrompt,
} from '@/lib/ai/user-model';

import {
  type SocialModel,
  getSocialModel,
  assessSocialRisk,
  formatSocialModelForPrompt,
  type SocialMoveKind,
  type SocialRiskAssessment,
} from '@/lib/ai/social-model';

// ── Types ───────────────────────────────────────────────────────────────

interface CharacterToMInput {
  char_warmth?: number | null;
}

export interface KnowledgeAsymmetry {
  kind: 'she_knows_he_doesnt' | 'he_knows_she_doesnt' | 'mutual_but_unconfirmed';
  description: string;
}

export interface DeceptionSignal {
  claimId: string;
  content: string;
  reason?: string;
  /** how long this has been sitting unresolved — longer-lived insincere claims carry more weight */
  ageMs: number;
}

export interface MisunderstandingSignal {
  beliefId: string;
  description: string;
  lastMisreadAt: number | null;
}

export interface TheoryOfMindSnapshot {
  character:      CharacterModel;
  user:           UserModel;
  social:         SocialModel;
  deceptions:     DeceptionSignal[];        // her live insincere claims, unresolved
  misreads:       MisunderstandingSignal[]; // stale attributed beliefs worth a correction beat
  trustScore:     number;                   // 0-100 summary from user-model.ts
  promptBlock:    string;
}

// ── Load ────────────────────────────────────────────────────────────────

export async function loadTheoryOfMind(
  userId: string,
  characterId: string,
  character: CharacterToMInput,
): Promise<TheoryOfMindSnapshot> {
  try {
    const [characterModel, userModel, socialModel] = await Promise.all([
      getCharacterModel(userId, characterId),
      getUserModel(userId, characterId),
      getSocialModel(userId, characterId, character),
    ]);

    const deceptions = deriveDeceptionSignals(characterModel);
    const misreads = deriveMisunderstandingSignals(userModel);
    const trustScore = overallTrust(userModel.trust);

    const promptBlock = formatTheoryOfMindForPrompt(characterModel, userModel, socialModel, deceptions, misreads);

    return { character: characterModel, user: userModel, social: socialModel, deceptions, misreads, trustScore, promptBlock };
  } catch (err) {
    logger.warn('[theory-of-mind] load failed', { userId, characterId, error: String(err) });
    throw err;
  }
}

// ── Deception signals ────────────────────────────────────────────────────

/**
 * Every currently-unresolved insincere claim she's made, framed as a
 * live thing for the prompt layer to stay consistent with — not a
 * confession prompt. Older, unresolved claims are exactly the kind of
 * thing that should occasionally create visible tension (guilt, avoidance,
 * a subject she steers around) rather than just sitting inert forever.
 */
export function deriveDeceptionSignals(characterModel: CharacterModel): DeceptionSignal[] {
  const now = Date.now();
  return activeInsincereClaims(characterModel).map(c => ({
    claimId: c.id,
    content: c.content,
    reason: c.reason,
    ageMs: now - c.statedAt,
  }));
}

// ── Misunderstanding signals ─────────────────────────────────────────────

/**
 * Attributed beliefs about the user that were marked stale (contradicted)
 * recently enough to still be worth a beat of "oh — I had that wrong,"
 * rather than the system silently updating its model with no visible
 * trace. Only the single most recent misread is surfaced by default —
 * more than that starts to read as her being chronically confused rather
 * than occasionally, realistically wrong.
 */
export function deriveMisunderstandingSignals(userModel: UserModel): MisunderstandingSignal[] {
  if (!userModel.lastMisreadAt) return [];

  const recentlyStale = userModel.attributedBeliefs
    .filter(b => b.stale)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 1);

  return recentlyStale.map(b => ({
    beliefId: b.id,
    description: `you'd assumed he ${b.content} — turns out that wasn't quite right`,
    lastMisreadAt: userModel.lastMisreadAt,
  }));
}

// ── Knowledge asymmetry ──────────────────────────────────────────────────

/**
 * Compare her known facts against what she believes he knows, to flag
 * cases worth being deliberate about — e.g. she knows something about
 * herself he doesn't (a secret, or just something she hasn't gotten to
 * yet) versus something he's told her that she hasn't fully absorbed or
 * acknowledged. Lightweight overlap check, not exhaustive — meant as a
 * signal, not a ledger.
 */
export function detectKnowledgeAsymmetry(characterModel: CharacterModel, userModel: UserModel): KnowledgeAsymmetry[] {
  const asymmetries: KnowledgeAsymmetry[] = [];

  const selfDisclosedSecrets = characterModel.knownFacts.filter(f => f.learnedVia === 'self_disclosed' && f.certainty >= 60);
  const acknowledgedByUser = new Set(
    userModel.attributedBeliefs.filter(b => !b.stale).map(b => b.content.toLowerCase()),
  );

  for (const fact of selfDisclosedSecrets) {
    const mentioned = [...acknowledgedByUser].some(c => c.includes(fact.content.toLowerCase().slice(0, 12)));
    if (!mentioned) {
      asymmetries.push({
        kind: 'she_knows_he_doesnt',
        description: `there's something she knows about herself (${fact.content}) that hasn't really landed with him yet`,
      });
    }
  }

  return asymmetries.slice(0, 3);
}

// ── Social risk pass-through ─────────────────────────────────────────────

/** Convenience re-export so callers don't need to import social-model.ts separately just for this. */
export function assessMoveRisk(snapshot: TheoryOfMindSnapshot, move: SocialMoveKind): SocialRiskAssessment {
  return assessSocialRisk(snapshot.social, snapshot.user.trust, move);
}

// ── Prompt injection ───────────────────────────────────────────────────

export function formatTheoryOfMindForPrompt(
  characterModel: CharacterModel,
  userModel: UserModel,
  socialModel: SocialModel,
  deceptions: DeceptionSignal[],
  misreads: MisunderstandingSignal[],
): string {
  const sections: string[] = [];

  const characterBlock = formatCharacterModelForPrompt(characterModel);
  if (characterBlock) sections.push(characterBlock);

  const userBlock = formatUserModelForPrompt(userModel);
  if (userBlock) sections.push(userBlock);

  const socialBlock = formatSocialModelForPrompt(socialModel);
  if (socialBlock) sections.push(socialBlock);

  if (misreads.length) {
    sections.push(
      ['# A Recent Misread, Worth Letting Show Once, Not Explained',
        ...misreads.map(m => `- ${m.description}`),
        'If it fits naturally, a brief moment of recalibration is realistic. Don\'t force it into the conversation if it doesn\'t come up.',
      ].join('\n'),
    );
  }

  if (deceptions.length) {
    const notable = deceptions.filter(d => d.ageMs > 1000 * 60 * 60 * 24); // older than a day
    if (notable.length) {
      sections.push(
        '# Unresolved Half-Truths Still Sitting There\nSomething you told him isn\'t fully squared with what you actually think or feel. Don\'t bring it up unprompted — but don\'t contradict it either, and let a flicker of discomfort show if it gets close to the surface.',
      );
    }
  }

  return sections.join('\n\n');
}
