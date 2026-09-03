-- ─────────────────────────────────────────────────────────────────────────
-- Memory Graph — real persisted embeddings (pgvector)
-- ─────────────────────────────────────────────────────────────────────────
-- Closes the gap described in services/brain/README.md's "Extending this
-- later" section: today semantic-memory.ts calls the brain service's
-- /rerank endpoint LIVE, on every chat turn, against whatever small
-- candidate set getMemoryGraph() already fetched by SQL (emotional_weight +
-- recency order). There is no persisted embedding, no vector column, no ANN
-- index anywhere — "semantic memory" is a per-request reranking of an
-- already-truncated list, not retrieval.
--
-- This migration adds the missing storage: an `embedding vector(384)` column
-- (384 = all-MiniLM-L6-v2's output dimension — see services/brain/main.py's
-- MODEL_NAME) plus an IVFFlat ANN index, so memories can be retrieved by
-- cosine similarity directly from Postgres instead of only re-sorted after
-- the fact. Embeddings are written once, asynchronously, at memory-creation
-- time (see src/lib/ai/memory-embeddings.ts) — never on the request's
-- critical path, same fail-open philosophy as the rest of this system.
--
-- Requires the `vector` extension, which Supabase enables by default under
-- `extensions` schema; CREATE EXTENSION IF NOT EXISTS is safe to run
-- repeatedly and is a no-op if already enabled.

create extension if not exists vector with schema extensions;

-- Nullable: rows written before this migration (or written while the brain
-- service was down at insert time) simply have no embedding and are
-- excluded from similarity search, not treated as an error. This is the
-- same fail-open contract semantic-memory.ts already documents.
alter table public.memory_graph
  add column if not exists embedding extensions.vector(384);

-- IVFFlat requires an approximate row count to size `lists` sensibly; 100 is
-- a reasonable default for the expected per-character/per-user cardinality
-- (a handful to a few hundred memories per pair, not millions). Revisit if
-- a single user_id/character_id pair ever grows unusually large — this
-- index is global across all pairs, filtered by the WHERE clause in the
-- query function below, not partitioned per pair.
create index if not exists memory_graph_embedding_ivfflat_idx
  on public.memory_graph
  using ivfflat (embedding extensions.vector_cosine_ops)
  with (lists = 100)
  where embedding is not null;

-- Speeds up the common WHERE user_id = ? AND character_id = ? filter that
-- always accompanies the similarity search below (IVFFlat alone doesn't
-- help with equality filters).
create index if not exists memory_graph_user_character_idx
  on public.memory_graph (user_id, character_id);

comment on column public.memory_graph.embedding is
  'Sentence embedding (all-MiniLM-L6-v2, 384-dim) of "title. description", '
  'written asynchronously by src/lib/ai/memory-embeddings.ts at memory-'
  'creation time via services/brain''s /embed endpoint. NULL means either '
  'the row predates this column or the brain service was unavailable when '
  'the memory was created (fail-open — the memory itself is never blocked '
  'or lost, it just isn''t retrievable by similarity until backfilled).';

-- ── Similarity search RPC ───────────────────────────────────────────────
-- Wrapped in a SQL function (rather than building the raw `<=>` query with
-- the JS client) so:
--   1. The distance operator and column name are defined in exactly one
--      place — every caller, present and future, gets identical semantics.
--   2. It can be called via supabase-js's `.rpc()`, which composes cleanly
--      with `.eq()`-style filters is not needed since scoping is baked in
--      as required params.
--   3. Postgres can use the IVFFlat index (a hand-built query from the JS
--      client risks quietly falling back to a sequential scan if the
--      generated SQL shape doesn't match the indexed operator class).
create or replace function public.match_memory_graph(
  p_user_id        uuid,
  p_character_id   uuid,
  p_query_embedding extensions.vector(384),
  p_match_count    int default 8,
  -- Cosine distance (0 = identical, 2 = opposite); reject weak matches
  -- rather than always returning the "closest of a bad bunch". 0.6 is a
  -- deliberately loose starting threshold for all-MiniLM-L6-v2 on short
  -- text — tune based on observed score distribution, not guessed forever.
  p_max_distance   float default 0.6
)
returns table (
  id                uuid,
  event_type        text,
  title             text,
  description       text,
  emotional_weight  smallint,
  tags              text[],
  created_at        timestamptz,
  similarity        float
)
language sql
stable
as $$
  select
    mg.id,
    mg.event_type,
    mg.title,
    mg.description,
    mg.emotional_weight,
    mg.tags,
    mg.created_at,
    1 - (mg.embedding <=> p_query_embedding) as similarity
  from public.memory_graph mg
  where mg.user_id = p_user_id
    and mg.character_id = p_character_id
    and mg.embedding is not null
    and (mg.embedding <=> p_query_embedding) <= p_max_distance
  order by mg.embedding <=> p_query_embedding
  limit p_match_count;
$$;

-- RLS: memory_graph already has RLS enabled (service-role bypasses it, and
-- this RPC is only ever called from server code via supabaseAdmin — see
-- memory-embeddings.ts). Nothing to change here, but documented explicitly
-- so a future reviewer doesn't assume this function needs its own policy.
grant execute on function public.match_memory_graph(uuid, uuid, extensions.vector(384), int, float) to service_role;
