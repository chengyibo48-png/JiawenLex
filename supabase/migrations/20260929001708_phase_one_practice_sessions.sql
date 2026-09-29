create table public.practice_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  skill text not null check (skill in ('reading','listening')),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  unique(owner_id, material_id)
);
create index practice_sessions_updated on public.practice_sessions(updated_at);
alter table public.practice_sessions enable row level security;
create policy sessions_self_read on public.practice_sessions for select to authenticated
using (
  owner_id = (select auth.uid()) and (select private.is_active_member())
  and exists (
    select 1 from public.materials m where m.id = material_id and (
      m.owner_id = (select auth.uid()) or (m.visibility = 'shared' and m.approval = 'approved')
      or exists (select 1 from public.share_grants g where g.target_type = 'material'
        and g.target_id = m.id and g.recipient_id = (select auth.uid()) and g.revoked_at is null)
    )
  )
);
revoke all on public.practice_sessions from anon, authenticated;
grant select on public.practice_sessions to authenticated;
grant all on public.practice_sessions to service_role;
comment on table public.practice_sessions is 'Private resumable reading/listening sessions. Writes pass through authenticated server CAS; no administrator read policy.';
