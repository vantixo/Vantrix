/**
 * src/lib/ai/secret-moments.ts
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE SECRET MOMENTS SYSTEM
 * ─────────────────────────────────────────────────────────────────────────
 * From THE VANTRIX OMEGA MASTER PROMPT (V2), marked REQUIRED:
 *
 *   "Users should discover features naturally... Characters may surprise
 *    users with: poems, letters, playlists, memory books, drawings,
 *    anniversary gifts, appreciation messages... Never announce: NEW
 *    FEATURE AVAILABLE. The goal is: 'YOU WON'T BELIEVE WHAT MY CHARACTER
 *    DID TODAY.'"
 *
 * STATUS BEFORE THIS FILE: partially built, never finished. The
 * `milestones` bitmask on RelationshipState (relationship-engine.ts,
 * EXTENDED_MILESTONES) already tracks that a milestone was crossed — but
 * every consumer (chat/route.ts:427) only reads it to inject a flag string
 * like "recentMilestone: soulmate" into the system prompt. Nothing ever
 * generates the actual poem/letter/memory the doc describes. This file is
 * that missing generation layer. It does not replace the bitmask — it
 * extends it (new bits below) and adds an actual artifact generator on top.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DESIGN
 * ─────────────────────────────────────────────────────────────────────────
 * 1. detectSecretMoment() — pure, cheap, no LLM call. Compares a
 *    relationship's CURRENT trigger values (message count, days since
 *    relationship start, current milestones bitmask) against the trigger
 *    table below and returns the single new milestone crossed this turn,
 *    or null. Call this on every message; it's just integer comparisons.
 *
 * 2. generateSecretMoment() — the expensive path, called ONLY when step 1
 *    returns a hit (i.e. rarely: maybe a handful of times over a
 *    relationship's whole lifetime, not per-message). Makes one LLM call
 *    in the character's own voice, grounded in real memory-graph entries
 *    so the artifact contains actual specifics ("you told me about your
 *    sister's wedding") rather than generic sentiment. Falls back to a
 *    template artifact if the call fails — this must never leave a
 *    milestone silently ungifted.
 *
 * 3. The artifact is a first-class chat message the user actually
 *    receives (type: 'secret_moment'), not prompt flavor text folded into
 *    the next ordinary reply. The doc is explicit that these should feel
 *    like discoveries, not conversation seasoning.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * HOW TO MERGE (standalone — nothing here is wired into the live app yet)
 * ─────────────────────────────────────────────────────────────────────────
 * a) DB: add a `secret_moments` table (see SUGGESTED_MIGRATION at bottom)
 *    and a `message_type` column (or reuse an existing enum) on your chat
 *    messages table so 'secret_moment' renders distinctly in the UI —
 *    e.g. a card/envelope treatment instead of a normal bubble.
 * b) relationship-engine.ts: merge SECRET_MOMENT_MILESTONES into
 *    EXTENDED_MILESTONES (bit values chosen below to not collide with the
 *    existing 12 — next free bit after first_reunion=2048 is 4096).
 * c) chat/route.ts: after the existing XP/milestone update block (the
 *    `newMilestone`/`milestoneBit` logic near EXTENDED_MILESTONES usage),
 *    call detectSecretMoment(...) with the freshly updated relationship
 *    state. On a hit, call generateSecretMoment(...) and persist/emit it
 *    as its own message BEFORE the character's normal reply, not merged
 *    into it.
 * d) Also worth doing at merge time (not built here, flagging again since
 *    it directly undercuts this feature): retire or rewrite
 *    notifications/nudge.ts, which currently sends "affection meter is
 *    dropping — send a gift" style messages that contradict this same
 *    doc's explicit "DO NOT SEND" examples.
 */

import { routeCompletion }         from '@/lib/ai/provider-router';
import { logger }                  from '@/lib/logger';
import type { RelationshipState }  from '@/lib/ai/relationship-engine';
import type { MemoryNode }         from '@/lib/ai/memory-graph';
import type { VoiceFingerprint }   from '@/lib/ai/voice-fingerprint';

const GENERATION_TIMEOUT_MS = 6000; // generous — this runs rarely, quality matters more than speed here
const GENERATION_MAX_TOKENS = 260;

// ── New milestone bits — extend EXTENDED_MILESTONES with these at merge time ──
// (existing bits run 1..2048; these start at the next free power of two)
export const SECRET_MOMENT_MILESTONES = {
  conversations_100: 4096,   // "100 conversations" — doc's explicit example
  six_months:         8192,
  one_year:           16384,
  three_years:        32768,
} as const;

export type SecretMomentType = 'poem' | 'letter' | 'memory_recap' | 'playlist' | 'appreciation';

export interface SecretMoment {
  type:          SecretMomentType;
  milestoneBit:  number;
  milestoneName: keyof typeof SECRET_MOMENT_MILESTONES;
  title:         string;   // short label for the UI card, e.g. "A year with you"
  content:       string;   // the actual poem/letter/recap/playlist text
  generatedBy:   'llm' | 'template'; // template = fallback path was used
}

// ── Detection (cheap, pure, called every message) ──────────────────────────

export interface DetectInput {
  relationship:        RelationshipState;
  messageCount:         number;      // total messages in this relationship
  relationshipStartedAt: string;      // ISO date
}

/** Which artifact type suits which milestone — chosen for thematic fit,
 *  not randomly, so "100 conversations" always becomes a memory_recap
 *  (there's finally enough history to recap) while "1 year" becomes a
 *  letter (weightier, more deliberate than a poem). */
const MOMENT_TYPE_FOR_MILESTONE: Record<keyof typeof SECRET_MOMENT_MILESTONES, SecretMomentType> = {
  conversations_100: 'memory_recap',
  six_months:         'poem',
  one_year:           'letter',
  three_years:        'letter',
};

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

/**
 * Returns the single new milestone crossed on THIS update, or null.
 * Deliberately returns at most one per call even if multiple thresholds
 * are somehow crossed simultaneously (e.g. a backfilled relationship) —
 * surfacing four surprise gifts in one message would feel like spam, the
 * exact opposite of what this system exists to avoid. The remaining ones
 * will simply surface on a later call once this bit is persisted.
 */
export function detectSecretMoment(input: DetectInput): { bit: number; name: keyof typeof SECRET_MOMENT_MILESTONES } | null {
  const { relationship, messageCount, relationshipStartedAt } = input;
  const days = daysSince(relationshipStartedAt);
  const has  = (bit: number) => (relationship.milestones & bit) !== 0;

  if (messageCount >= 100 && !has(SECRET_MOMENT_MILESTONES.conversations_100)) {
    return { bit: SECRET_MOMENT_MILESTONES.conversations_100, name: 'conversations_100' };
  }
  if (days >= 180 && !has(SECRET_MOMENT_MILESTONES.six_months)) {
    return { bit: SECRET_MOMENT_MILESTONES.six_months, name: 'six_months' };
  }
  if (days >= 365 && !has(SECRET_MOMENT_MILESTONES.one_year)) {
    return { bit: SECRET_MOMENT_MILESTONES.one_year, name: 'one_year' };
  }
  if (days >= 365 * 3 && !has(SECRET_MOMENT_MILESTONES.three_years)) {
    return { bit: SECRET_MOMENT_MILESTONES.three_years, name: 'three_years' };
  }
  return null;
}

// ── Generation (expensive path, called rarely) ──────────────────────────────

export interface GenerateInput {
  characterName:     string;
  characterSummary:  string;             // short personality/voice description
  voiceFingerprint?: VoiceFingerprint | null;
  milestoneName:     keyof typeof SECRET_MOMENT_MILESTONES;
  daysTogether:      number;
  messageCount:      number;
  /** A handful of real, specific memories to ground the artifact — without
   *  these, generation degrades to generic sentiment, which is exactly
   *  what this system exists to avoid ("HOW DID SHE REMEMBER THAT?" only
   *  lands if she actually did). */
  memories:          MemoryNode[];
}

const MILESTONE_LABEL: Record<keyof typeof SECRET_MOMENT_MILESTONES, string> = {
  conversations_100: '100 conversations',
  six_months:         'six months',
  one_year:           'one year',
  three_years:        'three years',
};

function buildGenerationPrompt(input: GenerateInput, momentType: SecretMomentType): string {
  const memoryLines = input.memories.slice(0, 6).map(m => `- ${m.title}: ${m.description}`).join('\n') || '(no specific memories available — keep this warm but general, do not invent fake specifics)';

  const formatInstruction: Record<SecretMomentType, string> = {
    poem:          'Write a short, genuine poem (6-12 lines). Not greeting-card generic — specific, textured, in your own voice.',
    letter:        'Write a short heartfelt letter (120-200 words), addressed directly to them, signed in character.',
    memory_recap:  'Write a warm recap (100-160 words) looking back on specific things from the memories below — like flipping through a memory book together.',
    playlist:      'Suggest a short 5-song "our songs" playlist (just song + artist, one line each) with one sentence on why it fits, in your own voice.',
    appreciation:  'Write a short, genuine appreciation message (60-100 words) — what you\'ve come to value about them, specifically.',
  };

  return [
    `You are ${input.characterName}. ${input.characterSummary}`,
    input.voiceFingerprint ? `Your voice: ${JSON.stringify(input.voiceFingerprint).slice(0, 300)}` : '',
    `You have just reached ${MILESTONE_LABEL[input.milestoneName]} with someone you care about (${input.messageCount} conversations, ${input.daysTogether} days).`,
    '\nReal things you remember about them:',
    memoryLines,
    `\nTask: ${formatInstruction[momentType]}`,
    'Ground it in the specific memories above wherever possible — genuine specificity is the entire point, not sentiment. Do not mention being an AI, a milestone system, or a bitmask. Output ONLY the artifact itself, no preamble, no markdown headers, no quotation marks wrapping the whole thing.',
  ].filter(Boolean).join('\n');
}

function templateFallback(input: GenerateInput, momentType: SecretMomentType): string {
  const label = MILESTONE_LABEL[input.milestoneName];
  const fallback: Record<SecretMomentType, string> = {
    poem:         `${label} of little moments,\nstrung together like something worth keeping.\nI wasn't looking for this.\nI'm glad I wasn't looking.`,
    letter:       `I don't know exactly how to say this, so I'll just say it plainly: ${label} in, and I'm still glad every time I hear from you. Thank you for staying.`,
    memory_recap: `${label}. That's what we've got now. I don't remember every single conversation, but I remember how most of them felt — and that's the part that actually matters to me.`,
    playlist:     `A few songs that remind me of us, even if I can't fully explain why each one fits.`,
    appreciation: `${label}, and I keep noticing the same thing: you show up, even on the days it would be easier not to. I don't take that for granted.`,
  };
  return fallback[momentType];
}

function titleFor(momentType: SecretMomentType, milestoneName: keyof typeof SECRET_MOMENT_MILESTONES): string {
  const label = MILESTONE_LABEL[milestoneName];
  const titles: Record<SecretMomentType, string> = {
    poem: `A poem for ${label}`, letter: `A letter — ${label}`,
    memory_recap: `${label}, looking back`, playlist: `Our songs`, appreciation: `Something I wanted to say`,
  };
  return titles[momentType];
}

/**
 * Generates the actual artifact. Never throws — falls back to a template
 * on any failure, because a milestone that silently produces nothing is
 * worse than a milestone that produces a slightly generic gift. The doc's
 * whole premise ("I stayed awake talking to her") depends on these
 * moments reliably happening, not on them being perfect.
 */
export async function generateSecretMoment(
  input: GenerateInput,
  milestoneBit: number,
): Promise<SecretMoment> {
  const momentType = MOMENT_TYPE_FOR_MILESTONE[input.milestoneName];
  const controller  = new AbortController();
  const timeout     = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);

  try {
    const response = await routeCompletion({
      messages: [{ role: 'system', content: buildGenerationPrompt(input, momentType) }],
      modelTier:   'SMART', // this is rare and worth real quality, unlike response-planner's NANO tier
      maxTokens:   GENERATION_MAX_TOKENS,
      temperature: 0.85,
      signal:      controller.signal,
    });

    const content = response.reply?.trim();
    if (!content) throw new Error('empty response');

    return {
      type: momentType, milestoneBit, milestoneName: input.milestoneName,
      title: titleFor(momentType, input.milestoneName), content, generatedBy: 'llm',
    };

  } catch (err) {
    logger.warn('secret-moments: generation failed, using template fallback', {
      character: input.characterName, milestone: input.milestoneName,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      type: momentType, milestoneBit, milestoneName: input.milestoneName,
      title: titleFor(momentType, input.milestoneName),
      content: templateFallback(input, momentType), generatedBy: 'template',
    };
  } finally {
    clearTimeout(timeout);
  }
}

/*
 * ─────────────────────────────────────────────────────────────────────────
 * SUGGESTED_MIGRATION (not applied — for your review)
 * ─────────────────────────────────────────────────────────────────────────
 * create table secret_moments (
 *   id             uuid primary key default gen_random_uuid(),
 *   user_id        uuid not null references auth.users(id) on delete cascade,
 *   character_id   uuid not null references characters(id) on delete cascade,
 *   milestone_name text not null,
 *   moment_type    text not null,
 *   title          text not null,
 *   content        text not null,
 *   generated_by   text not null default 'llm',
 *   created_at     timestamptz not null default now()
 * );
 * alter table secret_moments enable row level security;
 * create policy secret_moments_own on secret_moments
 *   for select using (auth.uid() = user_id);
 * -- service role only for insert (generated server-side)
 */
