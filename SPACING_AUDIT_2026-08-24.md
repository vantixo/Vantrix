# Vantrix — Spacing/Padding Audit

**Scope:** app-wide pass over all 280 `.tsx` files (~26.7k lines) for spacing/padding
consistency and correctness — page-shell containers, loading skeletons, shared
chrome (Sidebar/TopBar/BottomNav/MobileDrawer), UI primitives (`Card`, `Button`,
`Badge`, `Tabs`), modal/bottom-sheet patterns, and repeated card components.

---

## Bugs found and fixed (2)

### 1. BottomNav safe-area clearance shortfall — app-wide, every mobile page
`(app)/layout.tsx`'s `<main>` reserved a flat `pb-16` (64px) to clear the fixed
`BottomNav`. But `BottomNav` itself is 64px **plus**
`pb-[env(safe-area-inset-bottom)]` for the iOS home-indicator inset. On any
notched/home-indicator device, the nav renders taller than the space `<main>`
reserved for it, so the bottom ~20–34px of content on *every* route in the app
sat behind the (opaque) nav bar — most visible as the last item in a list or a
sticky CTA getting clipped.

**Fix:** `pb-16` → `pb-[calc(4rem+env(safe-area-inset-bottom))]` on `<main>`, so
it always matches the nav's real rendered height instead of a hardcoded guess.

```
src/app/(app)/layout.tsx
```

### 2. Loading skeletons missing responsive horizontal padding — 24 routes
Every real page under `(app)/` uses `px-4 md:px-8` on its top-level container
(verified this is a genuine, consistent, app-wide convention — every page.tsx
checked follows it). But 22 of the matching `loading.tsx` route skeletons, plus
two real pages (`roleplay/new`, `roleplay/new/[characterId]`) that were missed
when the convention was applied, only had `px-4`. Result: on tablet/desktop
widths, content visibly jumped 16px inward the instant the real page replaced
its own skeleton — a layout shift on effectively every route transition.

**Fix:** added `md:px-8` to match each route's own real page container exactly
(spot-checked that `py-*` values already matched between every page/loading
pair — only the horizontal padding was missing).

Files fixed (24):
- `(app)/chats/loading.tsx`
- `(app)/characters/[id]/loading.tsx`, `(app)/characters/[id]/page.tsx` (NSFW-gated placeholder block)
- `(app)/community/loading.tsx`, `(app)/community/[slug]/loading.tsx`, `(app)/community/posts/[id]/loading.tsx`
- `(app)/dating/loading.tsx`, `(app)/dating/matches/loading.tsx`, `(app)/dating/match/[id]/loading.tsx`
- `(app)/digital-twin/loading.tsx`
- `(app)/notifications/loading.tsx`
- `(app)/premium/success/loading.tsx`
- `(app)/profile/loading.tsx`, `(app)/profile/settings/loading.tsx`, `(app)/profile/tokens/loading.tsx`
- `(app)/referrals/loading.tsx`
- `(app)/roleplay/new/page.tsx`, `(app)/roleplay/new/[characterId]/page.tsx`
- `(app)/studio/loading.tsx`, `(app)/studio/[id]/loading.tsx`, `(app)/studio/create/loading.tsx`
- `(app)/world/locations/[slug]/loading.tsx`, `(app)/world/factions/[slug]/loading.tsx`

---

## Checked, found consistent — no change made

- **All top-level page containers** (`mx-auto max-w-* px-4 md:px-8 py-*`) —
  confirmed a real, deliberate 3-tier vertical rhythm: `py-6` (list/content
  pages), `py-8` (personal/settings/form pages), `py-10` (the two monetization
  pages, `/premium` and `/profile/tokens` — matches both ways, so this is a
  tier, not a stray outlier).
- **Public/marketing pages** (`/about`, `/discover`, `/terms`, `/privacy`,
  `/support`, `/(seo)/*`) — same `px-4 md:px-8` convention, just written in a
  different (still-valid) class order in a few files.
- **Bottom-sheet modals** (`report-modal.tsx`, `all-milestones-drawer.tsx`) —
  byte-identical shared pattern: `max-h-[85vh] ... rounded-t-lg border p-4 sm:rounded-lg`.
- **Shared chrome height alignment** — `Sidebar` header and `TopBar` are both
  `h-16`; `BottomNav`'s content row is also `h-16` (the safe-area padding sits
  *outside* that, which is what caused bug #1).
- **Paired dating cards** (`tonight-match-card` / `locked-tonight-match-card`)
  — identical `p-4 sm:p-6` overlay padding, as expected for locked/unlocked
  states of the same card.
- **Admin stat cards** (`admin-stat-card.tsx` / `kpi-card.tsx`) — identical
  `p-5` / `mb-3` / `mt-1` structure.
- **5 arbitrary-value spacing classes** app-wide (`pb-[env(...)]`,
  `pt-[max(...)]`, `p-[2px]`) — all deliberate (safe-area insets, a 2px
  gradient-ring border), not the "someone eyeballed a pixel value" kind of
  arbitrary. Left as-is.
- Ran a heuristic sweep across the 48 files that combine a `space-y-*`
  container with `.map()` rendering, looking for mapped items that also carry
  their own `mb-`/`mt-`, which would double up spacing between siblings. All
  ~56 hits inspected turned out to be internal spacing *within* a single list
  item (e.g. a heading's `mb-3` above its own body text), not a duplicate gap
  between siblings — no bug found.

## Coverage disclosure

| Area | Status |
|---|---|
| Page-shell containers (all `page.tsx`) | ✅ Full |
| Loading skeletons (all `loading.tsx`) | ✅ Full |
| Shared chrome (Sidebar, TopBar, BottomNav, MobileDrawer) | ✅ Full |
| UI primitives (`Card`, `Button`, `Badge`, `Tabs`) | ✅ Full |
| Modal/bottom-sheet components (7 found) | ✅ Full |
| Arbitrary-value (`[...]`) spacing classes | ✅ Full (5 found, all reviewed) |
| `space-y-*` + `.map()` double-margin heuristic | ✅ Swept (48 candidate files, 56 hits, all cleared) |
| Card components (25 found across dating/admin/home/feed/etc.) | ⚠️ Partial — spot-checked ~10 of 25, all consistent within their own family; the remaining ~15 (community, world, studio, home, premium card variants) weren't individually diffed against their siblings |
| Remaining component tree beyond the above (~200 files) | ⚠️ Not individually read line-by-line — no arbitrary-value or structural red flags surfaced in the targeted greps run against the whole tree, but this isn't the same as a full manual pass |

**Bottom line:** the codebase's spacing discipline was already good going in —
the two bugs found were both structural (a skeleton/page convention drift and
a safe-area miscalculation), not sloppy inline styling. Both are fixed and
verified against every sibling file that should match. If you want the
remaining ~15 unreviewed card components covered too, say the word and I'll
keep going.
