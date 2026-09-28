-- JiawenLex v1. Apply in Supabase SQL Editor before exposing the site.
create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table public.invite_control (
  id integer primary key default 1 check (id = 1),
  code_hash text not null,
  active boolean not null default true,
  max_accounts integer not null default 5 check (max_accounts between 2 and 5),
  updated_at timestamptz not null default now()
);
alter table public.invite_control enable row level security;
revoke all on public.invite_control from anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 32),
  role text not null default 'member' check (role in ('admin','member')),
  status text not null default 'active' check (status in ('active','removed')),
  onboarded boolean not null default false,
  track text not null default 'academic' check (track in ('academic','general')),
  goal_overall numeric(3,1) check (goal_overall between 0 and 9),
  goal_listening numeric(3,1) check (goal_listening between 0 and 9),
  goal_reading numeric(3,1) check (goal_reading between 0 and 9),
  goal_writing numeric(3,1) check (goal_writing between 0 and 9),
  goal_speaking numeric(3,1) check (goal_speaking between 0 and 9),
  target_date date,
  weekly_hours numeric(4,1) not null default 10 check (weekly_hours between 1 and 80),
  language text not null default 'zh' check (language in ('zh','en')),
  theme text not null default 'light' check (theme in ('light','dark')),
  reminder_on boolean not null default false,
  reminder_time time not null default '20:00',
  timezone text not null default 'Asia/Shanghai',
  ai_enabled boolean not null default false,
  monthly_budget_cny numeric(9,2) check (monthly_budget_cny > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_active_member()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and status = 'active') $$;

create or replace function public.is_group_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and status = 'active' and role = 'admin') $$;

create or replace function public.list_members()
returns table(id uuid, display_name text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_active_member() then
    raise exception 'inactive account';
  end if;
  return query select p.id, p.display_name from public.profiles p where p.status = 'active' order by p.created_at;
end;
$$;
revoke all on function public.list_members() from public, anon;
grant execute on function public.list_members() to authenticated;

create or replace function public.jiawenlex_before_user_created(event jsonb)
returns jsonb language plpgsql security definer set search_path = public, auth
as $$
declare
  supplied text := coalesce(event->'user'->'user_metadata'->>'invite_code', '');
  rule public.invite_control%rowtype;
  active_count integer;
begin
  perform pg_advisory_xact_lock(58174239);
  select * into rule from public.invite_control where id = 1;
  if not found or not rule.active or char_length(supplied) < 12
     or encode(sha256(convert_to(supplied, 'UTF8')), 'hex') <> rule.code_hash then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Invalid invitation code'));
  end if;
  select count(*) into active_count from public.profiles where status = 'active';
  if active_count >= rule.max_accounts then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'The group is full'));
  end if;
  return '{}'::jsonb;
end;
$$;
revoke all on function public.jiawenlex_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.jiawenlex_before_user_created(jsonb) to supabase_auth_admin;

create or replace function public.jiawenlex_profile_insert()
returns trigger language plpgsql security definer set search_path = public, auth
as $$
begin
  insert into public.profiles (id, display_name, role, goal_overall, target_date, weekly_hours)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1), '学习伙伴'), 32),
    case when not exists (select 1 from public.profiles) then 'admin' else 'member' end,
    case when not exists (select 1 from public.profiles) then 7.5 else null end,
    case when not exists (select 1 from public.profiles) then date '2027-02-28' else null end,
    10);
  update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'invite_code' where id = new.id;
  return new;
end;
$$;
create trigger jiawenlex_new_user after insert on auth.users
for each row execute function public.jiawenlex_profile_insert();

create or replace function public.protect_profile_admin_fields()
returns trigger language plpgsql set search_path = public
as $$
begin
  if auth.uid() is not null and (new.role <> old.role or new.status <> old.status or new.id <> old.id) then
    raise exception 'Only the service can change account roles or status';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger protect_profile before update on public.profiles
for each row execute function public.protect_profile_admin_fields();

create table public.study_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  planned_date date not null,
  skill text not null check (skill in ('reading','listening','writing','speaking','vocabulary')),
  title text not null check (char_length(title) between 1 and 240),
  minutes integer not null check (minutes between 10 and 300),
  status text not null default 'todo' check (status in ('todo','done','skipped')),
  source text not null default 'manual' check (source in ('manual','rule','ai')),
  rationale text not null default '',
  material_id uuid,
  created_at timestamptz not null default now()
);

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  visibility text not null default 'private' check (visibility in ('private','shared')),
  approval text not null default 'approved' check (approval in ('pending','approved','rejected')),
  title text not null check (char_length(title) between 1 and 240),
  skill text not null check (skill in ('reading','listening','writing','speaking')),
  track text not null default 'academic' check (track in ('academic','general')),
  question_type text not null default '',
  prompt text not null default '',
  passage text not null default '',
  transcript text not null default '',
  questions jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array'),
  tags text[] not null default '{}',
  source_title text not null default '',
  source_url text not null default '',
  license_name text not null default '',
  file_path text,
  file_name text,
  file_kind text,
  created_at timestamptz not null default now()
);
alter table public.study_tasks add constraint study_tasks_material_id_fkey foreign key (material_id) references public.materials(id) on delete set null;

create table public.practice_attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  material_id uuid references public.materials(id) on delete set null,
  skill text not null check (skill in ('reading','listening','writing','speaking')),
  mode text not null check (mode in ('practice','timed')),
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  correct_count integer,
  question_count integer,
  answer_body jsonb,
  feedback jsonb,
  transcript text,
  recording_path text,
  saved_recording boolean not null default false,
  submitted_at timestamptz not null default now(),
  purged_at timestamptz
);
create index practice_attempts_owner_time on public.practice_attempts(owner_id, submitted_at desc);

create table public.vocabulary (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  term text not null check (char_length(term) between 1 and 160),
  definition text not null default '',
  example text not null default '',
  tags text[] not null default '{}',
  due_at timestamptz not null default now(),
  interval_days integer not null default 0 check (interval_days between 0 and 365),
  streak integer not null default 0 check (streak >= 0),
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index vocabulary_due on public.vocabulary(owner_id, due_at);

create table public.writing_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  body text not null default '',
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  unique (owner_id, material_id)
);

create table public.share_grants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('material','attempt')),
  target_id uuid not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (owner_id <> recipient_id)
);
create index share_grants_target on public.share_grants(target_type, target_id);
create index share_grants_recipient on public.share_grants(recipient_id, revoked_at);

create table public.share_comments (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.share_grants(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null,
  operation text not null,
  reference_id uuid,
  estimated_cny numeric(10,4) not null default 0,
  created_at timestamptz not null default now(),
  unique (owner_id, provider, operation, reference_id)
);
create index ai_usage_owner_time on public.ai_usage(owner_id, created_at);

create table public.provider_keys (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('text','asr')),
  provider text not null,
  encrypted_key text not null,
  iv text not null,
  workspace_id text not null default '',
  updated_at timestamptz not null default now(),
  primary key (owner_id, kind)
);
alter table public.provider_keys enable row level security;
revoke all on public.provider_keys from public, anon, authenticated;
grant all on public.provider_keys to service_role;

create table public.transcription_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  task_id text not null unique,
  audio_path text not null,
  save_recording boolean not null default false,
  estimated_cny numeric(10,4) not null default 0,
  status text not null default 'PENDING',
  transcript text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index transcription_jobs_owner on public.transcription_jobs(owner_id, created_at desc);
alter table public.transcription_jobs enable row level security;
revoke all on public.transcription_jobs from public, anon, authenticated;
grant all on public.transcription_jobs to service_role;

create table public.reminder_deliveries (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  local_date date not null,
  sent_at timestamptz not null default now(),
  primary key (owner_id, local_date)
);
alter table public.reminder_deliveries enable row level security;
revoke all on public.reminder_deliveries from public, anon, authenticated;
grant all on public.reminder_deliveries to service_role;

create table public.deletion_events (
  id bigint generated always as identity primary key,
  owner_id uuid,
  entity text not null,
  entity_id uuid not null,
  deleted_at timestamptz not null default now()
);
alter table public.deletion_events enable row level security;
revoke all on public.deletion_events from public, anon, authenticated;
grant all on public.deletion_events to service_role;

create or replace function public.owns_share_target(kind text, item_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select case
    when kind = 'material' then exists (select 1 from public.materials where id = item_id and owner_id = auth.uid())
    when kind = 'attempt' then exists (select 1 from public.practice_attempts where id = item_id and owner_id = auth.uid())
    else false
  end
$$;

create or replace function public.can_read_share(grant_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_active_member() and exists (
    select 1 from public.share_grants
    where id = grant_id and revoked_at is null and (owner_id = auth.uid() or recipient_id = auth.uid())
  )
$$;

create or replace function public.protect_material_approval()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.visibility = 'shared' and (tg_op = 'INSERT' or old.approval <> new.approval) and not public.is_group_admin() then
    if new.approval <> 'pending' then raise exception 'Shared material needs approval'; end if;
  end if;
  if new.visibility = 'shared' and (trim(new.source_title) = '' or trim(new.license_name) = '') then
    raise exception 'Shared material needs source and licence';
  end if;
  return new;
end;
$$;
create trigger protect_material before insert or update on public.materials
for each row execute function public.protect_material_approval();

create or replace function public.protect_material_identity()
returns trigger language plpgsql set search_path = public
as $$
begin
  if auth.uid() is not null and (new.owner_id <> old.owner_id or new.id <> old.id) then
    raise exception 'Cannot change material ownership';
  end if;
  if auth.uid() is not null and public.is_group_admin() and new.owner_id <> auth.uid() and
     (new.title, new.skill, new.track, new.question_type, new.prompt, new.passage,
      new.transcript, new.questions, new.tags, new.source_title, new.source_url,
      new.license_name, new.file_path, new.file_name, new.file_kind, new.visibility)
     is distinct from
     (old.title, old.skill, old.track, old.question_type, old.prompt, old.passage,
      old.transcript, old.questions, old.tags, old.source_title, old.source_url,
      old.license_name, old.file_path, old.file_name, old.file_kind, old.visibility) then
    raise exception 'Admin may only review shared material';
  end if;
  if auth.uid() is not null and not public.is_group_admin() and old.approval = 'approved' and new.visibility = 'shared' then
    new.approval := 'pending';
  end if;
  return new;
end;
$$;
create trigger protect_material_identity before update on public.materials
for each row execute function public.protect_material_identity();

create or replace function public.protect_share_identity()
returns trigger language plpgsql set search_path = public
as $$
begin
  if (new.id, new.owner_id, new.recipient_id, new.target_type, new.target_id, new.created_at)
     is distinct from (old.id, old.owner_id, old.recipient_id, old.target_type, old.target_id, old.created_at) then
    raise exception 'Share identity is immutable';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'Revoked shares cannot be reopened';
  end if;
  return new;
end;
$$;
create trigger protect_share before update on public.share_grants
for each row execute function public.protect_share_identity();

alter table public.profiles enable row level security;
alter table public.study_tasks enable row level security;
alter table public.materials enable row level security;
alter table public.practice_attempts enable row level security;
alter table public.vocabulary enable row level security;
alter table public.writing_drafts enable row level security;
alter table public.share_grants enable row level security;
alter table public.share_comments enable row level security;
alter table public.ai_usage enable row level security;

create policy profiles_self_read on public.profiles for select to authenticated using (id = auth.uid() and public.is_active_member());
create policy profiles_self_update on public.profiles for update to authenticated using (id = auth.uid() and public.is_active_member()) with check (id = auth.uid() and public.is_active_member());

create policy tasks_self_all on public.study_tasks for all to authenticated using (owner_id = auth.uid() and public.is_active_member()) with check (owner_id = auth.uid() and public.is_active_member());
create policy vocab_self_read on public.vocabulary for select to authenticated using (owner_id = auth.uid() and public.is_active_member());
create policy vocab_self_insert on public.vocabulary for insert to authenticated with check (owner_id = auth.uid() and public.is_active_member());
create policy vocab_self_update on public.vocabulary for update to authenticated using (owner_id = auth.uid() and public.is_active_member()) with check (owner_id = auth.uid() and public.is_active_member());
create policy drafts_self_read on public.writing_drafts for select to authenticated using (owner_id = auth.uid() and public.is_active_member());

create policy materials_read on public.materials for select to authenticated using (
  public.is_active_member() and (
    owner_id = auth.uid() or (visibility = 'shared' and approval = 'approved')
    or (public.is_group_admin() and visibility = 'shared')
    or exists (select 1 from public.share_grants g where g.target_type = 'material' and g.target_id = materials.id and g.recipient_id = auth.uid() and g.revoked_at is null)
  )
);
create policy materials_insert on public.materials for insert to authenticated with check (owner_id = auth.uid() and public.is_active_member());
create policy materials_update on public.materials for update to authenticated using (public.is_active_member() and (owner_id = auth.uid() or (public.is_group_admin() and visibility = 'shared'))) with check (public.is_active_member() and (owner_id = auth.uid() or (public.is_group_admin() and visibility = 'shared')));

create policy attempts_read on public.practice_attempts for select to authenticated using (
  public.is_active_member() and (
    owner_id = auth.uid()
    or exists (select 1 from public.share_grants g where g.target_type = 'attempt' and g.target_id = practice_attempts.id and g.recipient_id = auth.uid() and g.revoked_at is null)
  )
);
create policy attempts_insert on public.practice_attempts for insert to authenticated with check (owner_id = auth.uid() and public.is_active_member());

create policy shares_read on public.share_grants for select to authenticated using (public.is_active_member() and (owner_id = auth.uid() or recipient_id = auth.uid()));
create policy shares_insert on public.share_grants for insert to authenticated with check (
  owner_id = auth.uid() and public.is_active_member() and public.owns_share_target(target_type, target_id)
  and exists (select 1 from public.profiles p where p.id = recipient_id and p.status = 'active')
);
create policy comments_read on public.share_comments for select to authenticated using (public.can_read_share(share_id));
create policy comments_insert on public.share_comments for insert to authenticated with check (author_id = auth.uid() and public.can_read_share(share_id));
create policy comments_delete on public.share_comments for delete to authenticated using (author_id = auth.uid() and public.can_read_share(share_id));
create policy usage_self_read on public.ai_usage for select to authenticated using (owner_id = auth.uid() and public.is_active_member());

insert into storage.buckets (id, name, public, file_size_limit)
values ('study-files', 'study-files', false, 26214400), ('study-audio', 'study-audio', false, 26214400)
on conflict (id) do nothing;

create policy own_files_upload on storage.objects for insert to authenticated
with check (bucket_id in ('study-files','study-audio') and split_part(name, '/', 1) = auth.uid()::text and public.is_active_member());
create policy own_files_read on storage.objects for select to authenticated
using (bucket_id in ('study-files','study-audio') and split_part(name, '/', 1) = auth.uid()::text and public.is_active_member());
create policy own_files_delete on storage.objects for delete to authenticated
using (bucket_id in ('study-files','study-audio') and split_part(name, '/', 1) = auth.uid()::text and public.is_active_member());

create or replace function public.log_deleted_attempt()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.deletion_events(owner_id, entity, entity_id) values (old.owner_id, 'practice_attempts', old.id);
  return old;
end;
$$;
create trigger log_deleted_attempt after delete on public.practice_attempts
for each row execute function public.log_deleted_attempt();

create or replace function public.log_deleted_material()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.deletion_events(owner_id, entity, entity_id) values (old.owner_id, 'materials', old.id);
  return old;
end;
$$;
create trigger log_deleted_material after delete on public.materials
for each row execute function public.log_deleted_material();
