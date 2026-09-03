/**
 * AI Capability Interface — Vantrix
 *
 * Phase 2 of the AI-wiring cleanup (see AUDIT_FINDINGS_LOG.md / the
 * second-pass audit): several background subsystems — memory, purpose,
 * self-esteem, identity, core beliefs, backstory, the user fact graph, and
 * the summarizer — each had their own private `fetch('https://openrouter.ai/...')`
 * call instead of going through provider-router.ts's routeCompletion().
 *
 * That meant none of those calls got:
 *   - provider failover (OpenRouter down → nothing, instead of trying Kaetah)
 *   - the shared circuit breaker (a flaky OpenRouter would trip retries
 *     independently in 7 different places instead of opening one breaker)
 *   - centralized timeout policy
 *   - provider health tracking (getProviderHealth() didn't see these calls)
 *   - a single point to swap in Kaetah once it's production-ready
 *
 * generateStructured() is the replacement: every background subsystem that
 * wants "send this system+user prompt, get JSON back" should call this
 * instead of hitting OpenRouter directly. It wraps routeCompletion() and
 * does the fence-stripping / JSON.parse that every call site was
 * duplicating by hand.
 *
 * This intentionally does NOT touch the main chat/orchestrator path — that
 * already goes through routeCompletion() via orchestrator.ts and is out of
 * scope here.
 *
 * PLATFORM-BUDGET GAP FIX (Pass 5 reliability audit): orchestrator.ts and
 * universe/deep-tick.ts both report every call's totalTokens to
 * recordPlatformTokens() (adaptive-quota.ts), which is what
 * getPlatformHourlyUsage() reads to decide whether the fleet is over its
 * hourly budget and should start throttling per-request ceilings. Every
 * caller of THIS module — backstory, core-beliefs, self-esteem, identity-
 * core, memory, user-fact-graph, purpose-engine, moderation, digital-twin,
 * summarizer — was routing through the same shared routeCompletion() and
 * genuinely spending real provider tokens on every call, but this module
 * only ever read `.reply` off the result and silently dropped `.totalTokens`.
 * That's real, uncapped-by-anything-fleet-wide spend (these are exactly the
 * background paths bg-concurrency.ts already flagged as fanning out with no
 * ceiling on total volume, only on concurrency) that the platform-hourly-
 * budget system was never able to see, so it could never trigger on a spike
 * originating from this side of the app no matter how large. Fixed by
 * reporting usage here too — same fire-and-forget, non-critical shape as
 * every other recordPlatformTokens() call site.
 */

import { routeCompletion } from './provider-router';
import type { ProviderName } from './provider-router';
import type { ModelTier } from './model-router';
import { logger } from '@/lib/logger';
import { recordPlatformTokens } from './adaptive-quota';

export interface StructuredCallOptions {
  /** Short label for logging — e.g. 'self-esteem', 'core-beliefs'. */
  caller: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
  /**
   * These background reflection/extraction calls are small, cheap,
   * classification-style completions — NANO is the tier every one of the
   * migrated call sites was already implicitly using via env.OPENROUTER_MODEL
   * (DeepSeek Flash). Override only if a specific subsystem genuinely needs
   * a stronger model.
   */
  modelTier?: ModelTier;
  /**
   * Pin an exact model string (e.g. 'openai/gpt-4o-mini') instead of using
   * the tier's default ladder. Reserved for callers where the exact model
   * is a product/safety decision, not a cost/quality tradeoff — e.g.
   * moderation. Most callers should leave this unset.
   */
  modelOverride?: string;
  /**
   * Pin to a single named provider, skipping failover. Required alongside
   * modelOverride when the override model string is meaningless to other
   * providers (see ProviderRequest.providerOverride in provider-router.ts) —
   * without it, a failed OpenRouter call could silently retry against
   * Kaetah with a model name Kaetah doesn't recognize.
   */
  providerOverride?: ProviderName;
}

/**
 * Send a system+user prompt through the shared provider router and parse
 * the reply as JSON. Returns null (never throws) on any failure — network,
 * provider, or parse — so call sites can keep their existing
 * "fall back to current state" behavior unchanged.
 */
export async function generateStructured<T>(opts: StructuredCallOptions): Promise<T | null> {
  try {
    const result = await routeCompletion({
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
      modelTier: opts.modelTier ?? 'NANO',
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
      modelOverride: opts.modelOverride,
      providerOverride: opts.providerOverride,
    });

    // Report BEFORE the parse attempt — tokens were spent (and billed by the
    // provider) the moment routeCompletion() resolved, regardless of whether
    // the reply turns out to be valid JSON. Recording it after a possible
    // JSON.parse throw would silently drop usage for every malformed reply.
    void recordPlatformTokens(result.totalTokens).catch(() => { /* non-critical */ });

    const raw = result.reply?.trim() ?? '{}';
    const clean = raw.replace(/```json?/gi, '').replace(/```/g, '').trim();
    return JSON.parse(clean) as T;
  } catch (err) {
    logger.warn(`[${opts.caller}] generateStructured failed`, { error: String(err) });
    return null;
  }
}

export interface TextCallOptions {
  caller: string;
  /** Single-message prompt — pass the whole thing as one user message, matching the plain-text callers this replaces (no separate system prompt). */
  prompt: string;
  /** Optional system message, for callers that had a separate system+user split (e.g. digital-twin reply generation). */
  system?: string;
  maxTokens: number;
  temperature?: number;
  modelTier?: ModelTier;
  /** See StructuredCallOptions.modelOverride. */
  modelOverride?: string;
  /** See StructuredCallOptions.providerOverride. */
  providerOverride?: ProviderName;
}

/**
 * Same as generateStructured but for callers that want the raw text reply
 * (e.g. a prose summary) rather than parsed JSON. Throws on failure — the
 * existing plain-text callers (summarizer.ts, purpose-engine.ts,
 * digital-twin/engine.ts) each have their own specific fallback behavior on
 * error, so unlike generateStructured this doesn't swallow the error itself.
 */
export async function generateText(opts: TextCallOptions): Promise<string> {
  const result = await routeCompletion({
    messages: opts.system
      ? [{ role: 'system', content: opts.system }, { role: 'user', content: opts.prompt }]
      : [{ role: 'user', content: opts.prompt }],
    modelTier: opts.modelTier ?? 'NANO',
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    modelOverride: opts.modelOverride,
    providerOverride: opts.providerOverride,
  });
  void recordPlatformTokens(result.totalTokens).catch(() => { /* non-critical */ });
  return result.reply?.trim() ?? '';
}
