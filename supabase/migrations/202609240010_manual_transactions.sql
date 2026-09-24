-- Orbis: extra detail for manually entered transactions.

alter table public.transactions
  add column if not exists payment_method text
    check (payment_method is null or payment_method in ('upi', 'debit_card', 'credit_card', 'cash', 'net_banking', 'wallet', 'other')),
  add column if not exists note text
    check (note is null or char_length(note) <= 500);
