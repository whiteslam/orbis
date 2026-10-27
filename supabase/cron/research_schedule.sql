-- Orbis Research desk scheduler. Optional: run it in the Supabase SQL editor only
-- if you want the weekly desk run or the Saturday settling pass, AFTER migration
-- 202610270003_research_desk.sql and after the Research desk code is deployed
-- with its worker set up. It reuses the orbis_cron_secret vault secret created by
-- notifications_schedule.sql. Safe to run again: each job is replaced, not doubled.
--
-- Two jobs, both for the desk's owners only (ORBIS_RESEARCH_DESK_EMAILS):
--   orbis-research-queue    Saturday 09:00 IST (03:30 UTC): settle calls whose
--                           holding period has passed, and, when the weekly run
--                           is on in the desk's settings, queue the top holdings
--   orbis-research-summary  Monday 08:00 IST (02:30 UTC): a heads-up on Today
--                           when the weekend's calls are in
-- Until the desk is set up on the deployment, both answer without doing anything.
select cron.unschedule('orbis-research-queue') where exists (select 1 from cron.job where jobname = 'orbis-research-queue');
select cron.schedule(
  'orbis-research-queue',
  '30 3 * * 6',
  $$
  select net.http_post(
    url := 'https://orbis-starter.vercel.app/api/research/weekly?step=queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'orbis_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

select cron.unschedule('orbis-research-summary') where exists (select 1 from cron.job where jobname = 'orbis-research-summary');
select cron.schedule(
  'orbis-research-summary',
  '30 2 * * 1',
  $$
  select net.http_post(
    url := 'https://orbis-starter.vercel.app/api/research/weekly?step=summary',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'orbis_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- Check it later:
--   select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'orbis-research-queue') order by start_time desc limit 5;
-- To stop: select cron.unschedule('orbis-research-queue'); select cron.unschedule('orbis-research-summary');
