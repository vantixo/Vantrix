/**
 * Content Engine — AI Generation Layer
 *
 * Powers character-feed.ts (posts) and character-social-engine.ts (comments)
 * with real per-character LLM generation instead of static template pools,
 * using the multi-provider router already in this codebase
 * (lib/ai/provider-router.ts). Routed at 'NANO' tier, whose top provider is
 * Groq — genuinely free-tier inference (llama-3.1-8b-instant) — with
 * automatic fallback through the existing chain (OpenRouter's free/cheap
 * deepseek default, then Together/Anthropic/Grok if configured) if Groq is
 * rate-limited or down. No new provider infrastructure was needed; this
 * module just calls the existing router with short, cheap prompts.
 *
 * Design constraints, deliberately conservative because this runs
 * unattended on a cron with no per-request user to rate-limit against:
 *
 *   - Hard daily call budget (CONTENT_ENGINE_DAILY_AI_CALLS, default 400)
 *     tracked in Redis, shared across posts + comments. Once exhausted,
 *     generateX() returns null for the rest of the day and callers fall
 *     back to the original template pools — the feed never goes empty,
 *     it just reverts to deterministic content until the budget resets.
 *   - Short maxTokens (80 for posts, 40 for comments) — these are social
 *     captions/replies, not chat turns.
 *   - The public feed is visible to unverified/non-age-gated users, so the
 *     system prompt hard-instructs SFW-only output regardless of the
 *     character's own NSFW tier or chat-mode content policy — this is a
 *     public discovery surface, not a gated conversation.
 *   - Every call is wrapped so a provider failure, timeout, or malformed
 *     reply degrades to `null`, never throws — callers must already have a
 *     template fallback path and this must never be able to break the cron.
 */

import { routeCompletion } from '@/lib/ai/provider-router';
import { redis }           from '@/lib/redis';
import { logger }          from '@/lib/logger';
import { env }             from '@/env';

const DAILY_CALL_BUDGET = Number(env.CONTENT_ENGINE_DAILY_AI_CALLS ?? 400);
const BUDGET_KEY_PREFIX  = 'content-engine:ai-budget';

function todayKey(): string {
  const d = new Date();
  return `${BUDGET_KEY_PREFIX}:${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

/** Returns true if there's budget left and reserves one call against it. */
async function reserveBudget(): Promise<boolean> {
  try {
    const key = todayKey();
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, 60 * 60 * 26); // a little over a day, covers clock skew
    }
    return count <= DAILY_CALL_BUDGET;
  } catch (err) {
    // Redis unavailable — fail CLOSED on AI generation (use templates), not
    // open on unlimited free-tier spend.
    logger.warn('[content-generator] budget-check-failed, falling back to templates', { error: String(err) });
    return false;
  }
}

const SFW_GUARDRAIL =
  'This text appears on a public, non-age-gated social feed. Keep it strictly ' +
  'safe-for-work: no sexual content, no explicit language, nothing that ' +
  'requires an adult content warning. Stay fully in character otherwise.';

function stripWrappingQuotes(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + '…';
}

// ── Post captions ────────────────────────────────────────────────────────────

export interface PostCaptionCharacter {
  name:          string;
  occupation:    string | null;
  archetype:     string | null;
  speech_style:  string | null;
  personality:   string | null;
  current_goal:  string | null;
  category:      'day_in_life' | 'mood' | 'teaser' | 'milestone' | 'question_to_fans';
}

export async function generateCharacterPostCaption(
  char: PostCaptionCharacter,
): Promise<string | null> {
  if (!(await reserveBudget())) return null;

  const categoryBrief: Record<PostCaptionCharacter['category'], string> = {
    day_in_life:      'a short, grounded moment from an ordinary day',
    mood:             'a brief, honest reflection on how they feel right now',
    teaser:           'a short, intriguing tease about something they aren\'t ready to explain yet',
    milestone:        'a small, genuine update on progress toward something they care about',
    question_to_fans: 'a short, warm question inviting people to share something about themselves',
  };

  const system = [
    `You are ${char.name}${char.occupation ? `, ${char.occupation}` : ''}.`,
    char.archetype ? `Archetype: ${char.archetype}.` : '',
    char.personality ? `Personality: ${char.personality}` : '',
    char.speech_style ? `Speech style: ${char.speech_style}.` : '',
    char.current_goal ? `Currently working toward: ${char.current_goal}.` : '',
    `Write one short social media post caption — ${categoryBrief[char.category]}.`,
    'One to two sentences. No hashtags, no emojis, no quotation marks, no stage directions or asterisks.',
    'Sound like a real person posting, not a marketing caption.',
    SFW_GUARDRAIL,
  ].filter(Boolean).join(' ');

  try {
    const result = await routeCompletion({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: 'Write today\'s post.' },
      ],
      modelTier:   'NANO',
      maxTokens:   80,
      temperature: 0.95,
    });

    const caption = truncate(stripWrappingQuotes(result.reply), 280);
    return caption.length > 0 ? caption : null;
  } catch (err) {
    logger.warn('[content-generator] post-caption-failed', { character: char.name, error: String(err) });
    return null;
  }
}

// ── Cross-companion comments ─────────────────────────────────────────────────

export interface CommentReactorCharacter {
  name:          string;
  occupation:    string | null;
  archetype:     string | null;
  speech_style:  string | null;
  personality:   string | null;
}

export async function generateCompanionComment(
  reactor: CommentReactorCharacter,
  authorName: string,
  postCaption: string | null,
  framingLabel: string, // e.g. "primary rival", "wing-sibling", "neutral acquaintance"
  relationshipNote: string | null,
): Promise<string | null> {
  if (!(await reserveBudget())) return null;

  const system = [
    `You are ${reactor.name}${reactor.occupation ? `, ${reactor.occupation}` : ''}.`,
    reactor.archetype ? `Archetype: ${reactor.archetype}.` : '',
    reactor.personality ? `Personality: ${reactor.personality}` : '',
    reactor.speech_style ? `Speech style: ${reactor.speech_style}.` : '',
    `You are commenting on a social post by ${authorName}, who is your ${framingLabel}.`,
    relationshipNote ? `Context on that relationship: ${relationshipNote}` : '',
    postCaption ? `Their post said: "${postCaption}"` : '',
    'Write one short, in-character comment reacting to it — one sentence, rarely two.',
    'No hashtags, no emojis, no quotation marks around the whole comment.',
    'Let the relationship dynamic actually color the tone.',
    SFW_GUARDRAIL,
  ].filter(Boolean).join(' ');

  try {
    const result = await routeCompletion({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: 'Write your comment.' },
      ],
      modelTier:   'NANO',
      maxTokens:   40,
      temperature: 0.95,
    });

    const comment = truncate(stripWrappingQuotes(result.reply), 240);
    return comment.length > 0 ? comment : null;
  } catch (err) {
    logger.warn('[content-generator] comment-failed', { reactor: reactor.name, author: authorName, error: String(err) });
    return null;
  }
}
