create table if not exists public.ai_generation_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  feature text not null check (feature in ('workbook_advice')),
  model text not null check (char_length(model) between 1 and 120),
  outcome text not null check (outcome in ('succeeded', 'failed')),
  provider_status smallint check (provider_status between 100 and 599),
  duration_ms integer not null check (duration_ms between 0 and 120000),
  response_bytes integer not null default 0 check (response_bytes between 0 and 131072),
  created_at timestamptz not null default now()
);

create index if not exists ai_generation_events_user_created_idx
  on public.ai_generation_events (user_id, created_at desc);

alter table public.ai_generation_events enable row level security;
revoke all on public.ai_generation_events from public, anon, authenticated;
grant insert on public.ai_generation_events to service_role;
