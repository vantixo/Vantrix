# Feed — Instagram-style redesign + premium wiring

## 1. Generated posts (done directly against the live Supabase project, not just code)
- 65/65 live, approved characters now have post history (was 34/65 with
  exactly 1 post each, 31 with zero). Backfilled to 5 posts/character,
  timestamps spread over the last ~3-19 days.
- 291 new `character_posts` rows inserted; likes/comments randomized within
  the range the existing organic data already used (88-720 likes,
  8-116 comments) so new content blends in.
- 37 of the new posts are real locked "teaser" posts — see #2.

## 2. Real gap fixed: premium/locked posts were never actually created
`runCharacterFeedCron()` (src/lib/ai/character-feed.ts) hardcoded
`is_locked: false` on every insert, for every post, always. The feed's
entire lock/"Unlock with Premium" UI and the API's image-redaction logic
(feed/posts/route.ts) were real and correct — they just had zero posts to
ever act on. `is_locked` is now `postType === 'teaser'`, so the premium
upsell this UI was built for actually fires going forward, not just in
today's one-time backfill.

## 3. Instagram-style redesign
- `/feed` is now a single centered column (~520px), not a 2-up grid.
- New stories rail (`feed-stories-rail.tsx`): gold-ringed avatars of
  companions from the loaded feed, tap to filter to just their posts —
  no new backend call, reuses data already on the page.
- Post card rebuilt to IG conventions: media first, action row (like /
  comment / share) below it, bold likes count, "**Name** caption" line,
  "View all N comments", compact timestamp.
- Double-tap-to-like on the image with a heart-burst animation
  (framer-motion); single tap still opens the existing lightbox.
- Share icon uses the native share sheet where available, else copies a
  link to clipboard.
- Locked teaser posts get a real premium panel (icon + copy + a solid
  "Unlock with Premium" button to /premium) instead of the old bare lock
  icon + text link.
- Restrained fade/rise-in on post mount; loading skeleton rebuilt to match
  the new layout.

## Modified
- src/lib/ai/character-feed.ts  (is_locked fix)
- src/components/feed/feed-post-card.tsx  (rewritten)
- src/components/feed/feed-grid.tsx  (rewritten)
- src/app/(app)/feed/page.tsx
- src/app/(app)/feed/loading.tsx
- src/hooks/use-feed.ts  (fetchPosts now accepts an optional character filter)
- src/lib/utils.ts  (timeAgo gained an optional `short` mode; existing callers unaffected)

## New
- src/components/feed/feed-stories-rail.tsx

## Verified (this session, real install — network access to npm was
available, unlike prior sessions' offline sandbox)
- npm ci: exit 0 (774 packages)
- tsc --noEmit: exit 0, project-wide
- next build: exit 0, /feed compiles (10.9 kB)
- next lint (touched files): no warnings or errors
- vitest run: 58 files, 447 passed, 15 skipped, exit 0
