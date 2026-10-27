-- Orbis: Career, where Orbis runs the job hunt.
--
--   career_profiles      one row per person: the resume, the profile built from
--                        it, the spec, settings, and the crons' bookkeeping
--   career_jobs          every job found, deduped per person, with its
--                        requirements and how well it matches
--   career_applications  one per job applied to, from draft to outcome
--   career_events        what happened to an application (sent, replies,
--                        interviews…), and replies not yet linked to one
--   career_offers        an offer's terms and the advice on it
--   career_mail          which Gmail messages the watcher has handled (internal)
--
-- Who writes what: the owner, through their own session (server actions), may
-- write anything that is theirs to decide or that an action works out for
-- them. Identity columns (user_id, job and application links, dedupe keys,
-- Gmail message ids) are fixed once written, and the crons' bookkeeping
-- (last_ingest_at, source_cursors, last_mail_scan_at, career_mail) is written
-- by the service role only. Sent applications can't be deleted, so the record
-- stays honest. See docs/superpowers/specs/2026-10-27-career-copilot-design.md.
--
-- Safe to run more than once.

-- ─── Profiles ───────────────────────────────────────────────────────────────

create table if not exists public.career_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Validated in code (lib/career/profile.ts); null until a resume is parsed.
  profile jsonb check (profile is null or (jsonb_typeof(profile) = 'object' and octet_length(profile::text) <= 400000)),
  -- Private Storage path (<user_id>/resume/<file>), never a public URL.
  resume_path text check (resume_path is null or char_length(resume_path) between 1 and 300),
  resume_name text check (resume_name is null or char_length(resume_name) between 1 and 200),
  resume_text text check (resume_text is null or char_length(resume_text) <= 100000),
  spec jsonb check (spec is null or (jsonb_typeof(spec) = 'object' and octet_length(spec::text) <= 40000)),
  -- Merged over DEFAULT_SETTINGS in code, so a new setting needs no migration.
  settings jsonb not null default '{}'::jsonb
    check (jsonb_typeof(settings) = 'object' and octet_length(settings::text) <= 100000),
  last_ingest_at timestamptz,
  source_cursors jsonb not null default '{}'::jsonb check (jsonb_typeof(source_cursors) = 'object'),
  last_mail_scan_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists career_profiles_set_updated_at on public.career_profiles;
create trigger career_profiles_set_updated_at
  before update on public.career_profiles
  for each row execute function public.set_updated_at();

alter table public.career_profiles enable row level security;
revoke all on public.career_profiles from public, anon, authenticated;
grant select on public.career_profiles to authenticated;
grant insert (user_id, profile, resume_path, resume_name, resume_text, spec, settings) on public.career_profiles to authenticated;
grant update (profile, resume_path, resume_name, resume_text, spec, settings) on public.career_profiles to authenticated;
grant select, insert, update, delete on public.career_profiles to service_role;

drop policy if exists "Users read their own career profile" on public.career_profiles;
create policy "Users read their own career profile" on public.career_profiles
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users create their own career profile" on public.career_profiles;
create policy "Users create their own career profile" on public.career_profiles
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users update their own career profile" on public.career_profiles;
create policy "Users update their own career profile" on public.career_profiles
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ─── Jobs ───────────────────────────────────────────────────────────────────

create table if not exists public.career_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null check (source in (
    'gmail_alerts', 'himalayas', 'remotive', 'remoteok', 'wwr', 'jobspresso', 'hn', 'adzuna',
    'greenhouse', 'lever', 'ashby', 'recruitee', 'pasted')),
  source_ref text not null check (char_length(source_ref) between 1 and 300),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 300),
  title text not null check (char_length(title) between 1 and 300),
  company text not null check (char_length(company) between 1 and 200),
  location text check (location is null or char_length(location) <= 300),
  remote boolean not null default false,
  url text not null check (char_length(url) <= 2048 and url ~* '^https?://'),
  apply_url text check (apply_url is null or (char_length(apply_url) <= 2048 and apply_url ~* '^https?://')),
  apply_email text check (apply_email is null or char_length(apply_email) between 3 and 320),
  apply_route text not null default 'link' check (apply_route in ('email', 'recruitee', 'link')),
  -- For Recruitee: { company, offer }, so Send can post to it.
  recruitee jsonb check (recruitee is null or jsonb_typeof(recruitee) = 'object'),
  description text check (description is null or char_length(description) <= 20000),
  thin boolean not null default false,
  salary jsonb check (salary is null or jsonb_typeof(salary) = 'object'),
  posted_at timestamptz,
  -- Every source that listed it, newest first: [{ source, url, attribution }].
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  attribution text check (attribution is null or char_length(attribution) <= 120),
  requirements jsonb check (requirements is null or jsonb_typeof(requirements) = 'object'),
  requirements_version integer,
  match jsonb check (match is null or jsonb_typeof(match) = 'object'),
  -- Null until scored; 0 for "not your role".
  score smallint check (score is null or score between 0 and 100),
  excluded_reason text check (excluded_reason is null or char_length(excluded_reason) <= 300),
  state text not null default 'new' check (state in ('new', 'shortlisted', 'dismissed', 'applied')),
  dismiss_reason text check (dismiss_reason is null or char_length(dismiss_reason) <= 300),
  found_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_key),
  -- Lets applications point at a job by (user_id, id), so a row can never link
  -- to someone else's job.
  unique (user_id, id)
);

create index if not exists career_jobs_user_score_idx on public.career_jobs (user_id, score desc nulls last);
create index if not exists career_jobs_user_found_idx on public.career_jobs (user_id, found_at desc);
-- Jobs still waiting for requirements extraction, oldest first.
create index if not exists career_jobs_needs_requirements_idx on public.career_jobs (user_id, found_at) where requirements is null;

drop trigger if exists career_jobs_set_updated_at on public.career_jobs;
create trigger career_jobs_set_updated_at
  before update on public.career_jobs
  for each row execute function public.set_updated_at();

alter table public.career_jobs enable row level security;
revoke all on public.career_jobs from public, anon, authenticated;
grant select on public.career_jobs to authenticated;
-- A pasted job is saved through the owner's session.
grant insert (user_id, source, source_ref, dedupe_key, title, company, location, remote, url, apply_url, apply_email, apply_route,
  recruitee, description, thin, salary, posted_at, sources, attribution) on public.career_jobs to authenticated;
-- Where it came from (source, source_ref, dedupe_key, found_at) is fixed; what
-- is known about it, and what the owner decided, may change.
grant update (title, company, location, remote, url, apply_url, apply_email, apply_route, recruitee, description, thin, salary,
  posted_at, sources, attribution, requirements, requirements_version, match, score, excluded_reason, state, dismiss_reason)
  on public.career_jobs to authenticated;
grant select, insert, update, delete on public.career_jobs to service_role;

drop policy if exists "Users read their own career jobs" on public.career_jobs;
create policy "Users read their own career jobs" on public.career_jobs
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users add their own career jobs" on public.career_jobs;
create policy "Users add their own career jobs" on public.career_jobs
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users update their own career jobs" on public.career_jobs;
create policy "Users update their own career jobs" on public.career_jobs
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ─── Applications ───────────────────────────────────────────────────────────

create table if not exists public.career_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null,
  status text not null default 'drafting' check (status in (
    'drafting', 'ready', 'sending', 'opened', 'sent', 'acknowledged', 'replied', 'assessment', 'interview', 'offer',
    'accepted', 'declined', 'rejected', 'withdrawn', 'ghosted', 'failed')),
  route text not null default 'link' check (route in ('email', 'recruitee', 'link')),
  -- The tailored content; names, employers, titles and dates come from the profile.
  draft jsonb check (draft is null or (jsonb_typeof(draft) = 'object' and octet_length(draft::text) <= 200000)),
  -- { text, factIds }.
  cover_note jsonb check (cover_note is null or jsonb_typeof(cover_note) = 'object'),
  answers jsonb not null default '[]'::jsonb check (jsonb_typeof(answers) = 'array'),
  outreach text check (outreach is null or char_length(outreach) <= 5000),
  -- What the truth check removed.
  removed jsonb not null default '[]'::jsonb check (jsonb_typeof(removed) = 'array'),
  ats jsonb check (ats is null or jsonb_typeof(ats) = 'object'),
  resume_pdf_path text check (resume_pdf_path is null or char_length(resume_pdf_path) between 1 and 300),
  resume_docx_path text check (resume_docx_path is null or char_length(resume_docx_path) between 1 and 300),
  sent_at timestamptz,
  gmail_thread_id text check (gmail_thread_id is null or char_length(gmail_thread_id) between 1 and 100),
  company_domains text[] not null default '{}' check (coalesce(array_length(company_domains, 1), 0) <= 20),
  follow_up_due timestamptz,
  prediction jsonb check (prediction is null or jsonb_typeof(prediction) = 'object'),
  prep jsonb check (prep is null or jsonb_typeof(prep) = 'object'),
  last_event_at timestamptz,
  notes text check (notes is null or char_length(notes) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, job_id),
  unique (user_id, id),
  foreign key (user_id, job_id) references public.career_jobs (user_id, id) on delete cascade
);

create index if not exists career_applications_user_status_idx on public.career_applications (user_id, status, updated_at desc);
-- Today's sends, for the daily cap.
create index if not exists career_applications_user_sent_idx on public.career_applications (user_id, sent_at desc) where sent_at is not null;
create index if not exists career_applications_follow_up_idx on public.career_applications (follow_up_due) where follow_up_due is not null;

drop trigger if exists career_applications_set_updated_at on public.career_applications;
create trigger career_applications_set_updated_at
  before update on public.career_applications
  for each row execute function public.set_updated_at();

alter table public.career_applications enable row level security;
revoke all on public.career_applications from public, anon, authenticated;
grant select on public.career_applications to authenticated;
grant insert (user_id, job_id, status, route, draft, cover_note, answers, outreach, removed, ats, resume_pdf_path, resume_docx_path,
  company_domains, prediction, notes) on public.career_applications to authenticated;
-- Send runs as the owner, so status, sent_at and the thread id are theirs to
-- write; the action's conditional update is what keeps a send once-only.
grant update (status, route, draft, cover_note, answers, outreach, removed, ats, resume_pdf_path, resume_docx_path, sent_at,
  gmail_thread_id, company_domains, follow_up_due, prediction, prep, last_event_at, notes) on public.career_applications to authenticated;
grant delete on public.career_applications to authenticated;
grant select, insert, update, delete on public.career_applications to service_role;

drop policy if exists "Users read their own applications" on public.career_applications;
create policy "Users read their own applications" on public.career_applications
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users create their own applications" on public.career_applications;
create policy "Users create their own applications" on public.career_applications
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users update their own applications" on public.career_applications;
create policy "Users update their own applications" on public.career_applications
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Only a draft that never left can be thrown away.
drop policy if exists "Users discard their own unsent applications" on public.career_applications;
create policy "Users discard their own unsent applications" on public.career_applications
  for delete to authenticated
  using ((select auth.uid()) = user_id and status in ('drafting', 'ready', 'failed'));

-- ─── Events ─────────────────────────────────────────────────────────────────

create table if not exists public.career_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Null for a reply that couldn't be linked yet ("Unmatched replies").
  application_id uuid,
  kind text not null check (kind in (
    'sent', 'acknowledgement', 'reply', 'recruiter_question', 'assessment', 'interview_invite', 'rejection', 'offer',
    'follow_up_sent', 'status_change', 'note')),
  at timestamptz not null default now(),
  summary text not null check (char_length(summary) between 1 and 300),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 20000),
  gmail_message_id text check (gmail_message_id is null or char_length(gmail_message_id) between 1 and 100),
  created_at timestamptz not null default now(),
  foreign key (user_id, application_id) references public.career_applications (user_id, id) on delete cascade
);

create index if not exists career_events_user_at_idx on public.career_events (user_id, at desc);
create index if not exists career_events_application_idx on public.career_events (application_id, at desc) where application_id is not null;
-- Each Gmail message becomes at most one event.
create unique index if not exists career_events_gmail_message_uidx
  on public.career_events (user_id, gmail_message_id) where gmail_message_id is not null;

alter table public.career_events enable row level security;
revoke all on public.career_events from public, anon, authenticated;
grant select on public.career_events to authenticated;
-- Notes and "I applied" come from the owner; mail events (with a message id) from the watcher.
grant insert (user_id, application_id, kind, at, summary, details) on public.career_events to authenticated;
-- Attaching an unmatched reply to an application.
grant update (application_id) on public.career_events to authenticated;
grant select, insert, update, delete on public.career_events to service_role;

drop policy if exists "Users read their own career events" on public.career_events;
create policy "Users read their own career events" on public.career_events
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users add their own career events" on public.career_events;
create policy "Users add their own career events" on public.career_events
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users link their own career events" on public.career_events;
create policy "Users link their own career events" on public.career_events
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ─── Offers ─────────────────────────────────────────────────────────────────

create table if not exists public.career_offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid not null,
  -- OfferTerms; the owner confirms or corrects it before any advice.
  compensation jsonb not null check (jsonb_typeof(compensation) = 'object'),
  confirmed boolean not null default false,
  advice jsonb check (advice is null or (jsonb_typeof(advice) = 'object' and octet_length(advice::text) <= 40000)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, application_id) references public.career_applications (user_id, id) on delete cascade
);

create index if not exists career_offers_user_idx on public.career_offers (user_id, created_at desc);
create index if not exists career_offers_application_idx on public.career_offers (application_id);

drop trigger if exists career_offers_set_updated_at on public.career_offers;
create trigger career_offers_set_updated_at
  before update on public.career_offers
  for each row execute function public.set_updated_at();

alter table public.career_offers enable row level security;
revoke all on public.career_offers from public, anon, authenticated;
grant select on public.career_offers to authenticated;
grant insert (user_id, application_id, compensation, confirmed) on public.career_offers to authenticated;
grant update (compensation, confirmed, advice) on public.career_offers to authenticated;
grant delete on public.career_offers to authenticated;
grant select, insert, update, delete on public.career_offers to service_role;

drop policy if exists "Users read their own offers" on public.career_offers;
create policy "Users read their own offers" on public.career_offers
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users add their own offers" on public.career_offers;
create policy "Users add their own offers" on public.career_offers
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users update their own offers" on public.career_offers;
create policy "Users update their own offers" on public.career_offers
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users remove their own offers" on public.career_offers;
create policy "Users remove their own offers" on public.career_offers
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ─── Mail bookkeeping (service role only) ───────────────────────────────────

-- Each Gmail message is handled once. Internal state: not exported, and gone
-- with the account by cascade.
create table if not exists public.career_mail (
  user_id uuid not null references auth.users (id) on delete cascade,
  message_id text not null check (char_length(message_id) between 1 and 100),
  outcome text not null check (outcome in ('alert', 'reply', 'skipped')),
  processed_at timestamptz not null default now(),
  primary key (user_id, message_id)
);

create index if not exists career_mail_processed_idx on public.career_mail (processed_at);

alter table public.career_mail enable row level security;
revoke all on public.career_mail from public, anon, authenticated;
grant select, insert, update, delete on public.career_mail to service_role;

-- ─── Storage ────────────────────────────────────────────────────────────────

-- Private bucket for the resume and tailored files: 10 MB, PDF and DOCX only,
-- each person under <user_id>/.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('career-documents', 'career-documents', false, 10485760,
        array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

drop policy if exists "Users manage their own career documents" on storage.objects;
create policy "Users manage their own career documents" on storage.objects
  for all to authenticated
  using (bucket_id = 'career-documents' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'career-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
