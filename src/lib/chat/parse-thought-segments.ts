/**
 * Thought/speech segment parser — client-safe, no server imports.
 *
 * The AI is instructed (see assembleFullPrompt in lib/ai/prompt.ts) to wrap
 * unspoken internal thoughts in [thought]...[/thought] markers within an
 * otherwise normal reply, e.g.:
 *
 *   "I'm glad you're here. [thought]He seems distracted tonight — I hope
 *   everything's okay.[/thought] What's on your mind?"
 *
 * By product decision, inner thoughts are a peek-behind-the-curtain
 * feature, not always-on narration: the UI (message-bubble.tsx) hides
 * `thought` segments by default behind a tap-to-reveal affordance, so the
 * spoken reply always reads clean and the thought is a discoverable
 * moment rather than something pushed at the user on every message.
 */

export interface ThoughtSegment {
  type: 'speech' | 'thought' | 'action';
  text: string;
}

// [thought]...[/thought]  — unspoken interiority, hidden by default (tap to reveal)
// [action]...[/action]    — physical actions / stage directions, always visible but
//                           rendered distinctly (italic + color) so they read as
//                           narration rather than something the character says aloud.
//                           The model may also use bare *asterisk* narration, which is
//                           normalized to [action] tags below for a single code path.
const MARKER_RE = /\[(thought|action)\]([\s\S]*?)\[\/\1\]/gi;
const BARE_ACTION_RE = /\*([^*\n]+)\*/g;

function normalizeBareActions(text: string): string {
  // Convert *does something* into [action]does something[/action] so both
  // authoring styles funnel through the same parser below.
  return text.replace(BARE_ACTION_RE, (_m, inner) => `[action]${inner.trim()}[/action]`);
}

export function parseThoughtSegments(content: string): ThoughtSegment[] {
  if (!content) return [];

  const normalized = normalizeBareActions(content);
  const segments: ThoughtSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  MARKER_RE.lastIndex = 0;
  while ((match = MARKER_RE.exec(normalized)) !== null) {
    if (match.index > lastIndex) {
      const speech = normalized.slice(lastIndex, match.index).trim();
      if (speech) segments.push({ type: 'speech', text: speech });
    }
    const kind = match[1].toLowerCase() as 'thought' | 'action';
    const inner = match[2].trim();
    if (inner) segments.push({ type: kind, text: inner });
    lastIndex = MARKER_RE.lastIndex;
  }

  if (lastIndex < normalized.length) {
    const trailing = normalized.slice(lastIndex);
    // Streaming case: an opening tag has arrived but its closing tag
    // hasn't streamed in yet. Rather than flash the raw "[thought]..." /
    // "[action]..." text for a moment, hold it back — it'll render
    // correctly once complete.
    const openTagIndex = trailing.search(/\[(thought|action)\]/i);
    if (openTagIndex !== -1) {
      const before = trailing.slice(0, openTagIndex).trim();
      if (before) segments.push({ type: 'speech', text: before });
    } else {
      const t = trailing.trim();
      if (t) segments.push({ type: 'speech', text: t });
    }
  }

  // Malformed/unclosed tag, or content with no markers at all — fall back
  // to treating the whole thing as speech rather than dropping it.
  if (segments.length === 0) {
    return content.trim() ? [{ type: 'speech', text: content.trim() }] : [];
  }

  return segments;
}
