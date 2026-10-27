-- Orbis: the Research desk, TradingAgents runs on one Indian stock or ETF.
--
--   research_runs         one row per run: what was asked, its status, the
--                         final call, and what it cost
--   research_events       what each agent wrote, in order, for the live view
--   research_settlements  how each call did against Nifty (or Sensex) once its
--                         holding period traded, and the reflection on it
--   research_settings     one row per person: on/off, the weekly run, models
--                         and the caps
--   storage research-memory  TradingAgents' markdown memory log, one file per
--                         person (<user_id>/trading_memory.md)
--
-- Who writes what: the owner reads their own rows through their session and
-- writes nothing directly. Every write goes through the service role: the
-- server actions (after checking the Research desk allowlist,
-- ORBIS_RESEARCH_DESK_EMAILS, which the database cannot see) and the Python
-- worker on GitHub Actions. So a signed-in session can't queue a run, change a
-- result or fake a track record by talking to the API directly.
-- See docs/superpowers/specs/2026-10-27-research-desk-tradingagents-design.md.
--
-- Needs public.set_updated_at() (any earlier migration). Safe to run more than once.

-- ─── Runs ───────────────────────────────────────────────────────────────────

create table if not exists public.research_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Yahoo's ticker, always Indian: RELIANCE.NS, 500325.BO.
  ticker text not null check (ticker ~ '^[A-Z0-9&-]{1,20}\.(NS|BO)$'),
  -- The broker's own spelling, for the screen.
  symbol text not null check (char_length(symbol) between 1 and 40),
  exchange text not null check (exchange in ('NSE', 'BSE')),
  trade_date date not null,
  source text not null default 'manual' check (source in ('manual', 'weekly')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  -- { currency, cash, positions: [{ ticker, quantity, average_price }] }: never broker tokens.
  portfolio_context jsonb check (portfolio_context is null or (jsonb_typeof(portfolio_context) = 'object' and octet_length(portfolio_context::text) <= 20000)),
  -- Models, analysts, rounds and caps the run used.
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 20000),
  -- { rating, summary, thesis, priceTarget, horizon, entry, stop, sizing, trader }.
  decision jsonb check (decision is null or (jsonb_typeof(decision) = 'object' and octet_length(decision::text) <= 40000)),
  cost_usd numeric(10, 6) check (cost_usd is null or cost_usd >= 0),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  tokens integer check (tokens is null or tokens >= 0),
  error text check (error is null or char_length(error) <= 500),
  dispatched_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Lets events and settlements point at a run by (user_id, id), so a row can
  -- never link to someone else's run.
  unique (user_id, id)
);

create index if not exists research_runs_user_created_idx on public.research_runs (user_id, created_at desc);
create index if not exists research_runs_user_ticker_idx on public.research_runs (user_id, ticker, created_at desc);
create index if not exists research_runs_active_idx on public.research_runs (status) where status in ('queued', 'running');

drop trigger if exists research_runs_set_updated_at on public.research_runs;
create trigger research_runs_set_updated_at
  before update on public.research_runs
  for each row execute function public.set_updated_at();

alter table public.research_runs enable row level security;
revoke all on public.research_runs from public, anon, authenticated;
grant select on public.research_runs to authenticated;
grant select, insert, update, delete on public.research_runs to service_role;

drop policy if exists "Users read their own research runs" on public.research_runs;
create policy "Users read their own research runs" on public.research_runs
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- ─── Events ─────────────────────────────────────────────────────────────────

create table if not exists public.research_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  run_id uuid not null,
  -- Order within the run, from 1; the live view asks for everything after the last it has.
  seq integer not null check (seq between 1 and 10000),
  agent text not null check (agent in (
    'desk', 'market', 'fundamentals', 'news', 'bull', 'bear', 'research_manager', 'trader',
    'risk_aggressive', 'risk_conservative', 'risk_neutral', 'portfolio_manager')),
  kind text not null check (kind in ('status', 'report', 'turn', 'decision')),
  content text not null check (char_length(content) between 1 and 60000),
  at timestamptz not null default now(),
  unique (run_id, seq),
  foreign key (user_id, run_id) references public.research_runs (user_id, id) on delete cascade
);

create index if not exists research_events_user_idx on public.research_events (user_id, at desc);

alter table public.research_events enable row level security;
revoke all on public.research_events from public, anon, authenticated;
grant select on public.research_events to authenticated;
grant select, insert, update, delete on public.research_events to service_role;

drop policy if exists "Users read their own research events" on public.research_events;
create policy "Users read their own research events" on public.research_events
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- ─── Settlements ────────────────────────────────────────────────────────────

create table if not exists public.research_settlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  run_id uuid not null unique,
  ticker text not null check (ticker ~ '^[A-Z0-9&-]{1,20}\.(NS|BO)$'),
  trade_date date not null,
  benchmark text not null check (char_length(benchmark) between 1 and 20),
  holding_days smallint not null check (holding_days between 1 and 60),
  -- Percentages, e.g. 2.15 for +2.15%.
  return_pct numeric(8, 3) not null,
  benchmark_pct numeric(8, 3) not null,
  alpha_pct numeric(8, 3) not null,
  reflection text check (reflection is null or char_length(reflection) <= 20000),
  settled_at timestamptz not null default now(),
  foreign key (user_id, run_id) references public.research_runs (user_id, id) on delete cascade
);

create index if not exists research_settlements_user_idx on public.research_settlements (user_id, trade_date desc);

alter table public.research_settlements enable row level security;
revoke all on public.research_settlements from public, anon, authenticated;
grant select on public.research_settlements to authenticated;
grant select, insert, update, delete on public.research_settlements to service_role;

drop policy if exists "Users read their own research settlements" on public.research_settlements;
create policy "Users read their own research settlements" on public.research_settlements
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- ─── Settings ───────────────────────────────────────────────────────────────

create table if not exists public.research_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default true,
  -- Off until the owner turns it on (the spec's decision 4).
  weekly_enabled boolean not null default false,
  weekly_top_n smallint not null default 5 check (weekly_top_n between 1 and 15),
  -- OpenRouter model ids; null means the code's default (lib/research/types.ts).
  deep_model text check (deep_model is null or char_length(deep_model) between 3 and 120),
  quick_model text check (quick_model is null or char_length(quick_model) between 3 and 120),
  run_token_cap integer not null default 600000 check (run_token_cap between 50000 and 3000000),
  monthly_run_cap smallint not null default 40 check (monthly_run_cap between 1 and 300),
  -- The weekly cron's bookkeeping: the Monday it last summarised.
  last_summary_week date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists research_settings_set_updated_at on public.research_settings;
create trigger research_settings_set_updated_at
  before update on public.research_settings
  for each row execute function public.set_updated_at();

alter table public.research_settings enable row level security;
revoke all on public.research_settings from public, anon, authenticated;
grant select on public.research_settings to authenticated;
grant select, insert, update, delete on public.research_settings to service_role;

drop policy if exists "Users read their own research settings" on public.research_settings;
create policy "Users read their own research settings" on public.research_settings
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- ─── Storage ────────────────────────────────────────────────────────────────

-- Private bucket for the memory log, written and read by the worker only. No
-- policy for authenticated users: the service role bypasses RLS on storage.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('research-memory', 'research-memory', false, 5242880, array['text/markdown', 'text/plain'])
on conflict (id) do nothing;
