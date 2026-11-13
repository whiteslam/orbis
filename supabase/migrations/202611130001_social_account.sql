-- Social Studio: whose page a post is for.
--
-- 'me' is the person's own account (every existing post); 'orbis' is Orbis's
-- own promotion page, which only the owner can use (checked in the server
-- actions). Paste into the Supabase SQL editor once; safe to run again.

alter table public.social_posts
  add column if not exists account text not null default 'me';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'social_posts_account_check') then
    alter table public.social_posts add constraint social_posts_account_check check (account in ('me', 'orbis'));
  end if;
end $$;

create index if not exists social_posts_user_period_account_idx on public.social_posts (user_id, period, account);
