import { logger } from "@/lib/logger";
import { moderateCharacter } from "@/lib/moderation";
import { generateText } from "@/lib/ai/capability";
import { buildVoiceProfile, type CharacterBibleRow } from "./character-bible";

export interface ChatLineResult {
  success: boolean;
  lines: string[];
  error?: string;
}

/**
 * Generates `count` distinct, on-voice chat line variations for a
 * character — opening lines, greeting variety, or reply-style examples —
 * conditioned on the character's existing personality/speech_style so they
 * read as the same character, not generic text.
 *
 * Every line is passed through the platform's existing moderation gate
 * (same one used for character creation) before being returned. Lines that
 * fail moderation are dropped rather than surfaced — callers should not
 * assume the returned array has exactly `count` items.
 */
export async function generateChatLines(
  character: CharacterBibleRow,
  opts: { kind: "opening_line" | "reply_variety"; count?: number } = { kind: "opening_line" },
): Promise<ChatLineResult> {
  const count = Math.min(Math.max(opts.count ?? 5, 1), 10);
  const voice = buildVoiceProfile(character);

  const instruction =
    opts.kind === "opening_line"
      ? `Write ${count} different opening lines this character could use to start a new conversation with someone matching with them for the first time. Each should feel distinct in mood/approach (e.g. one playful, one curious, one warm) while staying true to the voice below. One per line, no numbering, no quotes.`
      : `Write ${count} example reply lines this character might send mid-conversation, showing their natural texting/speech rhythm. Each on a different everyday topic (how their day went, a small opinion, a light tease). One per line, no numbering, no quotes.`;

  try {
    // Routed through capability.ts's generateText() (Phase 2 AI-wiring
    // cleanup) rather than a private fetch(), for shared circuit-breaker/
    // timeout/health-tracking. Model stays pinned to openai/gpt-4o-mini on
    // the openrouter provider specifically — same reasoning as
    // moderation/index.ts's aiModerationCheck(): every line generated here
    // is re-run through that exact moderation gate below, so keeping
    // generation on the same model/provider pin as review avoids
    // introducing any daylight between what generated the line and what's
    // known to review it correctly.
    const raw = await generateText({
      caller: "content-engine:chat-lines",
      modelOverride: "openai/gpt-4o-mini",
      providerOverride: "openrouter",
      maxTokens: 500,
      temperature: 0.9,
      system:
        "You write in-character dialogue lines for an AI companion platform's character profiles. " +
        "Stay consistent with the character description given. Adult romantic/flirty tone is fine when " +
        "it fits the character; never involve minors, non-consent, or real public figures.",
      prompt: `Character voice profile:\n${voice}\n\n${instruction}`,
    });

    const candidates = raw
      .split("\n")
      .map((l) => l.replace(/^[-*\d.)\s]+/, "").trim())
      .filter((l) => l.length > 0);

    // Moderate every line individually — same gate character creation uses.
    const approved: string[] = [];
    for (const line of candidates.slice(0, count)) {
      const result = await moderateCharacter({ name: character.name, description: line });
      if (result.allowed) {
        approved.push(line);
      } else {
        logger.warn("content-engine: chat line rejected by moderation", {
          characterId: character.id,
          category: result.category,
        });
      }
    }

    return { success: true, lines: approved };
  } catch (err) {
    logger.error("content-engine: generateChatLines failed", { error: String(err), characterId: character.id });
    return { success: false, lines: [], error: err instanceof Error ? err.message : "generation failed" };
  }
}
