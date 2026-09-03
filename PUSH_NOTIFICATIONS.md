# Push Notifications — Setup & Activation

Real OS/browser push (Web Push / VAPID), separate from the in-app SSE
stream at `/api/notifications` (which only fires while a tab is open).

## 1. Generate a VAPID keypair

```bash
npx web-push generate-vapid-keys
```

## 2. Set env vars (before building)

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<public key from step 1>
VAPID_PRIVATE_KEY=<private key from step 1>
VAPID_SUBJECT=mailto:support@vantrix.ink
```

`NEXT_PUBLIC_VAPID_PUBLIC_KEY` is inlined into the client bundle at build
time — set it in Vercel (or wherever you build) *before* deploying, not
just at runtime, or the client will build with no key and push will
silently no-op.

`CRON_SECRET` must already be set (it secures every `/api/cron/*` route,
including `/api/cron/nudges`, which now sends push).

## 3. Apply the migration

```bash
supabase db push
```

Creates `push_subscriptions` (see
`supabase/migrations/20260932_push_notifications.sql`).

## 4. Deploy

The service worker cache version was bumped to `v2`, so existing installs
pick up the new `push`/`notificationclick` handlers automatically on next
visit.

## 5. Cron — nothing to activate manually

`vercel.json` already schedules `/api/cron/nudges` every 6 hours. Vercel
calls it and authenticates with `CRON_SECRET` automatically. To smoke-test
it directly:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain.com/api/cron/nudges
```

Response includes `{ generated, markSent, pushSent }`.

## 6. End-to-end test

1. Sign in on a real HTTPS deployment (push is unreliable on `localhost`
   outside Chrome).
2. Wait ~45s — the opt-in prompt appears (`src/components/pwa/push-opt-in.tsx`).
3. Click **Enable**, accept the browser permission prompt.
4. Confirm a row appears in `push_subscriptions` for your `user_id`.
5. Send yourself a direct test push:

```ts
import { sendPushToUser } from '@/lib/push/send-push';
await sendPushToUser('your-user-id', { title: 'Test', body: 'It works!' });
```

If nothing arrives, check devtools → Application → Service Workers to
confirm `sw.js` v2 is active, and double check
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` was actually present at build time.

## Notes / limits

- Max 8 device subscriptions per user (oldest evicted on a 9th).
- Subscribe/unsubscribe are rate-limited (shared 30 req/min limiter).
- Only known browser push-service endpoints are accepted
  (`src/lib/push/known-endpoints.ts`) — closes an SSRF vector where a
  client could otherwise register an arbitrary URL as its subscription
  endpoint.
- Undelivered pushes expire after 24h (`TTL`) rather than queueing forever.
- Currently wired into: nudges cron. Character-initiative and
  surprise-engine deliveries still only go through in-app SSE — extending
  `sendPushToUser`/`sendPushToUsers` into those follows the same pattern
  used in `src/lib/notifications/nudge.ts`.
