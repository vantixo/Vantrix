/**
 * ARCH-04 — Post-Response Work Survives Serverless Teardown
 *
 * Regression test for a reliability gap: chat/route.ts, chat/stream/route.ts,
 * lib/queue/worker.ts, and lib/ai/orchestrator.ts all kicked off ~20
 * fire-and-forget calls (psychology, emotion, memory, fact-graph, quests,
 * XP, beliefs, session bridge, platform cost telemetry, and — in the
 * streaming route — even the per-user billing call) AFTER the response had
 * already been sent (NextResponse.json(), controller.close(), or the
 * worker route's awaited Promise.allSettled()). None of it was awaited, so
 * none of it was guaranteed to finish before Vercel/Next.js could freeze or
 * tear down the function instance — under load, any of it could be silently
 * dropped with no error surfaced anywhere.
 *
 * Fix: wrap that work in Next.js's after() API, which keeps the function
 * instance alive until the callback finishes, without making the user wait
 * for it (the response/stream/job result is unaffected — after() runs once
 * it's already been sent).
 *
 * This can't be meaningfully unit-tested by executing the route (it needs a
 * live request context for after() to attach to, plus a full Supabase/Redis/
 * OpenRouter stack). Statically checking the source is cheap and catches a
 * regression — e.g. someone "simplifying" the code back to bare fire-and-
 * forget calls — before it ships. Same approach as ARCH-02/ARCH-03.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

function src(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf-8');
}

const streamRoute = src('app', 'api', 'chat', 'stream', 'route.ts');
const worker       = src('lib', 'queue', 'worker.ts');
const orchestrator = src('lib', 'ai', 'orchestrator.ts');
const swipeRoute   = src('app', 'api', 'dating', 'swipe', 'route.ts');
const giftsRoute   = src('app', 'api', 'dating', 'gifts', 'route.ts');
const moodRoute    = src('app', 'api', 'dating', 'mood', 'route.ts');

describe('ARCH-04 — post-response enrichment wrapped in after()', () => {
  it('imports after() from next/server in the remaining three files', () => {
    for (const [name, file] of [
      ['chat/stream/route.ts', streamRoute],
      ['queue/worker.ts', worker],
      ['ai/orchestrator.ts', orchestrator],
    ] as const) {
      expect(file, `${name} should import after()`).toMatch(/import\s*\{[^}]*\bafter\b[^}]*\}\s*from\s*['"]next\/server['"]/);
    }
  });

  it('chat/route.ts no longer exists — superseded by chat/stream/route.ts (see SESSION_FIXES 2026-07-18, 1b)', () => {
    expect(existsSync(join(__dirname, '..', 'app', 'api', 'chat', 'route.ts'))).toBe(false);
  });

  it('chat/stream/route.ts wraps post-stream work — including the billing call — in after()', () => {
    // recordTokensUsed is the CRITICAL billing call. It must be inside the
    // after() callback, not a bare await sitting right after controller.close().
    const afterIdx = streamRoute.indexOf('after(async () => {');
    const billingIdx = streamRoute.indexOf('recordTokensUsed(userId, tokensUsed)');
    expect(afterIdx).toBeGreaterThan(-1);
    expect(billingIdx).toBeGreaterThan(afterIdx);
  });

  it('worker.ts wraps post-job enrichment in after()', () => {
    expect(worker).toMatch(/after\(\(\) => \{[\s\S]*updateMemory\(/);
  });

  it('orchestrator.ts wraps platform cost accounting + tracer flush in after()', () => {
    const afterIdx = orchestrator.indexOf('after(() => {');
    const platformIdx = orchestrator.indexOf('recordPlatformTokens(tokensUsed)');
    expect(afterIdx).toBeGreaterThan(-1);
    expect(platformIdx).toBeGreaterThan(afterIdx);
  });

  it('dating/swipe, dating/gifts, dating/mood wrap their emitDatingEvent telemetry in after() ' +
     '(same pattern, found in the production-hardening pass after ARCH-04 first shipped — ' +
     'all three fired an unawaited tracing call immediately before return NextResponse.json())',
  () => {
    for (const [name, file] of [
      ['dating/swipe', swipeRoute],
      ['dating/gifts', giftsRoute],
      ['dating/mood',  moodRoute],
    ] as const) {
      expect(file, `${name} should import after()`).toMatch(/import\s*\{[^}]*\bafter\b[^}]*\}\s*from\s*['"]next\/server['"]/);
      const afterIdx = file.indexOf('after(() => {');
      const eventIdx = file.indexOf('emitDatingEvent(');
      expect(afterIdx, `${name}: after() call`).toBeGreaterThan(-1);
      expect(eventIdx, `${name}: emitDatingEvent inside it`).toBeGreaterThan(afterIdx);
    }
  });
});
