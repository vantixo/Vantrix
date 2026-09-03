# Vantrix Brain

A small Python service that adds real semantic intelligence to memory
retrieval — replacing rule-based ranking with an actual embedding model.

## What it does

Given the user's current message and a character's candidate memories, it
returns the memories re-ordered by semantic similarity — so a character
recalls the moment that's actually relevant to what's being said right now,
not just whichever memory has the highest `emotional_weight`.

## Why it's separate from the Next.js app

Next.js/Vercel can't run a persistent Python process with a loaded ML model.
This runs as its own small service — locally via Docker Compose (see
`docker-compose.yml` in the repo root), or deployed anywhere that can run a
container (Fly.io, Railway, a VPS, your own hardware). Zero per-request API
cost — the model runs locally, CPU is enough.

## Running locally

```bash
cd services/brain
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Or via Docker Compose from the repo root: `docker compose up brain`.

## Wiring it up

Set `BRAIN_SERVICE_URL` (e.g. `http://localhost:8000` or `http://brain:8000`
in Docker Compose) in your env. That's it — `src/lib/ai/semantic-memory.ts`
picks it up automatically. Leave it unset and the app behaves exactly as it
did before this service existed (fail-open, no reranking, zero risk).

## Endpoints

- `GET /health` — model load status.
- `POST /embed` — `{ texts: string[] }` → embedding vectors. General-purpose;
  not currently called by the Node app, but available for future use
  (e.g. semantic character search, duplicate-caption detection for
  auto-posts).
- `POST /rerank` — `{ query: string, candidates: [{id, text}] }` → candidates
  sorted by cosine similarity to `query`. This is what
  `semanticRerankMemories()` calls.

## Model

`sentence-transformers/all-MiniLM-L6-v2` — 22M params, ~90MB, free, no API
key, runs fine on CPU. Baked into the Docker image at build time so the
container never needs network access to Hugging Face at runtime.

## Extending this later

The natural next step beyond reranking existing memories is using `/embed`
to do actual semantic search — e.g. embed every memory once at write-time,
store the vector, and query by similarity directly instead of reranking a
small candidate set fetched by SQL. That needs a vector column/index
(pgvector on Supabase is the natural fit) — not implemented here; this
service currently reranks whatever `getMemoryGraph()` already fetched.

**Character recommendation (implemented):** `src/lib/recommendations/
character-recommender.ts` reuses this same `/rerank` endpoint — not
`/embed` — to semantically rank the character catalog against a user's
free-text description (see `/find-my-companion` and `POST
/api/recommendations/characters`). It fetches a candidate pool by SQL
(popularity-ordered, filtered by NSFW/gender/category) and reranks that
pool per-request, same shape as the memory reranking above — no vector
column yet. If candidate-pool-fetch-then-rerank ever becomes a bottleneck
(large catalog, high request volume), that's the point to revisit
`/embed` + pgvector: embed each character once at write-time (character
create/update), store the vector, and query by similarity directly
instead of reranking a freshly-fetched pool on every request.
