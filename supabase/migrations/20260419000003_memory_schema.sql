-- Shared memory store for all 9 agents. Holds episodic / procedural / semantic / preferences rows.
-- Phase 1 uses pg_trgm text search via search_memory_text(); embeddings (vector(1024)) are
-- declared now so HNSW index exists, but populated in Phase 1.5 when Voyage embedding job lands.

create extension if not exists vector;

create type memory_kind as enum ('episodic', 'procedural', 'semantic', 'preferences');

create table memory (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references pharmacies(id) on delete cascade,
  kind memory_kind not null,
  source text not null,          -- who wrote this: 'kaleem', 'research_analyst', 'reflector', 'portfolio_manager', 'system', etc.
  content text not null,
  embedding vector(1024),        -- Voyage voyage-3 uses 1024 dims; nullable — populated by embedding job in Phase 1.5
  embedding_model text,          -- track which model produced the embedding (migrate-friendly)
  metadata jsonb default '{}'::jsonb,
  importance numeric default 0.5 check (importance between 0 and 1),
  related_entity_type text,
  related_entity_id uuid,
  created_at timestamptz default now(),
  last_retrieved_at timestamptz,
  retrieval_count integer default 0
);
create index memory_kind_idx on memory(kind);
create index memory_pharmacy_kind_idx on memory(pharmacy_id, kind);
create index memory_related_idx on memory(related_entity_type, related_entity_id);
-- HNSW (not IVFFlat) — safe on empty tables, handles growth without rebuild
create index memory_embedding_hnsw_idx on memory using hnsw (embedding vector_cosine_ops);
-- Trigram text fallback (used by Phase 1 search_memory until embeddings land)
create index memory_content_trgm_idx on memory using gin (content gin_trgm_ops);

-- Phase 1: text-match search. Phase 1.5 adds a match_memory_vector RPC when embeddings are populated.
create or replace function search_memory_text(
  q text,
  pharmacy uuid,
  kind_filter text default null,
  k int default 10
)
returns table (
  id uuid,
  kind memory_kind,
  content text,
  metadata jsonb,
  importance numeric,
  rank float
)
language sql stable
as $$
  select
    m.id, m.kind, m.content, m.metadata, m.importance,
    similarity(m.content, q) as rank
  from memory m
  where m.pharmacy_id = pharmacy
    and (kind_filter is null or m.kind::text = kind_filter)
    and m.content % q    -- trigram %% operator (uses gin index)
  order by rank desc
  limit k;
$$;
