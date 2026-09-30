alter table public.source_documents
  add column members_visible boolean not null default false;

create index source_documents_members_visible_time
  on public.source_documents(created_at desc)
  where members_visible and status = 'ready';
