/**
 * Session Bridge — Emotional Continuity Across Sessions
 *
 * The character doesn't "carry" the emotional arc of the last conversation
 * into this one by default — each session reads a psychology snapshot that
 * was a state at session-end, not a feeling. This module bridges that gap.
 *
 * The bridge is injected at the TOP of the system prompt as lived emotional
 * context, making the character feel like she remembers how things were left.
 *
 * Architecture:
 *   - Stored in Redis with 30-day TTL per userId:characterId pair
 *   - Written at conversation end (updateSessionBridge)
 *   - Read at conversation start (getSessionBridge)
 *   - The bridgePrompt is injected into assembleFullPrompt()
 *
 * Example bridge prompt injected:
 *   "The last time you spoke was 3 days ago. You ended the conversation in a
 *    warm, tender mood after he said something that surprised you. You've been
 *    thinking about it. You asked him about his sister and he changed the
 *    subject — that unresolved question is still in the back of your mind.
 *    Don't force it, but you're aware of it."
 */

import { logger }  from '@/lib/logger';
import { redis }              from '@/lib/redis';

const BRIDGE_TTL = 60 * 60 * 24 * 30; // 30-day TTL

// ── Types ──────────────────────────────────────────────────────────────────────

export type SessionMood =
  | 'tender' | 'playful' | 'vulnerable' | 'warm' | 'distant'
  | 'flirty' | 'melancholic' | 'excited' | 'neutral';

export interface SessionBridge {
  conversationId:      string;
  endedMood:           SessionMood;
  lastUserSentiment:   'positive' | 'neutral' | 'negative';
  unresolvedTension:   boolean;  // conversation ended mid-conflict?
  openQuestion:        string | null;  // she asked something, user didn't answer
  daysElapsed:         number;
  bridgePrompt:        string;  // injected at top of system prompt next session
  createdAt:           number;
}

// ── Redis key ─────────────────────────────────────────────────────────────────

function bridgeKey(userId: string, characterId: string): string {
  return `vantrix:session-bridge:${userId}:${characterId}`;
}

// ── Mood detection heuristics ─────────────────────────────────────────────────

const TENDER_SIGNALS  = /love|miss you|beautiful|sweet|can't stop|always|precious/i;
const PLAYFUL_SIGNALS = /haha|lol|joke|tease|silly|fun|game|laugh/i;
const VULN_SIGNALS    = /scared|afraid|alone|nervous|sad|cry|hard|hurt/i;
const DISTANT_SIGNALS = /bye|later|tired|busy|gtg|leave|stop/i;
const FLIRTY_SIGNALS  = /gorgeous|hot|kiss|flirt|wink|blush|cute|attractive/i;
const NEGATIVE_SIGNALS = /angry|mad|upset|disappointed|wrong|stop it|don't/i;
const POSITIVE_SIGNALS = /thank|amazing|perfect|love you|great|happy|wonderful/i;

export function detectMoodFromMessages(messages: { role: string; content: string }[]): SessionMood {
  if (!messages.length) return 'neutral';
  const lastFew = messages.slice(-6).map(m => m.content).join(' ');

  if (TENDER_SIGNALS.test(lastFew))  return 'tender';
  if (FLIRTY_SIGNALS.test(lastFew))  return 'flirty';
  if (VULN_SIGNALS.test(lastFew))    return 'vulnerable';
  if (PLAYFUL_SIGNALS.test(lastFew)) return 'playful';
  if (DISTANT_SIGNALS.test(lastFew)) return 'distant';
  return 'warm';
}

export function detectSentiment(lastUserMessage: string): 'positive' | 'neutral' | 'negative' {
  if (POSITIVE_SIGNALS.test(lastUserMessage)) return 'positive';
  if (NEGATIVE_SIGNALS.test(lastUserMessage)) return 'negative';
  return 'neutral';
}

export function detectUnresolvedTension(messages: { role: string; content: string }[]): boolean {
  if (messages.length < 4) return false;
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
  if (!lastAssistant) return false;
  // Tension signals — question not answered, conflict phrases
  const tensionRe = /\?|waiting|answer|respond|tell me|what about|you didn't/i;
  return tensionRe.test(lastAssistant.content);
}

export function detectOpenQuestion(messages: { role: string; content: string }[]): string | null {
  // Find the last assistant message that ends with a question
  const assistantMessages = messages.filter(m => m.role === 'assistant');
  const last = assistantMessages[assistantMessages.length - 1];
  if (!last) return null;
  const match = last.content.match(/([^.!]*\?)\s*$/);
  if (!match) return null;
  const q = match[1].trim();
  // Only store if the user's last message didn't seem to answer it
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser) return q;
  // If the user's response is substantial (>10 chars), assume they answered
  if (lastUser.content.length > 10 && messages.indexOf(last) < messages.indexOf(lastUser)) return null;
  return q.length > 8 && q.length < 120 ? q : null;
}

// ── Bridge prompt builder ─────────────────────────────────────────────────────

function buildBridgePrompt(bridge: Omit<SessionBridge, 'bridgePrompt' | 'createdAt'>): string {
  const { daysElapsed, endedMood, lastUserSentiment, unresolvedTension, openQuestion } = bridge;

  const lines: string[] = ['# Emotional Context From Last Conversation'];

  // Time elapsed
  if (daysElapsed === 0) {
    lines.push('You spoke earlier today.');
  } else if (daysElapsed === 1) {
    lines.push('The last time you spoke was yesterday.');
  } else {
    lines.push(`The last time you spoke was ${daysElapsed} days ago.`);
  }

  // Mood bridge
  const moodDescriptions: Record<SessionMood, string> = {
    tender:      'You ended the conversation in a warm, tender mood — something he said moved you.',
    playful:     'You were in a light, playful mood when you last spoke. You felt easy together.',
    vulnerable:  'The last conversation ended with you feeling open — you shared something real.',
    warm:        'Things felt warm and natural at the end of your last conversation.',
    distant:     'The last conversation ended a bit abruptly — something felt unfinished.',
    flirty:      'There was an electric energy at the end of your last conversation.',
    melancholic: 'You ended the last conversation in a reflective, gentle sadness.',
    excited:     'You were excited when you last spoke — something good was happening.',
    neutral:     'The last conversation ended normally.',
  };
  lines.push(moodDescriptions[endedMood] ?? moodDescriptions.neutral);

  // Sentiment bridge
  if (lastUserSentiment === 'positive') {
    lines.push("He said something kind before leaving — it stayed with you.");
  } else if (lastUserSentiment === 'negative') {
    lines.push("The last thing he said left a small shadow. You're not holding a grudge, but you noticed.");
  }

  // Unresolved tension
  if (unresolvedTension) {
    lines.push("Something felt unfinished. Don't bring it up unless the moment is right.");
  }

  // Open question
  if (openQuestion) {
    lines.push(`You had asked: "${openQuestion}" — and it went unanswered. You've been aware of it. Don't force it, but you haven't forgotten.`);
  }

  lines.push('');
  lines.push('Carry this context into the conversation naturally — as a person would, not as a report.');

  return lines.join('\n');
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Read the bridge for a user-character pair (called at conversation start) */
export async function getSessionBridge(
  userId:      string,
  characterId: string,
): Promise<SessionBridge | null> {
  try {
    const raw = await redis.get<SessionBridge>(bridgeKey(userId, characterId));
    if (!raw) return null;

    // Update daysElapsed based on current time
    const daysElapsed = Math.floor((Date.now() - raw.createdAt) / 86_400_000);
    return { ...raw, daysElapsed };
  } catch (err) {
    logger.warn('session-bridge:get-error', { userId, error: String(err) });
    return null;
  }
}

/** Write the bridge at conversation end (call fire-and-forget) */
export async function updateSessionBridge(
  userId:         string,
  characterId:    string,
  conversationId: string,
  messages:       { role: string; content: string }[],
): Promise<void> {
  try {
    if (messages.length < 2) return;

    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';

    const bridgeData = {
      conversationId,
      endedMood:         detectMoodFromMessages(messages),
      lastUserSentiment: detectSentiment(lastUserMessage),
      unresolvedTension: detectUnresolvedTension(messages),
      openQuestion:      detectOpenQuestion(messages),
      daysElapsed:       0,
    };

    const bridgePrompt = buildBridgePrompt(bridgeData);

    const bridge: SessionBridge = {
      ...bridgeData,
      bridgePrompt,
      createdAt: Date.now(),
    };

    await redis.set(bridgeKey(userId, characterId), bridge, { ex: BRIDGE_TTL });
    logger.info('session-bridge:saved', { userId, characterId, mood: bridge.endedMood });
  } catch (err) {
    logger.warn('session-bridge:save-error', { userId, error: String(err) });
  }
}
