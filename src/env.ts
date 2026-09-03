/**
 * Environment variable validation — Zod schema.
 *
 * Dev mode: missing variables get safe placeholder defaults so the app boots
 * without all keys configured. Features that need the real values will fail
 * at runtime rather than at startup.
 *
 * Production: ALL required variables must be present. A missing variable
 * prints the exact field name and throws, preventing a broken deploy.
 *
 * DOCKER-01 FIX: This used to `import 'server-only'`, which unconditionally
 * throws unless the module loader has webpack/Next's `react-server` export
 * condition set. That condition only exists inside Next's own build/runtime
 * — it is never set for the standalone worker process (`worker-runner.ts`,
 * run directly via `node`/`tsx`, both in Docker and locally via `npm run
 * worker`), so importing `@/env` from the worker crashed immediately with
 * "This module cannot be imported from a Client Component module", even
 * though the worker is server-side Node code and was never at risk of being
 * bundled into the browser.
 *
 * The actual thing we're protecting against — this module (and the secrets
 * it resolves) ending up in a browser bundle — is fully covered by a
 * `typeof window` check: `window` is only ever defined in a real browser
 * environment, never under Next's server rendering, Next's Edge runtime, or
 * a plain Node/tsx process. This achieves the same guarantee as
 * `server-only` without depending on a bundler-specific resolution
 * condition, so it works identically inside Next AND in the standalone
 * worker process.
 */
if (typeof window !== 'undefined') {
  throw new Error(
    'src/env.ts must not be imported into client/browser code — it resolves ' +
      'server secrets. If you hit this from a "use client" component, move ' +
      'the env read to a Server Component, Route Handler, or server action.',
  );
}
import { z } from 'zod';
import { logger } from './lib/logger';


const isDev = process.env.NODE_ENV !== 'production';

// `next build` always forces NODE_ENV=production, even before real secrets
// are injected at deploy time. Treating the build phase like dev lets every
// `req*()` field below fall back to its placeholder default instead of
// failing validation — without this, `env` would resolve to `{}` during
// build and break anything that reads it (e.g. `new URL(...)` in
// generateSEOMeta). The strict throw further down still only skips when
// `!isDev`, so a genuinely missing var at real prod runtime still fails loudly.
const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';
const useDefaults = isDev || isBuildPhase;

// Helpers: in dev (and at build time), fall back to safe placeholders;
// at prod runtime, strictly required.
const req      = (fb = 'PLACEHOLDER')                    =>
  useDefaults ? z.string().min(1).default(fb)             : z.string().min(1);
const reqUrl   = (fb = 'https://placeholder.example.com') =>
  useDefaults ? z.string().url().default(fb)              : z.string().url();
const reqMin32 = (fb = 'placeholder-secret-32-chars-xxxx') =>
  useDefaults ? z.string().min(32).default(fb)            : z.string().min(32);

const envSchema = z.object({
  // ── Supabase ────────────────────────────────────────────────────────────────
  NEXT_PUBLIC_SUPABASE_URL:      reqUrl('https://placeholder.supabase.co'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: req('placeholder-anon-key'),
  SUPABASE_SERVICE_ROLE_KEY:     req('placeholder-service-role-key'),

  // ── App ─────────────────────────────────────────────────────────────────────
  // Default kept in sync with absoluteUrl()'s fallback in lib/utils.ts — see
  // that comment for why 127.0.0.1 (not 'localhost') avoids a Windows-
  // specific IPv6/IPv4 self-fetch failure in local dev.
  NEXT_PUBLIC_APP_URL: reqUrl('http://127.0.0.1:3000'),
  NEXT_PUBLIC_APP_VERSION: z.string().optional(),

  // ── AI ──────────────────────────────────────────────────────────────────────
  // REROUTE: OpenRouter is now the single unified LLM gateway (see
  // provider-router.ts). GROQ_API_KEY / ANTHROPIC_API_KEY / TOGETHER_API_KEY
  // removed — those providers were dropped from ROUTING_ORDER; the literal
  // model strings now live in model-router.ts's MODELS / ROLEPLAY_MODELS /
  // OPENROUTER_MODEL_PRIORITY, not here.
  OPENROUTER_API_KEY: req('sk-or-placeholder'),
  // Still used directly (not via provider-router.ts) by background AI
  // engines — backstory-engine.ts, core-beliefs.ts, self-esteem.ts,
  // memory.ts, identity-core.ts, purpose-engine.ts, digital-twin/engine.ts —
  // that call OpenRouter themselves for cheap, high-volume background work.
  // Default now points at DeepSeek V4 Flash (see model-router.ts MODELS).
  OPENROUTER_MODEL:   z.string().default('deepseek/deepseek-v4-flash'),
  // GROK_API_KEY is kept — still used by lib/grok/video-pipeline.ts (video
  // generation, unrelated to images or chat LLM routing). Image generation
  // no longer uses Grok — lib/grok/image-pipeline.ts was retired in favor of
  // HotAPI/Atlas (see lib/image/image-router.ts).
  GROK_API_KEY:       z.string().optional(),
  // ── Image generation (chat/companion portraits) ───────────────────────────
  // HotAPI: primary image-generation adapter (see lib/image/providers/hotapi.ts)
  HOTAPI_API_URL:     z.string().url().default('https://api.hotapi.ai'),
  HOTAPI_API_KEY:     z.string().optional(),
  // Atlas: backup image-generation adapter, used when HotAPI errors/times out
  // or is unconfigured (see lib/image/providers/atlas.ts)
  ATLAS_API_URL:      z.string().url().default('https://api.atlas.ai'),
  ATLAS_API_KEY:       z.string().optional(),
  // Video generation (content-engine + chat-triggered video) reuses the same
  // HotAPI/Atlas gateways and keys above — see lib/video/video-router.ts.
  // Kling direct is no longer used for this; the "living portrait"
  // auto-animation feature's separate fal.ai-wrapped Kling model
  // (src/lib/fal/animate-portrait.ts) is unaffected.
  // Daily cap on AI-generated content-engine calls (posts + cross-companion
  // comments combined) — see lib/ai/content-generator.ts. Keeps unattended
  // cron generation bounded even on Groq's free tier. Default: 400/day.
  CONTENT_ENGINE_DAILY_AI_CALLS: z.string().optional(),
  CURATOR_DAILY_AI_CALLS: z.string().optional(),
  // URL of the Python brain service (services/brain) — semantic memory
  // reranking. Optional: semantic-memory.ts fails open (no reranking, same
  // behavior as today) if unset. e.g. http://brain:8000 in Docker Compose,
  // or a deployed URL (Fly.io/Railway/your own host).
  BRAIN_SERVICE_URL:  z.string().url().optional(),
  // AUTH-FIX: services/brain/main.py previously had no authentication on
  // /embed or /rerank — anyone who could reach BRAIN_SERVICE_URL could send
  // arbitrary text/candidate batches and consume CPU (DoS) with no
  // credential required. If set, this key is sent as a Bearer token on
  // every request and the service rejects requests without a matching key.
  // Optional so local/Docker-network-only deployments (where the service
  // isn't reachable from outside the VPC at all) aren't forced to set it,
  // but strongly recommended for any deployment reachable from the public
  // internet — see services/brain/README.md.
  BRAIN_SERVICE_API_KEY: z.string().optional(),
  // Self-hosted Kaetah-2B inference server (see inference/api_server.py in
  // the kaetah repo). Optional and OFF by default — provider-router.ts only
  // adds 'kaetah' to a routing chain when KAETAH_ENABLED='true', so setting
  // just the URL/key here does not change production traffic. Flip
  // KAETAH_ENABLED once there's an actual trained checkpoint being served
  // at this URL; until then this is scaffolding only. Point this at an
  // internal/VPC address, not a public one — the inference server has no
  // built-in auth beyond the bearer key below.
  KAETAH_API_URL:     z.string().url().optional(),
  KAETAH_API_KEY:     z.string().optional(),
  KAETAH_ENABLED:     z.enum(['true', 'false']).default('false'),
  // Terminal last-resort fallback in provider-router.ts's ROUTING_ORDER —
  // routes to OpenRouter's own free-model auto-router (openrouter/free)
  // ONLY after the primary OpenRouter (paid) attempt AND Kaetah have both
  // failed. Reuses OPENROUTER_API_KEY above, not a separate credential.
  // Defaults on since it's free and only ever fires when everything else is
  // already down. Consider setting to 'false' if that tradeoff is wrong for
  // this deployment: which specific model answers is non-deterministic
  // (OpenRouter picks at random from whatever free models are live that
  // week), and some individual free models' providers train on free-tier
  // input/output — see openrouter.ai/docs/guides/routing/routers/free-router
  // and each model's own listing for its data-use terms before relying on
  // this for conversations you don't want a third party training on.
  OPENROUTER_FREE_FALLBACK_ENABLED: z.enum(['true', 'false']).default('true'),
  // Separate, higher-level flag from KAETAH_ENABLED above. KAETAH_ENABLED
  // only lets Kaetah serve as a last-resort *compute* fallback inside
  // provider-router.ts. KAETAH_BRAIN_ENABLED is the future full-orchestration
  // switch (see lib/ai/kaetah-brain.ts) — must stay 'false' until that file's
  // implementation is finished; today it deliberately throws if flipped on.
  KAETAH_BRAIN_ENABLED: z.enum(['true', 'false']).default('false'),

  // ── Payments (optional in dev, required in prod) ─────────────────────────
  STRIPE_SECRET_KEY:      req('sk_test_placeholder'),
  STRIPE_WEBHOOK_SECRET:  req('whsec_placeholder'),
  // NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY — only needed if adding Stripe.js Elements
  // on the client. Currently all Stripe flows are server-side (checkout.sessions.create).
  // Add back here if/when client-side payment elements are introduced.
  PAYSTACK_SECRET_KEY:    req('sk_test_placeholder'),
  // NOTE: Paystack uses the same key for API calls AND HMAC webhook verification.
  // PAYSTACK_WEBHOOK_SECRET would be a separate secret, but Paystack does not
  // provide one — their docs explicitly use PAYSTACK_SECRET_KEY for both.

  // ── Paystack recurring billing (Plan codes) ───────────────────────────────
  // Required for true Paystack-managed subscriptions (auto-renewal). Create
  // each Plan in the Paystack Dashboard (or via POST /plan) with the matching
  // NGN amount and a monthly interval, then paste its PLN_xxx code here.
  // Optional individually: a tier with no plan code configured falls back to
  // the old one-off-charge behavior (manual renewal required) rather than
  // failing — see initializePaystackTransaction() call site for the fallback.
  PAYSTACK_PLAN_CODE_SPARK:   z.string().optional(),

  // Annual cadence — separate Paystack plans (interval: annually), created
  // in the Dashboard. Optional, same soft-degradation behavior as the
  // monthly codes above: a tier with no annual code configured simply
  // can't offer annual billing yet.
  PAYSTACK_PLAN_CODE_SPARK_ANNUAL:    z.string().optional(),
  PAYSTACK_PLAN_CODE_SPARK_QUARTERLY: z.string().optional(),

  NOWPAYMENTS_API_KEY:    req('nowpayments_placeholder'),
  NOWPAYMENTS_IPN_SECRET: req('nowpayments_ipn_placeholder'),

  // ── Paddle Billing (card/MoR rail #2 — international subscriptions) ──────
  // Paddle acts as Merchant of Record: it is the seller of record, handles
  // VAT/sales-tax collection and remittance across 200+ markets, and
  // presents in the buyer's local currency — the reason to offer it
  // alongside Stripe for international subscribers rather than instead of.
  // Sandbox vs live use entirely separate API keys/webhook secrets/price
  // IDs — see PADDLE_ENVIRONMENT below.
  PADDLE_API_KEY:         req('pdl_test_placeholder'),
  PADDLE_WEBHOOK_SECRET:  req('pdl_ntfset_placeholder'),
  PADDLE_ENVIRONMENT:     useDefaults ? z.enum(['sandbox', 'production']).default('sandbox')
                                       : z.enum(['sandbox', 'production']),

  // Tier+interval -> Paddle Price ID (pri_xxx), same shape as the Paystack
  // plan-code env vars above. Created per-Paddle-account via the Dashboard
  // (Catalog -> Prices) — this codebase cannot invent them. A tier/interval
  // with no configured price id simply has no Paddle checkout support yet
  // (see paddle-plans.ts) — soft degradation, not a hard failure.
  PADDLE_PRICE_ID_PREMIUM_MONTHLY:   z.string().optional(),
  PADDLE_PRICE_ID_PREMIUM_QUARTERLY: z.string().optional(),
  PADDLE_PRICE_ID_PREMIUM_ANNUAL:    z.string().optional(),

  // Token-pack id -> Paddle Price ID, same soft-degradation contract as the
  // subscription price ids above. Unlike Stripe (createTokenPackCheckoutSession
  // builds an ad-hoc price at checkout time), Paddle transactions require a
  // pre-existing Price object — one per pack, created in the Dashboard
  // (Catalog -> Prices) against a one-time (non-recurring) Product. A pack
  // with no configured id here simply has no Paddle checkout option yet
  // (see paddle-plans.ts's priceIdForTokenPack()).
  PADDLE_PRICE_ID_TOKENS_100:  z.string().optional(),
  PADDLE_PRICE_ID_TOKENS_550:  z.string().optional(),
  PADDLE_PRICE_ID_TOKENS_1200: z.string().optional(),
  PADDLE_PRICE_ID_TOKENS_2500: z.string().optional(),
  PADDLE_PRICE_ID_TOKENS_7000: z.string().optional(),

  // ── Redis ───────────────────────────────────────────────────────────────────
  UPSTASH_REDIS_REST_URL:   reqUrl('https://placeholder.upstash.io'),
  UPSTASH_REDIS_REST_TOKEN: req('placeholder-redis-token'),

  // ── Security secrets ────────────────────────────────────────────────────────
  ADMIN_SECRET_TOKEN: reqMin32(),
  WORKER_SECRET:      reqMin32(),
  CRON_SECRET:        reqMin32(),
  // Mirrors the build-time CRON_TIER read directly via process.env in
  // scripts/generate-vercel-json.mjs (that script runs before this module
  // exists, so it can't import from here) — this is the SAME env var,
  // exposed at request runtime too so cron routes whose real duration
  // budget exceeds Hobby's 60s ceiling (currently only
  // content-engine-video — see config/cron-jobs.mjs's fitsFreeTier()) can
  // self-skip defensively if ever hit directly while still on CRON_TIER=free,
  // rather than submit a paid API call that the platform will kill mid-run
  // regardless of what invoked it. Default 'free' matches the generator's
  // default and errs toward the safe (skip) side if unset.
  CRON_TIER: z.enum(['free', 'pro']).default('free'),
  // WIRE-FIX: this was read directly via `process.env.IP_HASH_SALT ?? "vantrix-salt"`
  // in the waitlist route, bypassing this schema entirely. That hardcoded
  // fallback is committed in this exact source tree — anyone with a copy
  // of the codebase (as of this audit: two people, both Anthropic) knows
  // it, which makes it useless as a salt: the "hashed" IPs in the waitlist
  // table are one small precomputed rainbow table away from being plain
  // IPs again. Required in production like the other operational secrets
  // above; dev gets a placeholder.
  IP_HASH_SALT:        reqMin32(),

  // ── Fal.ai (C-03: previously missing — caused silent undefined credentials) ─
  // Intentionally OPTIONAL, same rationale as R2 above: this backs the LoRA
  // training / portrait generation feature only. src/env.ts is imported at
  // module scope by src/app/layout.tsx (every route), so making this
  // hard-required blocked the entire app — not just image generation — on
  // a fresh deploy or local box without a Fal.ai account yet. The LoRA
  // pipeline itself still fails loudly with a clear "not configured" error
  // when actually invoked without a key.
  FAL_KEY: z.string().optional(),
  // SEC-FIX (2026-07-13): FAL_WEBHOOK_SECRET removed. Fal.ai signs webhooks
  // with Ed25519 verified against their public JWKS (see
  // src/app/api/webhooks/fal-lora/route.ts) — there is no shared secret to
  // configure on Fal's side, so requiring one here just blocked every
  // production boot on a value that was never obtainable from Fal in the
  // first place.

  // ── Cloudflare R2 (S3-compatible — requires AWS SigV4, NOT a bearer token) ──
  // R2_API_TOKEN (a single bearer token) was previously sent as
  // `Authorization: Bearer ...` against the S3-compatible endpoint
  // (https://{account}.r2.cloudflarestorage.com) — that endpoint requires
  // AWS SigV4-signed requests, the same as any other S3-compatible API. A
  // bearer token there returns 401/403 regardless of how valid the token is.
  // Use the Access Key ID / Secret Access Key pair from R2's "API Tokens" ->
  // S3 credentials page instead — see src/lib/fal/lora-pipeline.ts uploadToR2().
  //
  // Intentionally OPTIONAL: R2 backs one feature (permanent image storage
  // for Fal-generated/admin-uploaded media), not the whole app. src/env.ts
  // is imported at module scope by src/app/layout.tsx, which wraps every
  // route — making these `req()` (hard-required) meant a fresh deploy or
  // local dev box with no R2 account yet couldn't render ANY page, not just
  // the upload feature. getR2Client() in src/lib/storage/r2.ts now throws a
  // clear "R2 not configured" error at the point of use instead.
  R2_ACCOUNT_ID:        z.string().optional(),
  R2_BUCKET_NAME:       z.string().optional(),
  R2_ACCESS_KEY_ID:     z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_PUBLIC_URL:        z.string().url().optional(),
  // AVATAR-REVERT-FIX: public mirror of R2_PUBLIC_URL — same value, not a
  // secret (it's the public CDN URL images are already served from). Exists
  // solely so NEXT_PUBLIC_-inlining makes it readable from "use client"
  // components. src/lib/utils.ts's isAllowedImageHost() is what actually
  // needs this: without a client-visible copy, every client-side render
  // path (avatar upload, message images, swipe cards, etc.) couldn't
  // recognize an R2-hosted URL as trusted and silently fell back to the
  // placeholder image — see that function's own comment for the full story.
  // Deliberately NOT read through this `env` module at the actual call
  // site (lib/utils.ts explicitly avoids importing `@/env` — see that
  // file's header comment — since this module throws if pulled into a
  // client bundle); listed here only so it's validated/documented/typed
  // alongside every other env var, the same way NEXT_PUBLIC_SENTRY_DSN is.
  NEXT_PUBLIC_R2_PUBLIC_URL: z.string().url().optional(),

  // ── Voice ──────────────────────────────────────────────────────────────────
  // ElevenLabs: premium per-character voice with emotional tone adaptation.
  // VOICE-FIX (2026-09-01): previously `.optional()` — a missing key in
  // production didn't fail the build, it silently routed EVERY character's
  // voice through the Web Speech fallback (one shared browser voice for the
  // whole app) with no error surfaced anywhere. That's the exact bug this
  // fixes: premium voice is now a hard-required production var, same as the
  // other operational secrets above — a deploy with no ElevenLabs key now
  // fails loudly at boot instead of quietly shipping degraded voice to 100%
  // of users. Dev/build still get a placeholder via req()'s useDefaults path.
  ELEVENLABS_API_KEY: req('placeholder-elevenlabs-key'),
  NEXT_PUBLIC_SENTRY_DSN:  z.string().url().optional(),
  SENTRY_AUTH_TOKEN:       z.string().optional(),
  // Org/project slugs for withSentryConfig's source-map upload step. Optional
  // here (the Sentry webpack plugin auto-reads these same env var names if
  // omitted from config) — validating them means a missing value fails loud
  // at build time instead of silently skipping source-map upload.
  SENTRY_ORG:              z.string().optional(),
  SENTRY_PROJECT:          z.string().optional(),
  // Phase A gap-fix: fraction (0–1) of logger.error() calls forwarded to
  // Sentry as captureMessage events in production. Defaults to 0.1 (10%)
  // in src/lib/logger.ts if unset — kept optional here so omitting it is
  // never a deploy blocker, matching every other Sentry var above.
  SENTRY_ERROR_LOG_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
  ANOMALY_WEBHOOK_URL:     z.string().url().optional(),
  TRACING_ENDPOINT:        z.string().url().optional(),

  // Feature flags (src/lib/flags) — connection string for a linked Vercel
  // Edge Config store. Injected automatically by Vercel once a store is
  // linked to the project; unset locally/in CI is expected and fine — the
  // flags module falls back to each flag's hardcoded default.
  EDGE_CONFIG: z.string().optional(),

  // Product analytics (src/lib/analytics) — PostHog. Same key is used
  // client-side (posthog-js) and server-side (posthog-node); NEXT_PUBLIC_
  // prefix is required for the client build to inline it, and the server
  // client reads the same public var rather than a separate secret because
  // a PostHog project API key is designed to be exposed client-side.
  // Unset locally/in CI is expected — both analytics clients no-op.
  NEXT_PUBLIC_POSTHOG_KEY:  z.string().optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.string().url().default('https://us.i.posthog.com'),
  // METRICS_SECRET: if set, the /api/metrics endpoint requires Bearer auth.
  // In production without this set, the metrics endpoint self-disables (returns 503).
  METRICS_SECRET:          z.string().min(16).optional(),

  // ── Email (Resend) — contact form server action ───────────────────────
  // Optional: without a key, the contact form logs submissions server-side
  // instead of emailing them (safe fallback for local dev / fresh deploys).
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM:    z.string().email().optional(),
  RESEND_TO:      z.string().email().optional(),

  // ── Platform cost controls ──────────────────────────────────────────────────
  PLATFORM_HOURLY_TOKEN_BUDGET:  z.coerce.number().int().positive().default(10_000_000),
  PLATFORM_BUDGET_REDUCTION_PCT: z.coerce.number().int().min(10).max(90).default(50),
  WORKER_BATCH_SIZE:             z.coerce.number().int().positive().default(5),
  // System-wide ceiling on billable fal.ai portrait-animation submits per
  // UTC day, across every trigger path combined (creation, import, admin
  // backfill, cron backfill). checkDailyVideoCap (rate-limit/index.ts) only
  // covers the ONE user-facing manual-regenerate route — it has no visibility
  // into or effect on the other four call sites of triggerAnimationAsync,
  // none of which are per-user rate-limited (bulk import and admin backfill
  // in particular can each submit many jobs in one request with zero cap).
  // This is the platform-wide backstop sitting at the actual submission
  // chokepoint in animate-portrait.ts, so no current or future call site can
  // bypass it. Kling video is the single most expensive per-call action in
  // the app (see checkDailyVideoCap's own comment) — default is deliberately
  // conservative; raise via env once real usage data justifies it.
  PLATFORM_DAILY_VIDEO_BUDGET:   z.coerce.number().int().positive().default(500),
  // Same fail-closed platform-wide backstop as PLATFORM_DAILY_VIDEO_BUDGET,
  // for image-to-3D generation (lib/fal/character-3d-model.ts,
  // fal-ai/hunyuan3d/v2 — $0.16/generation white mesh, $0.48 textured; this
  // pipeline requests textured_mesh: true, so budget in textured-cost
  // terms). Default kept conservative — this is a one-time backfill per
  // character (unlike video, which can be re-triggered on every portrait
  // regenerate), so a lower daily cap is fine and 100 * $0.48 = $48/day
  // worst case is a sane starting ceiling to raise once real usage data
  // justifies it.
  PLATFORM_DAILY_3D_MODEL_BUDGET: z.coerce.number().int().positive().default(100),
  // Max messages a guest (unauthenticated) user can send before seeing the paywall.
  // 7 — the middle of the 5-10 range the guest-to-signup flow is designed
  // around (lets the character build enough rapport to make signing up feel
  // worth it, without giving away the whole experience for free).
  // BUG FIX: this default had drifted to 0, which silently killed the guest
  // funnel entirely — sessionMsgNum starts at 1 on the very first message,
  // so `sessionMsgNum > GUEST_MESSAGE_LIMIT` was true immediately and every
  // guest hit the paywall before a single reply (see
  // src/app/api/chat/guest/route.ts). Every other reference to this value
  // in the codebase (guest-chat-widget.tsx, guest/route.ts's own docstring,
  // claim-guest-transcript/route.ts) already assumed 7 — only this schema
  // default and one stale comment in tiers/limits.ts had regressed to 0.
  // min(0) is kept so an explicit env override can still disable the guest
  // funnel intentionally; it just can't happen by silent default anymore.
  GUEST_MESSAGE_LIMIT:           z.coerce.number().int().min(0).max(20).default(7),
  // Concurrent jobs per worker process (defaults to 1 for safety; raise on beefy instances)
  WORKER_CONCURRENCY:            z.coerce.number().int().min(1).max(20).default(1),

  // ── Web Push (VAPID) ──────────────────────────────────────────────────────
  // Real OS/browser push notifications for nudges, character initiatives,
  // and surprise moments — delivered even when the user isn't actively
  // connected to the in-app SSE stream. See src/lib/push/send-push.ts.
  // NEXT_PUBLIC_VAPID_PUBLIC_KEY is inlined into the client bundle (it's
  // public by design — it's what PushManager.subscribe() sends to the
  // push service) and MUST be the public half of the same keypair as
  // VAPID_PRIVATE_KEY below, or every subscribe() will silently produce
  // a subscription the server can never successfully sign for.
  // Generate a pair with: `npx web-push generate-vapid-keys`.
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY:            z.string().optional(),
  // mailto: contact required by the Web Push protocol so push services can
  // reach the sender if a key is being abused. Not otherwise used.
  VAPID_SUBJECT: z.string().default('mailto:support@vantrix.ink'),
});

// Treat blank env vars as absent, not as invalid values.
// `KEY=` in a .env file (or an unset Vercel/Docker secret) sets process.env.KEY
// to '' — a *defined* empty string, never `undefined`. `.optional()` only
// skips validation for `undefined`, so an empty string still has to satisfy
// the rest of the rule (e.g. `.url()`), which it can't. One blank optional
// field — NEXT_PUBLIC_SENTRY_DSN left unset is the documented default in
// .env.example — was enough to fail safeParse() entirely, collapsing `env`
// to `{}` below and silently nulling out unrelated required fields like
// NEXT_PUBLIC_APP_URL across the whole app. Normalizing '' → undefined first
// lets `.optional()` work as intended without weakening required-field checks.
const cleanedEnv = Object.fromEntries(
  Object.entries(process.env).map(([key, value]) => [key, value === '' ? undefined : value]),
);

const parsed = envSchema.safeParse(cleanedEnv);

// Never throw during Next.js build phase — routes are statically analyzed
// without real env vars. Only throw at server startup / runtime.
// (isBuildPhase is already computed above, alongside useDefaults.)

let resolvedEnv: z.infer<typeof envSchema>;

if (parsed.success) {
  resolvedEnv = parsed.data;
} else if (!isBuildPhase) {
  const errors = parsed.error.flatten().fieldErrors;
  // LOG-SPAM FIX: this module throws below when !isDev, which means Node
  // never caches it as successfully loaded — every subsequent import of
  // @/env (i.e. almost every request, since most routes touch it
  // transitively) re-runs this entire file from scratch, re-parsing env
  // and re-logging this exact error every single time. In production
  // that turned one missing var (e.g. STRIPE_WEBHOOK_SECRET) into
  // hundreds of identical log lines per second rather than one clear
  // error. globalThis (not module-scoped state) survives the re-import,
  // so it's the only place a "have we already logged this" flag works.
  const g = globalThis as { __vantrixEnvErrorLogged?: boolean };
  if (!g.__vantrixEnvErrorLogged) {
    g.__vantrixEnvErrorLogged = true;
    logger.error('Invalid environment variables', { errors });
  }
  if (!isDev) {
    throw new Error('Invalid environment variables — see above for details.');
  }
  logger.warn('env: running with placeholder vars in dev — some features will not work');
  // Dev fallback: drop only the offending keys so every other field keeps
  // its real/parsed value and only the bad ones fall back to schema
  // defaults, instead of collapsing the entire env to {}.
  const badKeys = Object.keys(parsed.error.flatten().fieldErrors);
  const sanitizedEnv = { ...cleanedEnv };
  for (const key of badKeys) delete sanitizedEnv[key];
  const retry = envSchema.safeParse(sanitizedEnv);
  resolvedEnv = retry.success ? retry.data : ({} as z.infer<typeof envSchema>);
} else {
  logger.warn('env: building with missing vars — OK for CI/CD, ensure all vars are set before production');
  // Build fallback: same as above — drop only the fields that failed
  // validation (typically placeholder/unset URLs, enums, numbers) so every
  // other field — including required ones like NEXT_PUBLIC_APP_URL — keeps
  // its actual value or a sane default, rather than the whole `env` object
  // resolving to `{}` and breaking anything that does e.g. `new URL(...)`
  // during static page-data collection.
  const badKeys = Object.keys(parsed.error.flatten().fieldErrors);
  const sanitizedEnv = { ...cleanedEnv };
  for (const key of badKeys) delete sanitizedEnv[key];
  const retry = envSchema.safeParse(sanitizedEnv);
  resolvedEnv = retry.success ? retry.data : ({} as z.infer<typeof envSchema>);
}

export const env = resolvedEnv;
