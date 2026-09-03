/**
 * Conversation Summarizer
 *
 * When a conversation exceeds the adaptive context window, older messages
 * are compressed into a compact summary. This allows infinite-feeling
 * conversations at a fraction of the token cost.
 *
 * Strategy:
 *   1. Keep the most recent N messages verbatim (the "hot window")
 *   2. Summarise all messages before the hot window into 1 paragraph
 *   3. Inject the summary as a special system message before hot messages
 *   4. Store the summary in Redis so it survives across requests
 *
 * Token savings: a 100-message conversation compresses to ~200 tokens of
 * summary + 20 hot messages, vs. 8,000+ tokens for the full history.
 *
 * Per-plan hot window sizes:
 *   free:    6 messages
 *   premium: 40 messages
 */

import type { Tier } from "@/lib/rate-limit";
import type { OrchestratorMessage } from "./orchestrator";
import { generateText } from "./capability";
import { redis }              from "@/lib/redis";


// ── Config ────────────────────────────────────────────────────────────────────

const HOT_WINDOW: Record<Tier, number> = {
  free:    6,
  premium: 40,
};

/** Only summarise when history exceeds hot_window + this buffer */
const SUMMARISE_THRESHOLD_EXTRA = 4;

const SUMMARY_TTL = 60 * 60 * 24 * 7; // 7 days

function summaryKey(conversationId: string): string {
  return `ai:summary:${conversationId}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface StoredSummary {
  summary:    string;
  upToMsgIdx: number;     // index of last message included in summary
  createdAt:  number;
  tokensSaved: number;
}

// ── Core logic ────────────────────────────────────────────────────────────────

/**
 * Apply adaptive context: summarise old messages if needed, return trimmed history.
 *
 * @returns messages array ready to send to the model, plus metadata.
 */
export async function applyAdaptiveContext(params: {
  conversationId: string;
  tier:           Tier;
  messages:       OrchestratorMessage[];
}): Promise<{
  messages:       OrchestratorMessage[];
  summarized:     boolean;
  tokensSaved:    number;
  summaryUsed:    string | null;
}> {
  const { conversationId, tier, messages } = params;
  const hotWindow = HOT_WINDOW[tier] ?? 10;
  const threshold = hotWindow + SUMMARISE_THRESHOLD_EXTRA;

  // ── Return as-is if within threshold ─────────────────────────────────────
  const convoMessages = messages.filter((m) => m.role !== "system");
  if (convoMessages.length <= threshold) {
    return { messages, summarized: false, tokensSaved: 0, summaryUsed: null };
  }

  // ── Check for existing summary ────────────────────────────────────────────
  let existingSummary: StoredSummary | null = null;
  try {
    existingSummary = await redis.get<StoredSummary>(summaryKey(conversationId));
  } catch { /* non-fatal */ }

  const systemMessages = messages.filter((m) => m.role === "system");
  const hotMessages    = convoMessages.slice(-hotWindow);

  // Determine which messages need to be summarised
  const coldMessages = convoMessages.slice(
    0,
    convoMessages.length - hotWindow
  );

  // ── If we have an existing summary that covers all cold messages, reuse it
  let summaryText: string;
  let tokensSaved = 0;

  if (existingSummary && existingSummary.upToMsgIdx >= coldMessages.length - 1) {
    summaryText = existingSummary.summary;
    tokensSaved = existingSummary.tokensSaved;
  } else {
    // ── Generate new summary via API ─────────────────────────────────────────
    summaryText = await generateSummary(coldMessages, existingSummary?.summary);

    // Estimate tokens saved: average 4 chars/token, cold messages removed
    const charsSaved = coldMessages.reduce((n, m) => n + m.content.length, 0);
    tokensSaved = Math.floor(charsSaved / 4);

    // Persist summary
    const stored: StoredSummary = {
      summary:     summaryText,
      upToMsgIdx:  coldMessages.length - 1,
      createdAt:   Date.now(),
      tokensSaved,
    };
    try {
      await redis.set(summaryKey(conversationId), JSON.stringify(stored), {
        ex: SUMMARY_TTL,
      });
    } catch { /* non-fatal */ }
  }

  // ── Assemble trimmed message list ─────────────────────────────────────────
  const summaryMessage: OrchestratorMessage = {
    role:    "system",
    content: `[Conversation history summary — ${coldMessages.length} earlier messages compressed]\n\n${summaryText}`,
  };

  const trimmedMessages: OrchestratorMessage[] = [
    ...systemMessages,
    summaryMessage,
    ...hotMessages,
  ];

  return {
    messages:    trimmedMessages,
    summarized:  true,
    tokensSaved,
    summaryUsed: summaryText,
  };
}

/**
 * Call OpenRouter to generate a summary of cold messages.
 * Uses the cheapest available model — summaries don't need creativity.
 */
async function generateSummary(
  coldMessages:    OrchestratorMessage[],
  previousSummary: string | undefined,
): Promise<string> {
  const historyText = coldMessages
    .map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.content}`)
    .join("\n");

  const prompt = previousSummary
    ? `Update this existing conversation summary with the new messages below. Keep it under 200 words, focusing on key emotional moments, established facts, running jokes, and relationship milestones.\n\nExisting summary:\n${previousSummary}\n\nNew messages to incorporate:\n${historyText}`
    : `Summarise this conversation in under 150 words. Focus on: key emotional moments, facts the AI learned about the user, relationship dynamics, running jokes or references, and any commitments made.\n\nConversation:\n${historyText}`;

  try {
    const reply = await generateText({
      caller: "summarizer",
      prompt,
      maxTokens: 300,
    });
    return reply || "(summary unavailable)";
  } catch {
    // Fallback: crude extractive summary
    const keyMsgs = coldMessages.slice(-3).map((m) =>
      `${m.role === "user" ? "User" : "AI"}: ${m.content.slice(0, 100)}`
    );
    return `Earlier conversation context: ${keyMsgs.join(" | ")}`;
  }
}

/**
 * Invalidate a conversation's summary (call after memory wipe or profile reset).
 */
export async function invalidateConversationSummary(conversationId: string): Promise<void> {
  try {
    await redis.del(summaryKey(conversationId));
  } catch { /* non-fatal */ }
}

/**
 * Get summary metadata for the admin panel / debug endpoint.
 */
export async function getSummaryMetadata(conversationId: string): Promise<StoredSummary | null> {
  try {
    return await redis.get<StoredSummary>(summaryKey(conversationId));
  } catch {
    return null;
  }
}
