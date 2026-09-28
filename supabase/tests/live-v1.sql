-- Run only after all V1 migrations are installed. Requires a real active member/session.
-- Temporary fixtures, profile settings and usage reservations are always rolled back.
-- No Auth user/session is created, changed or revoked; no email or AI call is made.
begin;
do $verify$
declare
  member_id uuid;
  member_session uuid;
  fixture_week date := date_trunc('week', date '2050-01-10')::date;
  task_id uuid := gen_random_uuid();
  replacement_id uuid := gen_random_uuid();
  task jsonb;
  used_cost numeric;
  reserved_count integer;
begin
  select p.id,s.id into member_id,member_session
    from public.profiles p join auth.sessions s on s.user_id=p.id
    where p.status='active' and (s.not_after is null or s.not_after>now())
    limit 1;
  if member_id is null then raise exception 'No active session available'; end if;
  if exists(select 1 from public.study_tasks where owner_id=member_id and week_start=fixture_week) then
    raise exception 'Fixture week must be empty';
  end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',member_id,'role','authenticated','session_id',member_session)::text,true);
  set local role authenticated;
  if not private.is_active_member() then raise exception 'Valid session denied'; end if;
  if (select count(*) from public.profiles) <> 1 then raise exception 'Profile isolation failed'; end if;
  if (select count(*) from public.list_members()) < 1 then raise exception 'Directory unavailable'; end if;
  begin
    perform public.session_active(member_id,member_session);
    raise exception 'Member can query server-only session API';
  exception when insufficient_privilege then null;
  end;
  task := jsonb_build_array(jsonb_build_object('id',task_id,'owner_id',member_id,'week_start',fixture_week,'planned_date',fixture_week,'skill','reading','title','Temporary validation task','minutes',30,'status','todo','source','rule'));
  perform public.replace_weekly_plan(fixture_week,'{}'::uuid[],task);
  if not exists(select 1 from public.study_tasks where id=task_id) then raise exception 'Atomic save failed'; end if;
  begin
    perform public.replace_weekly_plan(fixture_week,array[task_id],jsonb_build_array(jsonb_build_object('id',replacement_id,'owner_id',member_id,'week_start',fixture_week,'planned_date',fixture_week,'skill','reading','title','','minutes',30,'status','todo','source','rule')));
    raise exception 'Invalid plan unexpectedly accepted';
  exception when check_violation then null;
  end;
  if not exists(select 1 from public.study_tasks where id=task_id) then raise exception 'Rollback lost original task'; end if;
  update public.study_tasks set status='done' where id=task_id;
  begin
    perform public.replace_weekly_plan(fixture_week,array[task_id],'[]'::jsonb);
    raise exception 'Stale plan unexpectedly accepted';
  exception when raise_exception then
    if SQLERRM <> 'plan_conflict' then raise; end if;
  end;
  if not exists(select 1 from public.study_tasks where id=task_id and status='done') then raise exception 'Completed task lost'; end if;
  begin
    insert into public.materials(owner_id,title,skill,file_path) values(member_id,'Temporary forged attachment','reading',gen_random_uuid()::text || '/private.pdf');
    raise exception 'Foreign attachment path accepted';
  exception when check_violation then null;
  end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',member_id,'role','authenticated','session_id',gen_random_uuid())::text,true);
  if private.is_active_member() then raise exception 'Unknown session accepted'; end if;
  if exists(select 1 from public.profiles) then raise exception 'Invalid session can read profiles'; end if;
  if exists(select 1 from public.study_tasks) then raise exception 'Invalid session can read tasks'; end if;
  reset role;
  select coalesce(sum(estimated_cny),0) into used_cost from public.ai_usage where owner_id=member_id
    and created_at >= date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'
    and (status='settled' or reserved_until>now());
  update public.profiles set ai_enabled=true,monthly_budget_cny=used_cost+10 where id=member_id;
  set local role service_role;
  select count(*) into reserved_count from public.ai_usage where owner_id=member_id;
  perform public.reserve_ai_usage(member_id,'deepseek','validation_only',6,false,null);
  begin
    perform public.reserve_ai_usage(member_id,'deepseek','validation_only',5,false,null);
    raise exception 'Budget reservation not enforced';
  exception when raise_exception then
    if SQLERRM <> 'budget_confirmation_required' then raise; end if;
  end;
  perform public.reserve_ai_usage(member_id,'deepseek','validation_only',5,true,null);
  if (select count(*) from public.ai_usage where owner_id=member_id) <> reserved_count+2 then raise exception 'Reservation count failed'; end if;
  reset role;
end
$verify$;
rollback;
select 'passed' as real_session_plan_attachment_budget_checks, 'all fixtures rolled back; no user session revoked; no AI charge' as effect;
