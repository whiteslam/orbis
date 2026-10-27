-- Orbis Career scheduler. Run once in the Supabase SQL editor AFTER migration
-- 202610270001_career.sql and after the Career code is deployed. It reuses the
-- orbis_cron_secret vault secret created by notifications_schedule.sql.
--
-- Two jobs, both for everyone with a career profile:
--   orbis-career-ingest  every 3 hours: fetch new jobs from the sources, dedupe,
--                        read their requirements and score them
--   orbis-career-watch   every 15 minutes: read new Gmail (job alerts and
--                        replies), move applications forward, raise heads-ups
-- Each run stops at its own time budget and leaves the rest to the next run.
select cron.unschedule('orbis-career-ingest') where exists (select 1 from cron.job where jobname = 'orbis-career-ingest');
select cron.schedule(
  'orbis-career-ingest',
  '7 */3 * * *',
  $$
  select net.http_post(
    url := 'https://orbis-starter.vercel.app/api/career/ingest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'orbis_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

select cron.unschedule('orbis-career-watch') where exists (select 1 from cron.job where jobname = 'orbis-career-watch');
select cron.schedule(
  'orbis-career-watch',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://orbis-starter.vercel.app/api/career/watch',
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
--   select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'orbis-career-watch') order by start_time desc limit 5;
-- To stop: select cron.unschedule('orbis-career-ingest'); select cron.unschedule('orbis-career-watch');
