-- Phone payments reviewed in Money become ordinary transactions with source 'phone'.
-- source_signal_id ties the row to the phone signal it came from, so accepting
-- the same payment twice saves one row.

alter table public.transactions add column if not exists source_signal_id uuid;

-- The inline check on `source` from 202609240001_finance_gmail.sql is named
-- transactions_source_check by Postgres.
alter table public.transactions drop constraint if exists transactions_source_check;
alter table public.transactions add constraint transactions_source_check
  check (source in ('gmail', 'manual', 'phone'));

alter table public.transactions drop constraint if exists transactions_gmail_source_message_check;
alter table public.transactions add constraint transactions_gmail_source_message_check
  check (
    (source = 'gmail' and source_message_id is not null)
    or source = 'manual'
    or (source = 'phone' and source_signal_id is not null)
  );

create unique index if not exists transactions_user_signal_unique
  on public.transactions (user_id, source_signal_id)
  where source_signal_id is not null;
