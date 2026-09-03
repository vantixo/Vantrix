# Vantrix — Production Readiness Fixes (2026-08-20)

Verified against the actual codebase (not just the audit doc). Every claim
below was confirmed by reading the relevant file before and after the fix.
Full project `tsc --noEmit` and `next build` both pass clean with these
changes applied.

## Fixed — P0 age/NSFW gating (§0.1, §7.6, §13.1)

**Problem:** `checkMatureContentAccess()` (used by chat/stream,
queue/enqueue, dating/swipe) correctly required both sign-in AND
`is_user_age_verified()` AND `nsfw_enabled` before releasing mature
content. Every *discovery-level* surface — the ones that decide whether an
NSFW character shows up in a list at all — only checked `nsfw_enabled`,
with several docstrings explicitly noting "age is not re-checked here."
That meant any signed-in user, verified or not, could see and act on NSFW
characters just by flipping a settings toggle.

**Fix:** added `resolveNsfwDiscoveryAccess(userId)` to
`src/lib/access/character-gate.ts` — the single shared check (age
verification AND preference) — and pointed every listing surface at it:

- `src/app/api/characters/route.ts`
- `src/app/api/recommendations/route.ts`
- `src/app/api/recommendations/characters/route.ts`
- `src/app/api/discover/featured/route.ts`
- `src/app/api/dating/deck/route.ts`
- `src/app/api/dating/matches/route.ts`
- `src/app/api/dating/world/route.ts`

**Also fixed — direct character URLs (§0.1.5 / §12.7):**
`getCharacterDetail()` (`src/lib/frontend/characters.ts`) didn't even
select `is_nsfw`, so `/characters/[id]` rendered full mature character
metadata/image to any signed-in user with zero gate. Now selects
`is_nsfw` and the page (`src/app/(app)/characters/[id]/page.tsx`) checks
`resolveNsfwDiscoveryAccess()` before rendering, showing a "verify to
view" placeholder instead of the character otherwise.

**Also fixed — the preference itself (§0.1.8):**
`PATCH /api/profile/settings` let anyone set `nsfw_enabled: true` with no
server-side age check. Now returns `403 AGE_VERIFICATION_REQUIRED` unless
`is_user_age_verified()` is true, closing the gap at write-time as well
as read-time.

## Fixed — privileged RPC (§0.2, §9.3)

`20261026_fix_identity_bearing_rpcs.sql` re-secured 6 of 7 identity-bearing
`SECURITY DEFINER` RPCs the audit flagged, but **`can_send_message`** was
left out — still `GRANT`ed to `authenticated`, no `auth.uid()` check in
its body. Added `supabase/migrations/20260820_fix_can_send_message_rpc.sql`
applying the same fix: `auth.uid() = p_user_id` guard + `REVOKE EXECUTE`
from `anon`/`authenticated`/`PUBLIC`. No live caller was using it (confirmed
by grep — only appears in generated types), so this closes a dormant hole,
not a functional regression.

## Fixed — broken routing (§1, §2, §14.1)

| Was | Now |
|---|---|
| `/discover` referenced everywhere, no page existed | Built `src/app/discover/page.tsx` — public marketing/browse page on top of the existing `getDiscoverHome()` helper |
| `/auth/login` referenced in landing-page CTAs/comments | Fixed to `/login` (the real route) in `src/lib/seo/landing-pages.ts` |
| `/settings/billing` referenced in refund/dispute notifications | Fixed to `/premium` (the real billing surface) in `src/lib/payments/revocation.ts` |
| Footer linked to `/about /careers /blog /support /terms /privacy` — none existed | Built all six as real pages under `src/app/` |
| `sitemap.ts` only listed `/login` | Now lists all seven real public routes |
| `robots.ts` only allowed auth pages | Now allows the new public pages too |

**Note on `/terms` and `/privacy`:** these are structurally complete
drafts referencing real product facts already in the codebase (18+
requirement, AI disclosure, the refund/dispute grace-period policy,
payment providers), but are explicitly labeled in-page as **pending legal
review** — they are not a substitute for actual counsel sign-off before
launch, especially for jurisdiction-specific requirements (GDPR, CCPA,
etc).

## Verification

```
npx tsc --noEmit     # clean, no errors
npx next build        # clean, all routes compile including the new ones
```

## Not touched in this pass — still open from the original audit

## Fixed — dating milestones still silent from normal chat (follow-up)

**Problem:** MOOD-SYNC-FIX (above/elsewhere in this pass) made
`POST /api/dating/mood` actually get called from real chat sessions again,
so `first_chat`/`deep_talk`/`week_streak`/`soulmate` started firing for the
first time in practice. But the route itself never told the user when one
did — no `emitNotification`, no `recordSurprise`, just the silent
`dating_milestones` insert and (for world-impact-eligible ones) a trace
entry. Gift- and date-triggered milestones already called `recordSurprise()`
(MILESTONE-CHAT-FIX, `gifts/route.ts` / `date/[id]/complete/route.ts`) so
they showed an in-chat toast; chat-triggered milestones — the ones a user
hits far more often — did not.

**Fix:** `src/app/api/dating/mood/route.ts` now fetches the character's
name and calls `recordSurprise()` for each triggered milestone, in the
same place and same message format the gifts route already uses. Reaches
the in-chat `MilestoneToastStack` via the existing `character_surprises`
SSE stream — no new delivery mechanism needed, matching every other
milestone source.

These are real product/scope decisions, not mechanical fixes, and
weren't attempted here:

- §0.2.1 final DB verification that the RPC revokes actually match
  production (this pass only fixed the code/migrations)
- §3.3–3.6 creator identity/follow/monetization — no data model decision made
- §6.7 dormant engines (`runPracticeSession`, `considerAutomaticResponse`,
  `planner.ts`, prediction-engine `predict()`) — need product semantics,
  not a bug fix
- §11.6 business-level alerting, §11.7 runbooks — ops process, not code
- §13.2 `REQUIRE_DOCUMENT_VERIFICATION_FOR_EXPLICIT` — operator decision
  on self-attestation vs. real document verification
- §13.5/13.6/13.7 creator terms, AI disclosure policy, mature-content
  policy — legal/policy documents, not routes
- §17.1 the ~3K-line chat route, §17.6 domain boundaries — refactor-scale
  engineering work
- Blog page is intentionally empty (no fabricated posts); Careers page
  has no fabricated job listings — both are honest placeholders pointing
  to a contact email instead of invented content
