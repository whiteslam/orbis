-- Orbis: saved health documents (original file + searchable text chunks with
-- embeddings for retrieval) and AI-generated health plans.

create extension if not exists vector with schema extensions;

-- Private bucket for original uploads. Only server code (service role) touches it.
insert into storage.buckets (id, name, public, file_size_limit)
values ('health-documents', 'health-documents', false, 52428800)
on conflict (id) do nothing;

create table if not exists public.health_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  file_name text not null check (char_length(file_name) between 1 and 120),
  kind text not null check (kind in ('pdf', 'xlsx')),
  size_bytes bigint not null check (size_bytes > 0),
  storage_path text,
  preview jsonb not null default '{}'::jsonb,
  chunk_count integer not null default 0 check (chunk_count >= 0),
  created_at timestamptz not null default now()
);

create index if not exists health_documents_user_created_idx on public.health_documents (user_id, created_at desc);

create table if not exists public.health_document_chunks (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.health_documents (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null check (char_length(content) between 1 and 4000),
  embedding extensions.vector(1536) not null,
  created_at timestamptz not null default now(),
  constraint health_document_chunks_doc_index_unique unique (document_id, chunk_index)
);

create index if not exists health_document_chunks_user_idx on public.health_document_chunks (user_id);
create index if not exists health_document_chunks_embedding_idx
  on public.health_document_chunks using hnsw (embedding extensions.vector_cosine_ops);

create table if not exists public.health_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  answers jsonb not null default '[]'::jsonb,
  plan jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists health_plans_user_created_idx on public.health_plans (user_id, created_at desc);

alter table public.health_documents enable row level security;
alter table public.health_document_chunks enable row level security;
alter table public.health_plans enable row level security;

-- Users can see and delete their own documents and plans; writes and chunk
-- access go through server code with the service role.
drop policy if exists "Users read their health documents" on public.health_documents;
create policy "Users read their health documents" on public.health_documents
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users read their health plans" on public.health_plans;
create policy "Users read their health plans" on public.health_plans
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users delete their health plans" on public.health_plans;
create policy "Users delete their health plans" on public.health_plans
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.health_documents, public.health_document_chunks, public.health_plans from anon;
grant select on public.health_documents to authenticated;
grant select, delete on public.health_plans to authenticated;
revoke all on public.health_document_chunks from authenticated;
grant select, insert, update, delete on public.health_documents, public.health_document_chunks, public.health_plans to service_role;

-- Nearest chunks for one user's documents (cosine similarity).
create or replace function public.match_health_chunks(p_user_id uuid, p_embedding extensions.vector(1536), p_count integer)
returns table (document_id uuid, chunk_index integer, content text, similarity double precision)
language sql
stable
security definer
set search_path = ''
as $$
  select c.document_id, c.chunk_index, c.content, 1 - (c.embedding operator(extensions.<=>) p_embedding) as similarity
  from public.health_document_chunks c
  where c.user_id = p_user_id
  order by c.embedding operator(extensions.<=>) p_embedding
  limit least(greatest(p_count, 1), 20);
$$;

revoke all on function public.match_health_chunks(uuid, extensions.vector, integer) from public, anon, authenticated;
grant execute on function public.match_health_chunks(uuid, extensions.vector, integer) to service_role;

-- Log the new AI features (metadata only), keeping every earlier feature.
alter table public.ai_generation_events drop constraint if exists ai_generation_events_feature_check;
alter table public.ai_generation_events
  add constraint ai_generation_events_feature_check
    check (feature in ('workbook_advice', 'portfolio_advice', 'daily_notification', 'health_plan_questions', 'health_plan'));
