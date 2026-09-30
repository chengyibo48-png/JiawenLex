begin;
alter table public.vocabulary add column if not exists part_of_speech text not null default '';
alter table public.vocabulary add column if not exists pronunciation text not null default '';
alter table public.vocabulary add column if not exists pronunciation_uk text not null default '';
alter table public.vocabulary add column if not exists pronunciation_us text not null default '';
alter table public.vocabulary add column if not exists content_revision integer not null default 1;
alter table public.vocabulary add column if not exists import_key text;
create unique index if not exists vocabulary_import_identity on public.vocabulary(owner_id,import_key) where import_key is not null;

create table if not exists public.study_guides (
  id uuid primary key, owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null, category text not null check(category in ('plan','writing_method','answering_strategy','patterns','grammar')),
  body text not null, skill_tags text[] not null default '{}', source_document_id uuid references public.source_documents(id) on delete set null,
  visibility text not null default 'private' check(visibility in ('private','shared')),
  approval text not null default 'pending' check(approval in ('pending','approved','rejected')),
  license_name text not null default '', created_at timestamptz not null default now()
);
alter table public.study_guides enable row level security;
create policy guides_read on public.study_guides for select to authenticated using ((select private.is_active_member()) and (owner_id=(select auth.uid()) or (visibility='shared' and approval='approved')));
create policy guides_write on public.study_guides for all to authenticated using ((select private.is_active_member()) and owner_id=(select auth.uid())) with check ((select private.is_active_member()) and owner_id=(select auth.uid()) and (visibility='private' or (license_name<>'' and (approval='pending' or (select private.is_group_admin())))));
grant select,insert,update,delete on public.study_guides to authenticated;
grant all on public.study_guides to service_role;

create table if not exists public.vocabulary_templates (
 id uuid primary key, owner_id uuid not null references public.profiles(id) on delete cascade,
 term text not null, definition text not null, example text not null default '', tags text[] not null default '{}',
 part_of_speech text not null default '', pronunciation text not null default '', pronunciation_uk text not null default '', pronunciation_us text not null default '',
 source_document_id uuid references public.source_documents(id) on delete set null, approved boolean not null default false,
 created_at timestamptz not null default now()
);
alter table public.vocabulary_templates enable row level security;
grant all on public.vocabulary_templates to service_role;

create table if not exists public.vocabulary_review_events (
 owner_id uuid not null references public.profiles(id) on delete cascade, event_id uuid not null,
 word_id uuid not null references public.vocabulary(id) on delete cascade, known boolean not null,
 result jsonb not null, created_at timestamptz not null default now(), primary key(owner_id,event_id)
);
alter table public.vocabulary_review_events enable row level security;
grant all on public.vocabulary_review_events to service_role;

create table if not exists public.word_error_reports (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
 word_id uuid not null references public.vocabulary(id) on delete cascade, content_revision integer not null,
 kind text not null check(kind in ('spelling','meaning','pronunciation','example','other')),
 note text not null default '', suggestion jsonb not null default '{}', snapshot jsonb not null,
 status text not null default 'pending' check(status in ('pending','applied','rejected')), created_at timestamptz not null default now()
);
alter table public.word_error_reports enable row level security;
grant all on public.word_error_reports to service_role;

create or replace function public.record_word_review(p_owner uuid,p_word uuid,p_event uuid,p_known boolean,p_revision integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare w public.vocabulary; e public.vocabulary_review_events; days integer; result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||p_event::text,0));
 select * into e from vocabulary_review_events where owner_id=p_owner and event_id=p_event;
 if found then
   if e.word_id<>p_word or e.known<>p_known then raise exception 'review_event_mismatch'; end if;
   return e.result;
 end if;
 select * into w from vocabulary where id=p_word and owner_id=p_owner for update;
 if not found then raise exception 'word_unavailable'; end if;
 if w.content_revision<>p_revision then raise exception 'word_changed'; end if;
 days:=case when not p_known or w.interval_days<1 then 1 else least(60,w.interval_days*2) end;
 update vocabulary set interval_days=days, streak=case when p_known then streak+1 else 0 end,
   last_reviewed_at=now(),due_at=now()+make_interval(days=>days) where id=p_word returning * into w;
 result:=to_jsonb(w);
 insert into vocabulary_review_events(owner_id,event_id,word_id,known,result) values(p_owner,p_event,p_word,p_known,result);
 return result;
end $$;
revoke all on function public.record_word_review(uuid,uuid,uuid,boolean,integer) from public,anon,authenticated;
grant execute on function public.record_word_review(uuid,uuid,uuid,boolean,integer) to service_role;

create or replace function public.import_word_card(p_owner uuid,p_id uuid,p_key text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare w public.vocabulary;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||p_key,0));
 select * into w from vocabulary where owner_id=p_owner and (import_key=p_key or (lower(trim(term))=lower(trim(p_data->>'term')) and definition=p_data->>'definition' and part_of_speech=coalesce(p_data->>'part_of_speech',''))) order by created_at limit 1 for update;
 if found then return to_jsonb(w); end if;
 insert into vocabulary(id,owner_id,term,definition,example,tags,part_of_speech,pronunciation,pronunciation_uk,pronunciation_us,import_key,source_document_id,source_physical_page,source_printed_page,source_verified)
 values(p_id,p_owner,p_data->>'term',p_data->>'definition',coalesce(p_data->>'example',''),array(select jsonb_array_elements_text(coalesce(p_data->'tags','[]'))),
 coalesce(p_data->>'part_of_speech',''),coalesce(p_data->>'pronunciation',''),coalesce(p_data->>'pronunciation_uk',''),coalesce(p_data->>'pronunciation_us',''),p_key,
 (p_data->>'source_document_id')::uuid,(p_data->>'source_physical_page')::integer,coalesce(p_data->>'source_printed_page',''),coalesce((p_data->>'source_verified')::boolean,false))
 on conflict(id) do nothing returning * into w;
 if not found then select * into w from vocabulary where id=p_id and owner_id=p_owner; end if;
 if w.id is null then raise exception 'word_import_conflict'; end if;
 return to_jsonb(w);
end $$;
revoke all on function public.import_word_card(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.import_word_card(uuid,uuid,text,jsonb) to service_role;
create or replace function private.word_content_revision() returns trigger language plpgsql set search_path=public as $$
begin
 if (new.term,new.definition,new.example,new.part_of_speech,new.pronunciation,new.pronunciation_uk,new.pronunciation_us)
 is distinct from (old.term,old.definition,old.example,old.part_of_speech,old.pronunciation,old.pronunciation_uk,old.pronunciation_us) then
   new.content_revision:=old.content_revision+1;
 else new.content_revision:=old.content_revision; end if;
 return new;
end $$;
create trigger word_content_revision before update on public.vocabulary for each row execute function private.word_content_revision();

create or replace function public.apply_word_report(p_owner uuid,p_report uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.word_error_reports; w public.vocabulary;
begin
 select * into r from word_error_reports where id=p_report and owner_id=p_owner for update;
 if not found or r.status='rejected' then raise exception 'report_unavailable'; end if;
 if r.status='applied' then return jsonb_build_object('applied',true); end if;
 select * into w from vocabulary where id=r.word_id and owner_id=p_owner for update;
 if not found or w.content_revision<>r.content_revision then raise exception 'word_changed'; end if;
 if length(trim(coalesce(r.suggestion->>'term','')))=0 or length(trim(coalesce(r.suggestion->>'definition','')))=0 then raise exception 'invalid_suggestion'; end if;
 update vocabulary set term=trim(r.suggestion->>'term'), definition=trim(r.suggestion->>'definition'),
 example=coalesce(r.suggestion->>'example',''), source_verified=false where id=w.id;
 update word_error_reports set status='applied' where id=r.id;
 return jsonb_build_object('applied',true);
end $$;
revoke all on function public.apply_word_report(uuid,uuid) from public,anon,authenticated;
grant execute on function public.apply_word_report(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
