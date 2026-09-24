-- Orbis daily notifications scheduler. Run once in the Supabase SQL editor AFTER migration 019
-- and after CRON_SECRET is set in Vercel (and the app is redeployed).
-- Replace PASTE_CRON_SECRET_HERE with the CRON_SECRET value from .env.local / Vercel. It is stored in Supabase Vault.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('PASTE_CRON_SECRET_HERE', 'orbis_cron_secret', 'Bearer secret for /api/notifications/dispatch');

-- Every 5 minutes: the route sends each slot once, from its time until 45 minutes later.
select cron.schedule(
  'orbis-notifications',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://orbis-starter.vercel.app/api/notifications/dispatch',
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
--   select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'orbis-notifications') order by start_time desc limit 5;
--   select status_code, content from net._http_response order by created desc limit 5;
-- To change the secret: select vault.update_secret((select id from vault.secrets where name = 'orbis_cron_secret'), 'NEW_SECRET');
-- To stop: select cron.unschedule('orbis-notifications');
