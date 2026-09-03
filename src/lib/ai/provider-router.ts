/**
 * AI Provider Router — Multi-Provider Fallback & Redundancy
 *
 * Hardening changes in this revision:
 *
 *   Per-call AbortController + timeout:
 *     Every provider fetch now has a dedicated AbortController with a
 *     configurable timeout (default 20s). Previously there was no timeout on
 *     individual provider calls — a hung connection would block the slot for
 *     STREAM_TIMEOUT_MS (25s), and retries could pile up.
 *
 *   Response body size cap:
 *     After receiving the response, we read the body with a 512 KB hard limit.
 *     An adversarial or malfunctioning provider returning megabytes of data
 *     previously caused unbounded memory allocation.
 *
 *   Error sanitization:
 *     Provider error messages are stripped of URLs, tokens, and IPs before
 *     being included in the error chain. Internal provider details must not
 *     reach client-facing error responses.
 *
 *   Provider URL allowlist:
 *     All baseUrls are hardcoded constants. No dynamic URL construction from
 *     user input — SSRF is structurally impossible.
 *
 *   API key validation at startup:
 *     getConfiguredProviders() logs a warning at startup if no providers for
 *     a given model tier are configured, rather than failing silently at runtime.
 */

import { redis }              from '@/lib/redis';
import { getCircuitBreaker }  from '@/lib/circuit-breaker';
import type { CircuitBreaker } from '@/lib/circuit-breaker';
import { CircuitOpenError }   from '@/lib/errors';
import { logger }             from '@/lib/logger';
import { sanitizeProviderError } from '@/lib/security';
import { recordPeakUsage, releasePeakReservation } from '@/lib/peak-budget';
import { recordEscalationUsage }  from '@/lib/ai/emotional-escalation-budget';
import type { ModelTier }     from './model-router';
import { env }                        from '@/env';

// M-04: redis singleton now imported from @/lib/redis above.

// ── Provider definitions (hardcoded — no dynamic URLs) ────────────────────────

// REROUTE (Vantrix → OpenRouter + Kaetah only): groq / anthropic / together /
// grok removed by product decision — see REROUTE_NOTES.md at repo root for
// what was here before and why. OpenRouter is now the single unified LLM
// gateway; Kaetah remains the terminal, currently-inert fallback until it has
// a trained checkpoint (see ROUTING_ORDER below).
export type ProviderName = 'openrouter' | 'kaetah' | 'openrouter-free';

// True for any provider hitting OpenRouter's own API host — the primary
// paid entry and the free-router fallback both need OpenRouter-specific
// request headers (see callOpenAICompat / routeStream below), but must
// NOT both get the paid `models[]` native-fallback array (see the comment
// at buildOpenRouterFallbackChain's call sites for why that's restricted
// to the exact 'openrouter' name only).
function isOpenRouterHost(name: ProviderName): boolean {
  return name === 'openrouter' || name === 'openrouter-free';
}

// Shared circuit-breaker config for every ai:{provider} breaker. getCircuitBreaker()
// is a singleton registry keyed by name — options are only applied the FIRST
// time a given name is created; every later call with different (or missing)
// options is silently ignored and just returns the existing instance. Both
// routeCompletion and routeStream create breakers under the same 'ai:*' keys,
// so if they ever passed different config, whichever ran first for a given
// provider would silently win for the rest of the process lifetime. Defining
// it once here makes that structurally impossible.
const AI_BREAKER_CONFIG = { failureThreshold: 4, timeout: 25_000 } as const;

interface Provider {
  name:       ProviderName;
  baseUrl:    string;         // HARDCODED, or operator-set env var — never user input
  apiKeyEnv:  string;
  models:     Partial<Record<ModelTier, string>>;
  maxTokens:  number;
  streaming:  boolean;
  timeoutMs:  number;         // per-call timeout
  // Self-hosted single-model servers (Kaetah) speak a raw
  // prompt-in/text-out completion API, not the OpenAI chat-messages
  // schema every hosted provider above uses. callProvider() dispatches on
  // this instead of assuming every non-Anthropic provider is OpenAI-compat.
  promptAPI?: boolean;
  // SSE endpoint for prompt-API providers (Kaetah) — distinct from baseUrl
  // (its blocking /v1/completions route) since routeStream needs a
  // different path, not just stream:true on the same URL.
  streamUrl?: string;
}

import { MODELS as ROUTER_MODELS, OPENROUTER_MODEL_PRIORITY, FREE_TIER_MODELS } from './model-router';

// buildOpenRouterFallbackChain(): OpenRouter accepts a native `models: []`
// array on the request body — it will itself retry down that list if the
// primary model errors/is unavailable, before Vantrix's own provider-router
// fallback logic (ROUTING_ORDER) ever needs to move to the next *provider*.
// Kept as a function (not a static const) so it always reflects
// OPENROUTER_MODEL_PRIORITY from model-router.ts — one list, two consumers.
function buildOpenRouterFallbackChain(primary: string): string[] {
  return OPENROUTER_MODEL_PRIORITY.filter(m => m !== primary);
}

const PROVIDERS: Provider[] = [
  {
    // Unified LLM gateway. Model IDs come straight from model-router.ts's
    // MODELS / ROLEPLAY_MODELS maps so there is exactly one place that knows
    // "PEAK means deepseek/deepseek-v4-pro" etc. — this entry never hardcodes
    // a model string itself, it just points at that source of truth.
    name:      'openrouter',
    baseUrl:   'https://openrouter.ai/api/v1/chat/completions',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    models: ROUTER_MODELS,
    maxTokens: 32768, streaming: true, timeoutMs: 20_000,
  },
  {
    // Terminal last-resort fallback — OpenRouter's own free-model
    // auto-router (see FREE_TIER_MODELS / OPENROUTER_FREE_ROUTER in
    // model-router.ts). Same OpenRouter account/API key as the primary
    // entry above; this isn't a different vendor, just a different (free,
    // non-deterministic) model selection, reached only once the primary
    // paid attempt AND Kaetah have both failed — see ROUTING_ORDER below.
    // Gated by OPENROUTER_FREE_FALLBACK_ENABLED (env.ts) so an operator can
    // turn it off without a code change; see that var's comment for why
    // they might want to (non-deterministic model choice, varying per-model
    // data-training terms).
    name:      'openrouter-free',
    baseUrl:   'https://openrouter.ai/api/v1/chat/completions',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    models: FREE_TIER_MODELS,
    // Free models are shared/rate-limited and often slower under load —
    // smaller cap and a longer per-call timeout than the paid entry gives
    // this fair odds before the very last provider in the chain gives up.
    maxTokens: 4096, streaming: true, timeoutMs: 25_000,
  },
  {
    // Self-hosted Kaetah-2B (see /kaetah/inference/api_server.py). Scaffolding
    // only — see KAETAH_ENABLED below for why this never receives traffic
    // until an operator explicitly turns it on with a real trained checkpoint
    // behind KAETAH_API_URL.
    name:      'kaetah',
    baseUrl:   env.KAETAH_API_URL ? `${env.KAETAH_API_URL.replace(/\/$/, '')}/v1/completions` : '',
    apiKeyEnv: 'KAETAH_API_KEY',
    // Single self-hosted model — every tier maps to the same checkpoint.
    // Kept as its own explicit tier map (rather than a blanket default) so
    // adding a real second checkpoint later is a one-line change here.
    models: {
      NANO:  'kaetah-2b',
      FAST:  'kaetah-2b',
      SMART: 'kaetah-2b',
      POWER: 'kaetah-2b',
      PEAK:  'kaetah-2b',
    },
    // ACTIVATION: real trained checkpoint confirmed live behind
    // KAETAH_API_URL, with a working /v1/completions/stream SSE route —
    // streaming enabled and wired below (see parseKaetahSSE + the
    // promptAPI branch in routeStream's body/parse logic). Still gated
    // by KAETAH_ENABLED and its last-resort position in ROUTING_ORDER —
    // only the "no adapter exists" blocker is lifted, not the
    // last-resort placement, which stays deliberate.
    maxTokens: 4096, streaming: true, timeoutMs: 20_000,
    promptAPI: true,
    streamUrl: env.KAETAH_API_URL ? `${env.KAETAH_API_URL.replace(/\/$/, '')}/v1/completions/stream` : '',
  },
];

// ── Routing order ─────────────────────────────────────────────────────────────
//
// 'kaetah' is deliberately absent from every tier's chain below. It's an
// untrained model skeleton as of this writing (see kaetah/README.md
// "Status") — silently routing real user traffic to it the moment
// KAETAH_API_URL/KAETAH_API_KEY happen to be set would mean companions
// reply with noise. Wiring it in for real is a two-step, explicit process:
//
//   1. Train and deploy a real checkpoint behind KAETAH_API_URL.
//   2. Add 'kaetah' to the tier(s) below where you want it to serve traffic
//      (e.g. prepend to NANO/FAST for cost, or add as a POWER fallback) —
//      and only after you've validated its output quality directly.
//
// getConfiguredProviders() / getProviderHealth() below will pick it up
// automatically once it appears in a routing chain; nothing else to wire.
const ROUTING_ORDER: Record<ModelTier, ProviderName[]> = {
  NANO:  ['openrouter', 'kaetah', 'openrouter-free'],
  FAST:  ['openrouter', 'kaetah', 'openrouter-free'],
  SMART: ['openrouter', 'kaetah', 'openrouter-free'],
  POWER: ['openrouter', 'kaetah', 'openrouter-free'],
  PEAK:  ['openrouter', 'kaetah', 'openrouter-free'],
};
// 'openrouter-free' sits last in every tier's chain, deliberately after
// Kaetah — it only receives traffic if the primary paid OpenRouter attempt
// AND Kaetah have both failed/are unconfigured/have an open circuit
// breaker. See OPENROUTER_FREE_FALLBACK_ENABLED (env.ts) for the kill
// switch and why an operator might use it.
// Grok is deliberately placed second-to-last (ahead only of the still-unproven
// Kaetah scaffold) in every tier's chain. It only receives traffic if every
// other configured, real provider ahead of it fails, times out, or has an
// open circuit breaker — never as a first attempt. See the "LAST-RESORT
// PROVIDER" note on Grok's entry in PROVIDERS above before changing this.
// ACTIVATION: 'kaetah' is now the terminal (last-resort) entry in every
// tier's chain — it only receives traffic if every provider above it fails
// or is unconfigured, AND KAETAH_ENABLED='true' is set, AND KAETAH_API_URL
// points at a running server with a real consolidated checkpoint loaded
// (kaetah/inference/serve.py). Until KAETAH_ENABLED='true' this is a no-op.
// A streaming SSE adapter exists (see the promptAPI branches in routeStream
// below) so it now serves both routeCompletion() and routeStream() — verify
// formatPrompt()'s template still matches the checkpoint's instruction-tuning
// format, and the parseKaetahChunk() field names below still match its
// actual /v1/completions/stream wire schema, before relying on it in
// production; neither was written against a live server response.

// ── Response body size cap ────────────────────────────────────────────────────

const MAX_RESPONSE_BYTES = 512 * 1024;  // 512 KB

async function readResponseWithLimit(res: Response): Promise<string> {
  const reader  = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  let total = 0;
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      reader.cancel().catch(() => {});
      throw new Error('Provider response exceeded size limit');
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { merged.set(c, offset); offset += c.length; }
  return new TextDecoder().decode(merged);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProviderMessage {
  role:    'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderRequest {
  messages:     ProviderMessage[];
  modelTier:    ModelTier;
  maxTokens:    number;
  temperature?: number | undefined;
  topP?:        number | undefined;
  stream?:      boolean | undefined;
  appUrl?:      string | undefined;
  traceId?:     string | undefined;
  // H-01: needed so routeCompletion can call recordPeakUsage after a PEAK
  // request resolves. Optional so existing call sites don't break.
  userId?:      string | undefined;
  // Set from RoutingResult.escalated by whatever call site invoked
  // routeModel() (see orchestrator.ts). True means modelTier was reached
  // via the emotional-escalation budget, not the plan's normal cap.
  escalated?:   boolean | undefined;
  // Literal model override — used for roleplay/character-mode turns, where
  // orchestrator.ts has already resolved the model via model-router.ts's
  // ROLEPLAY_MODELS table (Euryale/Venice) instead of the default MODELS
  // ladder. When unset, callers fall back to provider.models[modelTier].
  modelOverride?: string | undefined;
  // Pins routing to a single named provider, skipping getHealthAdjustedOrder
  // and any failover entirely. Needed alongside modelOverride whenever the
  // override model string only exists on one provider (e.g. moderation's
  // 'openai/gpt-4o-mini' pin — that model name means nothing to Kaetah, so
  // silently failing over to Kaetah on an OpenRouter hiccup would send a
  // request Kaetah can't fulfill instead of surfacing the failure). Without
  // this, a caller using modelOverride has no way to prevent that.
  providerOverride?: ProviderName | undefined;
  frequencyPenalty?: number | undefined;
  presencePenalty?:  number | undefined;
  // DEAD-TIMEOUT-FIX: previously orchestrator.ts's infer() created an
  // AbortController + setTimeout intended to cap total inference time, but
  // ProviderRequest had no field to carry it and routeCompletion had no
  // code to consume it — calling controller.abort() aborted a signal
  // nothing was listening to. Real enforcement came only from each
  // provider's own per-call timeoutMs, so a caller's overall deadline was
  // never actually honored. This field lets a caller's abort signal
  // propagate into every underlying fetch — see callAnthropic /
  // callOpenAICompat, which combine it with the provider's own timeout via
  // AbortSignal.any().
  signal?:      AbortSignal | undefined;
}

export interface ProviderResponse {
  reply:            string;
  promptTokens:     number;
  completionTokens: number;
  totalTokens:      number;
  latencyMs:        number;
  provider:         ProviderName;
  model:            string;
  fallback:         boolean;
}

// ── Provider health tracking ──────────────────────────────────────────────────

const HEALTH_TTL = 3600;

export type ProviderHealth = {
  name:        ProviderName;
  healthy:     boolean;
  successRate: number;
  p50Ms:       number;
  updatedAt:   number;
};

async function recordProviderCall(name: ProviderName, success: boolean, latencyMs: number): Promise<void> {
  const key = `ai:provider:calls:${name}:${new Date().toISOString().slice(0, 13)}`;
  try {
    const pipe = redis.pipeline();
    pipe.incr(`${key}:total`);
    if (success) pipe.incr(`${key}:ok`);
    else         pipe.incr(`${key}:err`);
    pipe.lpush(`${key}:lat`, latencyMs);
    pipe.ltrim(`${key}:lat`, 0, 99);
    for (const k of [`${key}:total`, `${key}:ok`, `${key}:err`, `${key}:lat`]) pipe.expire(k, HEALTH_TTL);
    await pipe.exec();
  } catch { /* non-critical */ }
}

export async function getProviderHealth(): Promise<ProviderHealth[]> {
  const hour = new Date().toISOString().slice(0, 13);
  const results: ProviderHealth[] = [];
  for (const p of PROVIDERS) {
    if (!process.env[p.apiKeyEnv]) continue;
    const key = `ai:provider:calls:${p.name}:${hour}`;
    try {
      const [total, ok, latArr] = await Promise.all([
        redis.get<string>(`${key}:total`),
        redis.get<string>(`${key}:ok`),
        redis.lrange(`${key}:lat`, 0, 99),
      ]);
      const t    = parseInt(total ?? '0', 10);
      const s    = parseInt(ok    ?? '0', 10);
      const lats = (latArr as (string | number)[]).map(Number).sort((a, b) => a - b);
      const p50  = lats.length ? lats[Math.floor(lats.length / 2)] : 0;
      results.push({ name: p.name, healthy: t === 0 || s / t >= 0.8, successRate: t === 0 ? 1 : s / t, p50Ms: p50, updatedAt: Date.now() });
    } catch {
      results.push({ name: p.name, healthy: true, successRate: 1, p50Ms: 0, updatedAt: 0 });
    }
  }
  return results;
}

// ── Health-adjusted routing ─────────────────────────────────────────────────
//
// Previously: recordProviderCall() wrote success/failure/latency stats to
// Redis every call, and getProviderHealth() could read them back — but
// nothing in the actual routing path ever consulted that data. Provider
// order was 100% static (ROUTING_ORDER) plus a binary circuit-breaker skip
// (open/closed). A provider having a rough hour — degraded but not yet
// tripping its breaker's consecutive-failure threshold — still got tried
// first on every single request.
//
// This demotes (never excludes) a provider that's clearly struggling: moved
// to the back of its tier's chain, still tried if everything else fails.
// Grok already sits second-to-last in the static ROUTING_ORDER above (only
// Kaetah trails it) by product decision — it's a last-resort provider, not
// the primary. This reordering only ever pushes providers further back on
// real signal, so it can't promote anything ahead of that placement:
//   - Requires a real sample size (>= MIN_SAMPLES calls this hour) before
//     acting at all — a provider with 2 calls and 1 failure isn't "unhealthy",
//     it's noise.
//   - Only demotes below FAILURE_THRESHOLD (well under the circuit breaker's
//     own bar), so this acts as an earlier, softer signal ahead of the
//     breaker fully opening — not a replacement for it.
//   - Pure reordering, not filtering — a demoted provider is still in the
//     chain as a fallback, same as today.
const MIN_SAMPLES        = 5;
const FAILURE_THRESHOLD  = 0.5; // demote if success rate is below this

async function getHealthAdjustedOrder(tier: ModelTier): Promise<ProviderName[]> {
  const order = ROUTING_ORDER[tier] ?? ROUTING_ORDER.SMART;
  const hour  = new Date().toISOString().slice(0, 13);

  const flagged = new Set<ProviderName>();
  try {
    await Promise.all(order.map(async (name) => {
      const key = `ai:provider:calls:${name}:${hour}`;
      const [total, ok] = await Promise.all([
        redis.get<string>(`${key}:total`),
        redis.get<string>(`${key}:ok`),
      ]);
      const t = parseInt(total ?? '0', 10);
      const s = parseInt(ok    ?? '0', 10);
      if (t >= MIN_SAMPLES && (s / t) < FAILURE_THRESHOLD) flagged.add(name);
    }));
  } catch {
    return order; // Redis hiccup — fall back to the untouched static order
  }

  if (flagged.size === 0) return order;
  return [...order.filter(n => !flagged.has(n)), ...order.filter(n => flagged.has(n))];
}

// ── Anthropic prompt-caching helper ─────────────────────────────────────────
// Splits an assembled system prompt on prompt.ts's PROMPT_CACHE_BOUNDARY
// marker (if present) into a cached static block + uncached dynamic tail,
// producing Anthropic's content-block system format. Falls back to a plain
// string (today's behavior) when the marker isn't present, so this is a
// no-op for any system prompt not built via assembleFullPrompt().
const CACHE_BOUNDARY = '\n<<<VANTRIX_CACHE_BOUNDARY>>>\n';

// REROUTE: buildAnthropicSystem() (Anthropic content-block system format
// builder) was removed here along with callAnthropic — no longer used now
// that Anthropic is not in PROVIDERS.

/** Strip the cache marker from a messages[] system entry, for providers that don't cache. */
function stripCacheBoundaryFromMessages(
  messages: ProviderRequest['messages'],
): ProviderRequest['messages'] {
  if (!messages.some(m => m.role === 'system' && m.content.includes(CACHE_BOUNDARY))) return messages;
  return messages.map(m =>
    m.role === 'system' ? { ...m, content: m.content.split(CACHE_BOUNDARY).join('\n') } : m,
  );
}

// REROUTE: the Anthropic-native adapter (callAnthropic + buildAnthropicSystem)
// was removed here — Anthropic was dropped from PROVIDERS/ROUTING_ORDER when
// Vantrix moved to OpenRouter-only + Kaetah. stripCacheBoundaryFromMessages()
// above is kept: it's a generic marker-strip used for every provider's
// messages array, not Anthropic-specific.

// ── OpenAI-compat adapter ─────────────────────────────────────────────────────

async function callOpenAICompat(
  provider: Provider, req: ProviderRequest, apiKey: string,
): Promise<{ reply: string; promptTokens: number; completionTokens: number }> {
  const model = req.modelOverride ?? provider.models[req.modelTier];
  if (!model) throw new Error(`${provider.name}: no model for tier ${req.modelTier}`);

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type':  'application/json',
  };
  if (isOpenRouterHost(provider.name)) {
    if (req.appUrl)  headers['HTTP-Referer'] = req.appUrl;
    if (req.traceId) headers['X-Request-ID'] = req.traceId;
    headers['X-Title'] = 'Vantrix AI Companion';
  }

  const body: Record<string, unknown> = {
    model, messages: stripCacheBoundaryFromMessages(req.messages),
    max_tokens: Math.min(req.maxTokens, provider.maxTokens),
  };
  if (req.temperature != null)      body.temperature = req.temperature;
  if (req.topP != null)             body.top_p = req.topP;
  if (req.frequencyPenalty != null) body.frequency_penalty = req.frequencyPenalty;
  if (req.presencePenalty != null)  body.presence_penalty = req.presencePenalty;
  // Paid OpenRouter entry ONLY (exact name check, not isOpenRouterHost) —
  // native model fallback chain (see buildOpenRouterFallbackChain above).
  // OpenRouter retries down this list itself before provider-router's own
  // ROUTING_ORDER fallback (→ Kaetah → openrouter-free) ever kicks in, so a
  // momentary hiccup on e.g. DeepSeek V4 Pro doesn't have to fall all the
  // way down the chain. Deliberately NOT applied to 'openrouter-free': that
  // provider's whole point is $0 cost, and buildOpenRouterFallbackChain()
  // is built from paid models — attaching it here would mean a failed free
  // request could silently retry onto a billed model with no error and no
  // signal to the operator that money got spent on the "free" path.
  if (provider.name === 'openrouter') body.models = buildOpenRouterFallbackChain(model);

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), provider.timeoutMs);
  // DEAD-TIMEOUT-FIX: see identical note in callAnthropic above.
  const signal = req.signal ? AbortSignal.any([controller.signal, req.signal]) : controller.signal;

  try {
    const res = await fetch(provider.baseUrl, {
      method:  'POST',
      headers,
      body:    JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${provider.name} ${res.status}: ${sanitizeProviderError(text)}`);
    }

    const raw  = await readResponseWithLimit(res);
    const data = JSON.parse(raw) as {
      choices?: { message?: { content?: string } }[];
      usage?:   { prompt_tokens?: number; completion_tokens?: number };
    };

    const reply            = data.choices?.[0]?.message?.content ?? '';
    const promptTokens     = data.usage?.prompt_tokens     ?? 0;
    const completionTokens = data.usage?.completion_tokens ?? Math.ceil(reply.length / 4);
    // NO-DEAD-TURN FIX: a provider that content-filters a mature/roleplay
    // turn typically returns 200 OK with an empty (or whitespace-only)
    // message rather than a non-2xx status — so the check above never
    // caught it, and the chat silently rendered a blank reply. Throwing
    // here instead makes routeCompletion/routeStream treat it exactly like
    // any other provider failure and fall through to the next entry in
    // ROUTING_ORDER (ultimately Grok), so the user always gets a real reply.
    if (!reply.trim()) throw new Error(`${provider.name}: empty completion (likely content-filtered)`);
    return { reply, promptTokens, completionTokens };
  } finally {
    clearTimeout(timer);
  }
}

// ── Kaetah adapter (self-hosted, raw prompt-completion API) ──────────────────
//
// inference/api_server.py takes { prompt, max_new_tokens, temperature, top_k,
// top_p } and returns { text, prompt_tokens, completion_tokens, ... } — no
// chat-messages schema, no system-role concept, no model field (single model
// per server). This flattens the ProviderRequest messages array into one
// prompt string using a simple role-tagged format; swap formatPrompt() for
// whatever chat template the trained checkpoint was actually instruction-tuned
// on once one exists (post_training/sft_dataset.py is the source of truth for
// that template — keep the two in sync or POWER-tier-quality output silently
// degrades).
function formatPrompt(messages: ProviderMessage[]): string {
  const parts = messages.map(m => {
    const tag = m.role === 'system' ? 'System' : m.role === 'user' ? 'User' : 'Assistant';
    const content = m.role === 'system' ? m.content.split(CACHE_BOUNDARY).join('\n') : m.content;
    return `${tag}: ${content}`;
  });
  parts.push('Assistant:');
  return parts.join('\n\n');
}

async function callKaetah(
  provider: Provider, req: ProviderRequest, apiKey: string,
): Promise<{ reply: string; promptTokens: number; completionTokens: number }> {
  if (!provider.baseUrl) throw new Error('kaetah: KAETAH_API_URL not configured');

  const body = {
    prompt:         formatPrompt(req.messages),
    max_new_tokens: Math.min(req.maxTokens, provider.maxTokens),
    temperature:    req.temperature ?? 1.0,
    top_p:          req.topP,
  };

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), provider.timeoutMs);
  const signal = req.signal ? AbortSignal.any([controller.signal, req.signal]) : controller.signal;

  try {
    const res = await fetch(provider.baseUrl, {
      method:  'POST',
      // Self-hosted server has no built-in auth beyond this bearer key
      // (see KAETAH_API_URL comment in env.ts) — always send it even though
      // the wire format otherwise has nothing OpenAI-compat about it.
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`kaetah ${res.status}: ${sanitizeProviderError(text)}`);
    }

    const raw  = await readResponseWithLimit(res);
    const data = JSON.parse(raw) as {
      text?:               string;
      prompt_tokens?:      number;
      completion_tokens?:  number;
    };

    const reply            = data.text ?? '';
    const promptTokens     = data.prompt_tokens     ?? 0;
    const completionTokens = data.completion_tokens ?? Math.ceil(reply.length / 4);
    return { reply, promptTokens, completionTokens };
  } finally {
    clearTimeout(timer);
  }
}

// ── Core router ───────────────────────────────────────────────────────────────

/**
 * Shared "should this provider be skipped before we even try it" gate,
 * used by both routeCompletion's and routeStream's fallback loops.
 * Returns a human-readable skip reason (fed into skippedUnconfigured, and
 * ultimately into the DIAGNOSABILITY FIX error message below — see
 * routeCompletion) or null when the provider is configured and attemptable.
 *
 * Belt-and-suspenders kaetah/openrouter-free checks guard against an
 * untrained model going live from a routing-order edit alone — see the
 * ROUTING_ORDER comment above.
 */
function unconfiguredReason(providerName: ProviderName, provDef: Provider): string | null {
  if (providerName === 'kaetah' && env.KAETAH_ENABLED !== 'true') {
    return 'kaetah (KAETAH_ENABLED not true)';
  }
  if (providerName === 'openrouter-free' && env.OPENROUTER_FREE_FALLBACK_ENABLED !== 'true') {
    return 'openrouter-free (OPENROUTER_FREE_FALLBACK_ENABLED not true)';
  }
  if (!process.env[provDef.apiKeyEnv]) {
    return `${providerName} (${provDef.apiKeyEnv} not set)`;
  }
  return null;
}

async function callProvider(provider: Provider, req: ProviderRequest, apiKey: string) {
  if (provider.promptAPI) return callKaetah(provider, req, apiKey);
  return callOpenAICompat(provider, req, apiKey);
}

export async function routeCompletion(req: ProviderRequest): Promise<ProviderResponse> {
  const order  = req.providerOverride ? [req.providerOverride] : await getHealthAdjustedOrder(req.modelTier);
  const start  = Date.now();
  const errors: string[] = [];
  const skippedUnconfigured: string[] = [];
  let   primaryAttempted = false;

  for (const providerName of order) {
    const provDef = PROVIDERS.find(p => p.name === providerName);
    if (!provDef) continue;

    // DIAGNOSABILITY FIX: previously each of these checks just `continue`d
    // with no record kept — if every provider in the fallback chain was
    // skipped (a real, plausible deployment gap, e.g. missing API keys),
    // the loop would exit having pushed nothing to `errors`, and the thrown
    // message below would read "AI service temporarily unavailable. Errors:
    // " with an empty list. That's indistinguishable from every provider
    // actually being down, when the real problem is that nothing was ever
    // configured. Tracking each skip reason means the error says so
    // explicitly.
    const skipReason = unconfiguredReason(providerName, provDef);
    if (skipReason) {
      skippedUnconfigured.push(skipReason);
      continue;
    }
    const apiKey = process.env[provDef.apiKeyEnv]!;

    const breaker: CircuitBreaker = getCircuitBreaker(`ai:${providerName}`, AI_BREAKER_CONFIG);

    const callStart = Date.now();
    try {
      const result = await breaker.execute(() => callProvider(provDef, req, apiKey));

      await recordProviderCall(providerName, true, Date.now() - callStart);

      // H-01: record PEAK usage for monthly budget tracking. Both the
      // OpenRouter path and this direct-Anthropic fallback path record usage
      // so the budget counters stay accurate regardless of which path served
      // the request (the M-02 fix ensures both paths now use the same model
      // string, so cost math is consistent).
      if (req.modelTier === 'PEAK' && req.userId) {
        recordPeakUsage(req.userId, {
          inputTokens:  result.promptTokens,
          outputTokens: result.completionTokens,
        }).catch(err => logger.warn('[provider-router] recordPeakUsage failed', { error: String(err) }));
      }

      // Emotional-escalation budget: only for non-PEAK escalations
      // (free→SMART/POWER). A PEAK escalation (premium→PEAK)
      // is billed against checkPeakBudget above instead — one PEAK budget
      // ledger per user, not two competing ones, since both draw against
      // the same real Sonnet cost.
      if (req.escalated && req.modelTier !== 'PEAK' && req.userId) {
        recordEscalationUsage(req.userId, req.modelTier, {
          inputTokens:  result.promptTokens,
          outputTokens: result.completionTokens,
        }).catch(err => logger.warn('[provider-router] recordEscalationUsage failed', { error: String(err) }));
      }

      return {
        ...result,
        totalTokens:  result.promptTokens + result.completionTokens,
        latencyMs:    Date.now() - start,
        provider:     providerName,
        model:        req.modelOverride ?? provDef.models[req.modelTier] ?? 'unknown',
        fallback:     primaryAttempted && providerName !== order[0],
      };

    } catch (err: unknown) {
      await recordProviderCall(providerName, false, Date.now() - callStart);
      // Sanitize before logging/chaining — never let raw provider error reach client
      const sanitized = sanitizeProviderError(err);
      errors.push(`${providerName}: ${sanitized}`);
      primaryAttempted = true;

      if (err instanceof CircuitOpenError) {
        logger.warn(`[provider-router] Circuit open: ${providerName}`, { tier: req.modelTier });
        continue;
      }
      logger.warn(`[provider-router] ${providerName} failed`, { tier: req.modelTier, error: sanitized });
      continue;
    }
  }

  if (errors.length === 0 && skippedUnconfigured.length > 0) {
    // Every provider in the chain was skipped for lack of an API key — this
    // is a deployment/config problem, not a runtime outage. Say so plainly;
    // this is the difference between a 2-minute env-var fix and someone
    // burning an hour assuming OpenRouter/Groq/Anthropic are all down.
    logger.error('[provider-router] No AI provider configured for tier', {
      tier: req.modelTier, skipped: skippedUnconfigured,
    });
    // checkPeakBudget() already reserved a request slot + estimated spend
    // for this call before dispatch. It never reached a provider, so
    // nothing was actually spent — release the reservation rather than
    // letting it sit as phantom spend for the rest of the month.
    if (req.modelTier === 'PEAK' && req.userId) {
      releasePeakReservation(req.userId).catch(err =>
        logger.warn('[provider-router] releasePeakReservation failed', { error: String(err) }));
    }
    throw new Error(
      `No AI provider is configured for this request (checked: ${skippedUnconfigured.join(', ')}). ` +
      `Set at least one provider API key in your environment.`
    );
  }

  // Every configured provider in the fallback chain failed — same
  // reasoning as above: the reservation made in checkPeakBudget() was
  // never settled by a successful recordPeakUsage() call, so release it.
  if (req.modelTier === 'PEAK' && req.userId) {
    releasePeakReservation(req.userId).catch(err =>
      logger.warn('[provider-router] releasePeakReservation failed', { error: String(err) }));
  }
  throw new Error(`AI service temporarily unavailable. Errors: ${errors.join(' | ')}`);
}

// ── Streaming router ──────────────────────────────────────────────────────────

export interface StreamChunk {
  delta:    string;
  done:     boolean;
  provider: ProviderName;
  model:    string;
  // STREAM-TOKENS-FIX: real usage from the provider, when the stream carried
  // one. Only ever populated on a done:true chunk — never guess mid-stream.
  // Undefined (not zero) when the provider genuinely never sent usage, so
  // callers can tell "no data" apart from "zero tokens" and fall back to an
  // estimate only in the former case.
  usage?: { promptTokens: number; completionTokens: number };
  // FALLBACK-CORRUPTION-FIX: set to true on the first chunk from a NEW
  // provider, but only when a PRIOR provider in this same call had already
  // yielded at least one delta before failing mid-stream. Consumers MUST
  // discard any partial output accumulated so far and start fresh when they
  // see this — otherwise the failed provider's partial (and possibly
  // mid-sentence) text is silently concatenated with the new provider's
  // full independent response, with no boundary between them, and shown to
  // the real user as one garbled reply. Absent (undefined) on every other
  // chunk, including the very first chunk of a call that never needed a
  // fallback — only meaningful when explicitly true.
  reset?: true;
  // Tokens spent generating content that was abandoned when this provider
  // failed mid-stream (only present on a reset:true chunk). This is real,
  // billed provider usage that produced no user-facing output — callers
  // must add it to whatever they bill/record for this request, or that
  // spend is never accounted for anywhere.
  abandonedTokens?: number;
}

// Shared by both terminal-chunk sites inside routeStream() below.
// routeCompletion() (the non-streaming path) already recorded PEAK/
// escalation usage — routeStream() (the path live chat traffic actually
// hits, per the DIAGNOSABILITY FIX comment above) never did. Fire-and-
// forget, same as the routeCompletion call sites, so it adds no latency
// to the stream closing out.
function recordStreamUsage(req: ProviderRequest, usage: { promptTokens: number; completionTokens: number } | undefined): void {
  if (!usage || !req.userId) return;
  const tokens = { inputTokens: usage.promptTokens, outputTokens: usage.completionTokens };

  if (req.modelTier === 'PEAK') {
    recordPeakUsage(req.userId, tokens)
      .catch(err => logger.warn('[provider-router] routeStream recordPeakUsage failed', { error: String(err) }));
  } else if (req.escalated) {
    recordEscalationUsage(req.userId, req.modelTier, tokens)
      .catch(err => logger.warn('[provider-router] routeStream recordEscalationUsage failed', { error: String(err) }));
  }
}

export async function* routeStream(
  req: ProviderRequest,
  abortSignal?: AbortSignal,    // NEW: propagate client disconnect abort
): AsyncGenerator<StreamChunk> {
  const order = req.providerOverride ? [req.providerOverride] : await getHealthAdjustedOrder(req.modelTier);
  // before failing — used to mark the next provider's first chunk with
  // reset:true so consumers know to discard prior partial output.
  let priorProviderYieldedContent = false;
  let abandonedTokensTotal = 0;
  // DIAGNOSABILITY FIX: same issue as routeCompletion() above — if every
  // provider in the chain is skipped for a missing API key, the terminal
  // "All streaming providers exhausted" error gave no indication that
  // NOTHING was ever actually attempted. This is what a live chat request
  // hits (routeCompletion is the non-streaming path), so this is the one
  // that actually surfaces as "AI content is not available" in the product.
  const skippedUnconfigured: string[] = [];

  for (const providerName of order) {
    const provDef = PROVIDERS.find(p => p.name === providerName);
    if (!provDef || !provDef.streaming) continue;

    const skipReason = unconfiguredReason(providerName, provDef);
    if (skipReason) {
      skippedUnconfigured.push(skipReason);
      continue;
    }
    const apiKey = process.env[provDef.apiKeyEnv]!;

    const breaker = getCircuitBreaker(`ai:${providerName}`, AI_BREAKER_CONFIG);

    // How many chars THIS provider yielded before possibly failing — used
    // both to decide whether the next provider needs reset:true, and to
    // estimate abandoned token spend if this attempt fails after producing
    // output. Declared outside the try block so the catch block can read it.
    let thisAttemptYieldedChars = 0;
    let isFirstChunkOfAttempt = true;

    try {
      const model = req.modelOverride ?? provDef.models[req.modelTier];
      if (!model) continue;

      // Combine client abort + per-provider timeout
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), provDef.timeoutMs + 30_000); // stream gets more time
      // If client disconnects, abort the upstream fetch
      abortSignal?.addEventListener('abort', () => controller.abort(), { once: true });

      const headers: Record<string, string> = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      };

      let body: Record<string, unknown>;
      // Which URL this attempt actually fetches — defaults to baseUrl,
      // overridden below for prompt-API providers with a distinct SSE path.
      let fetchUrl = provDef.baseUrl;

      if (provDef.promptAPI) {
        // Kaetah: raw prompt-completion API, no messages/model schema — same
        // formatPrompt() flattening callKaetah() uses for the blocking path,
        // against the dedicated SSE route rather than baseUrl.
        if (!provDef.streamUrl) throw new Error('kaetah: KAETAH_API_URL not configured');
        fetchUrl = provDef.streamUrl;
        body = {
          prompt:         formatPrompt(req.messages),
          max_new_tokens: Math.min(req.maxTokens, provDef.maxTokens),
          temperature:    req.temperature ?? 1.0,
          top_p:          req.topP,
          stream:         true,
        };
      } else {
        if (isOpenRouterHost(provDef.name)) {
          if (req.appUrl)  headers['HTTP-Referer'] = req.appUrl;
          if (req.traceId) headers['X-Request-ID'] = req.traceId;
          headers['X-Title'] = 'Vantrix AI Companion';
        }
        body = {
          model, messages: stripCacheBoundaryFromMessages(req.messages),
          max_tokens: Math.min(req.maxTokens, provDef.maxTokens), stream: true,
          // STREAM-TOKENS-FIX: without this, the SSE stream never carries a
          // usage object at all — see the parsing loop below and the note in
          // StreamChunk for the billing-accuracy consequence this had.
          stream_options: { include_usage: true },
        };
        // Paid entry only — see the identical, longer comment in
        // callOpenAICompat above for why 'openrouter-free' must never get
        // the paid models[] fallback chain attached.
        if (provDef.name === 'openrouter') body.models = buildOpenRouterFallbackChain(model);
      }
      if (req.temperature != null)      body.temperature = req.temperature;
      if (req.frequencyPenalty != null) body.frequency_penalty = req.frequencyPenalty;
      if (req.presencePenalty != null)  body.presence_penalty = req.presencePenalty;

      const res = await breaker.execute(() =>
        fetch(fetchUrl, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal })
      );

      if (!res.ok || !res.body) {
        clearTimeout(timer);
        throw new Error(`${providerName} stream ${res.status}`);
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buf     = '';

      // STREAM-TOKENS-FIX: accumulated across the loop below, then attached
      // to the final done:true chunk. Anthropic reports input_tokens on
      // message_start and a running output_tokens on message_delta (take
      // the latest, it's cumulative, not incremental). OpenAI-compatible
      // providers report both at once in the terminal usage-only chunk
      // (empty choices array) — only sent because of stream_options above.
      let capturedUsage: { promptTokens: number; completionTokens: number } | undefined;

      try {
        while (true) {
          // Bail immediately if client disconnected
          if (abortSignal?.aborted) break;

          const { done, value } = await reader.read();
          if (done) break;

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';

          for (const line of lines) {
            const stripped = line.replace(/^data:\s*/, '').trim();
            if (!stripped || stripped === '[DONE]') {
              if (stripped === '[DONE]') {
                // NO-DEAD-TURN FIX: a stream that content-filtered the whole
                // turn emits zero content deltas and just closes — same
                // failure mode as the non-streaming empty-completion case
                // above. Throw instead of yielding an empty done chunk so
                // the outer loop falls through to the next provider
                // (ultimately Grok) instead of rendering a blank chat turn.
                if (thisAttemptYieldedChars === 0) {
                  throw new Error(`${providerName}: empty stream (likely content-filtered)`);
                }
                recordStreamUsage(req, capturedUsage);
                yield { delta: '', done: true, provider: providerName, model, usage: capturedUsage };
                return;
              }
              continue;
            }

            try {
              const parsed = JSON.parse(stripped) as {
                choices?: { delta?: { text?: string; content?: string } }[];
                type?: string;
                delta?: { type?: string; text?: string };
                message?: { usage?: { input_tokens?: number } };
                usage?: {
                  input_tokens?: number; output_tokens?: number;
                  prompt_tokens?: number; completion_tokens?: number;
                };
                // Kaetah /v1/completions/stream — best-effort field names
                // mirroring its blocking response shape (text, prompt_tokens,
                // completion_tokens); NOT yet verified against a live server
                // response. If real output comes through empty/garbled once
                // KAETAH_ENABLED=true, check the actual field names the
                // server sends here first — this is the most likely mismatch.
                token?:  string;
                text?:   string;
                done?:   boolean;
                prompt_tokens?:     number;
                completion_tokens?: number;
              };

              // REROUTE: Anthropic is no longer in PROVIDERS, so
              // 'message_start'/'message_delta' never actually occur now —
              // harmless dead branches, left in place rather than risk
              // destabilizing this parser for a cosmetic cleanup.
              // Anthropic: input_tokens arrives once, up front.
              if (parsed.type === 'message_start' && parsed.message?.usage?.input_tokens != null) {
                capturedUsage = {
                  promptTokens:     parsed.message.usage.input_tokens,
                  completionTokens: capturedUsage?.completionTokens ?? 0,
                };
              }
              // Anthropic: output_tokens is cumulative — each message_delta
              // replaces (not adds to) the previous value.
              if (parsed.type === 'message_delta' && parsed.usage?.output_tokens != null) {
                capturedUsage = {
                  promptTokens:     capturedUsage?.promptTokens ?? 0,
                  completionTokens: parsed.usage.output_tokens,
                };
              }
              // OpenAI-compatible (Groq/OpenRouter/Together): terminal chunk
              // with stream_options.include_usage, choices is empty here.
              if (parsed.usage?.prompt_tokens != null || parsed.usage?.completion_tokens != null) {
                capturedUsage = {
                  promptTokens:     parsed.usage.prompt_tokens     ?? 0,
                  completionTokens: parsed.usage.completion_tokens ?? 0,
                };
              }
              // Kaetah: usage arrives on the terminal chunk (done: true),
              // using the same prompt_tokens/completion_tokens names as its
              // blocking response.
              if (provDef.promptAPI && (parsed.prompt_tokens != null || parsed.completion_tokens != null)) {
                capturedUsage = {
                  promptTokens:     parsed.prompt_tokens     ?? 0,
                  completionTokens: parsed.completion_tokens ?? 0,
                };
              }

              let delta = '';
              if (parsed.type === 'content_block_delta') {
                delta = parsed.delta?.text ?? '';
              } else if (parsed.choices?.[0]?.delta) {
                delta = parsed.choices[0].delta.text ?? parsed.choices[0].delta.content ?? '';
              } else if (provDef.promptAPI) {
                delta = parsed.token ?? parsed.text ?? '';
              }

              // Kaetah's terminal chunk may arrive as {done: true} with no
              // [DONE] sentinel line (unlike the OpenAI-compat convention
              // parsed above) — treat it the same way: end this attempt
              // cleanly rather than falling through to "malformed chunk".
              if (provDef.promptAPI && parsed.done) {
                if (thisAttemptYieldedChars === 0) {
                  throw new Error(`${providerName}: empty stream (likely content-filtered)`);
                }
                recordStreamUsage(req, capturedUsage);
                yield { delta: '', done: true, provider: providerName, model, usage: capturedUsage };
                return;
              }

              if (delta) {
                thisAttemptYieldedChars += delta.length;
                const chunk: StreamChunk = { delta, done: false, provider: providerName, model };
                if (isFirstChunkOfAttempt && priorProviderYieldedContent) {
                  chunk.reset = true;
                  chunk.abandonedTokens = abandonedTokensTotal;
                }
                isFirstChunkOfAttempt = false;
                yield chunk;
              }
            } catch { /* malformed chunk — skip */ }
          }
        }
      } finally {
        reader.cancel().catch(() => {});
        clearTimeout(timer);
      }

      // NO-DEAD-TURN FIX: see identical note at the [DONE] branch above —
      // this is the same check for streams that close without ever sending
      // an explicit [DONE] marker.
      if (thisAttemptYieldedChars === 0) {
        throw new Error(`${providerName}: empty stream (likely content-filtered)`);
      }

      yield {
        delta: '', done: true, provider: providerName, model, usage: capturedUsage,
        // Surface total abandoned spend on the terminal chunk too, in case a
        // consumer only reads usage/billing data from the done:true chunk
        // rather than tracking it per-delta.
        ...(abandonedTokensTotal > 0 ? { abandonedTokens: abandonedTokensTotal } : {}),
      };
      return;

    } catch (err: unknown) {
      // If this attempt produced visible output before failing, that's real
      // billed provider spend for content the user will never see once we
      // fall back — estimate it (providers don't send a token count on a
      // failed/aborted stream) and carry it forward so the NEXT successful
      // attempt's reset chunk reports it, rather than it vanishing silently.
      if (thisAttemptYieldedChars > 0) {
        abandonedTokensTotal    += Math.ceil(thisAttemptYieldedChars / 4);
        priorProviderYieldedContent = true;
      }
      if (err instanceof CircuitOpenError) continue;
      logger.warn(`[provider-router] stream fallback from ${providerName}`, { error: sanitizeProviderError(err) });
      continue;
    }
  }

  if (skippedUnconfigured.length > 0 && skippedUnconfigured.length === order.filter(n => PROVIDERS.find(p => p.name === n)?.streaming).length) {
    // Every streaming-capable provider in the chain was skipped for lack of
    // an API key — nothing was ever actually attempted. This is a
    // deployment/config problem, not providers being down.
    logger.error('[provider-router] No streaming AI provider configured for tier', {
      tier: req.modelTier, skipped: skippedUnconfigured,
    });
    if (req.modelTier === 'PEAK' && req.userId) {
      releasePeakReservation(req.userId).catch(err =>
        logger.warn('[provider-router] releasePeakReservation failed', { error: String(err) }));
    }
    throw new Error(
      `No AI provider is configured for this request (checked: ${skippedUnconfigured.join(', ')}). ` +
      `Set at least one provider API key in your environment.`
    );
  }

  // Every streaming provider failed without ever yielding a usable stream —
  // recordStreamUsage() above was never reached, so the PEAK reservation
  // from checkPeakBudget() was never settled. Release it here.
  if (req.modelTier === 'PEAK' && req.userId) {
    releasePeakReservation(req.userId).catch(err =>
      logger.warn('[provider-router] releasePeakReservation failed', { error: String(err) }));
  }
  throw new Error(`All streaming providers exhausted for tier ${req.modelTier}`);
}
