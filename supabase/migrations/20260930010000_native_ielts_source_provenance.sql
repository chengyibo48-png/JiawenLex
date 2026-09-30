-- Four-skill source classification, rights declaration, and per-page review audit.
alter table public.source_documents
  add column if not exists skill_tags text[] not null default '{}',
  add column if not exists rights_attested_at timestamptz,
  add column if not exists rights_attestation text not null default '';
alter table public.source_documents add constraint source_documents_skill_tags_valid
  check (skill_tags <@ array['reading','listening','writing','speaking']::text[]);
alter table public.materials add column if not exists origin_kind text
  check (origin_kind in ('source','adapted','mixed'));
create table if not exists public.source_page_audit (
  document_id uuid not null references public.source_documents(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  physical_page integer not null check (physical_page > 0),
  status text not null default 'pending' check (status in ('extracted','non_exercise','pending')),
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (document_id, physical_page)
);
create index if not exists source_page_audit_owner_status on public.source_page_audit(owner_id, status);
alter table public.source_page_audit enable row level security;
revoke all on public.source_page_audit from public, anon, authenticated;
grant all on public.source_page_audit to service_role;
