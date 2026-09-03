/** @type {import('next').NextConfig} */
const { withSentryConfig } = require('@sentry/nextjs');
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

// CORS is handled dynamically in middleware.ts.
// Static headers here are kept for non-API routes only.

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Never ship source maps to the client in prod — they'd expose original
  // TypeScript source (including inline comments referencing internal
  // security/pricing reasoning) to anyone who opens devtools.
  productionBrowserSourceMaps: false,
  // RESTORED-THEN-RECONSIDERED (image-studio audit, 2026-08-14): tried
  // ignoreBuildErrors/ignoreDuringBuilds: false so `next build` itself
  // fails closed on real errors. That's correct in principle, but `next
  // build` runs full-program type-checking through its webpack/SWC loader
  // in the SAME process as bundling — on this build host it pushed peak
  // heap past the limit (OOM, `next build` aborted) and is meaningfully
  // slower even when it fits in memory, since type-checking and bundling
  // no longer overlap/short-circuit.
  //
  // Kept ignoreBuildErrors/ignoreDuringBuilds true here — `next build`
  // stays fast and lean — but the safety net these were supposed to
  // provide now lives in the "prebuild" script below (see package.json),
  // which runs `tsc --noEmit` + `next lint` as their own standalone
  // processes and hard-fails (non-zero exit) before `next build` is even
  // invoked. npm/most CI runners execute `prebuild` automatically ahead of
  // `build` — confirm your deploy pipeline actually calls `npm run build`
  // (not `next build` directly), or `prebuild` will be silently skipped
  // and you're back to the original gap.
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Constrained build host: cap parallel workers to reduce peak memory.
    cpus: 1,
    workerThreads: false,
    serverActions: {
      bodySizeLimit: "2mb",
    },
    // PERF (2026-08-26, whole-app pass): these packages are used via
    // named imports already (import { X } from "lucide-react", etc.),
    // which is tree-shakeable in principle — but Next's own bundler
    // still has to evaluate each package's full barrel file per route to
    // figure out what's actually reachable. optimizePackageImports skips
    // that by rewriting the import to pull directly from each package's
    // internal per-module path, so a route using 3 lucide-react icons
    // only ever bundles those 3, not the barrel-evaluation overhead of
    // the other 1400+. lucide-react (used in nearly every component),
    // date-fns, framer-motion, and recharts are this app's four heaviest
    // barrel-style dependencies with per-route icon/util/chart usage —
    // exactly the shape this optimization targets.
    // BUILD-OPT (2026-09-03): @react-three/drei is one of the largest
    // barrel exports in the dependency tree (100+ named helpers spanning
    // loaders, controls, and postprocessing) — its only two call sites
    // (character-3d.tsx, character-avatar-3d.tsx) each pull just 2-4 of
    // them, so this saves the same per-route barrel-evaluation cost the
    // comment above already describes for the other four packages.
    optimizePackageImports: ["lucide-react", "date-fns", "framer-motion", "recharts", "@react-three/drei"],
  },
  // PERF (2026-08-26, whole-app pass): these are real Node-only
  // dependencies (native bindings, Node crypto/fs, or just large and
  // meant to run server-side only) that should never be bundled into a
  // client or Edge chunk. Every current import site is already
  // server-only (API routes, Server Components, lib files that in turn
  // import "server-only") so this shouldn't change what runs where — it
  // tells Next's bundler not to even attempt to trace/bundle these,
  // which speeds up the build and guarantees a client bundle can't
  // accidentally pull one in later without an immediate build error
  // instead of a silent bundle-size regression.
  serverExternalPackages: [
    "sharp",
    "@aws-sdk/client-s3",
    "stripe",
    "resend",
    "web-push",
    "@fal-ai/client",
    // BUILD-OPT (2026-09-03): posthog-node is the same shape as the six
    // packages above — a real Node-only dependency (its own HTTP client,
    // no browser build) already guarded by `import "server-only"` in
    // src/lib/analytics/server.ts, so it can never leak into a client
    // chunk, but it was still missing from this list — meaning webpack
    // traced and bundled its full source into every server/RSC chunk
    // that imports it instead of treating it as an external require the
    // way it does for stripe/resend/web-push. Adding it here doesn't
    // change what runs where (same server-only call sites), just stops
    // paying to bundle it.
    "posthog-node",
  ],
  // Compress responses
  compress: true,
  // PWA-style fast navigation
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "cdn.vantrix.ink" },
      // Seeded promo ads (see 20260928_seed_hero_promo_ads.sql /
      // 20260930b_seed_additional_promo_ads.sql) originally referenced the
      // bare apex domain, not the `cdn.` subdomain — only the latter was
      // allowlisted, so next/image rejected every ad creative and the
      // AdBoard silently rendered nothing. The DB rows are now fixed to
      // use local /promos/ paths (20260941_fix_ad_image_urls.sql), but the
      // apex domain is kept here too as a safety net for any future ad
      // that legitimately points at it.
      { protocol: "https", hostname: "vantrix.ink" },
      { protocol: "https", hostname: "ui-avatars.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "*.supabase.co", pathname: "/**" },
      { protocol: "https", hostname: "*.supabase.in" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "cdn.discordapp.com" },
      // FAL-IMAGES-FIX: Fal.ai media hosts (source generations, LoRA
      // training outputs, living-portrait webhook payloads — see the same
      // three hosts trusted in api/webhooks/fal-lora/route.ts's
      // ALLOWED_LORA_HOSTS) were never added here even though character
      // rows and generate-batch results can transiently reference them
      // before/without being mirrored to R2. next/image hard-throws
      // ("hostname is not configured under images in next.config.js") on
      // any src whose host isn't listed — an uncaught render-time error,
      // not a warning — which is exactly what trips the (main)/error.tsx
      // boundary ("Page error") on /studio when a character's image_url
      // or a generated result lands on one of these hosts.
      { protocol: "https", hostname: "fal.media" },
      { protocol: "https", hostname: "v3.fal.media" },
      { protocol: "https", hostname: "fal-cdn.com" },
      // IMAGES-NOT-RENDERING FIX: every generated character photo now
      // uploads to R2 (uploadToR2() in lib/fal/lora-pipeline.ts) — Pollinations
      // was fully removed. next/image only fetches hostnames listed here; the
      // R2 public host was already added to the *separate* SSRF-validation
      // allowlist in api/characters/route.ts, but never here, so every R2
      // image silently failed to render ("hostname is not configured under
      // images in next.config.js"). R2_PUBLIC_URL is a custom domain set
      // per-deployment (see .env.example), so it's read from the environment
      // at build/start time rather than hardcoded — this file runs in Node,
      // not the browser bundle, so reading process.env directly here is safe.
      ...(() => {
        try {
          const url = new URL(process.env.R2_PUBLIC_URL || "");
          return [{ protocol: url.protocol.replace(":", ""), hostname: url.hostname }];
        } catch {
          // R2_PUBLIC_URL not set/invalid at build time (e.g. local dev
          // without R2 configured) — nothing to add, rest of the list
          // still works.
          return [];
        }
      })(),
    ],
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 86400,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      // HSTS-REMOVED (2026-08-16): this block used to send
      // Strict-Transport-Security here (with a host-based exclusion for
      // localhost/127.0.0.1/0.0.0.0/[::1]). Removed outright, along with
      // its counterpart in middleware.ts — excluding localhost only stops
      // the header going out *going forward*; it can't clear an HSTS
      // policy a browser already cached from an earlier `next start` run,
      // since HSTS blocks the very plain-HTTP response that would be
      // needed to un-cache it. That cost real debugging time twice, so the
      // mechanism is gone rather than re-fenced. Add TLS-stripping
      // protection at the edge/proxy (Vercel, Cloudflare) for the real
      // production domain instead, where it can't leak onto local testing.
      {
        // Generous cache on static assets
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // Service worker must never be cached long-term, or browsers won't
        // pick up new versions and the PWA update flow breaks silently.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        // Generated PNG icon set — content doesn't change without a deploy,
        // safe to cache aggressively.
        source: "/icons/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // Web app manifest — must revalidate reasonably often (unlike
        // content-hashed /_next/static assets) since theme_color, icons, or
        // shortcuts can change on a normal deploy without a filename change.
        source: "/manifest.webmanifest",
        headers: [
          { key: "Cache-Control", value: "public, max-age=3600, must-revalidate" },
          { key: "Content-Type", value: "application/manifest+json" },
        ],
      },
    ];
  },
  // Redirects are managed centrally in vercel.json for this deployment.
  // Output standalone for Docker deployments
  output: process.env.DOCKER_BUILD === "true" ? "standalone" : undefined,
  // logger.ts uses Node's AsyncLocalStorage (async_hooks) for request-context
  // propagation on the server. It is imported transitively by some client
  // components (via src/lib/image/in-chat-image.ts); without this fallback,
  // the client webpack build fails with "Module not found: Can't resolve
  // 'async_hooks'". The module is never invoked in the browser because all
  // call sites are guarded for the server runtime.
  webpack: (config, { isServer }) => {
    // ── Edge Runtime: suppress known-safe false-positive warnings ─────────────
    // @supabase/supabase-js references process.version inside a try/catch for
    // SDK version detection in error messages only.  The actual Edge code path
    // never executes the check; it is dead-code-eliminated at runtime.  The
    // @upstash/redis/cloudflare import in edge.ts already routes around the
    // Node.js bundle, but the webpack scanner may still surface a stale cache
    // entry — this guard ensures the warning stays suppressed in both cases.
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      { module: /node_modules\/@supabase\/supabase-js/ },
      { module: /node_modules\/@upstash\/redis\/nodejs\.mjs/ },
    ];

    if (!isServer) {
      // logger.ts uses AsyncLocalStorage (async_hooks) for server-side
      // request-context propagation.  It is transitively imported by some
      // client components; the fallback prevents a client-bundle build error
      // because async_hooks is never invoked in the browser.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        async_hooks: false,
      };
    }
    return config;
  },
};

// Wrap with Sentry — only activates when NEXT_PUBLIC_SENTRY_DSN is set.
// In CI / local dev without a DSN, this is a transparent no-op.
module.exports = withSentryConfig(withBundleAnalyzer(nextConfig), {
  // Explicit rather than relying on the plugin's implicit env var pickup —
  // a missing SENTRY_ORG/SENTRY_PROJECT now shows up clearly instead of
  // silently skipping source-map upload.
  org:     process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Suppress Sentry CLI output in CI logs
  silent: true,

  // Upload source maps to Sentry for production stack traces.
  // Requires SENTRY_AUTH_TOKEN set in Vercel / CI environment.
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  hideSourceMaps: true,

  // Tree-shake Sentry debug statements out of the production bundle.
  // NOTE: 'treeshake' is not a valid @sentry/nextjs config key — the correct
  // option is bundleSizeOptimizations.
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    excludeReplayShadowDom: true,
    excludeReplayIframe:    true,
  },
});
