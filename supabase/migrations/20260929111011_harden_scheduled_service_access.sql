-- Best-effort hardening for installations where the migration role owns pg_net.
-- Hosted Supabase owns these objects as supabase_admin: REVOKE may only warn and
-- leave ACLs unchanged. Verify ACLs; do not treat migration success as revocation.
-- On hosted projects net must remain absent from the exposed Data API schemas.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'net') then
    revoke all on schema net from public, anon, authenticated;
    revoke all on all tables in schema net from public, anon, authenticated;
    revoke all on all sequences in schema net from public, anon, authenticated;
    revoke all on all functions in schema net from public, anon, authenticated;
  end if;
end $$;
