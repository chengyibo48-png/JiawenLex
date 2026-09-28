-- Atomic plan changes, immediate session revocation, persistent summaries and AI reservations.
create or replace function private.session_active(member_id uuid, session_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from auth.sessions s join public.profiles p on p.id = s.user_id
    where s.id = session_id and s.user_id = member_id and p.status = 'active'
      and (s.not_after is null or s.not_after > now())
  )
$$;
revoke all on function private.session_active(uuid, uuid) from public, anon, authenticated;
grant execute on function private.session_active(uuid, uuid) to service_role;

create or replace function public.session_active(member_id uuid, session_id uuid)
returns boolean language sql stable security invoker set search_path = ''
as $$ select private.session_active(member_id, session_id) $$;
revoke all on function public.session_active(uuid, uuid) from public, anon, authenticated;
grant execute on function public.session_active(uuid, uuid) to service_role;

create or replace function private.is_active_member()
returns boolean language sql stable security definer set search_path = ''
as $$ select private.session_active(auth.uid(), nullif(auth.jwt()->>'session_id', '')::uuid) $$;
create or replace function private.is_group_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select private.is_active_member() and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and status = 'active') $$;

create or replace function private.replace_weekly_plan(plan_week date, expected_ids uuid[], new_tasks jsonb)
returns void language plpgsql security invoker set search_path = ''
as $$
declare
  member_id uuid := auth.uid();
  actual_ids uuid[];
begin
  if not private.is_active_member() then raise exception 'inactive account'; end if;
  if plan_week is null or extract(isodow from plan_week) <> 1
     or expected_ids is null or new_tasks is null or jsonb_typeof(new_tasks) <> 'array' then
    raise exception 'invalid plan';
  end if;
  if jsonb_array_length(new_tasks) > 500 then raise exception 'too many tasks'; end if;
  -- Serialize replans for one owner. Lock existing rows so a completion cannot be erased.
  perform 1 from public.profiles where id = member_id for update;
  perform 1 from public.study_tasks where owner_id = member_id and week_start = plan_week for update;
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into actual_ids
    from public.study_tasks where owner_id = member_id and week_start = plan_week and status = 'todo' and source = 'rule';
  if actual_ids is distinct from (select coalesce(array_agg(x order by x), '{}'::uuid[]) from unnest(expected_ids) x) then
    raise exception 'plan_conflict';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(new_tasks) as t(id uuid, owner_id uuid, week_start date, planned_date date, status text, source text, minutes integer)
    where t.id is null or t.owner_id is distinct from member_id or t.week_start is distinct from plan_week
      or t.planned_date is null or t.planned_date < plan_week or t.planned_date > plan_week + 6
      or t.status is distinct from 'todo' or t.source is distinct from 'rule'
      or t.minutes is null or t.minutes not between 10 and 300
  ) then raise exception 'invalid plan task'; end if;
  delete from public.study_tasks where owner_id = member_id and week_start = plan_week and status = 'todo' and source = 'rule';
  insert into public.study_tasks(id, owner_id, week_start, planned_date, skill, title, minutes, status, source, rationale, material_id)
    select t.id, member_id, plan_week, t.planned_date, t.skill, t.title, t.minutes, 'todo', 'rule', coalesce(t.rationale, ''), t.material_id
    from jsonb_to_recordset(new_tasks) as t(id uuid, planned_date date, skill text, title text, minutes integer, rationale text, material_id uuid);
end
$$;
revoke all on function private.replace_weekly_plan(date, uuid[], jsonb) from public, anon;
grant execute on function private.replace_weekly_plan(date, uuid[], jsonb) to authenticated;
create or replace function public.replace_weekly_plan(plan_week date, expected_ids uuid[], new_tasks jsonb)
returns void language sql security invoker set search_path = ''
as $$ select private.replace_weekly_plan(plan_week, expected_ids, new_tasks) $$;
revoke all on function public.replace_weekly_plan(date, uuid[], jsonb) from public, anon;
grant execute on function public.replace_weekly_plan(date, uuid[], jsonb) to authenticated;

alter table public.practice_attempts add column feedback_tags text[] not null default '{}';
alter table public.practice_attempts add column question_stats jsonb not null default '[]' check (jsonb_typeof(question_stats) = 'array');
create or replace function private.keep_attempt_summary()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.feedback is not null then
    new.feedback_tags := array(select distinct value from jsonb_array_elements_text(coalesce(new.feedback->'tags', '[]'::jsonb)) as tags(value));
  end if;
  return new;
end
$$;
revoke all on function private.keep_attempt_summary() from public, anon, authenticated;
create trigger keep_attempt_summary before insert or update on public.practice_attempts for each row execute function private.keep_attempt_summary();
update public.practice_attempts set feedback = feedback where feedback is not null;

alter table public.ai_usage add column status text not null default 'settled' check (status in ('reserved', 'settled'));
alter table public.ai_usage add column reserved_until timestamptz;
create or replace function private.reserve_ai_usage(member_id uuid, provider_name text, operation_name text, estimate numeric, override_budget boolean, reference uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  budget numeric;
  enabled boolean;
  used numeric;
  reservation uuid := gen_random_uuid();
begin
  select monthly_budget_cny, ai_enabled into budget, enabled from public.profiles where id = member_id and status = 'active' for update;
  if not found or not enabled then raise exception 'AI is disabled'; end if;
  if budget is null or budget <= 0 then raise exception 'Set a monthly AI budget'; end if;
  if estimate is null or estimate < 0 or estimate > 10000 then raise exception 'Invalid cost estimate'; end if;
  select coalesce(sum(estimated_cny), 0) into used from public.ai_usage
    where owner_id = member_id and created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'
      and (status = 'settled' or reserved_until > now());
  if used + estimate >= budget and not coalesce(override_budget, false) then raise exception 'budget_confirmation_required'; end if;
  insert into public.ai_usage(id, owner_id, provider, operation, reference_id, estimated_cny, status, reserved_until)
    values (reservation, member_id, provider_name, operation_name, reference, estimate, 'reserved', now() + interval '1 hour');
  return jsonb_build_object('id', reservation, 'used', used);
end
$$;
revoke all on function private.reserve_ai_usage(uuid, text, text, numeric, boolean, uuid) from public, anon, authenticated;
grant execute on function private.reserve_ai_usage(uuid, text, text, numeric, boolean, uuid) to service_role;
create or replace function public.reserve_ai_usage(member_id uuid, provider_name text, operation_name text, estimate numeric, override_budget boolean, reference uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.reserve_ai_usage(member_id, provider_name, operation_name, estimate, override_budget, reference) $$;
revoke all on function public.reserve_ai_usage(uuid, text, text, numeric, boolean, uuid) from public, anon, authenticated;
grant execute on function public.reserve_ai_usage(uuid, text, text, numeric, boolean, uuid) to service_role;
alter table public.transcription_jobs add column usage_id uuid references public.ai_usage(id) on delete set null;
create index transcription_jobs_usage on public.transcription_jobs(usage_id);

-- Owners cannot reference another member's storage paths through the server proxy.
alter table public.materials add constraint materials_file_owner
  check (file_path is null or split_part(file_path, '/', 1) = owner_id::text);
alter table public.practice_attempts add constraint attempts_recording_owner
  check (recording_path is null or split_part(recording_path, '/', 1) = owner_id::text);
create unique index share_grants_active_recipient on public.share_grants(owner_id,recipient_id,target_type,target_id) where revoked_at is null;
