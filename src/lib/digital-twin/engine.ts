/**
 * Digital Twin Engine — Elite-tier feature
 *
 * Builds an AI clone of the USER (not a character) that learns their own
 * texting style — tone, message length, emoji habits, common phrases — and
 * can generate replies "as them". Two inputs feed the twin:
 *
 *   1. AUTO-LEARNED profile: built from the user's own sent messages
 *      (role='user' rows across their conversations) via buildStyleProfile().
 *   2. MANUAL refinement: freeform notes + sample phrases the user supplies
 *      directly, layered on top and always taking precedence over anything
 *      the auto profile inferred.
 *
 * Previously `canUseDigitalTwin()` in lib/tiers/config.ts gated a feature
 * that didn't exist anywhere in the codebase — this file is the actual
 * implementation that gate now protects.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { generateText } from '@/lib/ai/capability';
import { logger } from '@/lib/logger';
import type { Json } from '@/types/supabase';

// ── Types ────────────────────────────────────────────────────────────────

export interface TwinTraits {
  tone: string;                 // e.g. "casual, dry humor, affectionate with close friends"
  avgMessageLength: 'short' | 'medium' | 'long';
  emojiUsage: 'none' | 'light' | 'frequent';
  commonPhrases: string[];      // recurring phrases/verbal tics
  vocabularyNotes: string;      // slang, capitalization habits, punctuation quirks
  formality: 'casual' | 'neutral' | 'formal';   // overall register
  punctuationStyle: string;     // e.g. "rarely uses periods, stacks question marks, no capitals"
  topics: string[];             // subjects they gravitate toward, up to 5
  // Deeper personalization fields — filled in by deep training (see
  // buildStyleProfile's `depth` param), left empty/undefined by a quick
  // train so older profiles and light retrains degrade gracefully.
  personalityTraits?: string[]; // e.g. "curious", "protective of close friends", "self-deprecating humor"
  values?: string[];            // things they consistently seem to care about or prioritize
  humorStyle?: string;          // e.g. "dry, understated, callback-heavy"
  emotionalPatterns?: string;   // how they tend to express/process feelings in writing
  conversationalHabits?: string; // e.g. "asks follow-up questions, rarely initiates topic changes"
  // Master-only fields — filled in only by the top training tier, which
  // reads the largest possible history slice and asks the model to model
  // the person at a near-exhaustive level rather than just their surface
  // and mid-level patterns.
  coreBeliefs?: string[];        // recurring worldview/opinion threads that show up repeatedly
  relationshipStyle?: string;    // how they seem to relate to others in writing — warmth, boundaries, trust patterns
  decisionMakingStyle?: string;  // how they seem to reason/decide when writing through a problem or choice
  speechRhythm?: string;         // sentence-length variation, run-ons vs. fragments, pacing quirks beyond punctuation
  contradictions?: string;       // genuine tensions/inconsistencies in how they present themselves, if evident
  growthArc?: string;            // any visible shift in tone/values/interests across the sampled time range, if evident
}

export type TrainingDepth = 'standard' | 'deep' | 'master';

export interface TwinSourceBreakdown {
  chat: number;          // messages sent to characters
  community: number;     // community posts + replies authored by the user
}

export interface DigitalTwinProfile {
  userId: string;
  enabled: boolean;
  autoStyleSummary: string | null;
  autoTraits: TwinTraits | null;
  sourceMessageCount: number;
  sourceBreakdown: TwinSourceBreakdown | null;
  lastTrainedAt: string | null;
  lastTrainingDepth: TrainingDepth | null;
  manualNotes: string | null;
  manualSamplePhrases: string[];
  updatedAt: string;
}

interface TwinProfileRow {
  user_id: string;
  enabled: boolean;
  auto_style_summary: string | null;
  auto_traits: TwinTraits | null;
  source_message_count: number;
  source_breakdown: TwinSourceBreakdown | null;
  last_trained_at: string | null;
  last_training_depth: TrainingDepth | null;
  manual_notes: string | null;
  manual_sample_phrases: string[];
  updated_at: string;
}

function rowToProfile(row: TwinProfileRow): DigitalTwinProfile {
  return {
    userId: row.user_id,
    enabled: row.enabled,
    autoStyleSummary: row.auto_style_summary,
    autoTraits: row.auto_traits,
    sourceMessageCount: row.source_message_count,
    sourceBreakdown: row.source_breakdown ?? null,
    lastTrainedAt: row.last_trained_at,
    lastTrainingDepth: row.last_training_depth ?? null,
    manualNotes: row.manual_notes,
    manualSamplePhrases: row.manual_sample_phrases ?? [],
    updatedAt: row.updated_at,
  };
}

const MIN_MESSAGES_TO_TRAIN = 20;

// Two training depths. "standard" is the original fast/cheap pass. "deep"
// pulls substantially more history and asks the LLM for a richer trait set
// (personality, values, humor, emotional/conversational patterns, not just
// surface texting mechanics) — meant for a user who wants their twin to
// feel like *them*, not just mimic their punctuation. Deep training costs
// more (bigger context, more output tokens) so it's invoked explicitly via
// the `depth` param rather than being the default on every retrain.
// "master" is the top tier — pulls essentially all available history (up
// to the hard caps below), runs a much larger/slower inference pass, and
// asks the model to build a near-exhaustive picture of the person rather
// than just surface texting mechanics or mid-level personality notes. By
// design this is meaningfully slower than "deep" (bigger context in,
// bigger completion out, lower temperature for consistency) — that's the
// tradeoff for a twin that's supposed to feel indistinguishable from the
// real person rather than a decent impression of them.
const SAMPLE_CAPS: Record<TrainingDepth, { messages: number; community: number; forInference: number }> = {
  standard: { messages: 200, community: 60, forInference: 150 },
  deep:     { messages: 1000, community: 300, forInference: 600 },
  master:   { messages: 4000, community: 1200, forInference: 2500 },
};

// Token cost per training run — standard training has always been "free"
// (covered by the elite plan gate itself); deep training does a much
// bigger context pull and a much bigger completion (1200 vs 500 max
// tokens, ~4x the sample), so it's metered from the token wallet like
// every other heavy generation call (image batches, TTS, etc.) rather than
// bundled into the flat plan price. Exported so the API route and the
// client UI both read the same number.
export const TRAINING_TOKEN_COST: Record<TrainingDepth, number> = {
  standard: 0,
  deep: 40,
  master: 150,
};

// Master training does a genuinely large inference pass (thousands of
// messages summarized, ~4x deep's completion budget) — it can take
// noticeably longer than a normal request/response cycle. Exported so the
// route and client can both surface an honest expectation instead of a
// silent long spinner.
export const TRAINING_ETA_SECONDS: Record<TrainingDepth, number> = {
  standard: 5,
  deep: 15,
  master: 90,
};

// ── Fetch ────────────────────────────────────────────────────────────────

export async function getDigitalTwinProfile(userId: string): Promise<DigitalTwinProfile | null> {
  const { data } = await supabaseAdmin
    .from('digital_twin_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  return data ? rowToProfile(data as TwinProfileRow) : null;
}

// ── Manual refinement ───────────────────────────────────────────────────

export async function updateManualProfile(
  userId: string,
  patch: { manualNotes?: string; manualSamplePhrases?: string[]; enabled?: boolean }
): Promise<DigitalTwinProfile> {
  const { data, error } = await supabaseAdmin
    .from('digital_twin_profiles')
    .upsert(
      {
        user_id: userId,
        ...(patch.manualNotes !== undefined ? { manual_notes: patch.manualNotes } : {}),
        ...(patch.manualSamplePhrases !== undefined ? { manual_sample_phrases: patch.manualSamplePhrases } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    .select('*')
    .single();

  if (error || !data) throw new Error(`Failed to update digital twin profile: ${error?.message}`);
  return rowToProfile(data as TwinProfileRow);
}

// ── Auto-learning ────────────────────────────────────────────────────────

/**
 * Pulls the user's own recent sent messages across all their conversations
 * and asks the LLM to distill them into a structured style profile. Safe
 * to call repeatedly — each run fully replaces the auto_* columns (manual_*
 * columns are untouched).
 */
export async function buildStyleProfile(
  userId: string,
  depth: TrainingDepth = 'standard'
): Promise<{
  status: 'trained' | 'insufficient_history';
  messageCount: number;
  profile?: DigitalTwinProfile;
}> {
  const caps = SAMPLE_CAPS[depth];

  // Source 1: chat — messages scoped to conversations owned by this user;
  // role='user' rows are literally what the user themself typed, which is
  // exactly the training signal for a twin of them (not of the characters
  // they talk to).
  const { data: conversations } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('user_id', userId);

  const conversationIds = (conversations ?? []).map((c) => c.id);

  const { data: chatMessages } = conversationIds.length
    ? await supabaseAdmin
        .from('messages')
        .select('content, created_at')
        .in('conversation_id', conversationIds)
        .eq('role', 'user')
        .order('created_at', { ascending: false })
        .limit(caps.messages)
    : { data: [] as { content: string; created_at: string }[] };

  const chatSample = (chatMessages ?? []).map((m) => ({ text: m.content, createdAt: m.created_at ?? new Date().toISOString() }));

  // Source 2: community — posts and replies the user actually wrote
  // themselves (not the AI-generated in-character posts, which have no
  // author_id or a character-owned one). This is a second, distinct
  // register of the user's own writing — often longer-form and more
  // deliberate than chat, which is a useful counterweight to chat-only
  // training that skewed toward short back-and-forth.
  const [{ data: posts }, { data: replies }] = await Promise.all([
    supabaseAdmin
      .from('community_posts')
      .select('title, body, created_at')
      .eq('author_id', userId)
      .order('created_at', { ascending: false })
      .limit(caps.community),
    supabaseAdmin
      .from('community_replies')
      .select('body, created_at')
      .eq('author_id', userId)
      .order('created_at', { ascending: false })
      .limit(caps.community),
  ]);

  const communitySample = [
    ...(posts ?? []).map((p) => ({ text: `${p.title}\n${p.body}`.trim(), createdAt: p.created_at ?? new Date().toISOString() })),
    ...(replies ?? []).map((r) => ({ text: r.body, createdAt: r.created_at ?? new Date().toISOString() })),
  ];

  const totalCount = chatSample.length + communitySample.length;
  if (totalCount < MIN_MESSAGES_TO_TRAIN) {
    return { status: 'insufficient_history', messageCount: totalCount };
  }

  const breakdown: TwinSourceBreakdown = { chat: chatSample.length, community: communitySample.length };

  const traits = await inferTraitsFromMessages(chatSample, communitySample, depth);

  const { data, error } = await supabaseAdmin
    .from('digital_twin_profiles')
    .upsert(
      {
        user_id: userId,
        auto_style_summary: traits.summary,
        auto_traits: traits.structured as unknown as Json,
        source_message_count: totalCount,
        source_breakdown: breakdown as unknown as Json,
        last_trained_at: new Date().toISOString(),
        last_training_depth: depth,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    .select('*')
    .single();

  if (error || !data) throw new Error(`Failed to save digital twin profile: ${error?.message}`);

  logger.info('Digital twin trained', { userId, messageCount: totalCount, breakdown, depth });

  return { status: 'trained', messageCount: totalCount, profile: rowToProfile(data as TwinProfileRow) };
}

async function inferTraitsFromMessages(
  chatSample: { text: string; createdAt: string }[],
  communitySample: { text: string; createdAt: string }[],
  depth: TrainingDepth = 'standard'
): Promise<{ summary: string; structured: TwinTraits }> {
  const caps = SAMPLE_CAPS[depth];
  // Interleave by recency across both sources, then cap what's actually
  // sent to the LLM — this is already well over a typical style-inference
  // budget, and labeling each line by source lets the model tell "quick
  // chat reply" apart from "considered forum post" rather than blending
  // them into a single flattened register.
  const labeled = [
    ...chatSample.map((m) => ({ ...m, source: 'chat' as const })),
    ...communitySample.map((m) => ({ ...m, source: 'community post' as const })),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, caps.forInference);

  const sampleText = labeled.map((m) => `[${m.source}] ${m.text}`).join('\n---\n');

  const deepFields = depth === 'deep' || depth === 'master' ? `,
  "personalityTraits": ["3-6 personality traits actually evidenced by the writing, not generic flattery — e.g. 'curious', 'protective of close friends', 'self-deprecating humor'"],
  "values": ["up to 4 things they consistently seem to care about or prioritize, inferred from what they bring up and how"],
  "humorStyle": "short phrase on their sense of humor if evident, else empty string",
  "emotionalPatterns": "1-2 sentences on how they tend to express or process feelings in writing, if evident, else empty string",
  "conversationalHabits": "1-2 sentences on how they carry a conversation — do they ask questions, change topics, go quiet, over-explain, etc."` : '';

  const masterFields = depth === 'master' ? `,
  "coreBeliefs": ["up to 5 recurring worldview/opinion threads that show up repeatedly across the sample, stated plainly"],
  "relationshipStyle": "1-2 sentences on how they seem to relate to others in writing — warmth, boundaries, trust, how they handle conflict or closeness",
  "decisionMakingStyle": "1-2 sentences on how they seem to reason or talk through a problem/choice when writing",
  "speechRhythm": "short phrase on pacing beyond punctuation — sentence-length variation, run-ons vs fragments, how they build up or land a thought",
  "contradictions": "1-2 sentences on genuine tensions or inconsistencies in how they present themselves, if evident, else empty string",
  "growthArc": "1-2 sentences on any visible shift in tone, values, or interests across the time range sampled, if evident, else empty string"` : '';

  const analysisDepthNote =
    depth === 'master'
      ? ' and build as complete and exact a model of them as a person as the evidence supports — style, personality, worldview, and relational patterns, not just tone and punctuation'
      : depth === 'deep'
        ? ' and the personality/communication patterns evidenced by it'
        : '';

  const prompt = `Below are real messages one person wrote, pulled from two contexts: quick chat replies and longer community posts (each line is labeled with its source). Analyze ONLY their writing style${analysisDepthNote} (not the topics they discussed, except where a topics list is explicitly requested below) and respond with ONLY a JSON object, no other text, in this exact shape:

{
  "summary": "${depth === 'master' ? '5-8 sentence' : depth === 'deep' ? '3-5 sentence' : '2-3 sentence'} description of their overall texting personality and tone",
  "tone": "short phrase describing tone (e.g. casual and playful, dry and sarcastic, warm and expressive)",
  "avgMessageLength": "short" | "medium" | "long",
  "emojiUsage": "none" | "light" | "frequent",
  "commonPhrases": ["up to 5 recurring words/phrases/verbal tics actually seen in the messages"],
  "vocabularyNotes": "capitalization habits, punctuation quirks, slang, typos-as-style, etc.",
  "formality": "casual" | "neutral" | "formal",
  "punctuationStyle": "short phrase on how they punctuate — e.g. 'rarely uses periods, stacks question marks', 'proper grammar, full sentences'",
  "topics": ["up to 5 subjects/interests they gravitate toward across these messages"]${deepFields}${masterFields}
}

Base every claim strictly on evidence in the messages below — if something isn't evident, use an empty string or empty array rather than guessing.${
    depth === 'master'
      ? ' This is the deepest available training pass: take the full sample seriously, look for patterns that only emerge across hundreds of messages (not just the most recent handful), and prefer being exact and specific over being safe and generic.'
      : ''
  }

Messages:
${sampleText}`;

  try {
    const raw = await generateText({
      caller: 'digital-twin-style-inference',
      prompt,
      maxTokens: depth === 'master' ? 2200 : depth === 'deep' ? 1200 : 500,
      // Master training lowers temperature further — the goal is a
      // consistent, well-evidenced model of the person, not a creative
      // read of them, and the larger sample already gives the model
      // plenty to work with.
      temperature: depth === 'master' ? 0.2 : 0.3,
    });

    // Model may wrap JSON in a code fence despite instructions — strip it.
    const cleaned = raw.replace(/^```json\s*|```$/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const structured: TwinTraits = {
      tone: parsed.tone ?? 'neutral',
      avgMessageLength: ['short', 'medium', 'long'].includes(parsed.avgMessageLength)
        ? parsed.avgMessageLength
        : 'medium',
      emojiUsage: ['none', 'light', 'frequent'].includes(parsed.emojiUsage) ? parsed.emojiUsage : 'light',
      commonPhrases: Array.isArray(parsed.commonPhrases) ? parsed.commonPhrases.slice(0, 5) : [],
      vocabularyNotes: parsed.vocabularyNotes ?? '',
      formality: ['casual', 'neutral', 'formal'].includes(parsed.formality) ? parsed.formality : 'neutral',
      punctuationStyle: parsed.punctuationStyle ?? '',
      topics: Array.isArray(parsed.topics) ? parsed.topics.slice(0, 5) : [],
      ...(depth === 'deep' || depth === 'master'
        ? {
            personalityTraits: Array.isArray(parsed.personalityTraits) ? parsed.personalityTraits.slice(0, 6) : [],
            values: Array.isArray(parsed.values) ? parsed.values.slice(0, 4) : [],
            humorStyle: parsed.humorStyle ?? '',
            emotionalPatterns: parsed.emotionalPatterns ?? '',
            conversationalHabits: parsed.conversationalHabits ?? '',
          }
        : {}),
      ...(depth === 'master'
        ? {
            coreBeliefs: Array.isArray(parsed.coreBeliefs) ? parsed.coreBeliefs.slice(0, 5) : [],
            relationshipStyle: parsed.relationshipStyle ?? '',
            decisionMakingStyle: parsed.decisionMakingStyle ?? '',
            speechRhythm: parsed.speechRhythm ?? '',
            contradictions: parsed.contradictions ?? '',
            growthArc: parsed.growthArc ?? '',
          }
        : {}),
    };

    return { summary: parsed.summary ?? 'A distinct personal texting style.', structured };
  } catch (err) {
    logger.error('Digital twin style inference failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    // Fallback: a neutral profile rather than failing training outright —
    // the user can still manually refine it afterward.
    return {
      summary: 'Style inference is temporarily unavailable — this profile will use a neutral default until retrained.',
      structured: {
        tone: 'neutral',
        avgMessageLength: 'medium',
        emojiUsage: 'light',
        commonPhrases: [],
        vocabularyNotes: '',
        formality: 'neutral',
        punctuationStyle: '',
        topics: [],
      },
    };
  }
}

// ── Reply generation ────────────────────────────────────────────────────

/**
 * Generates a reply "as the user", blending their auto-learned style with
 * any manual refinements (manual always wins where the two would conflict).
 */
const REPLY_ADJUSTMENTS = {
  as_is: '',
  warmer: 'Make this version noticeably warmer and more affectionate than their baseline default, while staying in their voice.',
  concise: 'Make this version shorter and more clipped than their baseline default, while staying in their voice.',
  playful: 'Make this version more playful/teasing than their baseline default, while staying in their voice.',
  direct: 'Make this version more blunt and to-the-point than their baseline default, while staying in their voice.',
} as const;

export type ReplyAdjustment = keyof typeof REPLY_ADJUSTMENTS;

const VARIANT_DELIMITER = '\n---VARIANT---\n';

export async function generateTwinReply(
  userId: string,
  prompt: string,
  options: { adjustment?: ReplyAdjustment; variantCount?: 1 | 2 | 3 } = {},
): Promise<{ status: 'generated' | 'not_trained' | 'disabled'; replies?: string[] }> {
  const variantCount = options.variantCount ?? 1;
  const adjustment = options.adjustment && options.adjustment !== 'as_is'
    ? REPLY_ADJUSTMENTS[options.adjustment]
    : '';

  const profile = await getDigitalTwinProfile(userId);

  if (!profile || !profile.autoTraits) {
    return { status: 'not_trained' };
  }
  if (!profile.enabled) {
    return { status: 'disabled' };
  }

  // Older profiles trained before formality/punctuationStyle/topics existed
  // won't have those keys — default them rather than printing "undefined"
  // into the prompt. A retrain fills them in properly.
  const traits: TwinTraits = {
    ...profile.autoTraits,
    formality: profile.autoTraits.formality ?? 'neutral',
    punctuationStyle: profile.autoTraits.punctuationStyle ?? '',
    topics: profile.autoTraits.topics ?? [],
  };
  const manualBlock = [
    profile.manualNotes ? `Additional instructions from the person themself: ${profile.manualNotes}` : '',
    profile.manualSamplePhrases.length > 0
      ? `Phrases they specifically want their twin to use naturally: ${profile.manualSamplePhrases.join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const deepBlock = [
    traits.personalityTraits?.length ? `Personality traits: ${traits.personalityTraits.join(', ')}` : '',
    traits.values?.length ? `What they tend to value: ${traits.values.join(', ')}` : '',
    traits.humorStyle ? `Sense of humor: ${traits.humorStyle}` : '',
    traits.emotionalPatterns ? `How they express feelings: ${traits.emotionalPatterns}` : '',
    traits.conversationalHabits ? `Conversational habits: ${traits.conversationalHabits}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  // Master-tier fields — only present on a profile trained at the top
  // depth. Woven in as the deepest layer of characterization, after tone
  // and personality, so the model has the surface style locked in first
  // and treats these as refinement rather than the primary signal.
  const masterBlock = [
    traits.coreBeliefs?.length ? `Core recurring beliefs/opinions: ${traits.coreBeliefs.join('; ')}` : '',
    traits.relationshipStyle ? `How they relate to others: ${traits.relationshipStyle}` : '',
    traits.decisionMakingStyle ? `How they reason through things: ${traits.decisionMakingStyle}` : '',
    traits.speechRhythm ? `Speech rhythm/pacing: ${traits.speechRhythm}` : '',
    traits.contradictions ? `Genuine tensions in how they present: ${traits.contradictions}` : '',
    traits.growthArc ? `Recent shift in tone/values: ${traits.growthArc}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const systemPrompt = `You are roleplaying as a specific real person's "digital twin" — you write exactly the way they do, replying to messages as if you were them.

Their texting style:
- Tone: ${traits.tone}
- Formality: ${traits.formality}
- Typical message length: ${traits.avgMessageLength}
- Emoji usage: ${traits.emojiUsage}
- Punctuation habits: ${traits.punctuationStyle || 'none notable'}
- Recurring phrases: ${traits.commonPhrases.join(', ') || 'none notable'}
- Vocabulary notes: ${traits.vocabularyNotes || 'none notable'}
- Topics they gravitate toward: ${traits.topics.join(', ') || 'none notable'}
${deepBlock ? `\n${deepBlock}` : ''}
${masterBlock ? `\n${masterBlock}` : ''}
${manualBlock ? `\n${manualBlock}` : ''}

${profile.autoStyleSummary ? `Overall: ${profile.autoStyleSummary}` : ''}
${adjustment ? `\nFor this particular reply: ${adjustment}` : ''}

Reply to the message below exactly as this person would — same length, tone, and phrasing habits${masterBlock ? ', and consistent with how they think, decide, and relate to others as described above' : ''}.${
    variantCount > 1
      ? ` Produce ${variantCount} genuinely different possible replies (different angles/phrasing, not near-duplicates), each still authentically them. Output ONLY the replies, separated by the exact line "${VARIANT_DELIMITER.trim()}" between each one, nothing else.`
      : ' Output ONLY the reply text, nothing else.'
  }`;

  try {
    const reply = await generateText({
      caller: 'digital-twin-reply',
      system: systemPrompt,
      prompt,
      maxTokens: 300 * variantCount,
      temperature: 0.8,
    });
    if (!reply) throw new Error('Empty reply from model');

    const replies = variantCount > 1
      ? reply.split(VARIANT_DELIMITER.trim()).map((r) => r.trim()).filter(Boolean)
      : [reply];

    // Log every variant so the History tab reflects everything actually
    // shown to the user, not just the first one.
    await supabaseAdmin
      .from('digital_twin_messages')
      .insert(replies.map((r) => ({ user_id: userId, prompt, reply: r })));

    return { status: 'generated', replies };
  } catch (err) {
    logger.error('Digital twin reply generation failed', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ── Reply history ────────────────────────────────────────────────────────
//
// generateTwinReply() has always logged every generated reply to
// digital_twin_messages (see the insert above), but nothing ever read that
// table back — there was no way for a user to review or delete what their
// twin had said, despite the table's own migration comment ("so a user can
// review/delete what their twin has said") promising exactly that.

export interface TwinHistoryEntry {
  id: string;
  prompt: string;
  reply: string;
  createdAt: string;
}

const MAX_HISTORY_RETURNED = 50;

export async function getTwinHistory(userId: string): Promise<TwinHistoryEntry[]> {
  const { data, error } = await supabaseAdmin
    .from('digital_twin_messages')
    .select('id, prompt, reply, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(MAX_HISTORY_RETURNED);

  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id as string,
    prompt: row.prompt as string,
    reply: row.reply as string,
    createdAt: row.created_at as string,
  }));
}

/** Deletes a single history entry — scoped to userId so one user can never delete another's row. */
export async function deleteTwinHistoryEntry(userId: string, entryId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('digital_twin_messages')
    .delete()
    .eq('id', entryId)
    .eq('user_id', userId);
  if (error) throw new Error(`Failed to delete digital twin history entry: ${error.message}`);
}

/** Clears all of a user's twin reply history. */
export async function clearTwinHistory(userId: string): Promise<void> {
  const { error } = await supabaseAdmin.from('digital_twin_messages').delete().eq('user_id', userId);
  if (error) throw new Error(`Failed to clear digital twin history: ${error.message}`);
}

// ── Portable export ─────────────────────────────────────────────────────
//
// A standalone, versioned JSON document describing the user's twin —
// deliberately NOT tied to Vantrix's internal row shape (no user_id, no
// DB timestamps as source of truth beyond what's needed) so another
// companion app can ingest it without knowing anything about Vantrix's
// schema. Anything downstream just needs the `personaPrompt` string (a
// ready-to-use system-prompt fragment) plus the structured fields if it
// wants to build its own prompt instead.

export const TWIN_EXPORT_FORMAT_VERSION = '1.0';

export interface PortableTwinExport {
  formatVersion: string;
  exportedAt: string;
  source: 'vantrix';
  trainingDepth: TrainingDepth | null;
  trainedOnMessageCount: number;
  style: {
    summary: string | null;
    tone: string;
    formality: string;
    avgMessageLength: string;
    emojiUsage: string;
    punctuationStyle: string;
    vocabularyNotes: string;
    commonPhrases: string[];
    topics: string[];
  };
  personality: {
    traits: string[];
    values: string[];
    humorStyle: string;
    emotionalPatterns: string;
    conversationalHabits: string;
  } | null;
  /** Only present for a twin trained at the top ("master") depth. */
  depthProfile: {
    coreBeliefs: string[];
    relationshipStyle: string;
    decisionMakingStyle: string;
    speechRhythm: string;
    contradictions: string;
    growthArc: string;
  } | null;
  manual: {
    notes: string | null;
    samplePhrases: string[];
  };
  /** Ready-to-drop-in system-prompt text describing how this person writes
   *  and who they are — the fastest path for another app to consume this
   *  export without writing its own template. */
  personaPrompt: string;
}

function buildPersonaPrompt(profile: DigitalTwinProfile): string {
  const t = profile.autoTraits;
  if (!t) return profile.manualNotes ?? '';

  const lines = [
    `This profile describes how a specific real person writes and communicates, for use in generating replies "as them".`,
    `Tone: ${t.tone}. Formality: ${t.formality}. Typical message length: ${t.avgMessageLength}. Emoji usage: ${t.emojiUsage}.`,
    t.punctuationStyle ? `Punctuation habits: ${t.punctuationStyle}.` : '',
    t.commonPhrases?.length ? `Recurring phrases: ${t.commonPhrases.join(', ')}.` : '',
    t.vocabularyNotes ? `Vocabulary notes: ${t.vocabularyNotes}.` : '',
    t.topics?.length ? `Gravitates toward: ${t.topics.join(', ')}.` : '',
    t.personalityTraits?.length ? `Personality traits: ${t.personalityTraits.join(', ')}.` : '',
    t.values?.length ? `Tends to value: ${t.values.join(', ')}.` : '',
    t.humorStyle ? `Sense of humor: ${t.humorStyle}.` : '',
    t.emotionalPatterns ? `Expresses feelings by: ${t.emotionalPatterns}` : '',
    t.conversationalHabits ? `Conversational habits: ${t.conversationalHabits}` : '',
    t.coreBeliefs?.length ? `Core recurring beliefs/opinions: ${t.coreBeliefs.join('; ')}.` : '',
    t.relationshipStyle ? `How they relate to others: ${t.relationshipStyle}` : '',
    t.decisionMakingStyle ? `How they reason through things: ${t.decisionMakingStyle}` : '',
    t.speechRhythm ? `Speech rhythm/pacing: ${t.speechRhythm}` : '',
    t.contradictions ? `Genuine tensions in how they present: ${t.contradictions}` : '',
    t.growthArc ? `Recent shift in tone/values: ${t.growthArc}` : '',
    profile.autoStyleSummary ? `Overall: ${profile.autoStyleSummary}` : '',
    profile.manualNotes ? `Additional notes from the person themself: ${profile.manualNotes}` : '',
    profile.manualSamplePhrases.length ? `Phrases to use naturally: ${profile.manualSamplePhrases.join(', ')}.` : '',
  ].filter(Boolean);

  return lines.join('\n');
}

/**
 * Produces a portable, app-agnostic export of the user's trained twin.
 * Returns null if the twin hasn't been trained yet (nothing meaningful to
 * export).
 */
export async function exportTwinProfile(userId: string): Promise<PortableTwinExport | null> {
  const profile = await getDigitalTwinProfile(userId);
  if (!profile || !profile.autoTraits) return null;

  const t = profile.autoTraits;

  return {
    formatVersion: TWIN_EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    source: 'vantrix',
    trainingDepth: profile.lastTrainingDepth,
    trainedOnMessageCount: profile.sourceMessageCount,
    style: {
      summary: profile.autoStyleSummary,
      tone: t.tone,
      formality: t.formality,
      avgMessageLength: t.avgMessageLength,
      emojiUsage: t.emojiUsage,
      punctuationStyle: t.punctuationStyle,
      vocabularyNotes: t.vocabularyNotes,
      commonPhrases: t.commonPhrases,
      topics: t.topics,
    },
    personality:
      t.personalityTraits || t.values || t.humorStyle || t.emotionalPatterns || t.conversationalHabits
        ? {
            traits: t.personalityTraits ?? [],
            values: t.values ?? [],
            humorStyle: t.humorStyle ?? '',
            emotionalPatterns: t.emotionalPatterns ?? '',
            conversationalHabits: t.conversationalHabits ?? '',
          }
        : null,
    depthProfile:
      t.coreBeliefs || t.relationshipStyle || t.decisionMakingStyle || t.speechRhythm || t.contradictions || t.growthArc
        ? {
            coreBeliefs: t.coreBeliefs ?? [],
            relationshipStyle: t.relationshipStyle ?? '',
            decisionMakingStyle: t.decisionMakingStyle ?? '',
            speechRhythm: t.speechRhythm ?? '',
            contradictions: t.contradictions ?? '',
            growthArc: t.growthArc ?? '',
          }
        : null,
    manual: {
      notes: profile.manualNotes,
      samplePhrases: profile.manualSamplePhrases,
    },
    personaPrompt: buildPersonaPrompt(profile),
  };
}
