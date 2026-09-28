-- Run only after adding jiawenlex_site_url and jiawenlex_cron_secret to Supabase Vault.
-- Requires pg_cron and pg_net extensions enabled in the Supabase dashboard.
select cron.schedule(
  'jiawenlex-reminders', '*/15 * * * *',
  $$ select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'jiawenlex_site_url') || '/api/cron/reminders',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'jiawenlex_cron_secret'))
  ); $$
);

select cron.schedule(
  'jiawenlex-retention', '15 3 * * *',
  $$ select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'jiawenlex_site_url') || '/api/cron/retention',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'jiawenlex_cron_secret'))
  ); $$
);
