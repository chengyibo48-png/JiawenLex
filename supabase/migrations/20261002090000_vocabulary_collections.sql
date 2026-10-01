-- Additive read-only vocabulary collections. Existing cards and schedules are untouched.
create index if not exists vocabulary_owner_cursor on public.vocabulary(owner_id,id);
create or replace function public.word_collection_matches(p_tags text[], p_collection text)
returns boolean language sql immutable security invoker set search_path = '' as $$
select case p_collection
 when 'all' then true
 when 'favorites' then coalesce(p_tags,'{}') @> array['收藏']
 when 'academic' then coalesce(p_tags,'{}') @> array['AWL学术核心570']
 when 'reading' then exists(select 1 from unnest(p_tags) t where t='reading' or t like '%阅读%')
 when 'listening' then exists(select 1 from unnest(p_tags) t where t='listening' or t like '%听力%')
 when 'writing' then exists(select 1 from unnest(p_tags) t where t='writing' or t like '%写作%' or t='议论文写作')
 when 'speaking' then exists(select 1 from unnest(p_tags) t where t='speaking' or t like '%口语%')
 when 'general' then not exists(select 1 from unnest(p_tags) t where t in ('reading','listening','writing','speaking','AWL学术核心570') or t ~ '(阅读|听力|写作|口语)')
 else false end;
$$;
create or replace function public.word_collection_counts()
returns table(collection text, total bigint, due bigint)
language sql stable security invoker set search_path = '' as $$
 select c.key,count(v.id),count(v.id) filter(where v.due_at <= now())
 from unnest(array['reading','listening','writing','speaking','academic','general','favorites','all']) c(key)
 left join public.vocabulary v on v.owner_id=(select auth.uid()) and public.word_collection_matches(v.tags,c.key)
 group by c.key;
$$;
create or replace function public.word_collection_page(p_collection text, p_cursor uuid default null)
returns setof public.vocabulary language sql stable security invoker set search_path = '' as $$
 select v.* from public.vocabulary v
 where v.owner_id=(select auth.uid()) and (p_cursor is null or v.id>p_cursor)
 and public.word_collection_matches(v.tags,p_collection)
 order by v.id limit 251;
$$;
revoke all on function public.word_collection_matches(text[],text),public.word_collection_counts(),public.word_collection_page(text,uuid) from public,anon;
grant execute on function public.word_collection_matches(text[],text),public.word_collection_counts(),public.word_collection_page(text,uuid) to authenticated;
