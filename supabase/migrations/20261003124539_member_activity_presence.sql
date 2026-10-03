-- Ephemeral online status; server API only, no client grants or broad admin RLS.
create table public.member_presence (
 owner_id uuid not null references public.profiles(id) on delete cascade,
 session_id uuid not null,
 instance_id uuid not null,
 module text not null check(module in ('today','practice','reading','listening','writing','speaking','vocabulary','plan','library','methods','progress','settings','admin')),
 visible boolean not null default true,
 last_seen timestamptz not null default now(),
 primary key(owner_id,session_id,instance_id)
);
create index member_presence_last_seen on public.member_presence(owner_id,last_seen desc);
alter table public.member_presence enable row level security;
revoke all on public.member_presence from public,anon,authenticated;
grant all on public.member_presence to service_role;
comment on table public.member_presence is 'Approximate last heartbeat per login/tab. Only authenticated server APIs write; only current active administrators read. Never restore as live sessions.';

-- Paginated history uses member + timestamp, rather than scanning the full word bank.
create index if not exists vocabulary_review_events_owner_time on public.vocabulary_review_events(owner_id,created_at desc,event_id desc);
create index if not exists study_tasks_owner_time on public.study_tasks(owner_id,created_at desc,id desc);
