-- Orbis: a "master" health document — one the plan builder reads every time,
-- instead of only when a search happens to surface it.
--
-- Retrieval is still used for everything else; this flag guarantees the file the
-- user considers their baseline (a full blood panel, a coach's programme) is in
-- context for every plan.

alter table public.health_documents
  add column if not exists always_include boolean not null default false;

create index if not exists health_documents_always_idx
  on public.health_documents (user_id) where always_include;
