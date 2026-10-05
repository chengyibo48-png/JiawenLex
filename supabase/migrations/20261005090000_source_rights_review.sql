-- Separate the uploader's rights declaration from an administrator's approval.
-- Existing visibility and records are retained; this only gates future sharing.
alter table public.source_documents
  add column if not exists rights_review_status text not null default 'not_submitted'
    check (rights_review_status in ('not_submitted','pending','approved','rejected')),
  add column if not exists rights_reviewed_at timestamptz,
  add column if not exists rights_reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists rights_review_note text not null default '';

update public.source_documents
set rights_review_status = 'pending'
where rights_attested_at is not null and rights_review_status = 'not_submitted';

create index if not exists source_documents_rights_review_queue
  on public.source_documents(rights_review_status, created_at desc)
  where rights_review_status = 'pending';

-- Keep declarations and decisions as immutable history, in the same transaction
-- as the document update. A later submission cannot erase an earlier decision.
create table if not exists public.source_rights_audit (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.source_documents(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  decision text not null check (decision in ('pending','approved','rejected')),
  attestation text not null,
  attested_at timestamptz,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists source_rights_audit_document_time
  on public.source_rights_audit(document_id, created_at desc, id);
alter table public.source_rights_audit enable row level security;
revoke all on public.source_rights_audit from public, anon, authenticated;
grant select, insert on public.source_rights_audit to service_role;

create or replace function public.record_source_rights_audit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.rights_review_status in ('pending','approved','rejected') and
     (new.rights_review_status is distinct from old.rights_review_status or
      new.rights_attestation is distinct from old.rights_attestation or
      new.rights_attested_at is distinct from old.rights_attested_at) then
    insert into public.source_rights_audit(document_id,owner_id,actor_id,decision,attestation,attested_at,note)
    values(new.id,new.owner_id,case when new.rights_review_status = 'pending' then new.owner_id else new.rights_reviewed_by end,
      new.rights_review_status,new.rights_attestation,new.rights_attested_at,new.rights_review_note);
  end if;
  return new;
end $$;
revoke all on function public.record_source_rights_audit() from public, anon, authenticated;
create trigger source_rights_audit_record
  after update of rights_review_status,rights_attestation,rights_attested_at on public.source_documents
  for each row execute function public.record_source_rights_audit();
