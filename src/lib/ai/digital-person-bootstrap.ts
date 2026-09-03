/**
 * Digital Person Bootstrap — Vantrix Silicon Valley
 *
 * ENFORCEMENT POINT: every character that exists in this platform must be
 * a "digital person with a persistent brain" — not an opt-in feature some
 * characters get and others don't. This module is the single choke point
 * that guarantees it: called synchronously from POST /api/characters,
 * REQUIRED to succeed before character creation is considered complete.
 *
 * Unlike triggerAnimationAsync() (fire-and-forget, cosmetic), this is NOT
 * fire-and-forget. If brain initialization fails, the caller must roll
 * back the character row and refund the token charge — a character
 * without a brain is not a valid Vantrix character, full stop.
 *
 * What "persistent brain" means concretely, wired to modules already built
 * in this codebase:
 *   1. writing_style + voice_profile   → assigned deterministically from
 *      the character's own text (no manual curation required at creation
 *      time) — see writing-style.ts. elevenlabs_voice_id is assigned in
 *      the same pass, from the same archetype match, so the character's
 *      writing style, abstract voice tuning, AND actual ElevenLabs voice
 *      identity are always one coherent read of who they are — see
 *      voice-library.ts.
 *   2. Baseline character_knowledge    → personality_note + backstory_detail
 *      entries auto-derived from the fields the creator already provided
 *      — see knowledge-library.ts
 *   3. characters.brain_initialized    → flipped true only after 1 and 2
 *      both succeed; this is the flag every downstream consumer (chat
 *      route, initiative cron, journal cron) checks before treating a
 *      character as usable.
 *
 * Per-relationship state (relationship_engine, memory_graph, milestones,
 * journal, independent thoughts) is deliberately NOT created here — those
 * are keyed by (user_id, character_id) and don't exist until a specific
 * user starts talking to this character. ensureRelationship() and
 * maybeRecordFirstMeeting() already do that lazily on first contact.
 * Bootstrapping here is about the character's OWN persistent identity,
 * which must exist before anyone ever talks to them.
 */

import { supabaseAdmin }        from '@/lib/supabase/admin';
import { logger }               from '@/lib/logger';
import type { Json }            from '@/types/supabase';
import { addKnowledgeEntry }    from './knowledge-library';
import {
  WRITING_STYLE_PRESETS,
  VOICE_PRESETS,
  type WritingStyleProfile,
  type VoiceProfile,
} from './writing-style';
import { resolveVoiceId } from './voice-library';

export interface DigitalPersonInput {
  characterId:  string;
  name:         string;
  personality?: string | null;
  backstory?:   string | null;
  occupation?:  string | null;
  category?:    string | null; // used as a loose signal for style preset selection
  tags?:        string[];
  // characters.gender ('female' | 'male' | 'anime' | 'other') — feeds
  // resolveVoiceId() so the assigned ElevenLabs voice actually matches
  // who the character is, not just a coin-flip default.
  gender?:      string | null;
}

export interface BootstrapResult {
  success: boolean;
  stage:   'writing_style' | 'knowledge_seed' | 'flag' | 'complete';
  error?:  string;
}

// ── Style preset selection ──────────────────────────────────────────────
// Deterministic, keyword-driven — every character gets a coherent style
// immediately, no manual tagging required. Falls back to a balanced
// default preset rather than leaving style unset.

const DEFAULT_STYLE: WritingStyleProfile = {
  sentence_length: 'medium', vocabulary: 'casual', humor: 'playful',
  emoji_usage: 'occasional', curiosity_level: 60,
  quirks: [], color: '#9B8CFF',
};
const DEFAULT_VOICE: VoiceProfile = { pitch: 0, pace: 1.0, warmth: 65, pauses: 'natural', energy: 55 };

function selectPreset(input: DigitalPersonInput): { style: WritingStyleProfile; voice: VoiceProfile; elevenlabsVoiceId: string } {
  const text = `${input.personality ?? ''} ${input.backstory ?? ''} ${input.occupation ?? ''} ${input.category ?? ''}`.toLowerCase();

  const rules: Array<[RegExp, string]> = [
    [/poet|writer|novelist|literary/, 'poet'],
    [/gam(er|ing)|streamer|esports/,  'gamer'],
    [/professor|academic|research|scientist|teacher/, 'professor'],
    [/girl.?next.?door|sweet|bubbly|cheerful/, 'girl_next_door'],
    [/companion|devoted|caring|nurtur|gentle|soothing|comfort/, 'companion'],
  ];

  for (const [pattern, key] of rules) {
    if (pattern.test(text)) {
      return {
        style: WRITING_STYLE_PRESETS[key],
        voice: VOICE_PRESETS[key],
        elevenlabsVoiceId: resolveVoiceId(key, input.gender),
      };
    }
  }
  return { style: DEFAULT_STYLE, voice: DEFAULT_VOICE, elevenlabsVoiceId: resolveVoiceId(null, input.gender) };
}

// ── Knowledge seeding from the creator's own inputs ─────────────────────
// Not placeholder content — actual derived facts, so retrieval has
// something real to work with from message one.

async function seedBaselineKnowledge(input: DigitalPersonInput): Promise<boolean> {
  const entries: Array<Parameters<typeof addKnowledgeEntry>[1]> = [];

  if (input.personality) {
    entries.push({
      category: 'personality_note',
      title:    `${input.name}'s core personality`,
      content:  input.personality,
      tags:     ['core_personality'],
      weight:   80,
    });
  }
  if (input.backstory) {
    entries.push({
      category: 'backstory_detail',
      title:    `${input.name}'s background`,
      content:  input.backstory,
      tags:     ['backstory'],
      weight:   75,
    });
  }
  if (input.occupation) {
    entries.push({
      category: 'personality_note',
      title:    `${input.name}'s work`,
      content:  `${input.name} works as ${input.occupation}. This shapes how they see the world and what they have opinions about.`,
      tags:     ['occupation', input.occupation.toLowerCase().replace(/\s+/g, '_')],
      weight:   60,
    });
  }

  if (!entries.length) {
    // A character created with no personality/backstory/occupation text at
    // all still needs SOMETHING to seed the brain — otherwise retrieval
    // has nothing to draw on and the character reads as flat by default.
    entries.push({
      category: 'personality_note',
      title:    `${input.name}'s baseline`,
      content:  `${input.name} is still discovering who they are through their conversations — early impressions should stay open and curious rather than fixed.`,
      tags:     ['baseline'],
      weight:   40,
    });
  }

  const results = await Promise.all(
    entries.map(e => addKnowledgeEntry(input.characterId, e)),
  );
  return results.every(r => r !== null);
}

// ── Main entry point — called synchronously from character creation ────

export async function initializeDigitalPerson(
  input: DigitalPersonInput,
): Promise<BootstrapResult> {
  const { style, voice, elevenlabsVoiceId } = selectPreset(input);

  const { error: styleErr } = await supabaseAdmin
    .from('characters')
    .update({
      writing_style: style as unknown as Json,
      voice_profile: voice as unknown as Json,
      elevenlabs_voice_id: elevenlabsVoiceId,
    })
    .eq('id', input.characterId);

  if (styleErr) {
    logger.error('digital-person-bootstrap: writing_style write failed', {
      characterId: input.characterId, error: styleErr.message,
    });
    return { success: false, stage: 'writing_style', error: styleErr.message };
  }

  const knowledgeOk = await seedBaselineKnowledge(input);
  if (!knowledgeOk) {
    logger.error('digital-person-bootstrap: baseline knowledge seed failed', {
      characterId: input.characterId,
    });
    return { success: false, stage: 'knowledge_seed', error: 'one or more knowledge entries failed to insert' };
  }

  const { error: flagErr } = await supabaseAdmin
    .from('characters')
    .update({ brain_initialized: true })
    .eq('id', input.characterId);

  if (flagErr) {
    logger.error('digital-person-bootstrap: brain_initialized flag write failed', {
      characterId: input.characterId, error: flagErr.message,
    });
    return { success: false, stage: 'flag', error: flagErr.message };
  }

  logger.info('digital-person-bootstrap: complete', { characterId: input.characterId, name: input.name });
  return { success: true, stage: 'complete' };
}

// ── Guard used by chat route + cron jobs ────────────────────────────────
// Any consumer that treats a character as a full digital person (chat
// generation, initiative cron, journal cron) should check this rather
// than assuming every row in `characters` qualifies.

export async function isDigitalPersonReady(characterId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('characters')
    .select('brain_initialized')
    .eq('id', characterId)
    .single();
  return !!data?.brain_initialized;
}

// ── Backfill for characters created before this system existed ─────────

export async function backfillDigitalPersons(batchSize = 25): Promise<{ processed: number; failed: number }> {
  const { data: characters } = await supabaseAdmin
    .from('characters')
    .select('id,name,personality,backstory,occupation,category,tags')
    .or('brain_initialized.is.null,brain_initialized.eq.false')
    .limit(batchSize);

  if (!characters?.length) return { processed: 0, failed: 0 };

  let processed = 0, failed = 0;
  for (const c of characters) {
    const result = await initializeDigitalPerson({
      characterId: c.id, name: c.name, personality: c.personality,
      backstory: c.backstory, occupation: c.occupation, category: c.category, tags: c.tags,
    });
    if (result.success) processed++; else failed++;
  }
  return { processed, failed };
}
