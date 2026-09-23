alter table public.gmail_sync_messages
  add column if not exists parse_status text not null default 'unparsed'
    check (parse_status in ('unparsed', 'needs_review', 'unrecognized', 'processed', 'ignored')),
  add column if not exists parsed_amount numeric(14, 2)
    check (parsed_amount is null or parsed_amount > 0),
  add column if not exists parsed_currency text
    check (parsed_currency is null or parsed_currency ~ '^[A-Z]{3}$'),
  add column if not exists parsed_direction text
    check (parsed_direction is null or parsed_direction in ('expense', 'income')),
  add column if not exists parsed_merchant text,
  add column if not exists parse_reason text;

create index if not exists gmail_sync_messages_review_queue_idx
  on public.gmail_sync_messages (user_id, connection_id, parse_status, received_at desc)
  where sync_state = 'pending';

grant select, insert, update, delete on public.transactions to service_role;
