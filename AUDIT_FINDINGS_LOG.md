# Vantrix — Enterprise-Readiness Audit: Final Findings Log

**Audit session date:** through 2026-07-31
**Scope completed:** Phases 0–9 (full), Phase 10 (final gate, this document)
**Scope not completed:** see "Coverage disclosure" at the end

---

## Final Gate — Verification (cold cache, this session)

| Check | Result |
|---|---|
| Clean install (`rm -rf node_modules package-lock.json && npm install`) | ✅ exit 0, 662 packages |
| `npm audit --production` | ✅ 0 vulnerabilities |
| `npm audit` (full, incl. dev deps) | 13 high — all in dev-only eslint-toolchain (`brace-expansion` ReDoS), 0 production exposure |
| Cold `tsc --noEmit` | ✅ exit 0 |
| Cold `tsc --noEmit --noUnusedLocals --noUnusedParameters` | 1 finding: `runPracticeSession` (deliberately left unwired — see below) |
| `next lint` | ✅ exit 0, no warnings |
| Full test suite (`vitest run`) | ✅ exit 0 — **49 files, 393 tests, all passing** |
| Full cold production build (`next build`) | ✅ exit 0 — all ~159 routes + pages compiled |

All exit codes checked explicitly (not masked by output piping) for this final round.

---

## Bugs found and fixed (18 total)

### Database / types (Phase 2)
1. **`chat_affinity_tags` RPC** — missing from generated types, forced `as any`. Typed, cast removed.
2. **`waitlist` route** — stale `as any` cast; table was already fully typed.
3. **`referral_clicks` RLS** — missing policy (copy-paste omission in the original migration, confirmed by comparing against 5 sibling tables in the same migration that all got the policy). Silently returned 0 click counts for every referral partner, forever. New migration adds the matching policy.

### Security / auth (Phase 3)
No bugs found — this was the most hardened area of the codebase, with prior fixes well-documented and verified intact.

### Business logic / engines (Phase 5)
4. **Memory-test engine** — `scheduleMemoryTest()` fully built, zero callers. Wired into both the hot chat path and the queued-fallback path.
5. **Daily-choice claim-ordering bug** — `economy_tick` (hourly) silently claimed-and-dropped `governance_pressure`-effect choices before `governance_tick` (4-hourly) ever ran. Structural, not a rare race — verified via actual cron cadence in `vercel.json`. Fixed to only claim when the effect belongs to the calling engine.
6. **`sinceTurn=0` bug** — the weekly wisdom/habit decay cron's guard (`if (lastAppliedTurn >= sinceTurn) continue`) was mathematically a no-op for every possible real turn value, forever, while still logging success. Fixed by fetching each pair's real current turn count.
7. **Experience→lesson→wisdom pipeline** — `reinforceLessons()`, `synthesizeWisdom()`, `reflectOnSession()`, `getWisdom()` all confirmed to have zero callers anywhere (verified via comment-excluding grep, cross-checked against barrel re-export names after an earlier heuristic gave a false positive). Wired `reinforceLessons`+`synthesizeWisdom` at a real session boundary using the codebase's own established gap-detection convention.
8. **`prediction-engine.ts` math bug** — `healthSlope` proven (numeric trace) to always equal exactly `1.0` regardless of input, making a claimed "trend signal" a hardcoded constant in disguise. Fixed to use the already-computed real valence trend.
9. **`workingMemoryOverride` inconsistency** — one field of `runCognitiveController()`'s return object respected a caller-supplied override; another silently re-derived from live state instead. Unified.

### Type-safety cleanup (Phase 2 + 5 + 7)
10–13. **6 stale `as unknown as Row` casts** across `belief-store.ts`, `habit-store.ts`, `wisdom-store.ts` — tables were fully typed, casts were dead weight from before type generation caught up.

### Dead code / cast sweep (Phase 7)
14. **`profiles.email` doesn't exist as a column** — `admin/referrals/applications/route.ts` queried it anyway, with the failure completely unchecked. Every applicant in this admin screen showed "Unknown" regardless of real display name. Fixed: removed the nonexistent column, added the missing error check.
15. **6 `as any` casts in `community-engine.ts`** — Supabase nested-embed selects with imprecise generated types. Replaced with narrow local interfaces matching each actual query shape.
16. **`awardXp()` — severe.** `increment_xp` genuinely `RETURNS VOID` in the live SQL function (verified directly against the migration). The code cast the always-`null` RPC result to a rich object and read `.leveled_up` off it directly, throwing a `TypeError` on **every single chat message sent**, from both live call paths, silently swallowed by `.catch(bg(...))`. Net effect: **level-up unlockables have never been granted**, though the underlying XP total itself likely did accumulate (the SQL completes before the JS-side crash). Fixed by reading real before/after state instead of a nonexistent return value. Regression test added.
17. **`checkStreak()`** — removing its own stale cast surfaced (via `tsc`) that the code accessed `.streak`/`.broken` directly on a value that can genuinely be `null`; the cast had been masking a real unhandled-failure path. Also found the sibling `consume_streak_shield` function defensively normalizes an array-vs-object response ambiguity for the identical SQL return shape, while this one didn't. Applied the same defensive handling plus a clear thrown error matching the caller's existing `.catch()` contract.

### Compliance (Phase 8)
18. **`stripe/trial/route.ts` failed open on a DB error.** Reimplemented the NSFW card-payment gate inline instead of using the shared `assertCardPaymentAllowed()` helper — with no `error` destructured from the query, a genuine lookup failure meant `profile` was `undefined`, and `undefined?.nsfw_enabled === true` silently evaluated to `false`, letting the gate through. The exact opposite of the shared helper's deliberate fail-closed design. Fixed by consolidating to the shared helper. Caught and corrected a pre-existing test that had been asserting the buggy pattern as correct.

### Accessibility (Phase 6)
19–21. **3 keyboard-inaccessible primary actions** — `swipe-card.tsx`, `luxury-swipe-card.tsx` (dating card tap-to-open), `TierPricing.tsx` (subscription tier selection) were mouse/touch-only. Added `role="button"`, `tabIndex`, Enter/Space handling.

### Hardening (Phase 9)
22. **Logger redaction widened** — exact-match key set extended with real-world variant spellings (`sessionToken`, `clientSecret`, `jwt`, `dob`, etc.) without switching to substring matching, which would have swept up legitimate in-app-currency fields (`tokenCost`, `tokensUsed`) that are extensively and safely logged elsewhere. New test file added (8 tests).

**All fixes verified**: `tsc --noEmit` clean, full test suite passing, and — for the higher-risk fixes — a dedicated regression test added (`arch-10` through `arch-13`, plus the logger-core test file), matching the codebase's existing static-assertion test convention.

---

## Flagged, NOT fixed — require your decision

Ranked by what I'd personally prioritize first:

### Should probably resolve before/soon after production traffic
1. **No automatic tier/access revocation on refund or dispute** (Phase 8). Traced all 3 payment providers — every one claws back the *referrer's* commission on a refund/dispute but none revoke the *paying user's* own subscription tier. Consistent across all 3 providers (looks like considered policy, e.g. manual admin review — but I can't confirm that without you). A user who successfully disputes a charge could retain full paid access indefinitely.
2. **`logger.error()` never reaches Sentry** (Phase 9). Only 3 places in the whole codebase manually call Sentry; the vast majority of caught/handled failures (every webhook, cron, and background-task failure) only produce console output. Could be intentional (avoid alert fatigue) or a real gap (nobody's watching the log dashboard). I proposed a lightweight middle-ground (forward to `Sentry.captureMessage`, sampled) but didn't implement it without your sign-off on alerting philosophy.
3. **`elections` migration-ordering bug** (Phase 2). `20260722_elections_tick_guard.sql` alters a table that isn't created until `20260831_government_engines.sql`, 40 days later in migration order — would fail on a fresh replay. Needs you to check whether both are already applied in production (`schema_migrations`) before I touch the ordering, since this codebase has had migrations reconciled via `supabase db push` before, which may not match filename order.

### Can follow shortly after launch — need product/design input, not urgent bugs
4. **`runPracticeSession()` unwired** (Phase 5) — needs a "quality" heuristic with no existing data source.
5. **`considerAutomaticResponse()` unwired** (Phase 5) — needs a decision on how "skip deliberation" manifests in generation; self-documented in the code as a known follow-up.
6. **`planner.ts` entirely dormant** (Phase 5) — needs both a trigger condition and step-decomposition logic that don't exist yet anywhere.
7. **`predict()` unwired** (Phase 5) — needs `HistorySnapshot[]` data-plumbing that doesn't exist yet; hardcoded to `prediction: null` at its one real call site.
8. **`REQUIRE_DOCUMENT_VERIFICATION_FOR_EXPLICIT` defaults to `false`** (Phase 8) — already honestly self-documented as "until this is a deliberate operator decision." A genuine jurisdiction/legal-risk call, not mine to make.
9. **One-time age verification, no expiry** (Phase 8) — a documented prior product decision. Flagging for visibility only.

---

## Coverage disclosure — what this audit did and did not cover

| Phase | Status |
|---|---|
| 0 — Baseline & tooling | ✅ Full |
| 1 — Env/config/deps | ✅ Full |
| 2 — Database layer | ✅ Full (all 163 tables checked for RLS; all migrations scanned for ordering/idempotency) |
| 3 — Security/auth/network | ✅ Full (all 14 admin + 28 cron + 3 worker + 5 webhook routes read line-by-line) |
| 4 — API routes (159 total) | ⚠️ Partial — targeted high-signal sweeps on ~117 non-cron/admin routes, not a full line-by-line pass |
| 5 — Business logic/engines | ⚠️ Partial — `cognition/` fully read (26/26 files); `ai/`+`universe/` (196 files) only spot-checked for idempotency and a wiring sweep whose reliability became questionable at scale (disclosed at the time, not chased further) |
| 6 — Frontend (215 files) | ⚠️ Partial — ISR/personalization, XSS, alt-text fully swept; loading/error-state sweep sampled 6/31 candidates (all false positives, remaining 25 unverified) |
| 7 — Dead code sweep | ✅ Reasonably thorough — zero-byte/truncated files, merge markers, all `@ts-ignore`/`@ts-expect-error` (0 found), all 16 `as any` and a representative sample of 85 `as unknown as` casts |
| 8 — Payments/compliance | ✅ Full flow trace for all 3 providers; age-verification bypass logic independently re-derived, not trusted from prior comments |
| 9 — Observability | ✅ Full — logging, redaction, Sentry wiring, cron failure-mode logging |
| 10 — Final gate | ✅ This document |

**Bottom line recommendation**: the codebase is in materially better shape than at the start of this session — 18 real bugs fixed and verified, including one severe one (`awardXp()` crashing on every message). Nothing found in the completed phases blocks a production launch outright, but items #1–3 above deserve a decision before or very shortly after go-live given their user-facing/compliance/deploy-risk nature. The two "partial" phases (4 and parts of 5/6) are the honest gaps if you want full confidence rather than high confidence — I'd prioritize a genuine line-by-line pass on the remaining ~117 API routes next if this goes further.
