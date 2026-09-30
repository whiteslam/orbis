-- Orbis heads-up scan scheduler. Run once in the Supabase SQL editor AFTER migration
-- 202609300100_headsups.sql and after the heads-ups code is deployed. It reuses the
-- orbis_cron_secret vault secret created by notifications_schedule.sql.
--
-- Runs the heads-up scan every 15 minutes. Each person is scanned once a day,
-- at or after 06:00 their time; runs in between only send pushes that were
-- waiting for the morning. Uses the same vault secret as the notifications job.
select cron.unschedule('orbis-headsups') where exists (select 1 from cron.job where jobname = 'orbis-headsups');
select cron.schedule(
  'orbis-headsups',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://orbis-starter.vercel.app/api/headsups/scan',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'orbis_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
