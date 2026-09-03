# Vantrix Services

This folder holds services that run separately from the main Next.js app.

- **brain/** — Python semantic-memory service (FastAPI). Actively used by
  the monolith via `BRAIN_SERVICE_URL` (see `src/app/api/chat/route.ts`,
  `src/app/api/chat/stream/route.ts`, `src/lib/ai/semantic-memory.ts`).

A prior microservices migration scaffold (gateway + 13 Node/Express
services: auth, user, discovery, character, chat, ai, memory, wallet,
billing, affiliate, notification, media) was removed. All of that
functionality lives in the Next.js monolith under `src/app/api/**`, which
remains the single source of truth for those routes.
