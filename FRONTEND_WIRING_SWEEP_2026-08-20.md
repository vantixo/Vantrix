# Frontend Wiring Sweep — non-admin/cron/webhook API routes

Follow-up to AUDIT_FINDINGS_LOG.md's Phase 4 disclosure ("targeted
high-signal sweeps on ~117 non-cron/admin routes, not a full line-by-line
pass"). Static string-search of every route path against src/app + src/
components + src/hooks, then manual verification of every zero-hit result
(a literal-string miss doesn't prove a route is unwired — several are
called through a shared hook's template literal instead).

## Correction (post-build verification)

The original version of this document claimed the entire `/universe/*`
system had zero frontend pages. **That was wrong** — caught by running
`next build` and seeing `/world`, `/world/factions/[slug]`, and
`/world/locations/[slug]` in the route output. My original search only
looked for a directory literally named `*universe*`; the actual page
lives under `/world` instead (a naming mismatch between the API's path
segment and the app's user-facing route), which a filename-pattern grep
silently missed. `getWorldHub()`/`getWorldFaction()`/`getWorldLocation()`
in `src/lib/frontend/world.ts` call `lib/universe/world-atlas.ts`'s
functions directly rather than going back over HTTP through
`/api/universe/*` — a deliberate, documented choice (see that file's own
"§10/§11" comment) to avoid a redundant HTTP hop from a server component,
not a wiring gap. So `/api/universe/factions` and `/api/universe/locations`
showing zero frontend hits earlier was real (nothing calls those two HTTP
routes directly), but it's the *thin-wrapper-vs-direct-call* pattern this
codebase already uses everywhere else for server components, not a buried
feature. Item #1 below is retracted.

## Update — items #2, #3, and #4 below are now fixed

Ported into this working directory alongside the login-portraits fix
that had, in the meantime, already been built independently (a fuller
server-component version than my own now-superseded attempt — see
`login/page.tsx` and `lib/config/login-portraits.ts`):
- `src/lib/dating/milestone-labels.ts` (new)
- `src/components/dating/all-milestones-drawer.tsx` (new) → wired into
  `dating/match/[id]/page.tsx`
- `src/components/referrals/embed-assets-panel.tsx` (new) → wired into
  `referrals-dashboard.tsx`

See each component's own header comment for the wire-up rationale;
unchanged from the original write-up below other than the file layout.

## Fixed

### 1. Chat queue fallback was completely unreachable
**Files:** `src/app/api/chat/stream/route.ts`, `src/hooks/use-chat-stream.ts`

`/api/chat/stream` 503s under platform load, and a full async fallback
already existed server-side — `POST /api/queue/enqueue` →
`GET /api/queue/status/[jobId]` polling, with its own dedup and
quota-parity handling matched to the sync route's own gates. But the
client hook that was supposed to call it — referenced by name in the
enqueue route's own comments ("use-chat.ts's sendMessage calls into after
a network drop", "use-chat.ts's existing isUpgradeGate branching") — never
existed anywhere in the codebase. Every capacity 503 just hard-errored the
user; the queue path was dead code from the client's side even though the
server side was fully built and tested.

Fix, in two parts:
- Tagged the load-shedder 503 with a machine-readable
  `code: 'PLATFORM_AT_CAPACITY'` (previously no `code` at all, so a client
  had no reliable way to distinguish "queue this" from the *other* 503 a
  few hundred lines down — character-brain-init failure — where queueing
  would only reproduce the same failure in the worker).
- Extended `use-chat-stream.ts` (the hook `chat-window.tsx` actually uses;
  no `use-chat.ts` file exists, so this is where the fallback belongs) with
  `sendViaQueue()`: enqueues, polls every 1.5s up to a 90s client-side
  ceiling, and resolves through the same `onDone` callback the streaming
  path uses. `chat-window.tsx` needed zero changes — a queued reply just
  arrives as one `onDone` call instead of incremental deltas.

## Flagged, not fixed — need a product decision, not pure wiring

Same posture as AUDIT_FINDINGS_LOG.md's own "needs your decision" list —
each of these is a built backend with no frontend consumer, but wiring one
up blind means guessing at UI/IA that isn't mine to decide.

1. **`/universe/*` (factions, locations, artifacts, scenes, legends,
   titles, history, status, world, daily-choice, profile) — zero frontend
   pages exist.** `find src/app -iname "*universe*"` outside `src/app/api`
   returns nothing. This is the single largest gap found: an entire
   world-building system (10 GET routes) with no page shell, nav entry, or
   component anywhere. Not a small wiring fix — needs real IA/design work
   (a `/universe` section, atlas browsing, etc.), scoped well beyond a
   route-by-route sweep.
2. **`/api/dating/milestones`** — the match detail page embeds only the 3
   most recent milestones inline (`milestones_log: (...).slice(0, 3)` in
   `/api/dating/matches`); the dedicated full-history endpoint for a match
   with more than 3 milestones is never called. Needs a "view all" entry
   point on the match page.
3. **`/api/referrals/assets/{badge,banner,widget.js}`** — fully-built
   partner embed assets (SVG badge/banner, a vanilla-JS floating widget)
   for approved dev/influencer referral partners. The referrals dashboard
   (`referrals-dashboard.tsx`) shows stats, the payout-bank form, and the
   raw referral link, but never surfaces these embeds or a copy-paste
   snippet — confirmed by reading the full component. Needs an "embeds"
   section added to the approved-partner view.
4. **`/api/config/login-portraits`** — admin-configurable portrait collage
   for the login page (`app_config` key `login_portraits`, with a
   hardcoded fallback). `login/page.tsx` doesn't render any portrait
   collage at all currently. Needs a design call on whether/how it
   should appear on that page.
5. **`/api/waitlist/count`** — public, CORS-enabled signup counter.
   Likely intentional: CORS headers suggest it's meant for an external
   pre-launch marketing site outside this repo, not this app's own UI —
   flagging for visibility rather than as a confirmed bug, since I
   can't confirm the external-site consumer from inside this codebase.

## Confirmed NOT bugs (zero-hit in the literal-string search, verified live)

- `/api/community/replies/[id]/like` — called via `useCommunity()`'s
  shared `toggleLike("replies", id)`, which builds the URL as a template
  literal (`/api/community/${kind}/${id}/like`), invisible to a plain
  string search for the full literal path.
- `/api/health` — intentionally infra-only (uptime monitors, load
  balancers, k8s probes per its own header comment), gated behind
  `WORKER_SECRET` for the detailed view. Not meant to be called by the
  app's own frontend.
