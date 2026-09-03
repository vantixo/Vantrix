/**
 * CODE-11 — Mood-Sync Message Count Uses a Column That's Actually Written
 *
 * Regression test for: POST /api/dating/mood counted a match's total
 * messages by looking up `conversations` rows via `.eq('match_id', matchId)`
 * to gate the first_chat (totalMessages>=1) and deep_talk
 * (totalMessages>=30) milestones. `conversations.match_id` is a real,
 * nullable FK column in the schema, but no code path anywhere in the app
 * ever writes it — /api/conversations/ensure, chat/[id]/page.tsx,
 * dating/date/start, and dating/scene all find-or-create the standing
 * conversation by (user_id, character_id) only. So that query always
 * returned zero rows, totalMsgs was always computed as 0, and first_chat /
 * deep_talk could never trigger, silently, for any match, ever.
 *
 * Fix: filter by character_id (already available on the `match` row this
 * route loads) instead of the never-populated match_id column — the same
 * (user_id, character_id) lookup every other dating route already uses to
 * find a character's standing conversation.
 *
 * This can't be meaningfully exercised without a live Supabase instance, so
 * — matching this codebase's own convention for DB-shape regressions (see
 * ARCH-02/03/04) — this statically asserts the route source no longer
 * depends on the dead column, and that no other dating route reintroduces a
 * conversations-table filter on match_id (the column is legitimately used
 * elsewhere, e.g. dating_gifts.match_id / dating_matches.id, so the check is
 * scoped to `conversations` specifically rather than banning the string
 * `match_id` outright).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function src(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf-8');
}

/** Finds `.from('conversations')...` chains and returns each chain's text,
 *  cut off at the next `.from(`/`.rpc(` call (or 400 chars, whichever comes
 *  first) so a filter belonging to the *next* table's query — e.g. the
 *  legitimate `dating_gifts` `.eq('match_id', ...)` that commonly follows a
 *  conversations lookup in a Promise.all — never bleeds into this table's
 *  chain and produces a false positive. */
function conversationsQueryChains(fileText: string): string[] {
  const chains: string[] = [];
  const startRe = /\.from\(\s*['"]conversations['"]\s*\)/g;
  const nextCallRe = /\.(from|rpc)\(/g;
  let m: RegExpExecArray | null;
  while ((m = startRe.exec(fileText))) {
    const chainStart = m.index + m[0].length;
    nextCallRe.lastIndex = chainStart;
    const next = nextCallRe.exec(fileText);
    const chainEnd = Math.min(
      next ? next.index : fileText.length,
      chainStart + 400,
    );
    chains.push(fileText.slice(m.index, chainEnd));
  }
  return chains;
}

describe('CODE-11 — dating/mood message count is keyed off a column that is actually written', () => {
  it('mood/route.ts counts conversations by character_id, not the dead match_id column', () => {
    const route = src('app', 'api', 'dating', 'mood', 'route.ts');
    const chains = conversationsQueryChains(route);
    expect(chains.length).toBeGreaterThan(0);
    for (const chain of chains) {
      expect(chain).toMatch(/\.eq\(\s*['"]character_id['"]\s*,\s*match\.character_id\s*\)/);
      expect(chain).not.toMatch(/\.eq\(\s*['"]match_id['"]/);
    }
  });

  it('every conversation-creation/lookup call site keys off (user_id, character_id), not match_id', () => {
    const files = [
      ['app', 'api', 'conversations', 'ensure', 'route.ts'],
      ['app', 'api', 'dating', 'date', 'start', 'route.ts'],
      ['app', 'api', 'dating', 'scene', 'route.ts'],
      ['app', 'api', 'dating', 'gifts', 'route.ts'],
    ];
    for (const parts of files) {
      const text = src(...parts);
      for (const chain of conversationsQueryChains(text)) {
        // None of these should ever filter/write match_id on conversations —
        // if one starts doing so, mood/route.ts's fix above should switch
        // back to match_id consistently rather than leaving two conventions.
        expect(chain).not.toMatch(/\.eq\(\s*['"]match_id['"]/);
        expect(chain).not.toMatch(/match_id\s*:/);
      }
    }
  });
});
