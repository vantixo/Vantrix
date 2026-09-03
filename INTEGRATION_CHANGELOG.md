# Integration changelog — this pass

Base: `vantrix-with-romance-engine.zip` + `vantrix-universe-integration_2.zip`, merged and fully wired.
`.env.local` excluded from this package — copy your original over separately.

## New files
- `src/lib/ai/relationship-behavior-engine.ts` (universe pkg — Part II §4)
- `src/lib/universe/archive-story-arcs.ts` (universe pkg — 25 chapters)
- `src/lib/ai/repair-engine.ts` (rupture & repair mechanic)
- `src/lib/ai/emotional-escalation-budget.ts` (budget-capped model escalation)
- `src/lib/safety/crisis-detection.ts` + `crisis-response.ts`
- `src/lib/moderation/reply-guard.ts`

## New migrations
- `20260825_archive_of_echoes_universe_integration.sql`
- `20260825_rupture_repair_engine.sql`
- `20260826_crisis_events.sql`
- `20260826_reply_guard_flags.sql`

## Modified — universe package (as delivered, no conflicts)
- `src/lib/ai/prompt.ts`, `src/lib/universe/story-engine.ts`

## Modified — merged (both this pass and universe pkg touched it)
- `src/types/world-expansion.ts` — universe pkg's `story_key` field + my
  `rupture_repaired`/`rupture_unresolved` WorldImpactSource values.

## Modified — routing/rupture wiring
- `src/lib/ai/decision-engine.ts` — rupture cooldown damper on SetBoundary.
- `src/lib/ai/attachment-engine.ts` — 3 new PsychologyEvent names.
- `src/lib/ai/model-router.ts` — `isEmotionallyIntense()`, `escalated` field,
  escalation-budget spend logic.
- `src/lib/ai/provider-router.ts` — `escalated` on `ProviderRequest`;
  usage recording added to **both** `routeCompletion()` (already had
  PEAK recording) **and `routeStream()`, which had none at all** — see
  below, this was the more important of the two.
- `src/lib/ai/orchestrator.ts` — threads `escalated` through; **also fixes
  a pre-existing bug where `userId` was never passed into
  `routeCompletion()`**, silently breaking PEAK usage tracking on that path.
- `src/lib/ai/cost-guard.ts` — `escalated` added to `CostGuardResult`,
  all three return sites (live route, cache-hit, blocked) updated.
- `src/app/api/chat/stream/route.ts` — `guard.escalated` passed into both
  the `routeStream()` call and the sync-fallback `orchestrator.prepare()` call.

## Modified — safety wiring (chat/stream/route.ts)
- **Crisis detection**: inserted immediately after auth resolves `userId` —
  the earliest point both `message` and `userId` exist, before stream-slot
  acquisition, before any pipeline work. A detected message short-circuits
  the entire route: fixed reply sent via single-frame SSE, turn persisted,
  crisis event logged, no engine/model call happens for that turn.
- **Reply guard**: inserted at the point where the streaming and
  sync-fallback code paths converge on a final `fullReply`, right before
  it's used for billing/persistence. Known limitation, stated in the
  inline comment: on the streamed path, deltas were already sent to the
  client token-by-token before this check runs, so a flagged reply is
  corrected via the same `reset: true` mechanism this file already uses
  for provider-fallback mid-stream corrections — not prevented from
  rendering at all. True token-level prevention would need buffering the
  full stream server-side before flushing, which is a bigger architecture
  change than this pass — flagged, not silently absorbed.

## Bugs found and fixed as a side effect of this wiring pass
1. `orchestrator.ts` never passed `userId` into `routeCompletion()` —
   PEAK budget usage recording (`recordPeakUsage`) was silently a no-op
   on that path.
2. `routeStream()` — the function real chat traffic actually calls, per
   its own inline comments — **never called `recordPeakUsage` or any
   usage-recording at all**. Only the effectively-unused `routeCompletion()`
   path had it. This means PEAK/budget tracking may have been broken for
   all live traffic before this pass, independent of anything built this
   session. Worth confirming with real usage data post-deploy.

## Follow-up pass — guest chat crisis wiring
- `src/app/api/chat/guest/route.ts` — added the same crisis-detection
  short-circuit the authenticated `/api/chat/stream` route already had.
  Previously `/api/chat/guest` had no crisis check at all: a distressed
  guest message flowed straight into `assembleCharacterPrompt` →
  `routeCompletion`, i.e. an in-character (romantic/playful) reply — the
  exact failure mode `crisis-detection.ts`'s file header calls out, and
  arguably worse for guests than for authed users since guests are the
  least identifiable, least supported population (no account, no memory,
  no human review context beyond IP).
  - Check runs first, before the IP/session rate caps, the character
    fetch, and the mature-content gate — mirrors the stream route's
    placement ("must run before ANY other pipeline work").
  - Uses the existing `detectCrisisSignal` / `logCrisisEvent` /
    `buildCrisisReply` from `crisis-detection.ts` / `crisis-response.ts`;
    no new detection logic, no new migration.
  - Does not consume the guest message quota (checked before `redis.incr`
    on the session key) and is not itself rate-limited.
  - Intentionally does **not** do the stream route's repeat-turn
    short-reply variant (`buildCrisisReplyShort`) or turn persistence —
    both are keyed on `conversationId`, and guest sessions have neither a
    conversation row nor any DB writes by design (see the route's own
    "No user data is persisted" comment). Every detected guest crisis
    message gets the full `buildCrisisReply()` template.
  - `logCrisisEvent` is called with `userId: null, conversationId: null`
    — `crisis_events` already allows nullable `user_id`/`conversation_id`
    (guest abuse-signal rows in the same table follow the same pattern),
    so no migration change needed.
- No client-side change required: `guest-chat-window.tsx` renders
  whatever comes back in `data.reply` as a normal assistant bubble, so
  the crisis template (988 / Crisis Text Line / findahelpline.com) just
  displays as text. Confirmed no chat component anywhere reads a
  `crisis: true` flag for special UI treatment — true on the
  authenticated path too, so this isn't a new gap, just an existing one
  this pass didn't attempt to close.
- Verified by hand (no `node_modules` in this environment, so `tsc`/
  `vitest` weren't run): every import in the new route resolves to an
  existing export with a matching signature, braces/parens balance, and
  `sec-07-guest-id-binding.test.ts` still applies unmodified since the
  cookie-identity logic is untouched. **Run `npm run typecheck && npm test`
  for real before deploying.**

## Still requires human action before deploy
- `crisis_events` migration references a `safety_reviewer` profile role
  that likely doesn't exist yet — create it or substitute `admin`.
- Real `tsc`/`vitest` pass — this was hand-verified for brace/paren
  balance and traced call-site-by-call-site, not compiled.
- Clinical/safety review of `crisis-response.ts`'s exact wording.
- Confirm `messages` table schema matches the insert shape used in the
  new crisis-turn persistence code (matched an existing pattern elsewhere
  in the same file, but wasn't run against a live schema).

## Follow-up pass — attention-candidate + goal-recency wiring, belief-maintenance cron

Merged in from a separate working session, onto what was by this point a
substantially more advanced tree (the `src/lib/cognition/` layer had
grown to 25 files, fully wired into `chat/stream/route.ts` via
`runCognitionCycle()`, including its own `experience-engine.ts →
lesson-engine.ts → wisdom-engine.ts` reflection/lesson/wisdom chain).
Read that entire layer before touching anything, specifically to avoid
building a second, redundant reflection system — an earlier draft of
this work included a standalone `ai/reflection-engine.ts` plus planned
`nightly-reflection.ts` / `lesson-generator.ts` / `life-review.ts` files;
all four were deliberately dropped once it was clear the cognition layer
already covers that ground more completely and is already live.

**What was actually still a real, open gap and got wired:**

- `ai/salience-engine.ts` (new) — reduces this turn's real signals
  (memories, facts, theory-of-mind, active task/goal, drive impulses)
  into `AttentionCandidate[]` for `attention-router.ts`'s budget fill.
  Distinct from `cognition/attention-engine.ts`, which decides what's
  salient enough to *persist into working-memory.ts* — this module
  scores what's worth spending *this turn's prompt budget* on. Neither
  module did the other's job before this.
- `ai/focus-stack.ts` (new) — Redis-backed, per-(user,character) counter
  of turns-since-goal-last-selected, feeding `goal-selector.ts`'s
  `GoalRecency[]` so one goal can't monomaniacally dominate every turn.
  Explicitly documented as NOT overlapping with `cognition/working-
  memory.ts` (broader, in-process, non-persistent item buffer) — the two
  answer genuinely different questions; see the file's own header.
- `ai/executive-controller.ts` — `goalRecency` and `attentionCandidates`
  are now optional on `ExecutiveInput`. Omitted, they're derived from
  focus-stack.ts / left as `[]` respectively (unchanged behavior for any
  caller that doesn't opt in). All existing confidence-engine.ts /
  uncertainty-engine.ts wiring preserved untouched — this was a strictly
  additive merge, verified line-by-line against the pre-merge version.
- `chat/stream/route.ts` — the `executiveInput` construction previously
  passed `goalRecency: [] as GoalRecency[]` explicitly, which (now that
  the field is optional) would have silently defeated the fix by
  overriding the fallback. Fixed by omitting the field instead of
  passing an empty array — the comment explaining the old gap was
  updated to explain the fix instead. `attentionCandidates` stays
  omitted too, and that comment's original reasoning (memory-graph.ts's
  output already flows through its own relevance filtering and direct
  prompt injection, most of it now duplicated many times over by the
  S1-S21 fragment system layered in since — routing it through
  attention-router.ts too risks double-injection) still holds and is
  now, if anything, more true. Cleaned up two now-dead imports
  (`runExecutiveController` — no longer called directly since
  `runCognitionCycle()` took over that call site in an earlier session;
  `AttentionCandidate`/`GoalRecency` types — no longer referenced once
  the hardcoded casts were removed).

**Belief-maintenance cron (new, closes a different, real, confirmed-dead gap):**

`belief-engine.ts`'s `runBeliefMaintenance()` already existed, already
had a doc comment saying it's "intended to be cron-driven... weekly is
plenty," and was never actually called from anywhere — confirmed via
`grep` across `src/app` before writing anything. `wisdom-engine.ts` and
`habit-engine.ts` have the same kind of maintenance function
(`runWisdomMaintenance` / `runHabitMaintenance`) and the same "run this
on a cron" suggestion in `cognition-engine.ts`'s own header, but both
store their state in an in-process `Map` (same pattern as
`working-memory.ts`, deliberately non-durable) — a serverless cron
invocation almost certainly runs in a different process than any chat
request did, so those buckets would be empty every time a cron fired.
Wiring those two into a cron now would compile and run but never
actually do anything, which is worse than not building it: it would
look operational without being operational. Belief storage
(`user_beliefs`, via `belief-store.ts`) is Supabase/Redis-backed, so
only that one got a real cron:

- `belief-engine.ts` — added `runBeliefMaintenanceCron()`, batching
  `runBeliefMaintenance()` over every distinct `(user_id, character_id)`
  pair that actually has rows in `user_beliefs` (not every active
  relationship — most have zero beliefs recorded so far, and sweeping
  those would be wasted round-trips). One pair failing doesn't stop the
  sweep, same fail-open-per-item posture as
  `character-initiative.ts`'s `runInitiativeCron()`.
- `cognition-engine.ts` — exported `runBeliefMaintenanceCron` and its
  report type from the public facade, per that file's own "callers
  outside src/lib/cognition/ should import from here" rule.
- `src/app/api/cron/belief-maintenance/route.ts` (new) — thin route,
  same shape as `character-initiatives/route.ts`: `requireCronAuth`,
  heartbeat start/success/fail, JSON result.
- `heartbeat.ts` — added `BELIEF_MAINTENANCE` to the `HeartbeatName`
  union and its `HEARTBEAT_BELIEF_MAINTENANCE` env var doc line.
- `vercel.json` — registered the cron at `0 5 * * 1` (weekly, Monday
  05:00 — same day as `referral-payouts`, offset by an hour to avoid
  both hitting Supabase at once) and added a matching `maxDuration: 30`
  functions entry, same value as the other per-relationship batch crons.

**Verification:** no `node_modules` in this environment (network
disabled for bash), so `tsc`/`vitest` weren't run. Hand-verified: brace/
paren balance on every touched file, `vercel.json` re-parses as valid
JSON, every new import resolves to a real export with a matching
signature (checked `requireCronAuth`'s signature, `user_beliefs`'
column names against its migration, `AttentionCandidate`'s source-type
union against every literal `salience-engine.ts` emits). **Run `npm run
typecheck && npm test` for real before deploying — this still hasn't
been compiled.**

## Still requires human action before deploy (this pass)
- `HEARTBEAT_BELIEF_MAINTENANCE` env var — optional (heartbeat pings are
  a no-op if unset) but worth adding a healthchecks.io check for, same
  as the other cron heartbeats.
- If wisdom-engine.ts / habit-engine.ts are meant to eventually get a
  real maintenance cron too, their storage needs to move off an
  in-process Map onto something that survives a serverless process
  boundary (Redis, matching focus-stack.ts's approach, would be the
  smallest change) before a cron for them would do anything.
- The `ai/salience-engine.ts` → `attention-router.ts` path is wired and
  reachable (`ExecutiveInput.salience`) but no live call site actually
  populates it yet — `chat/stream/route.ts` still deliberately omits it
  for the double-injection reason documented at that call site. Wiring
  real memory/fact/ToM signals through it is a real follow-up requiring
  a careful audit against the S1-S21 fragment system, not something to
  do blindly.


## 2026-07-23 — Backpressure audit + cache-patch merge

**Backpressure fix (audit finding):** the identity-core / backstory-engine
fire-and-forget paths had no ceiling on concurrent OpenRouter calls.
`maybeDeepenIdentity` (chat/stream's `after()` hook) fans out into up to 4
direct OpenRouter calls, throttled per-(user,character) pair by an
interaction-count boundary but with nothing capping how many pairs could
cross that boundary at once fleet-wide — a traffic burst could pile up
unbounded concurrent background LLM calls competing with the user-facing
completion. Added `src/lib/ai/bg-concurrency.ts`, a Redis-backed slot pool
(`withBgSlot`/`acquireBgSlot`/`releaseBgSlot`), and gated:
- `identity-engine.ts`'s `maybeDeepenIdentity` fan-out (pool
  `identity-enrichment`, cap 8 concurrent, fleet-wide)
- `backstory-engine.ts`'s `generateCandidate` call (pool
  `backstory-enrichment`, cap 3 concurrent, fleet-wide — belt-and-suspenders
  alongside the cron route's already-sequential per-invocation loop, in
  case of overlapping invocations)

Both skip (don't queue) when the pool is full — correct backpressure for
best-effort enrichment that's explicitly "never a dependency."
`backstory-engine`'s cron loop itself (`CHARACTERS_PER_RUN=15`, awaited
sequentially) was already bounded and not independently at risk.

**Merged vantrix-cache-patch.zip:** Anthropic prompt-caching support —
`prompt.ts` now emits a `PROMPT_CACHE_BOUNDARY` marker splitting each
assembled system prompt into a static per-character block and a dynamic
per-turn tail; `provider-router.ts`'s Anthropic adapters (sync + streaming)
split on that marker and mark the static half `cache_control: ephemeral`,
so only the small dynamic tail is billed at full input-token price each
turn. Other providers get the marker stripped transparently
(`stripCacheBoundary(FromMessages)`), so this is a no-op for them.

## 2026-08-10 — Web Push notifications (build + activate)

Added real OS/browser push notifications (VAPID), complementary to the
existing in-app SSE stream at `/api/notifications` (which only fires while
a tab is open and connected).

**New:**
- `supabase/migrations/20260932_push_notifications.sql` — `push_subscriptions`
  table + RLS (owner CRUD, service-role bypass for the send path).
- `src/lib/push/send-push.ts` — server-side sender. Batched subscription
  lookup for multi-user fan-out (no N+1), bounded concurrency pool
  (`PUSH_CONCURRENCY = 10`) since Web Push encryption is CPU-bound and this
  runs on constrained instances, TTL/urgency headers so undelivered pushes
  expire instead of queueing forever, title/body hard-capped under the 4KB
  payload ceiling.
- `src/lib/push/known-endpoints.ts` — allowlists subscription `endpoint`
  hosts to known browser push services (fcm.googleapis.com, Mozilla, Apple).
  Without this, a client could register an arbitrary URL as its "push
  endpoint" and the server would later POST to it directly (SSRF).
- `POST /api/push/subscribe`, `POST /api/push/unsubscribe` — rate-limited,
  endpoint-allowlisted, capped at 8 devices/user (oldest evicted).
- `public/sw.js` — `push` + `notificationclick` handlers. Cache version
  bumped v1 → v2 so existing installs pick up the new worker.
- `src/lib/push/use-push-subscription.ts` + `src/components/pwa/push-opt-in.tsx`
  — client hook + soft-ask prompt (waits 45s into a session, remembers
  dismissal for 21 days), mounted in `PWAInit`.
- `src/lib/notifications/nudge.ts` — the nudges cron
  (`/api/cron/nudges`, already scheduled every 6h in `vercel.json`, no
  cron-config changes needed) now sends real push alongside in-app SSE.

**To activate on a fresh environment:**
1. `npx web-push generate-vapid-keys`
2. Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
   (see `.env.example`) — the public key must be present at **build** time,
   since it's inlined into the client bundle.
3. Apply the migration (`supabase db push` or equivalent).
4. Deploy. Cron is automatic — Vercel calls `/api/cron/nudges` on schedule
   and authenticates via `CRON_SECRET` (`requireCronAuth`); nothing else to
   wire up.
5. Verify: sign in on a real HTTPS deploy (push is unreliable on
   `localhost` outside Chrome), wait ~45s for the opt-in prompt, accept,
   confirm a row lands in `push_subscriptions`, then either wait for a real
   nudge or call `sendPushToUser(userId, { title, body })` directly to
   smoke-test delivery end-to-end.

## 2026-08-15 — Pass 5 (Reliability) audit

Systematically re-verified all 10 Pass 5 reliability items against the actual
codebase rather than assuming prior audit claims still held. Nine were
already solid on inspection:

- **Payment entitlement revocation** — deliberately not automatic on refund/
  dispute; confirmed as a recorded product decision (manual admin review),
  consistent across Stripe/Paystack/NOWPayments. Not a gap.
- **Sentry/logging** — `logger.error()` already forwards to Sentry (sampled,
  prod-only, redacted) as of the 2026-08-06 pass.
- **Cron verification** — all 29 `/api/cron/*` routes call `requireCronAuth`.
- **Authorization** — all 19 admin API routes are gated; the one apparent
  exception (`generate-character-portraits`) correctly uses its own
  pre-auth `ADMIN_SECRET_TOKEN` gate by design (bootstrap-style route).
- **RLS** — programmatically parsed all 131 migrations: all 171 tables have
  RLS enabled. The 46 with zero `CREATE POLICY` statements are backend/
  service-role-only simulation and admin-log tables — verified none of them
  are queried from any client-side (`"use client"`) component — so
  deny-by-default there is correct, not an oversight.
- **Webhook idempotency** — all 4 webhook routes (Stripe, NOWPayments,
  fal-lora, fal-animate) write to `processed_webhooks`.
- **Rate limits / AI cost ceilings (user-facing)** — far more built out than
  expected: 7-layer cost guard (anomaly detection, per-user spending cap,
  memory compression, semantic cache, adaptive summarization, cost-aware
  model routing, PEAK monthly budget) plus a platform-hourly-budget system
  (`adaptive-quota.ts`) that auto-throttles per-request token ceilings
  fleet-wide during a spike.
- **Background job backpressure** — already covered by the 2026-07-23
  `bg-concurrency.ts` fleet-wide slot pool for identity/backstory fan-out.

**Real gap found and fixed — AI cost ceilings (background/fleet spend):**
The platform-hourly-budget system only ever learns about usage from calls
that explicitly report it to `recordPlatformTokens()`. That was wired into
the main chat path (`orchestrator.ts`) and universe deep-ticks
(`deep-tick.ts`) — but **not** into `src/lib/ai/capability.ts`, the single
shared chokepoint that `backstory-engine`, `core-beliefs`, `self-esteem`,
`identity-core`, `memory`, `user-fact-graph`, `purpose-engine`,
`moderation`, `digital-twin/engine`, and `summarizer` all route their LLM
calls through. `capability.ts` read `result.totalTokens` off every
`routeCompletion()` response and silently dropped it — real, billed
provider spend from ten background subsystems that was completely
invisible to the one mechanism built to catch a fleet-wide cost spike, no
matter how large. These are exactly the paths the 2026-07-23 backpressure
fix already flagged as fanning out with a concurrency cap but no ceiling on
total daily volume — the missing piece was cost *visibility*, not just
concurrency.

Fixed by reporting usage from both `generateStructured()` and
`generateText()` in `capability.ts`, right after `routeCompletion()`
resolves (before the JSON-parse attempt in `generateStructured`, so a
malformed reply doesn't also silently drop the usage report for tokens
that were already spent) — same fire-and-forget,
`.catch(() => {/* non-critical */})` shape as every other
`recordPlatformTokens()` call site. Regression tests added
(`capability-platform-budget.test.ts`, 5 tests) covering: usage reported on
a clean call, usage still reported on a JSON-parse failure, usage NOT
reported when the provider call itself throws (nothing was spent), and a
failing `recordPlatformTokens()` never propagates out of either function.

Verified (this environment still has no network/npm — no real `tsc`/`npm
test` run) via the TS compiler API's parser directly: 0 syntax errors across
all 853 `src/**/*.{ts,tsx}` files, 0 broken relative/`@/` imports
(re-checked after the edit). **Still needs a real `npm run typecheck &&
npm test` before deploy.**

Deliberately did NOT add a hard kill-switch that blocks user-facing chat
when the fleet budget is exceeded — `adaptive-quota.ts` already throttles
per-request token ceilings automatically under platform load, and outright
blocking paid chat would cut against the "premium = effectively unlimited"
commitment documented in `spending-cap.ts`. That's a revenue/product
tradeoff, not mine to make unilaterally — same reasoning the prior audit
already applied to payment-tier revocation. If a harder cutoff is wanted,
the natural next step is gating `bg-concurrency.ts`'s slot acquisition on
`getPlatformHourlyUsage()` so background (non-critical) work degrades first
under a real fleet-wide cost spike, before anything user-facing does.

## Pass 6 — Performance + polish

Scope: mobile rendering, animation budget, route loading states, and an
accessibility sweep. Verified this codebase's earlier passes had already
closed most of the plan doc's older items (HUD reservation, image-domain
config, bundle-splitting on chat/studio/premium/discover, PWA shell/SW,
modal focus trap) — so this pass targeted what was actually still open
rather than re-doing settled work. No `node_modules` in this environment,
so `tsc`/`vitest` weren't run; every edit was hand-checked for brace/paren
balance and traced against its call sites. **Run `npm run typecheck &&
npm test` for real before deploying.**

### Mobile visual-effects budget
- `src/components/ui/design-tokens.css` — `.nexus-bg::before` (blur(60px),
  `nexus-drift` 22s infinite) and `.crystal-rays-bg` (blur(80px),
  `crystal-rays-spin` 90s infinite) are two stacked `position: fixed`
  layers that ran their blur animation continuously regardless of
  `prefers-reduced-motion`. Added a `max-width: 1023px` rule — same
  breakpoint the file already uses for `.dark body`'s
  `background-attachment: fixed → scroll` mobile fix — that stops both
  animations and shrinks blur radius on mobile. Layers stay visible
  (app doesn't lose its ambient backdrop), only the per-frame recompute
  goes away.

### Route-specific loading states
Previously every route fell back to `(main)/loading.tsx`'s generic
header+card-grid skeleton. Added real ones for the five routes the prior
pass's plan named explicitly:
- `(main)/chat/loading.tsx` — conversation list + popular-characters strip
- `(main)/dating/loading.tsx` — hero + relationship-card grid (dating's
  page is a Client Component that fetches after mount, but Next still
  renders this during the route-segment transition, so it's not dead code)
- `(main)/studio/loading.tsx` — controls panel + generation grid
- `(main)/premium/loading.tsx` — pricing cards + FAQ
- `(main)/discover/{female,male,anime}/loading.tsx` — continue-strip +
  hero + card grid (duplicated 3x, one per gender-locked route, since
  `loading.tsx` is per-segment and isn't inherited across siblings)

### Accessibility
- **Skip-to-content link**: added to `src/app/layout.tsx` as the first
  focusable element (visually hidden until Tab-focused). Targets
  `#main-content`, added as `id` + `tabIndex={-1}` on the `<main>` in
  `(main)/layout.tsx`, `(public)/layout.tsx`, and `(seo)/layout.tsx` —
  lets keyboard/screen-reader users skip the navbar + full sidebar
  (a dozen-plus links across sections) on every route. `admin/layout.tsx`
  has no `<main>` at all and was left out of scope (internal tooling).
- **`aria-current="page"`**: added to the active link in both
  `sidebar.tsx`'s `NavLink` and `bottom-nav.tsx` — was entirely missing,
  so assistive tech had no way to know which nav item was current.
- **Mobile sidebar drawer** (`sidebar.tsx`): had zero focus management —
  no Escape-to-close, no focus trap, Tab could walk straight through into
  the dimmed page content behind the overlay. Added the same trap/restore
  pattern already established in `ui/modal.tsx` (capture
  previously-focused element, move focus in on open, Tab-cycle within the
  drawer, Escape closes, restore focus to the trigger on close). Gated on
  `sidebarOpen` alone, no viewport check — that flag is only ever set via
  the `lg:hidden` mobile hamburger, the same invariant the existing
  scroll-lock effect in this file already relies on. Also added
  `role="dialog"`/`aria-modal` (only while open) and `aria-label` on the
  `<aside>` and its inner `<nav>`.
- **Icon-only dismiss buttons missing `aria-label`**: found 8 via a
  codebase-wide heuristic scan (icon-only `<button>` children, no
  `aria-label`/`aria-hidden`) and fixed all of them — `report-modal.tsx`,
  `milestone-card.tsx`, `date-picker.tsx`, `daily-quests-widget.tsx`,
  `character-insights-panel.tsx`, `customize-companion-modal.tsx`,
  `emotional-peak-paywall.tsx`, `studio/character-import.tsx`. Previously
  a screen reader announced these as an unlabelled "button".

### Checked, found already solid (no change needed)
- **Image loading**: all `next/image` usage correct; the 3 raw `<img>`
  tags in the tree are each deliberately documented exceptions (blob-URL
  preview, no-intrinsic-size lazy fallback, embed-code string for
  external HTML) — no fix needed.
- **Bundle splitting**: chat, studio, premium, discover, create-character,
  dating/match, and referral already code-split their heavy client
  components via `next/dynamic`.
- **PWA**: manifest, service worker (network-first HTML, cache-first
  static, never-cache `/api/*`/`/auth/*`), and cache-clear-on-signout are
  already in good shape — no gaps found worth flagging.
- **Reduced motion**: already respected in 4 separate places
  (`design-tokens.css` x3, `theme-engine.css`) before this pass — the
  mobile budget fix above is a separate, additive concern (device-class
  cost, not user preference).

### Not done this pass — flagged for a future pass
- Only the mobile drawer's focus trap got the modal-parity treatment;
  other custom dropdown/disclosure components (e.g. the sidebar's "More"
  section, any `<select>`-replacement menus) weren't individually audited
  for keyboard support and may have similar gaps.
- Route loading states only cover the 5 routes explicitly named in the
  prior pass's plan — `/collection`, `/store`, `/my-ai`, `/community`,
  `/creator-studio`, etc. still fall back to the generic skeleton.
- No Lighthouse/axe run was possible in this environment (no `node_modules`,
  no network to install them) — the above was found by manual/grep audit,
  not automated tooling. Worth running both for real before shipping.
