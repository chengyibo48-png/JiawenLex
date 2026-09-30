begin;
create or replace function public.publish_verified_word_cards(p_ids uuid[],p_shared boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c source_review_candidates; d source_documents; owner uuid:=auth.uid(); w jsonb; result jsonb:='[]'; item uuid; data jsonb;
begin
 if not private.is_active_member() or owner is null then raise exception 'inactive_session'; end if;
 if p_shared and not private.is_group_admin() then raise exception 'group_admin_required'; end if;
 if cardinality(p_ids)>20 or cardinality(p_ids)<1 then raise exception 'invalid_batch_size'; end if;
 foreach item in array p_ids loop
  begin
   select * into c from source_review_candidates where id=item and owner_id=owner for update;
   if not found or c.content_kind<>'vocabulary' or c.status='rejected' then raise exception '词卡候选不可访问'; end if;
   if coalesce((c.payload->>'reviewed_against_pdf')::boolean,false) is not true then raise exception '尚未对照原页核验'; end if;
   if jsonb_typeof(c.payload->'extraction_issues')='array' and jsonb_array_length(c.payload->'extraction_issues')>0 then raise exception '仍有识别疑点'; end if;
   if length(trim(coalesce(c.payload->>'term','')))=0 or length(c.payload->>'term')>160 or length(trim(coalesce(c.payload->>'definition','')))=0 or length(c.payload->>'definition')>4000 or length(coalesce(c.payload->>'example',''))>4000 then raise exception '词条或释义不完整'; end if;
   select * into d from source_documents where id=c.document_id and owner_id=owner;
   if not found or (p_shared and d.rights_attested_at is null) then raise exception '缺少原文件或发布授权声明'; end if;
   data:=c.payload||jsonb_build_object('source_document_id',c.document_id,'source_physical_page',c.physical_page,'source_printed_page',c.printed_page,'source_verified',true);
   w:=import_word_card(owner,c.id,c.fingerprint,data);
   if p_shared then
    insert into vocabulary_templates(id,owner_id,term,definition,example,tags,part_of_speech,pronunciation,pronunciation_uk,pronunciation_us,source_document_id,approved)
    values(c.id,owner,w->>'term',w->>'definition',coalesce(w->>'example',''),array(select jsonb_array_elements_text(coalesce(w->'tags','[]'))),coalesce(w->>'part_of_speech',''),coalesce(w->>'pronunciation',''),coalesce(w->>'pronunciation_uk',''),coalesce(w->>'pronunciation_us',''),c.document_id,true)
    on conflict(id) do nothing;
   end if;
   update source_review_candidates set status='published',updated_at=now() where id=c.id;
   result:=result||jsonb_build_array(jsonb_build_object('id',item,'published',true));
  exception when others then
   result:=result||jsonb_build_array(jsonb_build_object('id',item,'published',false,'error',sqlerrm));
  end;
 end loop;
 return result;
end $$;
revoke all on function public.publish_verified_word_cards(uuid[],boolean) from public,anon;
grant execute on function public.publish_verified_word_cards(uuid[],boolean) to authenticated;
notify pgrst,'reload schema';
create or replace function public.import_word_card(p_owner uuid,p_id uuid,p_key text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare w public.vocabulary;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||p_key,0));
 select * into w from vocabulary where owner_id=p_owner and (import_key=p_key or (lower(trim(term))=lower(trim(p_data->>'term')) and definition=p_data->>'definition' and part_of_speech=coalesce(p_data->>'part_of_speech',''))) order by created_at limit 1 for update;
 if found then
    update vocabulary set tags=array(select distinct tag from unnest(w.tags || array(select jsonb_array_elements_text(coalesce(p_data->'tags','[]')))) tag order by tag) where id=w.id returning * into w;
    return to_jsonb(w);
   end if;
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
 example=coalesce(r.suggestion->>'example',w.example), pronunciation=coalesce(r.suggestion->>'pronunciation',w.pronunciation), pronunciation_uk=coalesce(r.suggestion->>'pronunciation_uk',w.pronunciation_uk), pronunciation_us=coalesce(r.suggestion->>'pronunciation_us',w.pronunciation_us), source_verified=false where id=w.id;
 update word_error_reports set status='applied' where id=r.id;
 return jsonb_build_object('applied',true);
end $$;
revoke all on function public.apply_word_report(uuid,uuid) from public,anon,authenticated;
grant execute on function public.apply_word_report(uuid,uuid) to service_role;
notify pgrst,'reload schema';

commit;
