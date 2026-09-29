-- Run only after adding jiawenlex_site_url and jiawenlex_cron_secret to Supabase Vault.
-- Requires pg_cron and pg_net extensions enabled in the Supabase dashboard.
-- Execute the whole file in one transaction; a missing setting leaves no partial jobs.
begin;
-- Keep net absent from the exposed Data API schemas.
-- Do not grant members a generic SQL or network forwarding function.
do $$
declare site text; token text;
begin
  if not exists(select 1 from pg_extension where extname='pg_cron') or not exists(select 1 from pg_extension where extname='pg_net') then
    raise exception 'Enable pg_cron and pg_net first';
  end if;
  if (select count(*) from vault.decrypted_secrets where name='jiawenlex_site_url') <> 1 or (select count(*) from vault.decrypted_secrets where name='jiawenlex_cron_secret') <> 1 then
    raise exception 'Add one site URL and one cron secret to Vault';
  end if;
  select decrypted_secret into site from vault.decrypted_secrets where name='jiawenlex_site_url';
  select decrypted_secret into token from vault.decrypted_secrets where name='jiawenlex_cron_secret';
  if site !~ '^https://[a-zA-Z0-9][a-zA-Z0-9.-]+(:443)?/?$' or site ~* '(localhost|127\.|0\.0\.0\.0|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)' or length(token)<32 then
    raise exception 'Use a public HTTPS site URL and a cron secret of at least 32 characters';
  end if;
end $$;
select cron.schedule(
  'jiawenlex-reminders', '*/15 * * * *',
  $$ select net.http_get(
    url := rtrim((select decrypted_secret from vault.decrypted_secrets where name = 'jiawenlex_site_url'), '/') || '/api/cron/reminders',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'jiawenlex_cron_secret')),
    timeout_milliseconds := 65000
  ); $$
);

select cron.schedule(
  'jiawenlex-retention', '15 */6 * * *',
  $$ select net.http_get(
    url := rtrim((select decrypted_secret from vault.decrypted_secrets where name = 'jiawenlex_site_url'), '/') || '/api/cron/retention',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'jiawenlex_cron_secret')),
    timeout_milliseconds := 65000
  ); $$
);
commit;
