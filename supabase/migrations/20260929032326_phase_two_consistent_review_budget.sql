-- Review scheduling and automatic replanning share a lock and a combined time budget.
create or replace function public.schedule_question_review(member uuid, review_id uuid, qid text, planned date, task_minutes integer) returns uuid
language plpgsql security invoker set search_path='' as $$
declare r public.attempt_reviews; week_day date := date_trunc('week',planned::timestamp)::date; tid uuid; used integer; budget integer;
begin
 -- Share the profile row lock used by rule-plan replacement.
 perform 1 from public.profiles where id=member and status='active' for update;
 perform pg_advisory_xact_lock(hashtextextended(member::text || week_day::text,0));
 select * into strict r from public.attempt_reviews where id=review_id and owner_id=member;
 if not exists(select 1 from jsonb_array_elements(r.snapshot->'questions') q where q->>'id'=qid) then raise exception 'Question unavailable'; end if;
 select id into tid from public.study_tasks where owner_id=member and review_attempt_id=review_id and question_id=qid and status='todo' limit 1;
 if tid is not null then return tid; end if;
 select (weekly_hours*60)::integer into strict budget from public.profiles where id=member and status='active';
 select coalesce(sum(minutes),0) into used from public.study_tasks where owner_id=member and week_start=week_day and status<>'skipped';
 if used+task_minutes>budget then raise exception 'weekly_budget_exceeded'; end if;
 tid := gen_random_uuid();
 insert into public.study_tasks(id,owner_id,week_start,planned_date,skill,title,minutes,status,source,rationale,material_id,review_attempt_id,question_id)
 values(tid,member,week_day,planned,r.snapshot->>'skill',concat('复盘 / Review: ',r.snapshot->>'title'),task_minutes,'todo','manual','复盘这次作答与错因 / Review answers and error reasons',(select id from public.materials where id=(r.snapshot->>'id')::uuid),review_id,qid);
 return tid;
end $$;

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
  if (select coalesce(sum(minutes),0) from public.study_tasks where owner_id=member_id and week_start=plan_week and status<>'skipped' and not(status='todo' and source='rule'))
     + (select coalesce(sum(t.minutes),0) from jsonb_to_recordset(new_tasks) as t(minutes integer))
     > (select weekly_hours*60 from public.profiles where id=member_id) then
    raise exception 'weekly_budget_exceeded';
  end if;
  delete from public.study_tasks where owner_id = member_id and week_start = plan_week and status = 'todo' and source = 'rule';
  insert into public.study_tasks(id, owner_id, week_start, planned_date, skill, title, minutes, status, source, rationale, material_id)
    select t.id, member_id, plan_week, t.planned_date, t.skill, t.title, t.minutes, 'todo', 'rule', coalesce(t.rationale, ''), t.material_id
    from jsonb_to_recordset(new_tasks) as t(id uuid, planned_date date, skill text, title text, minutes integer, rationale text, material_id uuid);
end
$$;
