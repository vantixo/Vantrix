# Memory conflict resolution — what actually changed

Scope: one track from the audit — "Memory lifecycle/conflict resolution."
The prior fixes zip built `memory-arbiter.ts` but never wired it in. This
pass wires it in, fixes a duplicate-fetch bug found while doing that, and
adds test coverage that didn't exist before.

## Files changed

### `src/lib/ai/memory-arbiter.ts`
- Split the old `getCanonicalMemoryContext()` (fetch + arbitrate) into:
  - `arbitrateMemoryContext(legacyFacts, structuredFacts, seedMemories)` —
    pure, no I/O, for callers that already have the data (companion-context.ts).
  - `getCanonicalMemoryContext(userId, characterId)` — thin wrapper that
    fetches then delegates to the pure function, for callers that don't.
- Added `factsPromptBlock` to `CanonicalMemoryContext` — user-facts only,
  no seed memories, so it can replace the existing `memoryFacts` prompt
  field without double-injecting seed memories (which are already injected
  separately via `formatSeedMemoriesForPrompt`).

### `src/lib/ai/companion-context.ts`
- **Bug found:** `canonicalMemory` was fetched via `getCanonicalMemoryContext()`
  in the same `Promise.all` that already fetches `memoryFacts`, `factGraph`,
  and `seedMemories` — silently re-fetching all three sources a second time,
  every turn, for a result that (see below) nothing consumed.
- Fixed: now calls `arbitrateMemoryContext()` synchronously, after the
  `Promise.all` resolves, using the data already fetched. Removes 3 redundant
  Redis/Supabase round trips per message.

### `src/app/api/chat/stream/route.ts`
- **Bug found:** `canonicalMemory` was computed on every request but never
  read anywhere in the codebase (confirmed by repo-wide grep). The two
  original unreconciled injections — the `memoryFacts` field
  (`formatMemoryForPrompt(memoryFacts)`) and the separate `fact-graph`
  budget candidate (`formatFactGraphForPrompt(factGraph)`) — were both
  still live, so the conflict the arbiter exists to solve was unfixed in
  practice.
- Fixed: `memoryFacts` field now uses `canonicalMemory.factsPromptBlock`;
  the separate `fact-graph` candidate is removed (its content is now inside
  the arbitrated block instead of racing it). Dead imports removed.

### `src/lib/ai/__tests__/memory-arbiter.test.ts` (new)
6 tests against `arbitrateMemoryContext()` directly: precedence
(user-fact-graph beats legacy memory.ts regardless of confidence), no
dual-injection of contradictory facts, non-overlapping facts pass through
untouched, confidence/recency tiebreak within a tier, seed memories excluded
from `factsPromptBlock` but present in `promptBlock`, empty-input case.

## Verification
- `tsc --noEmit`: clean on all three touched files. (One pre-existing,
  unrelated error in `memory-embeddings.ts` from the earlier session —
  a Supabase RPC name not yet in generated types — left untouched.)
- `vitest run memory-arbiter.test.ts persistent-fact-injection.test.ts`:
  11/11 pass.
- `arch-14-companion-context-assembly.test.ts`: 2 of 7 tests time out.
  Confirmed via a side-by-side run against the untouched fixes-zip version
  of `companion-context.ts` that this is **pre-existing** — the test doesn't
  mock `belief-store`/`habit-store`/`wisdom-store`/`companion-relationships`/
  `unified-mind`, which real code now calls (from the earlier
  "companion-state consolidation" fix), so those calls hit real
  Supabase/Redis clients in the test env and hang. Not caused by this
  change; still open.

## Still open (not touched this pass)
- The `arch-14` test's missing mocks (above) — belongs to whoever verifies
  the companion-state-architecture fix, not memory conflict resolution.
- pgvector retrieval, eval suite (beyond `eval-01`), native mobile, engine
  consolidation, proactive scheduler, compute-budget enforcement — separate
  tracks per the original audit, not started.

---

# Safety arbiter — what actually changed

Second track. `relationship-safety-arbiter.ts` (isolation/exclusivity/
secrecy/anti-professional-help pattern scanner, plus an eval suite
`eval-01-relationship-safety-arbiter.test.ts`) already existed in the
uploaded codebase — this was **not** part of either prior fixes zip and
wasn't reflected in the original audit ("safety/ has exactly 2 files, both
crisis-specific"). It's a real, well-built module: deterministic,
fail-closed at its wired call sites, biased toward false positives, with
labeled-fixture eval coverage already in place.

**What I found wrong, audited against the module's own header claims:**
the header asserted `nudge.ts` and `surprise-engine.ts` were wired with
"the same hard-gate shape" as `character-initiative.ts` and
`reply-guard.ts`. `nudge.ts` genuinely doesn't need it (fixed template
pool, no free-form text — the header's own caveat covers that case
correctly). `surprise-engine.ts` was the actual gap: `recordSurprise()`,
the single choke point every surprise message passes through before
persistence, only ran its own `toneGuard()` (a different risk category —
re-engagement guilt-pressure like "you haven't replied," not isolation/
exclusivity framing). `scanForManipulationRisk`/`guardPreDeliveryText` were
never called there despite the doc claim, even though these messages weave
in real stored memory text (`founding.description`, `favoriteThing`,
`recentTopic`) that could carry manipulation-risk phrasing.

**What I changed:**
- `src/lib/ai/surprise-engine.ts` — `recordSurprise()` now also runs
  `guardPreDeliveryText()` after `toneGuard()`; a flagged message is
  rejected (`reason: 'manipulation_risk'`) rather than persisted. Same
  fail-closed shape as the other two wired call sites.
- `src/lib/safety/relationship-safety-arbiter.ts` — corrected the header's
  incorrect wiring claim to describe what's actually true post-fix.
- `src/lib/ai/__tests__/surprise-engine-safety-gate.test.ts` (new) — 3
  tests: a message that passes `toneGuard` but trips the arbiter is
  blocked before `supabaseAdmin.insert` is called; `toneGuard`'s own
  category still blocks independently; a clean message still persists.

**Verification:**
- `tsc --noEmit`: clean on both touched files.
- `vitest run`: new test (3/3) + existing `eval-01` suite (22/22) both
  pass — the eval suite's own fixtures were untouched, confirming this
  didn't change scanner behavior, only where it's called.

**Explicitly not touched:** `crisis-detection.ts` / `crisis-response.ts`
(unrelated, already crisis-specific and working as designed); the
character-posts cron (public character-profile content, not directed
1:1 messaging — the arbiter's own header only speculatively mentions it
as a possible future `scanForReview` spot, not a claimed-done wiring, so
it isn't a doc/code mismatch and I left it alone).

---

# Merge — external P0-1/2/3 fix pack (`vantrix-fixed-p0-1-2-3.zip`)

A separately-delivered zip claiming P0-1/2/3 fixes turned out to be a
**different, older lineage** of this codebase — missing the memory-arbiter,
compute-budget dedup, relationship-safety-arbiter wiring, and
proactive-arbitrator work from the two tracks above, but ahead in billing
correctness, character pgvector, and cron infrastructure (areas this
session hadn't touched). Rather than overwrite, each overlapping file was
diffed individually and only genuinely new, non-conflicting fixes were
merged in.

## Merged in (verified real, evidence-backed)

1. **Subscription-expiry billing bug** — `daily-reset` cron previously
   hand-rolled pagination that downgraded a user's tier on *any* expired
   subscription without checking for another still-active one (e.g. a
   Paystack sub still live while a Stripe sub expires). Fixed by routing
   through the canonical `expire_subscriptions()` DB RPC instead of a
   second, buggy reimplementation. New migration
   (`20260902_expire_subscriptions_return_counts.sql`) makes the
   previously-`RETURNS VOID` function return counts for logging. New
   regression test (`subscription-expiry.test.ts`, 5 tests).
2. **Character pgvector search** (new: `character-embeddings.ts` +
   migration `20260902b_character_pgvector.sql`) — real persisted
   embeddings for the character catalog, mirroring the existing
   memory-graph pgvector pattern. Previously `character-recommender.ts`
   could only rerank a popularity-ordered top-100 pool live — a
   well-matching but low-`like_count` character could never surface, no
   matter how well it matched. Wired into both character routes
   (fire-and-forget embed on create, re-embed on `personality` edit only),
   additive fallback in `character-recommender.ts` so behavior is
   unchanged when no embedding exists yet. New test
   (`character-embeddings.test.ts`, 11 tests) + new
   `/api/cron/embedding-backfill` route + `heartbeat.ts` entry.
3. **`memory-embeddings.ts` type fix** — this is the exact pre-existing
   `tsc` error flagged at the end of the memory-conflict-resolution track
   above (`match_memory_graph` not in the generated Supabase RPC union).
   Narrowed to a local `RpcCapable` type instead of an `as never` cast
   that didn't actually satisfy `tsc`.
4. **Queue lock/lease TTL mismatch** — `worker.ts`'s per-user concurrency
   lock was hardcoded to 60s while the job's own processing lease
   (`LEASE_MS`, `lib/queue/index.ts`) is 3 minutes. A legitimately slow
   job could let the lock expire mid-job, allowing a second concurrent
   job to start for the same user. Now the lock TTL matches the lease.
5. **Cron-tier duration under-declaration** — `config/cron-jobs.mjs`
   declared `content-engine`, `universe-images`, and `backstory-engine` at
   `maxDuration: 60` when their real Fal/OpenRouter batches genuinely run
   up to 280s — the same silent-mid-batch-kill failure mode an existing
   test (`arch-16`) already caught for `content-engine-video` specifically,
   just undetected for these three because nothing had corrected their
   declared duration. Also added 7 routes previously missing from
   `generate-vercel-json.mjs`'s duration-override map entirely (fal-animate,
   fal-3d-model, admin content-queue, admin generate-character-portraits/
   models, digital-twin/train) — on `CRON_TIER=free` these had no
   `functions` entry at all, silently falling back to each route's own
   uncapped duration. `vercel.json` and the GitHub Actions free-tier
   workflow were regenerated from the merged config (via
   `node scripts/generate-vercel-json.mjs`), not hand-copied — confirmed
   byte-identical to the source zip's shipped output.
6. **`package.json`** — build memory bumped 2048MB → 8192MB (prevents
   OOM on `next build` for a codebase this size).

## Deliberately NOT merged (this session's tree was ahead)

`character-initiative.ts`, `reply-guard.ts`, `nudge.ts`,
`cron/surprises/route.ts`, `companion-context.ts`, `chat/stream/route.ts`,
`payments/__tests__/revocation.test.ts` — the zip's versions of these
predate the relationship-safety-arbiter wiring, `proactive-arbitrator.ts`
cross-source dedup, memory-arbiter wiring, and atomic-revocation-RPC work
already done in this session. Also skipped `.github/workflows/ci.yml` —
the zip's version restructures job names/secret-gating in a way that
would break this tree's existing `arch-17-e2e-ci-scaffold-wired.test.ts`,
which asserts this exact file's shape; unrelated to the cron-tier fix, so
left alone rather than risk a regression to merge an orthogonal CI
polish pass.

**Not reviewed at all — flagged, not merged:** a batch of UI-only diffs
in the zip (chat window, sidebar, message bubble, landing page, admin
content-queue panel, mobile drawer, settings page, etc.). No evidence
found that these are bug fixes rather than a separate session's visual
polish; out of scope for this backend/AI-architecture pass and not
touched.

## Fixed as a side effect of verification (not from the zip)

- `arch-16-video-cron-tier-gating.test.ts`'s `content-engine` assertion
  was written against the *bug* (asserting the mis-tagged job WAS
  scheduled on free tier) — updated to assert the post-fix, correct
  behavior (job now correctly excluded, per its own file header's stated
  intent for exactly this failure mode).
- `memory-arbiter.test.ts`'s seed-memory fixture was missing the
  `test_hint` field `CharacterSeedMemory` requires — real `tsc` failure,
  not a merge artifact; added `test_hint: null`.

## Full verification

- `tsc --noEmit`: **0 errors**, entire codebase (was 2 pre-existing errors
  before this merge — both now fixed, one by the zip's own type fix, one
  by the fixture fix above).
- `vitest run` (full suite): **551/553 non-skipped tests pass.** The 2
  failures are `arch-14-companion-context-assembly.test.ts` — confirmed
  pre-existing via an earlier side-by-side run against the untouched
  fixes-zip version of `companion-context.ts` (documented at the top of
  this file); still open, belongs to whoever verifies the
  companion-state-architecture track, not this merge.
- `node scripts/generate-vercel-json.mjs` output confirmed byte-identical
  to the source zip's shipped `vercel.json` and free-tier workflow.

## Still open (P0-4 through P0-10, not started)

Image-batch durable jobs, fal-lora webhook job queue, digital-twin
billing-order bug, GDPR export/deletion gaps, sync/queue AI-brain
divergence, the stub production RPC.


