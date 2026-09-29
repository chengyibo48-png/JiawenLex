-- Short retryable batches need several cleanup opportunities per day.
-- Fresh recovery projects do not start schedules until cron.sql is configured.
do $$
declare existing_command text;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select command into existing_command from cron.job where jobname = 'jiawenlex-retention';
    if existing_command is not null then
      perform cron.schedule('jiawenlex-retention', '15 */6 * * *', existing_command);
    end if;
  end if;
end $$;
