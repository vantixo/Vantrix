# Feed frontend — connecting backend to frontend

## What was already connected (verified, not touched)
Dating mood-sync: use-dating-mood-sync.ts -> GET /api/dating/matches?characterId=
-> POST /api/dating/mood, wired into chat-window.tsx. Confirmed end-to-end,
no changes needed.

## Real gap found and fixed: /feed page never existed
/api/feed/posts (+ /like, /comments) — Redis-cached, rate-limited, moderated,
locked-post-image-redacted character-post feed — had zero consuming page.
Same failure mode nav-config.ts already flagged and fixed once for /community.

### New files
- src/types/feed.ts
- src/lib/frontend/feed.ts       (getFeedPosts — fetchInternal, mirrors community.ts)
- src/hooks/use-feed.ts          (fetchPosts/toggleLike/fetchComments/submitComment)
- src/components/feed/feed-post-card.tsx
- src/components/feed/feed-comments.tsx
- src/components/feed/feed-grid.tsx
- src/app/(app)/feed/page.tsx
- src/app/(app)/feed/loading.tsx

### Modified
- src/components/shell/nav-config.ts   — added Feed (rail + drawer; not in
  bottom-nav's 5-item subset, matching Community's precedent)
- src/lib/frontend/profile.ts          — real tsc error: ProfileSettings.created_at
  is non-nullable but the DB column is nullable; coalesced with a logged fallback
  instead of crashing the Settings page type-check
- src/__tests__/sec-10-paystack-recurring-billing.test.ts — pre-existing false
  failure, unrelated to this pass: test only checked vercel.json for the
  paystack-renewal cron, but CRON_TIERS.md's own documented free-tier design
  deliberately moves sub-daily crons to the GitHub Actions workflow instead.
  Fixed to check both sources.

## Known backend limitation surfaced (not fixed, flagged in code comment)
/api/feed/posts only applies cursor pagination on filter=new/all — filter=trending
always re-runs its likes_count query unfiltered. FeedGrid's "Load more" is
gated to hide on trending (mirrors discussion-feed.tsx's identical `sort ===
"new"` gate for the same reason) rather than risk duplicate-keyed re-fetches.

## Verified (this session, cold)
- npm ci: exit 0
- tsc --noEmit: exit 0
- next build: exit 0, /feed compiles (7.71 kB)
- vitest run: 53 files, 388 passed, 15 skipped, exit 0
- next lint: not run — no eslint config shipped in this zip (pre-existing,
  unrelated to this pass)
