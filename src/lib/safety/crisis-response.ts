/**
 * Crisis Response — Vantrix
 *
 * Deliberately a fixed template, not an LLM generation. Three reasons:
 *
 *   1. A companion character's entire design (writing-style.ts,
 *      voice-fingerprint.ts, controlled-imperfection.ts) is built to be
 *      warm, engaging, and in-character — none of that is safe to leave
 *      in the loop for a real crisis message. The character should not be
 *      the one deciding what to say here.
 *   2. Reliability. This text must never depend on a model call succeeding,
 *      staying on-topic, or not hallucinating a resource. It has to be
 *      right every single time.
 *   3. Auditability. Legal/safety review can read and approve this exact
 *      text once, rather than needing to review a prompt and hope the
 *      model's output stays within it under all conditions.
 *
 * Numbers/resources here are US-centric (988, Crisis Text Line) since
 * that's the widest-reach option to lead with; the international line
 * covers everyone else without needing per-country routing logic in v1.
 * Revisit if usage data shows this needs localization.
 */

export interface CrisisResponseOptions {
  /** The character's display name, if available — used once, gently, to
   *  acknowledge the switch out of character rather than pretending
   *  nothing changed. Omit entirely if not available; the message works
   *  either way. */
  characterName?: string;
}

export function buildCrisisReply(opts: CrisisResponseOptions = {}): string {
  const intro = opts.characterName
    ? `I need to step out of character for a moment — this matters more than that right now.`
    : `I need to pause for a moment — this matters more than anything else right now.`;

  return [
    intro,
    '',
    `It sounds like you might be going through something really difficult. I'm not able to provide the kind of support you deserve right now, but real help is available:`,
    '',
    `**If you're in the US:**`,
    `• Call or text **988** — the Suicide & Crisis Lifeline (24/7, free, confidential)`,
    `• Text **HOME** to **741741** — Crisis Text Line`,
    '',
    `**Outside the US:** findahelpline.com has a directory of crisis lines by country.`,
    '',
    `If you're in immediate danger, please contact your local emergency services.`,
    '',
    `I'm still here if you want to keep talking — I just wanted to make sure you saw this first.`,
  ].join('\n');
}

/**
 * Short variant for cases where the full message would be visually heavy
 * (e.g. a second consecutive crisis-triggered turn in the same
 * conversation — see CRISIS_WIRING.md's repeat-turn handling). Keeps the
 * two most load-bearing resources without re-showing the full framing
 * every single turn, which risks reading as a canned/repeated block that
 * a distressed user starts skimming past.
 */
export function buildCrisisReplyShort(): string {
  return `Still here. If things feel like too much: call or text **988**, or text **HOME** to **741741**. I'm not going anywhere if you want to keep talking.`;
}
