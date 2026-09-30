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
   if c.status='published' then
    result:=result||jsonb_build_array(jsonb_build_object('id',item,'published',true)); continue;
   end if;
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
commit;
