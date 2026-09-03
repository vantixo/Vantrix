# Chat System Audit — 2026-08-22

Scope: `POST /api/chat/stream` (the live SSE chat path — `use-chat-stream.ts`
calls this, not the older non-streaming `/api/chat`), its Redis-backed
concurrency/rate/dedup primitives in `security.ts` and `rate-limit/`, and the
client hook. Goal: find what an adversarial or merely unlucky concurrent
client could do to break correctness or run up cost — not a full line-by-line
review of all ~90 imported cognition/relationship engines the route calls
into (that surface is enormous; flagged as a follow-up below, not covered
here).

## Finding 1 (fixed) — Stream concurrency guard could be defeated by an
unrelated failing request on the same conversation

**Severity: High.** Silently defeats a same-conversation double-submit/race
guard, enabling doubled LLM spend and out-of-order/duplicated persisted
messages. Exploitable by any authenticated user against their own
conversations — no privilege escalation needed, just malformed-but-authed
requests fired during a real generation.

**Where:** `src/app/api/chat/stream/route.ts`, the character-existence /
tier-gate / mature-content pre-check block (~line 425-460), which runs
*before* `acquireStreamSlot()` is ever called for the request (that happens
later, in the rate/cap/slot `Promise.all` at ~line 488).

**What was wrong:** Three early-rejection branches in that pre-check block —
character not found/inactive, tier-gated, NSFW-gated — each called
`await releaseStreamSlot(userId, streamScopeId)` before returning. But
`releaseStreamSlot()` is an *unconditional* Redis `DECR` on
`stream:slots:{userId}:{streamScopeId}` (see `security.ts`) with no check
that the calling request ever held that slot. Since these branches ran
before `acquireStreamSlot()`, they were decrementing a counter their own
request had never incremented.

**Exploit path:**
1. User (or script) sends a real message to conversation `C` — a genuine
   generation starts, `acquireStreamSlot` brings the slot counter for
   `stream:slots:{userId}:C` to `1` (`MAX_STREAMS_PER_CONVERSATION = 1`).
2. While that's still streaming, the same user fires a second request with
   the **same `conversationId: C`** but a `characterId` engineered to fail
   one of the three early checks — e.g. a `characterId` for a different,
   NSFW-gated character they haven't opted into, or any inactive/deleted
   character UUID. `streamScopeId` resolves to `conversationId ?? characterId`,
   so it's still `C` regardless of which (bogus) character was named.
3. That request 404s/403s — but on the way out it calls
   `releaseStreamSlot(userId, "C")`, decrementing the real stream's slot
   counter back to `0`.
4. A third request — a genuine double-submit on conversation `C` — now
   passes `acquireStreamSlot` and races the still-in-flight first
   generation. `MAX_STREAMS_PER_CONVERSATION = 1`'s entire purpose (per its
   own comment in `security.ts`) is preventing exactly this.

**Fix applied:** removed the four early `releaseStreamSlot()` calls that ran
before slot acquisition (one in the load-shedder check, three in the
character-gate block). Nothing before `acquireStreamSlot()` needs to release
a slot it never took. Left a comment at each site explaining why, plus a
block comment at the gate site documenting the exploit for future
maintainers touching this ordering. Every `releaseStreamSlot()` call *after*
acquisition (~15 call sites, all correctly guarded, including the
`try/finally` at stream end) was left untouched — those are legitimate.

**Updated file delivered:** `src/app/api/chat/stream/route.ts` (below).

## Areas checked and found solid

- **`checkDeduplication`** (`security.ts`) — atomic Redis `SET NX EX`, no
  TOCTOU window. A genuine simultaneous double-click can't both pass.
- **`acquireStreamSlot`** — atomic Lua (`INCR` + compare + conditional
  `DECR` in one script), no race between the check and the increment. Only
  `releaseStreamSlot` (a separate, unconditional decrement) was the problem.
- **`checkChatLimit`** (per-minute burst) — Redis-backed sliding window with
  a local-fallback degrade path if Redis is unreachable (fails closed to a
  conservative local limiter, not fully open).
- **Gate ordering vs. quota counters** — the existing `QUOTA-INTEGRITY FIX`
  correctly moved the cheap character-existence/tier/mature check ahead of
  `checkDailyMessageCap`/`checkPerCharacterMessageCap` so a doomed request
  against a bad character doesn't burn a free-tier user's daily/per-character
  allotment. This ordering is why the slot-release bug above existed
  (the gate block got moved earlier than slot acquisition) — worth knowing
  if this section gets touched again.
- **Post-stream cleanup** — `controller.close()` failing on client
  disconnect is wrapped in `try {} catch {} finally { releaseStreamSlot }`,
  so a client tab-close/nav-away mid-stream still releases the slot instead
  of leaking it for the full 120s TTL.
- **Crisis-detection short-circuit** — runs before stream-slot acquisition,
  the anomaly-suspension gate, and any model routing, and persists the
  turn without going through any engine layer. Correctly can't be starved
  by the earlier body-size/auth checks since those still gate it, but a
  crisis-flagged message never reaches cost/rate gates meant for normal
  chat — intentional per the comment, worth confirming that's still the
  desired product behavior (a crisis reply currently doesn't count against
  daily/per-character caps at all, which seems right, but flagging since
  it's a deliberate exception to note if caps are ever audited for revenue
  leakage).

## Not covered in this pass (flag for a follow-up)

- The ~90 imported relationship/cognition engines the route composes into
  the final prompt (`assembleFullPrompt`, `runCognitionCycle`, etc.) — each
  one is a possible source of a thrown exception mid-stream. Worth an
  audit specifically of "does every engine call have a fail-open path,"
  since one unguarded throw deep in that chain would 500 the whole stream.
  Skimmed a handful and they're consistently wrapped/optional-chained, but
  I didn't verify all ~90.
- `src/lib/queue/worker.ts` (the async/queued fallback path) wasn't audited
  this pass — only the live SSE path.
- No live load test was run against a deployed instance — this container
  has no outbound network access, so `load-test-chat.mjs` (below) is
  written for you to run against your own dev/staging URL rather than
  something I executed here. It includes a scenario that specifically
  re-creates the double-submit race from Finding 1, so you can confirm the
  fix holds under real concurrency before it ships.
