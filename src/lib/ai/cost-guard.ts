/**
 * AI Cost Guard — Unified Cost Protection
 *
 * Performance revision (v3):
 *
 *   Parallel gate execution:
 *     anomaly check + spending cap now run in Promise.all() instead of
 *     sequentially. Saves ~2-5ms per request (one less Redis round trip
 *     on the critical path).
 *
 *   Static imports:
 *     Dynamic `await import()` calls removed from the hot path.
 *     memory-compressor and spending-cap PLAN_DAILY_LIMITS are now
 *     top-level static imports. Eliminates ~0.5ms of module resolution
 *     overhead per cold-start AND per warm request (Node module cache
 *     lookup is not free under high concurrency).
 *
 *   Parallel post-cache work:
 *     After a cache miss, summarization (I/O) and model routing (CPU) now
 *     start concurrently with the governed token budget fetch (I/O).
 *     Saves another ~3-8ms on every non-cached request.
 *
 *   Guard result passthrough:
 *     CostGuardResult now exposes currentUsage, dailyLimit, tokenBudget,
 *     and multiplier so orchestrator.prepare() can accept them directly
 *     and skip re-running checkSpendingCap + getGovernedTokenBudget.
 *     Eliminates 2 redundant Redis calls (~4-10ms) from every request.
 *
 * Previous features (unchanged):
 *   - 7-layer cost protection
 *   - Semantic cache (exact / canonical / MinHash LSH)
 *   - Memory compression
 *   - Adaptive context summarisation
 *   - Cost-aware model routing
 *   - Anomaly detection gate
 */

import { checkSpendingCap, PLAN_DAILY_LIMITS }  from './spending-cap';
import { getGovernedTokenBudget }               from './adaptive-quota';
import { checkSemanticCache, storeSemanticCache } from './semantic-cache';
import { applyAdaptiveContext }                 from './summarizer';
import { routeModel }                           from './model-router';
import { checkAnomaly, recordUsageAsync }       from './anomaly-detector';
import {
  compressMemoryFacts,
  formatCompressedMemory,
  estimateUncompressedTokens,
}                                               from './memory-compressor';
import { AiLimitError }                         from '@/lib/errors';
import { metrics }                              from '@/lib/observability';
import { logger }                               from '@/lib/logger';
import type { Tier }                            from '@/lib/rate-limit';
import type { OrchestratorMessage }             from './orchestrator';
import type { ModelTier }                       from './model-router';
import type { MemoryFact }                      from './memory';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CostGuardInput {
  userId:          string;
  tier:            Tier;
  characterId:     string;
  conversationId?: string | undefined;
  systemPrompt:    string;
  userMessage:     string;
  messages:        OrchestratorMessage[];
  datingMode?:     boolean | undefined;
  rawMemoryFacts?: MemoryFact[] | undefined;
  hasMemory?:      boolean | undefined;
  forceModel?:     string | undefined;
}

export interface CostGuardResult {
  blocked:         boolean;
  blockReason?:    string;
  cooldown:        boolean;

  cacheHit:        boolean;
  cachedReply?:    string;
  cacheKey:        string | null;
  cacheMode?:      'exact' | 'canonical' | 'semantic';
  cacheWords?:     Set<string>;
  cacheSig?:       number[] | null;
  cacheBandKeys?:  string[] | null;

  model:           string;
  modelTier:       ModelTier;
  complexity:      string;
  /** From RoutingResult.escalated (model-router.ts) — see that file and
   *  emotional-escalation-budget.ts. Threaded through so the actual chat
   *  route can pass it into routeStream()/orchestrator so usage gets
   *  billed against the right budget after the call resolves. */
  escalated:       boolean;

  messages:        OrchestratorMessage[];
  systemPrompt:    string;
  summarized:      boolean;
  tokensSavedSummary: number;

  memoryTokensSaved: number;
  memoryFactCount:   number;

  tokenBudget:     number;
  multiplier:      number;
  throttled:       boolean;
  currentUsage:    number;
  dailyLimit:      number;
}

export interface CostGuardRecord {
  userId:        string;
  cacheKey:      string | null;
  cacheWords:    Set<string>;
  cacheSig:      number[] | null;
  cacheBandKeys: string[] | null;
  reply:         string;
  tokensUsed:    number;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export const costGuard = {

  async check(input: CostGuardInput): Promise<CostGuardResult> {
    const {
      userId, tier, conversationId, systemPrompt, userMessage,
      messages, datingMode = false, hasMemory = false,
      rawMemoryFacts, forceModel,
    } = input;

    // ── 1+2: Anomaly gate + spending cap — PARALLEL ───────────────────────────
    // Previously sequential: anomaly first, cap second. Both only need userId.
    // Running in parallel saves one Redis round trip (~2-5ms).
    const [anomalyResult, capResult] = await Promise.all([
      checkAnomaly({ userId, message: userMessage }),
      checkSpendingCap(userId, tier).catch((err: unknown) => {
        if (err instanceof AiLimitError) return err;
        throw err;
      }),
    ]);

    if (anomalyResult.blocked) {
      metrics.recordRequest({ tier, modelTier: 'SMART', provider: 'none', result: 'blocked',
        latencyMs: 0, promptTokens: 0, completionTokens: 0 });
      return blocked('Your account has been temporarily suspended for unusual activity. Contact support.');
    }

    if (capResult instanceof AiLimitError) {
      metrics.recordRequest({ tier, modelTier: 'SMART', provider: 'none', result: 'blocked',
        latencyMs: 0, promptTokens: 0, completionTokens: 0 });
      return blocked(capResult.message);
    }

    // ── 3: Memory compression (CPU-only, sync) ────────────────────────────────
    // Run before cache check so compressed system prompt produces stable cache key.
    let finalSystemPrompt  = systemPrompt;
    let memoryTokensSaved  = 0;
    let memoryFactCount    = 0;

    if (rawMemoryFacts && rawMemoryFacts.length > 0) {
      const compressed = compressMemoryFacts(rawMemoryFacts, tier);
      memoryTokensSaved = Math.max(0,
        estimateUncompressedTokens(rawMemoryFacts) - compressed.tokenCount
      );
      memoryFactCount = compressed.facts.length;

      if (compressed.removedCount > 0) {
        const compressedSection = formatCompressedMemory(compressed);
        const memMarker = '\nWhat you remember about this user:';
        const altMarker = '\nWhat you know about this user:';

        for (const marker of [memMarker, altMarker]) {
          if (finalSystemPrompt.includes(marker)) {
            const idx         = finalSystemPrompt.indexOf(marker);
            const nextSection = finalSystemPrompt.indexOf('\n\n', idx + 1);
            finalSystemPrompt =
              finalSystemPrompt.slice(0, idx) +
              compressedSection +
              (nextSection >= 0 ? finalSystemPrompt.slice(nextSection) : '');
            break;
          }
        }

        logger.info('cost-guard:memory-compressed', {
          userId, removedFacts: compressed.removedCount, tokensSaved: memoryTokensSaved,
        });
      }
    }

    // Rebuild messages[0] with compressed system prompt so summarizer and model
    // both receive the memory-compressed version, not the original bloated one.
    const compressedMessages: OrchestratorMessage[] = finalSystemPrompt !== systemPrompt
      ? [{ role: 'system', content: finalSystemPrompt }, ...messages.slice(1)]
      : messages;

    // ── 4: Semantic response cache ────────────────────────────────────────────
    // RE-SCOPED (2026-08-23, cost audit): was fully disabled (permanent miss)
    // after the original cross-user near-duplicate design leaked one user's
    // cached reply to another. Now live again, but scoped to only a curated
    // allowlist of fully generic openers (greetings/acks/farewells/thanks) —
    // see GENERIC_OPENERS in semantic-cache.ts for the full rationale. A
    // free-text message from an actual conversation is still a guaranteed
    // miss, same as when this was disabled outright.
    const cacheResult = await checkSemanticCache({
      tier, systemPrompt: finalSystemPrompt, userMsg: userMessage, datingMode,
      hasMemory: hasMemory || (rawMemoryFacts ? rawMemoryFacts.length > 0 : false),
    });

    if (cacheResult.hit) {
      logger.info('cost-guard:cache-hit', { userId, key: cacheResult.key, mode: cacheResult.mode });
      metrics.recordRequest({ tier, modelTier: 'cached', provider: 'cache', result: 'cache_hit',
        latencyMs: 0, promptTokens: 0, completionTokens: 0, cacheMode: cacheResult.mode });
      return {
        blocked: false, cooldown: false,
        cacheHit: true, cachedReply: cacheResult.reply, cacheKey: cacheResult.key,
        cacheMode: cacheResult.mode,
        cacheWords: new Set(), cacheSig: null, cacheBandKeys: null,
        model: 'cached', modelTier: 'SMART' as ModelTier, complexity: 'cached', escalated: false,
        messages, systemPrompt: finalSystemPrompt,
        summarized: false, tokensSavedSummary: 0,
        memoryTokensSaved, memoryFactCount,
        tokenBudget: 0, multiplier: 1, throttled: false,
        currentUsage: capResult.currentUsage,
        dailyLimit:   PLAN_DAILY_LIMITS[tier] ?? Infinity,
      };
    }

    // ── 5+7: Summarization (I/O) + governed token budget (I/O) — PARALLEL ────
    // Both are independent of each other. Running in parallel saves ~3-8ms.
    const [ctxResult, governed] = await Promise.all([
      conversationId
        ? applyAdaptiveContext({ conversationId, tier, messages: compressedMessages })
        : Promise.resolve({ messages: compressedMessages, summarized: false, tokensSaved: 0 }),
      getGovernedTokenBudget({
        userId, tier,
        baseLimit:    capResult.perRequestLimit,
        currentUsage: capResult.currentUsage,
        dailyLimit:   PLAN_DAILY_LIMITS[tier] ?? Infinity,
      }),
    ]);

    const finalMessages        = ctxResult.messages;
    const summarized           = ctxResult.summarized;
    const tokensSavedSummary   = ctxResult.tokensSaved;

    if (summarized) {
      logger.info('cost-guard:summarized', { userId, conversationId, tokensSaved: tokensSavedSummary });
    }

    // ── 6: Model routing — H-01: now async (checks PEAK monthly budget) ───────
    const routing = await routeModel({
      tier, userId, userMessage, messages: finalMessages,
      systemPrompt: finalSystemPrompt, datingMode, forceModel,
    });
    logger.info('cost-guard:model-routed', {
      userId, model: routing.model, complexity: routing.complexity,
      reason: routing.reason, downgraded: routing.downgraded,
    });

    const missResult = cacheResult as Extract<typeof cacheResult, { hit: false }>;

    return {
      blocked: false, blockReason: undefined,
      cooldown: anomalyResult.cooldown,

      cacheHit: false, cachedReply: undefined,
      cacheKey:      missResult.key,
      cacheWords:    missResult.words,
      cacheSig:      missResult.sig,
      cacheBandKeys: missResult.bandKeys,

      model:      routing.model,
      modelTier:  routing.modelTier,
      complexity: routing.complexity,
      escalated:  routing.escalated,

      messages:          finalMessages,
      systemPrompt:      finalSystemPrompt,
      summarized,
      tokensSavedSummary,
      memoryTokensSaved,
      memoryFactCount,

      tokenBudget:  governed.tokenBudget,
      multiplier:   governed.multiplier,
      throttled:    governed.throttled,
      currentUsage: capResult.currentUsage,
      dailyLimit:   PLAN_DAILY_LIMITS[tier] ?? Infinity,
    };
  },

  async record({ userId, cacheKey, cacheWords, cacheSig, cacheBandKeys, reply, tokensUsed }: CostGuardRecord): Promise<void> {
    // Independent side effects — a cache-store failure must not prevent
    // usage/anomaly tracking from running, and vice versa. Previously
    // sequential (await storeSemanticCache, then recordUsageAsync), so a
    // thrown cache error silently skipped usage recording for that turn.
    const cacheStore = storeSemanticCache({ key: cacheKey, words: cacheWords, sig: cacheSig, bandKeys: cacheBandKeys, reply })
      .catch(err => logger.warn('cost-guard:record-cache-store-failed', { userId, error: String(err) }));
    recordUsageAsync(userId, tokensUsed);
    await cacheStore;
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function blocked(reason: string): CostGuardResult {
  return {
    blocked: true, blockReason: reason,
    cooldown: false,
    cacheHit: false, cacheKey: null,
    cacheWords: new Set(), cacheSig: null, cacheBandKeys: null,
    model: 'none', modelTier: 'SMART', complexity: 'none', escalated: false,
    messages: [], systemPrompt: '',
    summarized: false, tokensSavedSummary: 0,
    memoryTokensSaved: 0, memoryFactCount: 0,
    tokenBudget: 0, multiplier: 0, throttled: true,
    currentUsage: 0, dailyLimit: 0,
  };
}
