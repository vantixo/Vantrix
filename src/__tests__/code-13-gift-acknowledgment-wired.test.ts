/**
 * CODE-13 — Companion Acknowledges Gifts In Chat
 *
 * Regression test for: sending a gift only ever produced a 'gift'-role
 * system log line ("You sent a Red Rose") in the conversation transcript —
 * the character herself never actually said anything back. The reaction
 * text (reactionIntensity, scaled by gift.rarity) was written into
 * user_facts/memory_graph as background grounding for some FUTURE turn to
 * maybe reference, but nothing produced an immediate in-character reply,
 * which is the actual point of a gift landing "in the moment."
 *
 * Fix (GIFT-ACK-FIX, 2026-08-25): dating/gifts/route.ts now generates a
 * short in-character acknowledgment via the same one-off-narration pattern
 * dating/date/start/route.ts already uses for opening scenes
 * (buildXPrompt + routeCompletion + timeout + non-LLM fallback), and
 * inserts it as a normal 'assistant' row in the same conversation, right
 * after the 'gift' row — all inside the existing fire-and-forget block, so
 * it adds no latency to the gift response itself.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function src(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf-8');
}

describe('CODE-13 — lib/dating/engine.ts exposes a gift-acknowledgment prompt builder', () => {
  const engine = src('lib', 'dating', 'engine.ts');

  it('buildGiftAcknowledgmentPrompt exists and is exported', () => {
    expect(engine).toMatch(/export function buildGiftAcknowledgmentPrompt/);
  });

  it('grounds the reaction in the actual gift, its computed significance, and any note left with it — never fabricates', () => {
    const fn = engine.slice(engine.indexOf('export function buildGiftAcknowledgmentPrompt'));
    expect(fn).toMatch(/ctx\.giftName/);
    expect(fn).toMatch(/ctx\.reactionIntensity/);
    expect(fn).toMatch(/ctx\.giftMessage/);
    // Explicitly instructs against generic/boilerplate reactions and against
    // breaking character (no AI/gift-system/token mentions).
    expect(fn).toMatch(/generic/i);
    expect(fn).toMatch(/being an AI/);
  });
});

describe('CODE-13 — dating/gifts/route.ts actually generates and inserts the acknowledgment', () => {
  const route = src('app', 'api', 'dating', 'gifts', 'route.ts');

  it('imports routeCompletion and the prompt builder', () => {
    expect(route).toMatch(/import\s*\{\s*routeCompletion\s*\}\s*from\s*['"]@\/lib\/ai\/provider-router['"]/);
    expect(route).toMatch(/buildGiftAcknowledgmentPrompt/);
  });

  it('generation is time-bounded with an AbortController, mirroring dating/date/start/route.ts', () => {
    expect(route).toMatch(/GIFT_ACK_TIMEOUT_MS/);
    expect(route).toMatch(/new AbortController\(\)/);
    expect(route).toMatch(/setTimeout\(\(\)\s*=>\s*controller\.abort\(\),\s*GIFT_ACK_TIMEOUT_MS\)/);
  });

  it('falls back to a non-LLM in-character line if generation fails, never a silent no-op', () => {
    const genSection = route.slice(route.indexOf('routeCompletion({'));
    expect(genSection).toMatch(/catch\s*\(err\)\s*\{/);
    expect(genSection).toMatch(/ackReply\s*=\s*rarity\s*===\s*'legendary'/);
  });

  it('inserts the reply as role "assistant" (a real turn), not "gift" (a log line)', () => {
    // There must be a SEPARATE insert from the 'gift' log-line insert —
    // guards against someone collapsing this back into a single system
    // message instead of an actual character reply.
    const inserts = [...route.matchAll(/role:\s*['"](gift|assistant)['"]/g)].map(m => m[1]);
    expect(inserts).toContain('gift');
    expect(inserts).toContain('assistant');
  });

  it('the acknowledgment insert happens inside the existing fire-and-forget block, adding no latency to the gift response', () => {
    // The POST handler's fire-and-forget IIFE is never awaited — assert the
    // acknowledgment insert's line number falls between the IIFE's opening
    // `(async () => {` and its closing `})();`, i.e. it's inside that block
    // rather than a separate, possibly-awaited call in the main handler body.
    const iifeStart = route.indexOf('(async () => {');
    const iifeEnd = route.indexOf('})();', iifeStart);
    const ackInsertIdx = route.indexOf("role:            'assistant'");
    expect(iifeStart).toBeGreaterThan(-1);
    expect(iifeEnd).toBeGreaterThan(iifeStart);
    expect(ackInsertIdx).toBeGreaterThan(iifeStart);
    expect(ackInsertIdx).toBeLessThan(iifeEnd);
  });

  it('reuses the sanitized gift note (safeMessage), never the raw client message, in the prompt', () => {
    const genSection = route.slice(route.indexOf('buildGiftAcknowledgmentPrompt({'));
    expect(genSection).toMatch(/giftMessage:\s*\s*safeMessage/);
  });
});
