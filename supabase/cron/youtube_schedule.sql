-- Orbis YouTube publisher scheduler. Run once in the Supabase SQL editor AFTER migration
-- 202611130002_youtube.sql and after the YouTube publishing code is deployed. It reuses the
-- orbis_cron_secret vault secret created by notifications_schedule.sql.
--
-- Runs every 10 minutes. Each run uploads for everyone whose time has come, and
-- picks up any upload left half way, in slices that fit one request. The app
-- decides who is due, so runs in between do nothing. Uses the same vault secret
-- as the notifications and heads-ups jobs.
select cron.unschedule('orbis-youtube') where exists (select 1 from cron.job where jobname = 'orbis-youtube');
select cron.schedule(
  'orbis-youtube',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://orbis-starter.vercel.app/api/social/youtube/publish',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'orbis_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
