-- ─────────────────────────────────────────────────────────────────────────
-- Character catalog — real persisted embeddings (pgvector)
-- ─────────────────────────────────────────────────────────────────────────
-- Same upgrade as 20260902_memory_graph_pgvector.sql, applied to the other
-- half of the gap services/brain/README.md's "Extending this later" section
-- describes: lib/recommendations/character-recommender.ts fetches a
-- popularity-ordered candidate pool by SQL (up to CANDIDATE_POOL_SIZE=100)
-- and reranks a trimmed slice of it LIVE via the brain service's /rerank on
-- every request. A character outside that pool — however well it'd match
-- the user's free-text query — can never surface, because it was never in
-- the pool the rerank call saw in the first place.
--
-- This migration adds the same missing piece 20260902_memory_graph_pgvector
-- added for memories: an `embedding vector(384)` column plus an IVFFlat
-- index, so /find-my-companion and POST /api/recommendations/characters can
-- search the *entire* eligible catalog by cosine similarity directly from
-- Postgres, not just whatever a popularity-ordered LIMIT 100 happened to
-- fetch. Embeddings are written once, asynchronously, at character
-- create/update time (see src/lib/ai/character-embeddings.ts) — never on
-- the request path, identical fail-open philosophy as the rest of this
-- system.
--
-- `vector` was already enabled by 20260902_memory_graph_pgvector.sql;
-- CREATE EXTENSION IF NOT EXISTS is repeated here so this migration is also
-- independently replayable against a fresh database regardless of ordering
-- assumptions about the other one.

create extension if not exists vector with schema extensions;

-- Nullable for the same reason memory_graph.embedding is nullable: rows
-- written before this migration, or while the brain service was down at
-- character-creation time, simply have no embedding and are excluded from
-- similarity search rather than treated as an error — see
-- backfillMissingCharacterEmbeddings() in character-embeddings.ts.
alter table public.characters
  add column if not exists embedding extensions.vector(384);

-- Partial IVFFlat index, scoped to the only rows a similarity search can
-- ever legally return (active, public, live, approved) — see
-- match_characters()'s WHERE clause below, which must stay in lockstep
-- with this predicate or Postgres will silently fall back to a sequential
-- scan instead of using the index. lists=100 follows the same reasoning as
-- the memory_graph index: reasonable for a catalog in the hundreds-to-low-
-- thousands, revisit if the public catalog grows past that by an order of
-- magnitude.
create index if not exists characters_embedding_ivfflat_idx
  on public.characters
  using ivfflat (embedding extensions.vector_cosine_ops)
  with (lists = 100)
  where embedding is not null
    and active = true
    and is_public = true
    and is_live = true
    and moderation_status = 'approved';

comment on column public.characters.embedding is
  'Sentence embedding (all-MiniLM-L6-v2, 384-dim) of "name. description. '
  'personality. tags", written asynchronously by '
  'src/lib/ai/character-embeddings.ts at character create/update time via '
  'services/brain''s /embed endpoint. NULL means either the row predates '
  'this column or the brain service was unavailable when it was written '
  '(fail-open — the character itself is never blocked, it just isn''t '
  'similarity-searchable until backfilled).';

-- ── Similarity search RPC ───────────────────────────────────────────────
-- Mirrors match_memory_graph's shape and rationale (single source of truth
-- for the distance operator + eligibility predicate, usable via
-- supabase-js .rpc(), and able to actually use the IVFFlat index above).
-- Filters are nullable/optional so one function serves every combination
-- recommendFilters (character-recommender.ts) currently supports, without
-- building raw SQL client-side.
create or replace function public.match_characters(
  p_query_embedding extensions.vector(384),
  p_gender          text    default null,
  p_category        text    default null,
  p_allow_nsfw      boolean default false,
  p_match_count     int     default 10,
  -- Same starting threshold as match_memory_graph and for the same reason:
  -- a deliberately loose default for all-MiniLM-L6-v2 on short text,
  -- meant to be tuned from observed score distributions, not guessed
  -- forever.
  p_max_distance    float   default 0.6
)
returns table (
  id              uuid,
  name            text,
  description     text,
  personality     text,
  category        text,
  tags            text[],
  image_url       text,
  gender          text,
  is_nsfw         boolean,
  like_count      integer,
  follower_count  integer,
  similarity      float
)
language sql
stable
as $$
  select
    c.id,
    c.name,
    c.description,
    c.personality,
    c.category,
    c.tags,
    c.image_url,
    c.gender,
    c.is_nsfw,
    c.like_count,
    c.follower_count,
    1 - (c.embedding <=> p_query_embedding) as similarity
  from public.characters c
  where c.embedding is not null
    and c.active = true
    and c.is_public = true
    and c.is_live = true
    and c.moderation_status = 'approved'
    and (p_allow_nsfw or c.is_nsfw = false)
    and (p_gender is null or c.gender = p_gender)
    and (p_category is null or c.category = p_category)
    and (c.embedding <=> p_query_embedding) <= p_max_distance
  order by c.embedding <=> p_query_embedding
  limit p_match_count;
$$;

-- RLS: characters already has RLS enabled; this RPC is only ever called
-- from server code via supabaseAdmin (see character-embeddings.ts), same
-- posture as match_memory_graph. Documented explicitly for the same reason.
grant execute on function public.match_characters(extensions.vector(384), text, text, boolean, int, float) to service_role;
