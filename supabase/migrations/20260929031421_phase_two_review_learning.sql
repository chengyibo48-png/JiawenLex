alter table public.materials add column audio_segments jsonb not null default '[]' check (jsonb_typeof(audio_segments) = 'array');
alter table public.practice_sessions add column answer_seen boolean not null default false;
alter table public.practice_attempts add column learning_kind text not null default 'legacy' check (learning_kind in ('legacy','first','repeat','review','intensive'));
alter table public.practice_attempts add column answer_exposed boolean not null default false;
alter table public.study_tasks add column review_attempt_id uuid references public.practice_attempts(id) on delete set null;
alter table public.study_tasks add column question_id text;

create table public.attempt_reviews (
 id uuid primary key references public.practice_attempts(id) on delete cascade,
 owner_id uuid not null references public.profiles(id) on delete cascade,
 snapshot jsonb not null, flagged text[] not null default '{}',
 notes jsonb not null default '{}', version integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index attempt_reviews_owner on public.attempt_reviews(owner_id);
create table public.vocabulary_sources (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
 word_id uuid not null references public.vocabulary(id) on delete cascade,
 attempt_id uuid not null references public.attempt_reviews(id) on delete cascade,
 question_id text not null, context text not null, created_at timestamptz not null default now(),
 unique(word_id,attempt_id,question_id)
);
create index vocabulary_sources_owner on public.vocabulary_sources(owner_id);
create index vocabulary_sources_attempt on public.vocabulary_sources(attempt_id);
create table public.spelling_sessions (
 id uuid primary key, owner_id uuid not null references public.profiles(id) on delete cascade,
 total integer not null check(total between 1 and 20), correct integer not null check(correct >= 0 and correct <= total),
 wrong_word_ids uuid[] not null default '{}', created_at timestamptz not null default now()
);
create index spelling_sessions_owner on public.spelling_sessions(owner_id,created_at desc);
alter table public.attempt_reviews enable row level security;
alter table public.vocabulary_sources enable row level security;
alter table public.spelling_sessions enable row level security;
create policy reviews_self_read on public.attempt_reviews for select to authenticated using(owner_id=(select auth.uid()) and (select private.is_active_member()));
create policy word_sources_self_read on public.vocabulary_sources for select to authenticated using(owner_id=(select auth.uid()) and (select private.is_active_member()));
create policy spelling_self_read on public.spelling_sessions for select to authenticated using(owner_id=(select auth.uid()) and (select private.is_active_member()));
revoke all on public.attempt_reviews,public.vocabulary_sources,public.spelling_sessions from anon,authenticated;
grant select on public.attempt_reviews,public.vocabulary_sources,public.spelling_sessions to authenticated;
grant all on public.attempt_reviews,public.vocabulary_sources,public.spelling_sessions to service_role;

-- Invoker functions are only callable by the authenticated application server.
create function public.submit_objective_attempt(payload jsonb, expected_snapshot jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare m public.materials; result_id uuid := (payload->>'id')::uuid; member uuid := (payload->>'owner_id')::uuid; snap jsonb; kind text; seen boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended(member::text || (payload->>'material_id'),0));
 if exists(select 1 from public.practice_attempts where id=result_id and owner_id=member) then return result_id; end if;
 select * into strict m from public.materials where id=(payload->>'material_id')::uuid for share;
 if m.track <> 'academic' or m.skill not in ('reading','listening') or not exists(select 1 from public.profiles where id=member and status='active') then raise exception 'Material unavailable'; end if;
 if not (m.owner_id=member or (m.visibility='shared' and m.approval='approved') or exists(select 1 from public.share_grants where target_type='material' and target_id=m.id and recipient_id=member and revoked_at is null)) then raise exception 'Material unavailable'; end if;
 snap := jsonb_build_object('id',m.id,'title',m.title,'skill',m.skill,'passage',m.passage,'transcript',m.transcript,'questions',m.questions,'question_type',m.question_type,'audio_segments',m.audio_segments,'audio_path',m.file_path,'source_title',m.source_title,'license_name',m.license_name);
 if snap <> expected_snapshot then raise exception 'Material changed; answers retained. Restart with the new version.'; end if;
 seen := coalesce((payload->>'answer_exposed')::boolean,false) or exists(select 1 from public.practice_sessions where owner_id=member and material_id=m.id and answer_seen) or exists(select 1 from public.practice_attempts where owner_id=member and material_id=m.id and (learning_kind in ('first','repeat','review') or answer_exposed));
 kind := case when payload->>'learning_kind'='intensive' then 'intensive' when seen then 'review' when exists(select 1 from public.practice_attempts where owner_id=member and material_id=m.id and learning_kind<>'intensive') then 'repeat' else 'first' end;
 insert into public.practice_attempts(id,owner_id,material_id,skill,mode,duration_seconds,correct_count,question_count,answer_body,feedback,question_stats,saved_recording,submitted_at,learning_kind,answer_exposed)
 values(result_id,member,m.id,m.skill,payload->>'mode',(payload->>'duration_seconds')::integer,case when kind='intensive' then null else (payload->>'correct_count')::integer end,case when kind='intensive' then null else (payload->>'question_count')::integer end,case when kind='intensive' then null else payload->'answer_body' end,null,case when kind='intensive' then '[]'::jsonb else payload->'question_stats' end,false,now(),kind,seen);
 if kind <> 'intensive' then insert into public.attempt_reviews(id,owner_id,snapshot,flagged) values(result_id,member,snap,array(select jsonb_array_elements_text(coalesce(payload->'flagged','[]'::jsonb)))); end if;
 if seen then update public.practice_sessions set answer_seen=true where owner_id=member and material_id=m.id; end if;
 return result_id;
end $$;
revoke all on function public.submit_objective_attempt(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.submit_objective_attempt(jsonb,jsonb) to service_role;

create function public.add_review_word(member uuid, review_id uuid, qid text, word text, meaning text, merge_id uuid default null) returns uuid
language plpgsql security invoker set search_path='' as $$
declare r public.attempt_reviews; q jsonb; wid uuid; context_text text; existing_count integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(member::text || lower(trim(word)),0));
 select * into strict r from public.attempt_reviews where id=review_id and owner_id=member;
 select value into strict q from jsonb_array_elements(r.snapshot->'questions') where value->>'id'=qid;
 context_text := case when coalesce(q->'evidence'->>'quote','')<>'' and position((q->'evidence'->>'quote') in (case when r.snapshot->>'skill'='reading' then r.snapshot->>'passage' else r.snapshot->>'transcript' end))>0 then q->'evidence'->>'quote' when r.snapshot->>'skill'='reading' and coalesce((q->'evidence'->>'paragraph')::integer,0)>0 then split_part(r.snapshot->>'passage',E'\n',(q->'evidence'->>'paragraph')::integer) else coalesce(q->>'prompt','') end;
 select count(*) into existing_count from public.vocabulary where owner_id=member and lower(regexp_replace(trim(term),'\s+',' ','g'))=lower(trim(word));
 if existing_count>0 and merge_id is null then raise exception 'duplicate_word_confirmation_required'; end if;
 if merge_id is not null then
   select id into strict wid from public.vocabulary where id=merge_id and owner_id=member and lower(regexp_replace(trim(term),'\s+',' ','g'))=lower(trim(word));
 else
   wid := gen_random_uuid();
   insert into public.vocabulary(id,owner_id,term,definition,example,tags,due_at) values(wid,member,trim(word),trim(meaning),'',array[r.snapshot->>'skill','错题复盘'],now());
 end if;
 insert into public.vocabulary_sources(owner_id,word_id,attempt_id,question_id,context) values(member,wid,review_id,qid,context_text) on conflict(word_id,attempt_id,question_id) do nothing;
 return wid;
end $$;
revoke all on function public.add_review_word(uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.add_review_word(uuid,uuid,text,text,text,uuid) to service_role;

create function public.schedule_question_review(member uuid, review_id uuid, qid text, planned date, task_minutes integer) returns uuid
language plpgsql security invoker set search_path='' as $$
declare r public.attempt_reviews; week_day date := date_trunc('week',planned::timestamp)::date; tid uuid; used integer; budget integer;
begin
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
revoke all on function public.schedule_question_review(uuid,uuid,text,date,integer) from public,anon,authenticated;
grant execute on function public.schedule_question_review(uuid,uuid,text,date,integer) to service_role;

create function private.purge_attempt_review() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.purged_at is not null then delete from public.attempt_reviews where id=new.id; end if;
 return new;
end $$;
create trigger purge_review_with_attempt after update of purged_at on public.practice_attempts for each row execute function private.purge_attempt_review();
comment on table public.attempt_reviews is 'Owner-only immutable question snapshot and CAS review notes; never shared with attempt recipients. Deleted when raw attempt is purged.';
