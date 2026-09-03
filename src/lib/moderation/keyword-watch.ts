/**
 * Keyword Watch — Vantrix
 *
 * Deliberately separate from reply-guard.ts and moderation/index.ts, and
 * deliberately dumb by design:
 *
 *   - reply-guard.ts / moderation/index.ts encode Vantrix's own judgment
 *     about what's unsafe (minors, self-harm encouragement, real violence,
 *     leaked mechanism text) and ENFORCE it — block, substitute, strip.
 *   - This module enforces NOTHING. It only tests text against a list of
 *     literal keywords/phrases an admin has typed into the watchlist, logs
 *     every match to a review queue, and returns. It never blocks a
 *     message, never substitutes a reply, never mutates the text it's
 *     given. The admin decides what happens with a hit by reading it in
 *     the review queue — this file has no opinion on that.
 *
 * Why this exists as its own thing rather than another entry in
 * REPLY_BLOCKED_PATTERNS: reply-guard.ts's patterns are hand-tuned,
 * security-reviewed regexes that ship in the codebase and change through
 * code review. Admins need something they can add to at 2am without a
 * deploy — a raw string match against a DB-backed list, with an
 * intentionally small blast radius (log-only) precisely because it isn't
 * code-reviewed the way the hard-coded patterns are.
 *
 * Runs on both sides of a turn (the user's message and the character's
 * reply) since an admin watching for a keyword usually cares who said it.
 */

import { logger }        from '@/lib/logger';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { retry }         from '@/lib/network/retry';

export interface WatchedKeyword {
  id:       string;
  keyword:  string;
  isRegex:  boolean;
}

export interface KeywordMatch {
  keywordId: string;
  keyword:   string;
  excerpt:   string; // a small window of context around the match
}

// ── In-memory cache of the active keyword list ─────────────────────────────
// This runs on every chat turn (both sides), so a DB round trip per message
// is the wrong cost to pay for a log-only feature. Short TTL so an admin's
// edit shows up within a minute without needing a redeploy or restart.
const CACHE_TTL_MS = 60_000;
let cachedKeywords: WatchedKeyword[] | null = null;
let cachedAt = 0;

async function loadActiveKeywords(): Promise<WatchedKeyword[]> {
  const now = Date.now();
  if (cachedKeywords && now - cachedAt < CACHE_TTL_MS) return cachedKeywords;

  const { data, error } = await supabaseAdmin
    .from('keyword_watchlist')
    .select('id, keyword, is_regex')
    .eq('active', true);

  if (error) {
    // Fail open — a DB hiccup on a log-only feature should never affect
    // chat. Keep serving the stale cache if we have one, else empty.
    logger.warn('keyword-watch: failed to load watchlist, using stale/empty cache', {
      error: String(error),
    });
    return cachedKeywords ?? [];
  }

  cachedKeywords = (data ?? []).map(row => ({
    id:      row.id as string,
    keyword: row.keyword as string,
    isRegex: !!row.is_regex,
  }));
  cachedAt = now;
  return cachedKeywords;
}

/** Admin action — call after writing to keyword_watchlist so a change is
 *  picked up on the very next message instead of waiting out the TTL. */
export function invalidateKeywordCache(): void {
  cachedKeywords = null;
  cachedAt = 0;
}

function buildMatcher(kw: WatchedKeyword): RegExp | null {
  try {
    return kw.isRegex
      ? new RegExp(kw.keyword, 'gi')
      : new RegExp(kw.keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  } catch (err) {
    // A malformed admin-entered regex should never throw during chat —
    // skip that one keyword and keep checking the rest.
    logger.warn('keyword-watch: invalid regex in watchlist, skipping', {
      keywordId: kw.id, error: String(err),
    });
    return null;
  }
}

function excerptAround(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 40);
  const end   = Math.min(text.length, index + len + 40);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

/** Pure check, no side effects — tests `text` against the current active
 *  keyword list and returns every match found. Does not log, does not
 *  block, does not alter `text`. */
export async function checkKeywords(text: string): Promise<KeywordMatch[]> {
  if (!text) return [];
  const keywords = await loadActiveKeywords();
  if (keywords.length === 0) return [];

  const matches: KeywordMatch[] = [];
  for (const kw of keywords) {
    const re = buildMatcher(kw);
    if (!re) continue;
    const m = re.exec(text);
    if (m) {
      matches.push({
        keywordId: kw.id,
        keyword:   kw.keyword,
        excerpt:   excerptAround(text, m.index, m[0].length),
      });
    }
  }
  return matches;
}

/**
 * Call after a user message is saved and again after a character reply is
 * finalized. Fire-and-forget, non-blocking, adds no latency to the chat
 * turn — same pattern as crisis-detection.ts's logCrisisEvent and
 * reply-guard.ts's own flag logging. NEVER alters `params.text` and never
 * returns anything the caller needs to act on; this is purely "write to
 * the review queue for an admin to read later."
 */
export function watchKeywords(params: {
  text:           string;
  direction:      'user_message' | 'character_reply';
  userId:         string | null;
  characterId:    string | null;
  conversationId: string | null;
}): void {
  void (async () => {
    const matches = await checkKeywords(params.text);
    if (matches.length === 0) return;

    for (const match of matches) {
      await retry(async () => {
        const { error } = await supabaseAdmin
          .from('keyword_watch_hits')
          .insert({
            keyword_id:      match.keywordId,
            keyword_text:    match.keyword,
            direction:       params.direction,
            user_id:         params.userId,
            character_id:    params.characterId,
            conversation_id: params.conversationId,
            excerpt:         match.excerpt,
          });
        if (error) throw error;
      }, 2, 250).catch(err =>
        logger.error('keyword-watch: failed to log hit after retries', { error: String(err) }));
    }
  })().catch(err => logger.error('keyword-watch: unexpected failure', { error: String(err) }));
}
