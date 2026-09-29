-- Mirror the extension-only migration already applied to the hosted project.
-- Vault configuration and actual schedules are separate deployment operations.
create extension if not exists pg_cron;
create extension if not exists pg_net;
