# Dating Domain — Audit (no product-decision gaps found, 1 real bug fixed)

Follow-up sweep specifically scoped to `/dating/*` — the 17 API routes under
`src/app/api/dating`, `src/lib/dating/*`, the dating components/hooks, and
`src/app/(app)/dating/*`. Same method as `BURIED_FEATURES_REPORT.md` and
`FRONTEND_WIRING_SWEEP_2026-08-20.md`: read every route end-to-end, verify
every backend export has a real caller, verify every route is reachable from
a page/hook, and check ownership scoping on every read/write.

## Result

Unlike the feed/admin/referrals domains audited in prior sessions, dating
came back essentially fully wired: swipe → match → chemistry → compatibility
→ forecast → gifts → first dates → milestones → prestige chapters → mood
sync → Tonight's Match / Unexpected Chemistry ("Your World" home) → share
cards all have live backend routes with real frontend consumers, and every
`engine.ts` / `prestige-chapters.ts` export has a live caller. No dead code,
no unwired backend, nothing needing a product/IA decision the way
`/universe/*` or the referral embeds did.

## Fixed

### 1. `GET /api/dating/gifts` — IDOR, gift history readable by any authenticated user
**File:** `src/app/api/dating/gifts/route.ts`

Every other route in this file (and every other dating route generally)
verifies `dating_matches.user_id === requesting user` before trusting a
client-supplied `matchId`. This GET handler was the one exception — it
queried `dating_gifts` filtered only by `match_id`, with no ownership check
at all. Since `matchId` is a plain UUID passed as a query param and the
route uses the service-role client (RLS doesn't apply), any authenticated
user could read another user's full gift history — including the private
note text attached to a gift — by guessing or enumerating match IDs.

**Fix:** added the same `.eq('id', matchId).eq('user_id', user.id)`
ownership check the POST handler above it already uses, returning 404
(not 403) for a match that isn't the caller's — consistent with how every
other route in this domain treats an out-of-scope ID.

## Flagged, not touched — already a documented, deliberate scope decision

**`POST /api/dating/share-card`** — `characterName`/`characterImage`/
`bondScore`/`matchTier`/`compatibility`/`mood`/`streakDays`/`daysKnown` are
still client-supplied with no server-side re-derivation from the real
`dating_matches`/`dating_compatibility` rows. The route's own header
comment already documents this as a known residual (only the "does a
relationship with this character exist at all" check was added, not full
stat verification) and calls it out as separate, larger scope. Not
re-opened here — the existing UI never sends fabricated numbers, so this is
purely a hardening item for a direct API call, not a functional bug.

## Files touched
`src/app/api/dating/gifts/route.ts` (GET handler — added ownership check)
