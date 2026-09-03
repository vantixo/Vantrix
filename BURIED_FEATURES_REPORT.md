# Buried Features — Investigation & Fixes

Picking up exactly where the prior pass left off (`secret-tier-engine.ts`,
last item under investigation), then doing a second sweep specifically for
**user-facing** buried features (built pages/UI nobody can navigate to),
which is a different failure mode than dead server-side exports.

---

## Fixed this pass

### 1. `unlockSecretTier()` — catastrophic secret tier could never be earned
**File:** `src/lib/ai/secret-tier-engine.ts`, wired from `src/app/api/chat/stream/route.ts`

Confirmed via per-export grep that 4 of 5 exports in this file were live
(`getUnlockedTiers`, `computeAvailableTiers`, `tiersUnlockedByStage` (used
internally), `formatSecretTierForPrompt` — all reachable from the real
request path, verified `assembleFullPrompt()` actually injects the
resulting gate into the system prompt every turn). Only `unlockSecretTier()`
— the write path for the "behavioral trust condition" the design doc
requires for the top secret tier — had zero callers anywhere. Effect:
`computeAvailableTiers()` could never return `'catastrophic'` for any
character, regardless of relationship depth, because nothing ever wrote a
row to `character_secret_unlocks`.

**Fix:** wired into the existing rupture/repair-outcome block (the same
block a prior session used to feed belief/esteem/self-image/purpose
engines) — the only signal in that route already classified as a genuine
trust condition, not merely time or stage passing. Deliberately narrow:

- Only fires on `outcome === 'repaired'` (never `'escalated'`).
- Only once `relationship.stage` has already reached the catastrophic
  floor (`best_friend`/`partner`) — added `meetsCatastrophicStageFloor()`
  as a new exported helper so this doesn't duplicate `STAGE_RANK` at the
  call site.
- Idempotent per `(user, character, tier)` — the existing upsert makes
  repeated repairs at that stage harmless no-ops, not re-unlocks.

This matches the design doc's own description exactly: a couple who just
met and patches up a small thing does not unlock a companion's darkest
secret; surviving a real rupture at maximum established trust does.

### 2. `/pricing` — built, SEO-indexed page with zero in-app navigation link
**File:** `src/components/layout/sidebar.tsx`

A prior session had already fixed the *previous* version of this bug —
`TierPricing.tsx` was a fully-built, nicer pricing grid mounted nowhere,
and got mounted at `/pricing`. But that page itself was never linked from
anywhere in the app's own navigation (sidebar, navbar, footer) — only
reachable by typing the URL directly or via an external SEO link. A
logged-in or logged-out user browsing the app itself could never click
into it.

**Fix:** added it to the sidebar footer link row, alongside Privacy/Terms/
Help. Its existing handoff to `/premium?billing=...` for actual checkout
was already correct and didn't need changes.

---

## Investigated, confirmed NOT buried (previously flagged as open, now closed by earlier sessions)

- **S1–S21 attention-routing conversion** — memory listed this as "scoped,
  not yet started." Confirmed it is fully live: `chat/stream/route.ts`
  builds one `AttentionCandidate` per relationship-state block (S2–S21)
  and runs a real `routeAttention()` budget-fill call
  (`relationshipAttention`), separate from the executive controller's own
  attention pass. S1 (session bridge) is correctly kept outside the pool.
- `getUnlockedTiers`, `computeAvailableTiers`, `formatSecretTierForPrompt`
  — all live and wired, contrary to the noisy static-analysis pass from
  the previous session that initially misclassified this whole file as
  suspicious.

## Investigated, confirmed genuinely NOT reachable by nav but intentionally so

`elections`, `laws`, `notifications`, `referral`, `creator-studio` all
have real in-app links (from `/universe`, the notification bell, profile/
help pages, character studio) — just not primary sidebar entries. Left
alone; these aren't buried, they're secondary destinations reached via
contextual entry points, which is a reasonable IA choice, not a bug.

## Not touched — same reasoning as the prior audit's "needs your decision" list

`planner.ts`, `prediction-engine.ts`'s `predict()`, `practice-engine.ts`'s
`runPracticeSession()`, and `automatic-behavior.ts`'s
`considerAutomaticResponse()` remain genuinely dormant. Re-confirmed via
grep this pass — still zero live callers. Not fixed here because each
needs a real product/data decision (trigger conditions, quality heuristics,
what "skip deliberation" should actually change in generation), not pure
wiring — wiring them blind would compile and run but encode an arbitrary
guess about game design, which the codebase's own established convention
in this repo explicitly avoids.
