/**
 * AI Orchestrator — Vantrix Production
 *
 * Performance revision (v4):
 *
 *   Eliminated double Redis calls:
 *     prepare() previously re-ran checkSpendingCap() + getGovernedTokenBudget()
 *     even when called after costGuard.check() which had already done both.
 *     prepare() now accepts an optional `precomputed` bag from the cost guard
 *     result. When present, all Redis I/O in prepare() is skipped entirely.
 *     Saves 2 Redis round trips (~4-10ms) on every non-queued chat request.
 *
 *   Retained: provider router, circuit breakers, retry, tracing, billing.
 */

import { createTracer, recordAiCostEvent, type Tracer } from '@/lib/tracing';
import { after } from 'next/server';
import { checkSpendingCap, recordTokensUsed, PLAN_DAILY_LIMITS } from '@/lib/ai/spending-cap';
import { markBillingLanded, enqueueBillingRetry } from '@/lib/ai/billing-dlq';
import { getGovernedTokenBudget, recordPlatformTokens } from '@/lib/ai/adaptive-quota';
import { breakers }          from '@/lib/circuit-breaker';
import { retry }             from '@/lib/network/retry';
import { logger }            from '@/lib/logger';
import { CircuitOpenError }  from '@/lib/errors';
import { metrics }           from '@/lib/observability';
import { routeCompletion }   from '@/lib/ai/provider-router';
import type { Tier }         from '@/lib/rate-limit';
import type { ModelTier }    from '@/lib/ai/model-router';
import { DEFAULT_GENERATION_PARAMS } from '@/lib/ai/model-router';
import { env }                        from '@/env';

const STREAM_TIMEOUT_MS = 25_000;

export interface OrchestratorMessage {
  role:    'system' | 'user' | 'assistant';
  content: string;
}

export interface OrchestratorContext {
  userId:          string;
  tier:            Tier;
  characterId:     string;
  conversationId?: string;
  traceId:         string;
  tracer:          Tracer;
  tokenBudget:     number;
  multiplier:      number;
  throttled:       boolean;
  currentUsage:    number;
  dailyLimit:      number;
  startedAt:       number;
  modelTier?:      ModelTier;
  selectedModel?:  string;
  /**
   * From RoutingResult.escalated (model-router.ts) — true when modelTier
   * was reached via the emotional-escalation budget rather than the
   * plan's normal cap. Threaded through to infer() so it reaches
   * provider-router.ts's ProviderRequest.escalated and gets billed
   * correctly after the call resolves.
   */
  escalated?:      boolean;
}

export interface InferResult {
  reply:            string;
  tokensUsed:       number;
  promptTokens:     number;
  completionTokens: number;
  latencyMs:        number;
  model:            string;
  provider?:        string;
  fallback?:        boolean;
}

/** Precomputed values from costGuard.check() — eliminates duplicate Redis calls. */
export interface PrecomputedContext {
  tokenBudget:  number;
  multiplier:   number;
  throttled:    boolean;
  currentUsage: number;
  dailyLimit:   number;
}

export const orchestrator = {

  async prepare(params: {
    userId:          string;
    tier:            Tier;
    characterId:     string;
    conversationId?: string | undefined;
    traceId:         string;
    modelTier?:      ModelTier | undefined;
    selectedModel?:  string | undefined;
    /** From RoutingResult.escalated — see OrchestratorContext.escalated above. */
    escalated?:      boolean | undefined;
    /** Pass from costGuard result to skip redundant Redis calls */
    precomputed?:    PrecomputedContext | undefined;
  }): Promise<OrchestratorContext> {
    const { userId, tier, characterId, conversationId, traceId, modelTier, selectedModel, escalated, precomputed } = params;

    const tracer = createTracer(traceId, { userId, tier, characterId, conversationId });

    let tokenBudget: number;
    let multiplier:  number;
    let throttled:   boolean;
    let currentUsage: number;
    let dailyLimit:   number;

    if (precomputed) {
      // Fast path: costGuard already did this work — reuse results
      ;({ tokenBudget, multiplier, throttled, currentUsage, dailyLimit } = precomputed);
      tracer.event('auth.ok', { userId, tier, source: 'precomputed' });
    } else {
      // Slow path: compute from scratch (used by queue worker which bypasses costGuard)
      const capSpan = tracer.startSpan('spending-cap.check', { tier });
      const { perRequestLimit, currentUsage: cu } = await checkSpendingCap(userId, tier);
      capSpan.end({ perRequestLimit, currentUsage: cu });
      tracer.event('auth.ok', { userId, tier });

      const rawDailyLimit = PLAN_DAILY_LIMITS[tier];
      dailyLimit  = Number.isFinite(rawDailyLimit) ? rawDailyLimit : Number.MAX_SAFE_INTEGER;
      currentUsage = cu;

      const quotaSpan = tracer.startSpan('adaptive-quota.compute', { tier });
      const governed  = await getGovernedTokenBudget({
        userId, tier, baseLimit: perRequestLimit, currentUsage, dailyLimit,
      });
      quotaSpan.end(governed);

      tokenBudget = governed.tokenBudget;
      multiplier  = governed.multiplier;
      throttled   = governed.throttled;
    }

    if (throttled) {
      tracer.event('quota.throttled', { multiplier, tokenBudget });
      logger.warn('Adaptive quota throttled request', { userId, tier, multiplier, tokenBudget });
    }

    return {
      userId, tier, characterId, conversationId,
      traceId, tracer,
      tokenBudget, multiplier, throttled,
      currentUsage, dailyLimit,
      startedAt: Date.now(),
      modelTier, selectedModel, escalated,
    };
  },

  async infer(
    ctx:      OrchestratorContext,
    messages: OrchestratorMessage[],
  ): Promise<InferResult> {
    const modelTier  = ctx.modelTier ?? 'SMART';
    const aiSpan     = ctx.tracer.startSpan('provider-router.infer', { modelTier, tier: ctx.tier });

    try {
      const response = await retry(async () => {
        // Fresh controller/timeout per attempt — previously created once
        // outside retry() and reused across attempts. Once the first
        // attempt timed out and aborted that controller, every subsequent
        // retry silently received an already-aborted signal and failed
        // instantly, defeating retry-on-timeout entirely.
        const attemptController = new AbortController();
        const attemptTimeout    = setTimeout(() => attemptController.abort(), STREAM_TIMEOUT_MS);
        try {
          return await routeCompletion({
            messages:    messages as { role: 'system' | 'user' | 'assistant'; content: string }[],
            modelTier,
            // Recommended companion/roleplay sampling defaults — see
            // model-router.ts DEFAULT_GENERATION_PARAMS. maxTokens still
            // clamped to the caller's actual token budget when smaller.
            maxTokens:        Math.min(ctx.tokenBudget, DEFAULT_GENERATION_PARAMS.maxTokens) || ctx.tokenBudget,
            temperature:      DEFAULT_GENERATION_PARAMS.temperature,
            topP:             DEFAULT_GENERATION_PARAMS.topP,
            frequencyPenalty: DEFAULT_GENERATION_PARAMS.frequencyPenalty,
            presencePenalty:  DEFAULT_GENERATION_PARAMS.presencePenalty,
            // routeModel() already resolved the literal model (DeepSeek V4
            // Pro/Flash, or Euryale/Venice for datingMode) — pass it straight
            // through instead of letting provider-router re-derive it from
            // modelTier alone, which wouldn't know about the roleplay swap.
            modelOverride: ctx.selectedModel,
            appUrl:      env.NEXT_PUBLIC_APP_URL,
            traceId:     ctx.traceId,
            // FIX: userId was never passed here, which means
            // provider-router.ts's `if (req.modelTier === 'PEAK' && req.userId)`
            // guard was always false and recordPeakUsage() never actually
            // fired — PEAK monthly budget tracking has been silently no-op-ing.
            // Also required for the new recordEscalationUsage path below.
            userId:      ctx.userId,
            escalated:   ctx.escalated,
            // DEAD-TIMEOUT-FIX: this was previously created but never passed
            // anywhere — controller.abort() below aborted a signal nothing
            // was listening to, so STREAM_TIMEOUT_MS enforced nothing and
            // actual latency was bounded only by each provider's own
            // (looser, and multiplied by retry()'s 2 attempts x up to 4
            // providers) per-call timeout. Now genuinely enforced inside
            // callAnthropic/callOpenAICompat via AbortSignal.any().
            signal:      attemptController.signal,
          });
        } finally {
          clearTimeout(attemptTimeout);
        }
      }, 2, 200, 2);

      const { reply, promptTokens, completionTokens, totalTokens, latencyMs, provider, model, fallback } = response;

      aiSpan.end({ promptTokens, completionTokens, totalTokens, latencyMs, model, provider });
      ctx.tracer.event('ai.response', {
        reply_length: reply.length, tokens_used: totalTokens,
        throttled: ctx.throttled, multiplier: ctx.multiplier,
        provider, model, fallback,
      });

      if (fallback) {
        logger.warn('Provider fallback used', { provider, model, tier: ctx.tier, traceId: ctx.traceId });
      }

      return {
        reply: reply || "I'm here — what would you like to talk about?",
        tokensUsed: totalTokens, promptTokens, completionTokens,
        latencyMs, model, provider, fallback,
      };

    } catch (err: unknown) {
      if (err instanceof CircuitOpenError) {
        const breaker = breakers.openrouter();
        const stats   = breaker.getStats();
        aiSpan.error(err, {
          circuit_name: 'openrouter', circuit_state: stats.state,
          circuit_failures: stats.failures, circuit_opened_at: stats.openedAt,
          error_code: 'CIRCUIT_OPEN',
        });
      } else {
        aiSpan.error(err);
      }
      throw err;
    }
  },

  async finish(ctx: OrchestratorContext, result: InferResult): Promise<void> {
    const { userId, tier, traceId, tracer, characterId } = ctx;
    const { tokensUsed, promptTokens, completionTokens, latencyMs, model, provider } = result;

    try {
      await retry(() => recordTokensUsed(userId, tokensUsed), 3, 200, 2);
      // Mark this traceId as billed so DLQ recovery skips re-processing it
      // if the caller throws after this point (prevents double INCRBY).
      await markBillingLanded(traceId);
    } catch (err) {
      logger.error('recordTokensUsed failed after retries — enqueuing DLQ', {
        userId, tokensUsed, traceId, error: err instanceof Error ? err.message : String(err),
      });
      // Enqueue for recovery — DLQ will check isAlreadyBilled before retrying.
      // GAP-FIX: this .catch() used to be bare. If enqueueBillingRetry ITSELF
      // fails (plausible — Redis just failed the retry() above too), the
      // token usage for this message is now recorded nowhere at all: not
      // billed, not queued for retry, not logged. A silently free message
      // with zero trace of why. This is the last safety net in the whole
      // billing path, so its own failure is exactly the one that must not
      // stay silent.
      await enqueueBillingRetry(userId, tokensUsed, traceId).catch(err => {
        logger.error('enqueueBillingRetry ITSELF failed — token usage unrecorded anywhere', {
          userId, tokensUsed, traceId, error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    after(() => {
      Promise.all([
        recordPlatformTokens(tokensUsed),
        recordAiCostEvent({
          traceId, userId, tier, model,
          promptTokens, completionTokens,
          totalTokens: tokensUsed, latencyMs, characterId,
        }),
      ]).catch(err => {
        logger.warn('Orchestrator platform accounting error (non-critical)', {
          userId, error: err instanceof Error ? err.message : String(err),
        });
      });

      tracer.flush().catch(err => logger.warn('tracer.flush failed (non-critical)', { error: String(err) }));
    });

    metrics.recordRequest({
      tier, modelTier: ctx.modelTier ?? 'SMART',
      provider: provider ?? 'openrouter', result: 'success',
      latencyMs, promptTokens, completionTokens,
    });
  },
};
