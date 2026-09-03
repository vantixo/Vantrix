# ─────────────────────────────────────────────────────────────────────────────
# Vantrix — Production Multi-Stage Dockerfile
#
# Three images:
#   deps     — production node_modules only (no devDeps)
#   builder  — full deps + compiled Next.js standalone output
#   runner   — minimal runtime image (Next.js server)
#
# A separate worker-runner image target (worker) is defined below.
# Build it with:  docker build --target worker -t vantrix-worker .
#
# DOCKER-01/CODE-02 FIX (superseding the old "compile worker-runner.ts to
# plain JS" approach, which never actually worked):
#   The previous version tried to precompile worker-runner.ts with a `tsc
#   --project ... <file>` command that is invalid TypeScript CLI syntax
#   (--project cannot be combined with an explicit source file), falling back
#   to `tsx --outDir ...`, which also doesn't work — tsx is a runtime loader,
#   not a compiler, and has no --outDir flag. Both failures were swallowed by
#   `|| true`, so dist/worker/ was silently never created and the worker
#   image's later COPY step failed outright.
#
#   Root cause ran deeper than the compile command: worker-runner.ts imports
#   `env` from `src/env.ts`, which pulled in Next's `server-only` package —
#   a guard that unconditionally throws unless the module loader has
#   webpack/Next's `react-server` export condition set. That condition only
#   exists inside Next's own build; a standalone `node`/`tsx` process (in
#   Docker or via `npm run worker` locally) never has it, so even a
#   successfully compiled worker-runner.js would have crashed immediately on
#   import. `src/env.ts` now uses a portable `typeof window` guard instead,
#   which protects against the same real risk (secrets in a browser bundle)
#   without depending on a bundler-only condition — see src/env.ts for detail.
#
#   With that fixed, worker-runner.ts runs correctly under plain tsx, so this
#   image now runs it directly instead of attempting to precompile it. tsx is
#   a real (non-dev) dependency for exactly this reason.
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Production dependencies ─────────────────────────────────────────
FROM node:24-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package*.json ./
# --omit=dev is the modern equivalent of --only=production.
# tsx is a real (non-dev) dependency — see note above — so it is included here.
RUN npm ci --omit=dev

# ── Stage 2: Build ────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder
WORKDIR /app

# Copy production deps from stage 1
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Install devDependencies on top for the build (eslint, vitest types etc.)
# This is a separate layer — it does NOT affect the final runner image.
RUN npm install --prefer-offline

ENV NEXT_TELEMETRY_DISABLED=1
ENV DOCKER_BUILD=true
ENV NODE_OPTIONS=--max-old-space-size=8192

RUN npm run build

# ── Stage 3: Next.js web server ───────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Non-root user
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

COPY --from=builder /app/public                         ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static     ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]

# ── Stage 4: Queue worker (separate image) ────────────────────────────────────
# Build: docker build --target worker -t vantrix-worker .
# Run:   docker run --env-file .env vantrix-worker
#
# Runs worker-runner.ts directly via tsx (a real dependency — see header
# note). No precompile step: TypeScript's own compiler can't cleanly emit
# this entrypoint to plain JS anyway, since its import graph reaches files
# well outside src/lib/queue (AI orchestration, moderation, payments, etc.),
# which breaks a single-rootDir tsc invocation. Running the source directly
# through tsx sidesteps that entirely and is what `npm run worker` already
# does successfully in dev — this just runs the same command in prod.
FROM node:24-alpine AS worker
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 vantrix

# Full production node_modules (includes tsx, now a real dependency)
COPY --from=deps  /app/node_modules    ./node_modules

# Worker needs the full src/ tree (its import graph reaches AI, payments,
# moderation, storage, etc. — not just src/lib/queue), plus tsconfig.json
# so tsx resolves the same path aliases (@/...) Next.js uses.
COPY --chown=vantrix:nodejs package.json    ./
COPY --chown=vantrix:nodejs tsconfig.json   ./
COPY --chown=vantrix:nodejs src             ./src

USER vantrix

# OPS-02 FIX: Real liveness check — exit 1 if heartbeat file is stale (>120s).
# worker-runner.ts writes /tmp/worker.heartbeat after each successful poll.
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s --retries=2 \
  CMD test -f /tmp/worker.heartbeat && \
      [ $(( $(date +%s) - $(stat -c %Y /tmp/worker.heartbeat) )) -lt 120 ] || exit 1

CMD ["npx", "tsx", "src/lib/queue/worker-runner.ts"]
