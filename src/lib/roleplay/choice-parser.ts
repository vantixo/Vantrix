import { randomUUID } from 'crypto';
import type { RoleplayChoice } from '@/types/roleplay';

/**
 * The roleplay system prompt (see prompt.ts) asks the model to end certain
 * beats with a machine-parseable block:
 *
 *   ...narrative prose...
 *   [[CHOICES]]
 *   1. Push forward despite the risk
 *   2. Hold back and watch a moment longer
 *   3. Say what you're actually thinking
 *   [[/CHOICES]]
 *
 * and to mark chapter endings with a bare `[[CHAPTER_END]]` line.
 *
 * Models don't always follow formatting instructions exactly — this parser
 * is deliberately tolerant: malformed or missing blocks degrade to "just
 * show the narrative, no choices," never to a broken/garbled reply. Free-
 * text input always remains a valid way to continue regardless of whether
 * choices were offered.
 */

const CHOICES_BLOCK_RE = /\[\[CHOICES\]\]([\s\S]*?)\[\[\/CHOICES\]\]/i;
const CHAPTER_END_RE   = /\[\[CHAPTER_END\]\]/i;
const NUMBERED_LINE_RE = /^\s*\d+[.)]\s*(.+)$/;

export interface ParsedRoleplayOutput {
  narrative:    string;
  choices:      RoleplayChoice[] | null;
  isChapterEnd: boolean;
}

export function parseRoleplayOutput(raw: string): ParsedRoleplayOutput {
  const isChapterEnd = CHAPTER_END_RE.test(raw);
  let narrative = raw.replace(CHAPTER_END_RE, '').trim();

  let choices: RoleplayChoice[] | null = null;
  const match = narrative.match(CHOICES_BLOCK_RE);

  if (match) {
    narrative = narrative.replace(CHOICES_BLOCK_RE, '').trim();

    const parsed = match[1]
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const numbered = line.match(NUMBERED_LINE_RE);
        return numbered ? numbered[1].trim() : line;
      })
      .filter(label => label.length > 0 && label.length <= 140)
      .slice(0, 4)
      .map(label => ({ id: randomUUID(), label }));

    if (parsed.length >= 2) choices = parsed;
  }

  // Belt-and-suspenders: strip any stray delimiter tokens that survived
  // (e.g. the model emitted "[[CHOICES]]" without a closing tag) so raw
  // formatting scaffolding never leaks into what the user reads.
  narrative = narrative
    .replace(/\[\[\/?CHOICES\]\]/gi, '')
    .replace(/\[\[CHAPTER_END\]\]/gi, '')
    .trim();

  return { narrative, choices, isChapterEnd };
}

/**
 * Deterministic fallback choices for a chapter end where the model didn't
 * produce a usable [[CHOICES]] block. Generic but genre-agnostic enough to
 * never feel broken — always offered alongside (never instead of) free text.
 */
export function fallbackChapterChoices(): RoleplayChoice[] {
  return [
    { id: randomUUID(), label: 'Push the story forward' },
    { id: randomUUID(), label: 'Take a quieter, more cautious path' },
    { id: randomUUID(), label: 'Say what you really feel' },
  ];
}
