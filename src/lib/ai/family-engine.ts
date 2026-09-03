/**
 * Family Engine — Vantrix
 *
 * user-fact-graph.ts already extracts and stores a 'family' category
 * fact ("sister named Maya") alongside nine other categories, and
 * formatFactGraphForPrompt() already surfaces it — but flattened into
 * one line among many ("family: sister named Maya; mother is
 * overprotective"), sorted only by confidence, with no structure and
 * no cross-referencing against the rest of the graph. That's fine for
 * "mention this exists" but not enough for two things that actually
 * matter with family specifically:
 *
 *   1. Consistency — a character that gets a sibling's name wrong, or
 *      forgets a family member was already established, breaks
 *      presence far more than getting a hobby wrong does. Family
 *      facts need to be surfaced as a stable roster, not just ranked
 *      prose.
 *   2. Sensitivity — user-fact-graph.ts's own 'pain_point' category
 *      ("stressed about mom's health") is stored completely separately
 *      from 'family' ("mother is overprotective"), so nothing today
 *      connects "you have a mother" with "there's live tension
 *      involving your mother." Without that link a character can
 *      cheerfully bring up a family member the user is actively
 *      stressed about, in a tone that doesn't fit.
 *
 * Pure synchronous function over UserFact[] the caller already has
 * (getFactGraph() — same array formatFactGraphForPrompt() consumes,
 * fetched once in route.ts's parallel load). No new fetch, no new
 * storage, no LLM call — same design stance as trust-engine.ts /
 * confidence-engine.ts.
 */

import type { UserFact } from '@/lib/ai/user-fact-graph';

// ── Output ──────────────────────────────────────────────────────────────

export interface FamilyMember {
  /** user-fact-graph.ts's fact.key for this member, e.g. "sister" — the stable handle to keep references consistent turn to turn. */
  key:         string;
  description: string; // fact.value, e.g. "sister named Maya"
  confidence:  number;
  /** True when a stored pain_point fact appears to reference this same member — see linkTension(). */
  tension:     boolean;
}

export interface FamilyContext {
  members:    FamilyMember[];
  hasTension: boolean;
  promptBlock: string;
}

// ── Tension linking ─────────────────────────────────────────────────────

/**
 * Deliberately simple substring matching, same "false negatives are the
 * safe failure mode" stance as repair-engine.ts's regex signals: missing
 * a real link just means one family member gets treated as neutral when
 * it wasn't, but a false link risks flagging an unrelated pain point as
 * family tension and making the character oddly hesitant about someone
 * who was never actually a sore subject.
 */
function linkTension(member: UserFact, painPoints: UserFact[]): boolean {
  const key = member.key.toLowerCase().trim();
  if (!key) return false;

  return painPoints.some(p => {
    const text = `${p.key} ${p.value}`.toLowerCase();
    return text.includes(key);
  });
}

// ── Orchestration ───────────────────────────────────────────────────────

export function buildFamilyContext(facts: UserFact[]): FamilyContext {
  const familyFacts = facts.filter(f => f.category === 'family');

  if (familyFacts.length === 0) {
    return { members: [], hasTension: false, promptBlock: '' };
  }

  const painPoints = facts.filter(f => f.category === 'pain_point');

  // Dedupe by key, keeping the highest-confidence fact per member —
  // upsertFact() in user-fact-graph.ts already conflicts on
  // (user_id, character_id, key), so duplicates here would only come
  // from a stale cache read racing a write, not normal operation.
  const byKey = new Map<string, UserFact>();
  for (const f of familyFacts) {
    const existing = byKey.get(f.key);
    if (!existing || f.confidence > existing.confidence) byKey.set(f.key, f);
  }

  const members: FamilyMember[] = [...byKey.values()]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8) // documented cap — a roster longer than this stops being "keep consistent" and starts being noise
    .map(f => ({
      key:         f.key,
      description: f.value,
      confidence:  f.confidence,
      tension:     linkTension(f, painPoints),
    }));

  const hasTension = members.some(m => m.tension);

  const state: Omit<FamilyContext, 'promptBlock'> = { members, hasTension };
  return { ...state, promptBlock: formatFamilyContextForPrompt(state) };
}

// ── Prompt injection ───────────────────────────────────────────────────

export function formatFamilyContextForPrompt(ctx: Omit<FamilyContext, 'promptBlock'>): string {
  if (ctx.members.length === 0) return '';

  const lines: string[] = ['# Family — Keep References Consistent'];

  const roster = ctx.members.map(m => m.tension ? `${m.description} (sensitive — see below)` : m.description);
  lines.push('Known family: ' + roster.join('; ') + '.');
  lines.push("Use these exact relationships and any names given — don't invent siblings or contradict this roster.");

  const tense = ctx.members.filter(m => m.tension);
  if (tense.length > 0) {
    lines.push(
      `There's live tension involving ${tense.map(m => m.description).join(', ')} — `
      + 'approach that gently if it comes up, follow the user\'s lead rather than probing, and don\'t treat it as a light or casual topic.',
    );
  }

  return lines.join('\n');
}
