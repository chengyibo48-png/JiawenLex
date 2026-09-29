alter table public.materials add column revision integer not null default 1;
alter table public.materials add column updated_at timestamptz not null default now();
alter table public.materials add column collection_title text not null default '' check(length(collection_title)<=160);
alter table public.materials add column set_title text not null default '' check(length(set_title)<=160);
alter table public.materials add column part_title text not null default '' check(length(part_title)<=160);
alter table public.materials add column sort_order integer not null default 0;
alter table public.materials add column training_kind text not null default 'none' check(training_kind in ('none','paraphrase','rewrite','speaking_part1'));
alter table public.materials add column training_minutes integer not null default 5 check(training_minutes between 1 and 20);
alter table public.materials add column training_topics text[] not null default '{}';
alter table public.practice_attempts add column material_revision integer;
alter table public.writing_drafts add column material_revision integer;
create table public.material_versions (
 id uuid primary key default gen_random_uuid(), material_id uuid not null references public.materials(id) on delete cascade,
 revision integer not null, snapshot jsonb not null, created_at timestamptz not null default now(), unique(material_id,revision)
);
alter table public.material_versions enable row level security;
create policy versions_read on public.material_versions for select to authenticated using((select private.is_active_member()) and exists(select 1 from public.materials m where m.id=material_id));
create policy versions_capture on public.material_versions for insert to authenticated with check((select private.is_active_member()) and exists(select 1 from public.materials m where m.id=material_id and m.revision=material_versions.revision and material_versions.snapshot=to_jsonb(m)-'owner_id' and (m.owner_id=(select auth.uid()) or (m.visibility='shared' and (select private.is_group_admin())))));
revoke all on public.material_versions from anon,authenticated;
grant select,insert on public.material_versions to authenticated;
grant all on public.material_versions to service_role;
create function private.bump_material_version() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.training_kind<>'none' and (new.source_title='' or new.license_name='') then raise exception 'Micro training requires a source and permission'; end if;
 if (new.training_kind='paraphrase' and new.skill<>'reading') or (new.training_kind='rewrite' and new.skill<>'writing') or (new.training_kind='speaking_part1' and new.skill<>'speaking') then raise exception 'Training kind does not match skill'; end if;
 if new.set_title<>'' and new.collection_title='' then raise exception 'Set requires a collection'; end if;
 if new.part_title<>'' and new.set_title='' then raise exception 'Part requires a set'; end if;
 if tg_op='INSERT' then new.revision:=1;
 elsif (to_jsonb(new)-'revision'-'updated_at') is distinct from (to_jsonb(old)-'revision'-'updated_at') then new.revision:=old.revision+1;
 else new.revision:=old.revision;new.updated_at:=old.updated_at;return new; end if;
 new.updated_at:=now();return new;
end $$;
create function private.capture_material_version() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 insert into public.material_versions(material_id,revision,snapshot) values(new.id,new.revision,to_jsonb(new)-'owner_id') on conflict(material_id,revision) do nothing;
 return new;
end $$;
create trigger bump_material_version before insert or update on public.materials for each row execute function private.bump_material_version();
create trigger capture_material_version after insert or update on public.materials for each row execute function private.capture_material_version();
insert into public.material_versions(material_id,revision,snapshot) select id,revision,to_jsonb(m)-'owner_id' from public.materials m;

create table public.micro_sessions (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.profiles(id) on delete cascade,
 material_id text not null, source_material_id uuid references public.materials(id) on delete cascade,
 body text not null check(length(body)<=100000),version integer not null default 1,updated_at timestamptz not null default now(),unique(owner_id,material_id)
);
create index micro_sessions_owner on public.micro_sessions(owner_id);
create index micro_sessions_source on public.micro_sessions(source_material_id);
create index micro_sessions_updated on public.micro_sessions(updated_at);
create table public.micro_attempts (
 id uuid primary key,owner_id uuid not null references public.profiles(id) on delete cascade,
 unit_key text not null,kind text not null check(kind in ('paraphrase','rewrite','speaking_part1')),
 skill text not null check(skill in ('reading','writing','speaking')),duration_seconds integer not null check(duration_seconds>=0),
 item_count integer not null,correct_count integer,answer_body jsonb,self_review jsonb,unit_snapshot jsonb,
 submitted_at timestamptz not null default now(),purged_at timestamptz
);
create index micro_attempts_owner on public.micro_attempts(owner_id,submitted_at desc);
alter table public.micro_sessions enable row level security;
alter table public.micro_attempts enable row level security;
create policy micro_sessions_self on public.micro_sessions for select to authenticated using(owner_id=(select auth.uid()) and (select private.is_active_member()) and (source_material_id is null or exists(select 1 from public.materials where id=source_material_id)));
create policy micro_attempts_self on public.micro_attempts for select to authenticated using(owner_id=(select auth.uid()) and (select private.is_active_member()));
revoke all on public.micro_sessions,public.micro_attempts from anon,authenticated;
grant select on public.micro_sessions,public.micro_attempts to authenticated;
grant all on public.micro_sessions,public.micro_attempts to service_role;

create function public.submit_response_attempt(payload jsonb, expected_snapshot jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare m public.materials; a public.practice_attempts;
begin
 a:=jsonb_populate_record(null::public.practice_attempts,payload);
 if exists(select 1 from public.practice_attempts where id=a.id and owner_id=a.owner_id) then return a.id; end if;
 select * into strict m from public.materials where id=a.material_id for share;
 if a.skill not in ('writing','speaking') then raise exception 'Response material unavailable'; end if;
 if not (m.owner_id=a.owner_id or (m.visibility='shared' and m.approval='approved') or exists(select 1 from public.share_grants where target_type='material' and target_id=m.id and recipient_id=a.owner_id and revoked_at is null)) then raise exception 'Response material unavailable'; end if;
 if not exists(select 1 from public.material_versions where material_id=m.id and revision=a.material_revision and snapshot=expected_snapshot and snapshot->>'skill'=a.skill and snapshot->>'track'='academic') then raise exception 'material_version_conflict'; end if;
 insert into public.practice_attempts(id,owner_id,material_id,material_revision,skill,mode,duration_seconds,answer_body,feedback,transcript,recording_path,saved_recording,submitted_at,learning_kind)
 values(a.id,a.owner_id,m.id,a.material_revision,a.skill,a.mode,a.duration_seconds,a.answer_body,a.feedback,a.transcript,a.recording_path,a.saved_recording,now(),'legacy');
 insert into public.attempt_reviews(id,owner_id,snapshot) values(a.id,a.owner_id,expected_snapshot);
 return a.id;
end $$;
revoke all on function public.submit_response_attempt(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.submit_response_attempt(jsonb,jsonb) to service_role;
comment on table public.material_versions is 'Immutable revisions. Access follows current material RLS; capture inserts must exactly equal its current database row.';

alter table public.micro_attempts add column unit_title text not null default '';
alter table public.micro_attempts add column unit_stamp text not null default '';
alter table public.micro_attempts add column criteria_total integer not null default 0;
alter table public.micro_attempts add column criteria_passed integer not null default 0;
create function public.submit_micro_attempt(payload jsonb,source_material uuid) returns uuid language plpgsql security invoker set search_path='' as $$
declare a public.micro_attempts; m public.materials;
begin
 a:=jsonb_populate_record(null::public.micro_attempts,payload);
 if exists(select 1 from public.micro_attempts where id=a.id and owner_id=a.owner_id) then return a.id; end if;
 if source_material is not null then
  select * into strict m from public.materials where id=source_material for share;
  if not(m.owner_id=a.owner_id or (m.visibility='shared' and m.approval='approved') or exists(select 1 from public.share_grants where target_type='material' and target_id=m.id and recipient_id=a.owner_id and revoked_at is null)) then raise exception 'Training access revoked'; end if;
  if (a.unit_snapshot->>'stamp')<>('material-v'||m.revision::text) then raise exception 'Training version changed; answers retained'; end if;
 end if;
 insert into public.micro_attempts(id,owner_id,unit_key,kind,skill,duration_seconds,item_count,correct_count,answer_body,self_review,unit_snapshot,unit_title,unit_stamp,criteria_total,criteria_passed)
 values(a.id,a.owner_id,a.unit_key,a.kind,a.skill,a.duration_seconds,a.item_count,a.correct_count,a.answer_body,a.self_review,a.unit_snapshot,a.unit_title,a.unit_stamp,a.criteria_total,a.criteria_passed);
 return a.id;
end $$;
revoke all on function public.submit_micro_attempt(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.submit_micro_attempt(jsonb,uuid) to service_role;

create or replace function public.submit_objective_attempt(payload jsonb, expected_snapshot jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare m public.materials; result_id uuid := (payload->>'id')::uuid; member uuid := (payload->>'owner_id')::uuid; snap jsonb; kind text; seen boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended(member::text || (payload->>'material_id'),0));
 if exists(select 1 from public.practice_attempts where id=result_id and owner_id=member) then return result_id; end if;
 select * into strict m from public.materials where id=(payload->>'material_id')::uuid for share;
 if m.track <> 'academic' or m.skill not in ('reading','listening') or not exists(select 1 from public.profiles where id=member and status='active') then raise exception 'Material unavailable'; end if;
 if not (m.owner_id=member or (m.visibility='shared' and m.approval='approved') or exists(select 1 from public.share_grants where target_type='material' and target_id=m.id and recipient_id=member and revoked_at is null)) then raise exception 'Material unavailable'; end if;
 snap := jsonb_build_object('prompt',m.prompt,'revision',m.revision,'id',m.id,'title',m.title,'skill',m.skill,'passage',m.passage,'transcript',m.transcript,'questions',m.questions,'question_type',m.question_type,'audio_segments',m.audio_segments,'audio_path',m.file_path,'source_title',m.source_title,'license_name',m.license_name);
 if snap <> expected_snapshot then raise exception 'Material changed; answers retained. Restart with the new version.'; end if;
 seen := coalesce((payload->>'answer_exposed')::boolean,false) or exists(select 1 from public.practice_sessions where owner_id=member and material_id=m.id and answer_seen) or exists(select 1 from public.practice_attempts where owner_id=member and material_id=m.id and (learning_kind in ('first','repeat','review') or answer_exposed));
 kind := case when payload->>'learning_kind'='intensive' then 'intensive' when seen then 'review' when exists(select 1 from public.practice_attempts where owner_id=member and material_id=m.id and learning_kind<>'intensive') then 'repeat' else 'first' end;
 insert into public.practice_attempts(id,owner_id,material_id,material_revision,skill,mode,duration_seconds,correct_count,question_count,answer_body,feedback,question_stats,saved_recording,submitted_at,learning_kind,answer_exposed)
 values(result_id,member,m.id,m.revision,m.skill,payload->>'mode',(payload->>'duration_seconds')::integer,case when kind='intensive' then null else (payload->>'correct_count')::integer end,case when kind='intensive' then null else (payload->>'question_count')::integer end,case when kind='intensive' then null else payload->'answer_body' end,null,case when kind='intensive' then '[]'::jsonb else payload->'question_stats' end,false,now(),kind,seen);
 if kind <> 'intensive' then insert into public.attempt_reviews(id,owner_id,snapshot,flagged) values(result_id,member,snap,array(select jsonb_array_elements_text(coalesce(payload->'flagged','[]'::jsonb)))); end if;
 if seen then update public.practice_sessions set answer_seen=true where owner_id=member and material_id=m.id; end if;
 return result_id;
end $$;
revoke all on function public.submit_objective_attempt(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.submit_objective_attempt(jsonb,jsonb) to service_role;
