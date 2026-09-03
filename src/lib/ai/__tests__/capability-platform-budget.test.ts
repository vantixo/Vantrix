// src/lib/ai/__tests__/capability-platform-budget.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Pass 5 reliability audit gap-fix: capability.ts is the single chokepoint
// every background subsystem (backstory, core-beliefs, self-esteem,
// identity-core, memory, user-fact-graph, purpose-engine, moderation,
// digital-twin, summarizer) routes its LLM calls through — but it discarded
// routeCompletion()'s totalTokens instead of reporting it to
// recordPlatformTokens() (adaptive-quota.ts), the one mechanism that decides
// whether the fleet is over its hourly budget and should throttle. That made
// real, uncapped spend from every one of those subsystems invisible to it.
//
// These tests assert both generateStructured() and generateText() now report
// usage on every successful call — including when generateStructured's JSON
// parse subsequently fails, since the tokens were already spent by then.
// ─────────────────────────────────────────────────────────────────────────────
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routeCompletion = vi.fn();
const recordPlatformTokens = vi.fn().mockResolvedValue(undefined);

vi.mock('../provider-router', () => ({ routeCompletion }));
vi.mock('../adaptive-quota', () => ({ recordPlatformTokens }));

describe('capability.ts → platform budget reporting', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    recordPlatformTokens.mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('generateStructured reports totalTokens on a successful, well-formed call', async () => {
    routeCompletion.mockResolvedValue({ reply: '{"ok":true}', totalTokens: 123 });
    const { generateStructured } = await import('../capability');

    const result = await generateStructured({ caller: 'test', system: 's', user: 'u', maxTokens: 100 });

    expect(result).toEqual({ ok: true });
    await new Promise(process.nextTick);
    expect(recordPlatformTokens).toHaveBeenCalledWith(123);
  });

  it('generateStructured still reports totalTokens when the reply is malformed JSON', async () => {
    // Tokens were spent and billed the moment routeCompletion() resolved —
    // a parse failure afterward must not make that usage disappear.
    routeCompletion.mockResolvedValue({ reply: 'not valid json{{{', totalTokens: 77 });
    const { generateStructured } = await import('../capability');

    const result = await generateStructured({ caller: 'test', system: 's', user: 'u', maxTokens: 100 });

    expect(result).toBeNull(); // existing swallow-and-return-null contract preserved
    await new Promise(process.nextTick);
    expect(recordPlatformTokens).toHaveBeenCalledWith(77);
  });

  it('generateStructured never reports usage when routeCompletion itself throws', async () => {
    routeCompletion.mockRejectedValue(new Error('provider down'));
    const { generateStructured } = await import('../capability');

    const result = await generateStructured({ caller: 'test', system: 's', user: 'u', maxTokens: 100 });

    expect(result).toBeNull();
    expect(recordPlatformTokens).not.toHaveBeenCalled();
  });

  it('generateText reports totalTokens on a successful call', async () => {
    routeCompletion.mockResolvedValue({ reply: 'a prose reply', totalTokens: 456 });
    const { generateText } = await import('../capability');

    const result = await generateText({ caller: 'test', prompt: 'hello', maxTokens: 50 });

    expect(result).toBe('a prose reply');
    await new Promise(process.nextTick);
    expect(recordPlatformTokens).toHaveBeenCalledWith(456);
  });

  it('a failing recordPlatformTokens call never throws out of generateText', async () => {
    routeCompletion.mockResolvedValue({ reply: 'fine', totalTokens: 10 });
    recordPlatformTokens.mockRejectedValue(new Error('redis down'));
    const { generateText } = await import('../capability');

    await expect(
      generateText({ caller: 'test', prompt: 'hello', maxTokens: 50 })
    ).resolves.toBe('fine');
  });
});
