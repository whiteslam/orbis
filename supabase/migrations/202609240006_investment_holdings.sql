create table if not exists public.investment_holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  asset_type text not null check (asset_type in ('stock', 'fund', 'etf', 'crypto', 'cash', 'other')),
  quantity numeric(20, 6) not null check (quantity > 0),
  value_per_unit numeric(20, 4) not null check (value_per_unit >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  value_as_of date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists investment_holdings_user_updated_idx
  on public.investment_holdings (user_id, updated_at desc);
alter table public.investment_holdings enable row level security;
create policy "Users manage their own investment holdings" on public.investment_holdings
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.investment_holdings to authenticated;
