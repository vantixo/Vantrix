/**
 * Model Router — Cost-Per-Token Aware Model Selection
 *
 * v5 Changes (merge optimization):
 *
 *   PEAK auto-routing (BUG FIX):
 *     classifyComplexity() previously returned only NANO | FAST | SMART | POWER.
 *     Elite and Enterprise users have PEAK as their plan cap, but could never
 *     reach it because no complexity path produced PEAK. This meant those tiers
 *     always got POWER even for scenarios that clearly warrant the best model.
 *
 *     Fix: added PEAK to Complexity and a detection branch for genuinely deep
 *     creative scenarios. Criteria are intentionally strict to protect margin:
 *     PEAK fires only on long creative/emotional messages (> 900 chars) from
 *     users whose plan cap allows it — classifyComplexity itself doesn't know
 *     the plan, so the cap enforcement in routeModel() still gates it correctly.
 *
 *   Previous v4 improvements retained:
 *     - Eliminated double Redis calls via precomputed context bag
 *     - NANO emoji / ack detection improvements
 *     - FAST historyLength threshold tightened from 4 → 3
 *     - POWER de-escalation (system prompt threshold raised 8K → 10K)
 *     - Cost tracking per call
 */

import type { Tier }               from '@/lib/rate-limit';
import type { OrchestratorMessage } from './orchestrator';
import { checkPeakBudget,
         recordPeakUsage }          from '@/lib/peak-budget';
import { checkEscalationBudget,
         recordEscalationUsage }    from './emotional-escalation-budget';
import { metrics, MSG_LEN_BUCKETS } from '@/lib/observability';

// ── Model config ──────────────────────────────────────────────────────────────

// ── OpenRouter model roster ───────────────────────────────────────────────────
// Single source of truth for the six OpenRouter models Vantrix is allowed to
// route to. Ordered most-capable-first — this exact order is also what gets
// sent as OpenRouter's native `models` fallback array (see provider-router.ts
// buildOpenRouterFallbackChain()), so OpenRouter itself will retry down this
// list before Vantrix's own provider-router even has to fail over to Kaetah.
export const OPENROUTER_MODELS = {
  DEEPSEEK_V4_PRO:   'deepseek/deepseek-v4-pro',
  DEEPSEEK_V4_FLASH: 'deepseek/deepseek-v4-flash',
  VENICE_UNCENSORED: 'venice/venice-uncensored',
  EURYALE_70B:       'sao10k/l3-70b-euryale-v2.1',
  DOLPHIN_MISTRAL:   'cognitivecomputations/dolphin-mistral-24b-venice-edition',
  MYTHOMAX:          'gryphe/mythomax-l2-13b',
} as const;

export const OPENROUTER_MODEL_PRIORITY: string[] = [
  OPENROUTER_MODELS.DEEPSEEK_V4_PRO,
  OPENROUTER_MODELS.DEEPSEEK_V4_FLASH,
  OPENROUTER_MODELS.VENICE_UNCENSORED,
  OPENROUTER_MODELS.EURYALE_70B,
  OPENROUTER_MODELS.DOLPHIN_MISTRAL,
  OPENROUTER_MODELS.MYTHOMAX,
];

// Complexity-tier → primary model. DeepSeek V4 Pro is the top of the chain
// (complex/high-value turns), V4 Flash covers high-volume ordinary chat.
// KAETAH NOTE: this whole MODELS map is what Kaetah eventually replaces —
// once Kaetah owns routing, model-router.ts's job shrinks to "give Kaetah a
// tier hint" instead of picking a literal model string. See kaetah-brain.ts
// for the swap-in seam; nothing here needs to change to enable that later.
export const MODELS = {
  NANO:  OPENROUTER_MODELS.DEEPSEEK_V4_FLASH,
  FAST:  OPENROUTER_MODELS.DEEPSEEK_V4_FLASH,
  SMART: OPENROUTER_MODELS.DEEPSEEK_V4_FLASH,
  POWER: OPENROUTER_MODELS.DEEPSEEK_V4_PRO,
  PEAK:  OPENROUTER_MODELS.DEEPSEEK_V4_PRO,
} as const;

// Roleplay/character-mode override — swapped in by orchestrator.ts instead of
// MODELS whenever datingMode/roleplay signals are active. Falls back through
// the two dedicated RP models before touching the low-cost fallbacks.
export const ROLEPLAY_MODELS = {
  NANO:  OPENROUTER_MODELS.DEEPSEEK_V4_FLASH,
  FAST:  OPENROUTER_MODELS.DEEPSEEK_V4_FLASH,
  SMART: OPENROUTER_MODELS.EURYALE_70B,
  POWER: OPENROUTER_MODELS.EURYALE_70B,
  PEAK:  OPENROUTER_MODELS.VENICE_UNCENSORED,
} as const;

// Lower-cost fallbacks tried after the tier's primary model fails upstream on
// OpenRouter (wired into the native `models` array — see
// buildOpenRouterFallbackChain in provider-router.ts).
export const OPENROUTER_FALLBACKS: string[] = [
  OPENROUTER_MODELS.DOLPHIN_MISTRAL,
  OPENROUTER_MODELS.MYTHOMAX,
];

// ── Free-tier terminal fallback ───────────────────────────────────────────────
// OpenRouter's own free-model auto-router: picks at random from whatever
// :free-suffixed models are currently live on OpenRouter, filtered for the
// features the request needs (tool calling, structured output, etc). Used
// by provider-router.ts as the very last entry in ROUTING_ORDER — tried only
// once the primary (paid) OpenRouter entry above AND Kaetah have both
// failed. Deliberately NOT one of the named OPENROUTER_MODELS: the free
// roster rotates weekly (models get added/pulled without notice) and a
// hardcoded `some-model:free` id would silently 404 the moment that model
// is retired. The router endpoint stays stable even as the underlying free
// models churn.
export const OPENROUTER_FREE_ROUTER = 'openrouter/free';

// Every tier maps to the same free router — there's no meaningful "free
// NANO vs free PEAK" distinction, the router picks whatever free model
// fits the request shape, not the caller's cost tier.
export const FREE_TIER_MODELS: Record<ModelTier, string> = {
  NANO:  OPENROUTER_FREE_ROUTER,
  FAST:  OPENROUTER_FREE_ROUTER,
  SMART: OPENROUTER_FREE_ROUTER,
  POWER: OPENROUTER_FREE_ROUTER,
  PEAK:  OPENROUTER_FREE_ROUTER,
};

// Recommended sampling defaults for companion/roleplay chat — applied by
// orchestrator.ts on every routeCompletion() call unless a caller overrides.
export const DEFAULT_GENERATION_PARAMS = {
  temperature:      0.9,   // within the 0.85–0.95 band
  topP:             0.9,
  maxTokens:        1000,  // within the 800–1200 band
  frequencyPenalty: 0.3,
  presencePenalty:  0.2,
} as const;

/** Approximate cost per 1M output tokens in USD (used for tie-breaking) */
export const MODEL_COST_PER_M: Record<keyof typeof MODELS, number> = {
  NANO:  0.20,    // DeepSeek V4 Flash
  FAST:  0.20,    // DeepSeek V4 Flash
  SMART: 0.20,    // DeepSeek V4 Flash
  POWER: 0.90,    // DeepSeek V4 Pro
  PEAK:  0.90,    // DeepSeek V4 Pro
};

export type ModelTier = keyof typeof MODELS;

/** Plans that can reach PEAK tier (billing must cover ~$15/M output tokens). */
const PEAK_ELIGIBLE_PLANS = new Set<Tier>(['premium']);

const PLAN_MODEL_CAP: Record<Tier, ModelTier> = {
  free:    'FAST',
  premium: 'PEAK',
};

const TIER_RANK: Record<ModelTier, number> = {
  NANO: 0, FAST: 1, SMART: 2, POWER: 3, PEAK: 4,
};

// ── Emotional intensity (tier-agnostic) ──────────────────────────────────────
// Same signal PEAK detection already uses below, factored out so
// routeModel() can check it independently of plan eligibility — this is
// what decides whether a capped-down tier is offered a budgeted escalation.
// Deliberately the same bar as PEAK's own classification, not a lower one:
// escalation budget should only spend on messages that would have reached
// PEAK/POWER on their own merit if the plan allowed it, not on ordinary
// traffic that happens to mention feelings in passing.

// ── Unified depth-signal vocabulary ──────────────────────────────────────────
// Previously this was four independently-maintained regexes (EMOTIONAL_DEPTH_
// PATTERN, PEAK_NARRATIVE_PATTERN, PEAK_ATTACHMENT_PATTERN, POWER_DEPTH_
// PATTERN) with heavy, inconsistent overlap — tuning one silently drifted it
// out of sync with the other three, and it was never obvious which branch a
// given word belonged to. Replaced with two disjoint word groups (narrative
// vs. attachment) plus thin, named wrappers so every call site keeps its
// original semantics but all four now draw from the same source of truth.
const NARRATIVE_WORDS =
  /roleplay|backstory|imagine|story|chapter|scene|letter|poem|describe|narrate|explain|write|remember\s+when|tell\s+me\s+about|open\s+up|what\s+do\s+you\s+feel|your\s+deepest|soul|heart|memories|dream|fantasy|deep\s+talk/i;

const ATTACHMENT_WORDS =
  /feel|emotion|love|miss|want\s+you|need\s+you|forever|together|commit|relationship|future|wish/i;

// EMOTIONAL_DEPTH_PATTERN: narrative OR attachment — used by isEmotionallyIntense().
const EMOTIONAL_DEPTH_PATTERN = new RegExp(
  `${NARRATIVE_WORDS.source}|${ATTACHMENT_WORDS.source}`, 'i'
);

// PEAK's narrative-writing branch — narrative words only (no attachment tail).
const PEAK_NARRATIVE_PATTERN = NARRATIVE_WORDS;

// PEAK's dating-mode attachment branch.
const PEAK_ATTACHMENT_PATTERN = ATTACHMENT_WORDS;

// POWER's depth signal — same vocabulary as PEAK, since a message either
// shows depth or it doesn't; POWER used to have its own slightly-different
// wordlist for no principled reason. Kept as its own named const (rather
// than inlining EMOTIONAL_DEPTH_PATTERN) so POWER's call site stays
// self-documenting and can still diverge deliberately later if needed.
const POWER_DEPTH_PATTERN = EMOTIONAL_DEPTH_PATTERN;

export function isEmotionallyIntense(input: { userMessage: string; historyLength: number; datingMode: boolean }): boolean {
  const trimmed = input.userMessage.trim();
  return (
    (trimmed.length > 900 && EMOTIONAL_DEPTH_PATTERN.test(trimmed)) ||
    (input.datingMode && input.historyLength > 80 && EMOTIONAL_DEPTH_PATTERN.test(trimmed))
  );
}

// ── Complexity classifier ─────────────────────────────────────────────────────

interface ClassifyInput {
  userMessage:     string;
  historyLength:   number;
  systemPromptLen: number;
  datingMode:      boolean;
  /** Pass the user's plan so PEAK is only classified when the plan can use it. */
  tier?:           Tier;
}

export type Complexity = 'NANO' | 'FAST' | 'SMART' | 'POWER' | 'PEAK';

// Buckets a raw char length against MSG_LEN_BUCKETS (mirrors observability's
// internal bucket() helper, which isn't exported — routing telemetry needs
// this at the call site in routeModel() below, not inside classifyComplexity
// itself, so classifyComplexity stays a pure function of its inputs).
function bucketMsgLen(len: number): string {
  for (const b of MSG_LEN_BUCKETS) {
    if (len <= b) return String(b);
  }
  return '+Inf';
}

export function classifyComplexity(input: ClassifyInput): Complexity {
  const { userMessage, historyLength, systemPromptLen, datingMode, tier } = input;
  const trimmed  = userMessage.trim();
  const msgLen   = trimmed.length;
  const msgWords = trimmed.split(/\s+/).length;

  // ── NANO: trivial greetings / acks / emoji-only ───────────────────────────
  if (
    msgWords <= 4 &&
    historyLength > 2 &&
    (
      /^[\u2600-\u26FF\s]+$/.test(trimmed) ||   // emoji-only
      /^(hi|hey|ok|okay|sure|yes|no|lol|haha|thanks?|np|k|yep|nope|wow|omg|cool|nice|great)[!\s?.]*$/i.test(trimmed)
    )
  ) {
    return 'NANO';
  }

  // ── FAST: short turns in established conversations ────────────────────────
  // BUGFIX (routing-accuracy): FAST used to be checked purely on length/
  // history/dating-mode, with no awareness of message content. A short but
  // emotionally-loaded turn ("I feel like you don't understand me" — 11
  // words, historyLength >= 3, not dating mode) would match FAST and never
  // even reach the POWER_DEPTH_PATTERN check below, since FAST returns
  // first. Excluding POWER_DEPTH_PATTERN here lets short-but-deep turns fall
  // through to the POWER check instead of being silently under-routed.
  if (
    msgLen < 80 &&
    msgWords < 20 &&
    historyLength >= 3 &&
    !datingMode &&
    systemPromptLen < 2000 &&
    !POWER_DEPTH_PATTERN.test(trimmed)
  ) {
    return 'FAST';
  }

  // ── PEAK: deep creative / emotional scenarios — only for PEAK-eligible plans
  // Intentionally strict to protect margin. Criteria:
  //   • Very long messages (> 900 chars) that are clearly narrative/emotional
  //   • Plus: dating mode with deep attachment language OR very long history
  // Plan gate: even if classified PEAK, routeModel() caps at plan ceiling.
  if (
    tier && PEAK_ELIGIBLE_PLANS.has(tier) &&
    (
      // Deep creative writing or storytelling (long, narrative-heavy)
      (
        msgLen > 900 &&
        PEAK_NARRATIVE_PATTERN.test(trimmed)
      ) ||
      // Dating mode + deep emotional / attachment language with long history
      (
        datingMode &&
        historyLength > 80 &&
        PEAK_ATTACHMENT_PATTERN.test(trimmed)
      ) ||
      // Exceptional system prompt complexity (rich memory graph loaded)
      (systemPromptLen > 14_000 && msgLen > 400)
    )
  ) {
    return 'PEAK';
  }

  // ── POWER: explicit signals of depth needed ───────────────────────────────
  if (
    datingMode ||
    msgLen > 500 ||
    msgWords > 120 ||
    systemPromptLen > 10_000 ||
    historyLength > 60 ||
    POWER_DEPTH_PATTERN.test(trimmed)
  ) {
    return 'POWER';
  }

  return 'SMART';
}

// ── Route ─────────────────────────────────────────────────────────────────────

export interface RoutingResult {
  model:            string;
  modelTier:        ModelTier;
  complexity:       Complexity;
  reason:           string;
  downgraded:       boolean;
  /**
   * True when modelTier was reached via the emotional-escalation budget
   * rather than the plan's normal cap. provider-router.ts checks this
   * field directly (not string-matching `reason`) to decide whether to
   * call recordEscalationUsage after the request resolves.
   */
  escalated:        boolean;
  estimatedCostUsd: number;   // per 1K output tokens (for cost-guard logging)
}

/**
 * Route a request to the appropriate model.
 *
 * H-01: Now async — calls checkPeakBudget before committing to PEAK.
 * If the monthly budget is exhausted, falls back to POWER silently (the user
 * never sees an error; they get a slightly less expensive model).
 * recordPeakUsage must be called by the caller after the request resolves —
 * see the integration notes in HIGH/H-01_integration-notes.md.
 */
export async function routeModel(params: {
  tier:         Tier;
  userId:       string;    // needed for PEAK budget check
  userMessage:  string;
  messages:     OrchestratorMessage[];
  systemPrompt: string;
  datingMode?:  boolean;
  forceModel?:  string;
}): Promise<RoutingResult> {
  const { tier, userId, userMessage, messages, systemPrompt, datingMode = false, forceModel } = params;
  // Character/companion roleplay turns route through the RP-specialized
  // models (Euryale / Venice) instead of the general DeepSeek ladder.
  const modelTable = datingMode ? ROLEPLAY_MODELS : MODELS;

  if (forceModel) {
    return {
      model: forceModel, modelTier: 'SMART', complexity: 'SMART',
      reason: 'forced override', downgraded: false, escalated: false, estimatedCostUsd: 0,
    };
  }

  const historyLength = messages.filter(m => m.role !== 'system').length;
  const complexity    = classifyComplexity({
    userMessage, historyLength,
    systemPromptLen: systemPrompt.length,
    datingMode,
    tier,
  });

  const planCap       = PLAN_MODEL_CAP[tier] ?? 'SMART';
  const requestedRank = TIER_RANK[complexity];
  const cappedRank    = TIER_RANK[planCap];
  let   finalTier     = requestedRank <= cappedRank ? complexity : planCap;
  let   downgraded    = finalTier !== complexity;
  let   escalated     = false;

  // Budget-capped one-step-up escalation for tiers BELOW plan-cap-PEAK
  // (free/spark/basic/premium). Only spent when the plan cap actually
  // downgraded a message that independently qualifies as emotionally
  // significant — see isEmotionallyIntense() above. This is what lets a
  // free or basic user's genuinely heavy moment reach a better model
  // without changing the cost profile of their ordinary traffic at all.
  if (downgraded && finalTier !== 'PEAK') {
    const intense = isEmotionallyIntense({ userMessage, historyLength, datingMode });
    if (intense) {
      const escalation = await checkEscalationBudget(userId, tier);
      if (escalation.allowed && escalation.targetTier) {
        finalTier  = escalation.targetTier;
        escalated  = true;
        downgraded = false;
      }
    }
  }

  // H-01: PEAK-specific monthly budget guard. Even if the plan cap allows PEAK
  // and complexity warrants it, check whether this user still has remaining
  // monthly budget. Fall back to POWER rather than erroring — quality degrades
  // gracefully, no user-visible error.
  if (finalTier === 'PEAK') {
    const budget = await checkPeakBudget(userId, tier);
    if (!budget.allowed) {
      finalTier = 'POWER';
      downgraded = true;
      escalated  = false; // fell back below PEAK — no longer an escalation to bill against that budget
    }
  }

  const estimatedCostUsd = MODEL_COST_PER_M[finalTier] / 1000;

  // Routing-accuracy telemetry — fire-and-forget, never on the critical path
  // for the actual completion. See RoutingMetric in @/lib/observability for
  // what each field means and how to query these for a dashboard.
  metrics.recordRouting({
    tier, complexity, finalTier, downgraded, escalated, datingMode,
    msgLenBucket: bucketMsgLen(userMessage.trim().length),
  });

  return {
    model:     modelTable[finalTier] ?? MODELS[finalTier],
    modelTier: finalTier,
    complexity,
    reason:    escalated
      ? `complexity=${complexity} escalated past plan cap via emotional-escalation budget (${tier} → ${finalTier})`
      : downgraded
      ? `complexity=${complexity} capped by plan or PEAK budget (${tier} → ${finalTier})`
      : `complexity=${complexity}`,
    downgraded,
    escalated,
    estimatedCostUsd,
  };
}

// Re-export recordPeakUsage so callers can import from a single model-router
// import statement rather than needing to know about peak-budget directly.
export { recordPeakUsage };

// Re-export recordEscalationUsage — provider-router.ts calls this after any
// request whose ProviderRequest.escalated is true, passing the actual model
// tier used and token usage from the provider response.
export { recordEscalationUsage };
