/**
 * TTS Text Cleanup
 *
 * Strips markdown formatting, emoji, and other visual-only noise from a
 * message before it's sent to a speech-synthesis provider. Two wins:
 *
 *   1. Pronunciation — ElevenLabs will literally speak "asterisk asterisk"
 *      around **bold** text and stumble over stray emoji/URLs; a raw glyph
 *      also silently eats into the character quota with something the
 *      model can't turn into sound.
 *   2. Cost — ElevenLabs bills by character count. Markdown syntax and
 *      emoji are pure overhead once the visual formatting is gone; on a
 *      typical roleplay reply this consistently trims a meaningful percent
 *      of billed characters with no audible difference in the output.
 *
 * Pure/synchronous — no I/O, safe to call on every request before hitting
 * cache-key derivation and the provider call.
 */

// Emoji + pictographs + dingbats + variation selectors + zero-width joiners.
// Deliberately broad (covers the common ranges) rather than an exhaustive
// Unicode property escape, since TTS engines don't attempt these anyway.
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\uFE0F\u200D]/gu;

export function cleanTextForSpeech(raw: string): string {
  let text = raw;

  // Fenced/inline code — strip the markers, keep (or drop) the content.
  // Code blocks rarely belong in a spoken roleplay reply; inline code is
  // usually a short word, so keep its text but drop the backticks.
  text = text.replace(/```[\s\S]*?```/g, ' ');
  text = text.replace(/`([^`]+)`/g, '$1');

  // Images: ![alt](url) → drop entirely (nothing to speak).
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  // Links: [label](url) → speak the label, drop the URL.
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // Bare URLs — never worth speaking character-by-character.
  text = text.replace(/https?:\/\/\S+/g, ' ');

  // Bold/italic/strikethrough markers — keep the wrapped text, drop the
  // punctuation. Order matters: triple/double before single so `***x***`
  // doesn't leave stray single asterisks behind.
  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/_([^_]+)_/g, '$1');
  text = text.replace(/~~([^~]+)~~/g, '$1');

  // Belt-and-suspenders: use-voice-playback.ts already strips
  // [thought]/[action] segments (and normalizes bare *asterisk* actions
  // into [action]) via parseThoughtSegments before text ever reaches this
  // route, so *asterisks* shouldn't normally survive to here. If they do
  // (a caller that bypasses that hook), unwrapping them below is a safe
  // fallback rather than leaving literal asterisks in the spoken output.
  // Bracketed out-of-character notes like [OOC: ...] are noise either way.
  text = text.replace(/\[OOC:[^\]]*\]/gi, ' ');

  // Markdown headings / blockquote / list markers at line start.
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/^>\s?/gm, '');
  text = text.replace(/^[-*+]\s+/gm, '');
  text = text.replace(/^\d+\.\s+/gm, '');

  // Emoji and pictographs.
  text = text.replace(EMOJI_RE, ' ');

  // Collapse whitespace left behind by all of the above.
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{2,}/g, '\n');
  text = text.replace(/ *\n */g, '\n');
  text = text.trim();

  return text;
}
