-- Read-only, owner-scoped searches and due-review priority. No existing rows change.
create or replace function public.word_collection_search(p_collection text,p_search text default '',p_cursor uuid default null)
returns setof public.vocabulary language sql stable security invoker set search_path='' as $$
 select v.* from public.vocabulary v where v.owner_id=(select auth.uid())
 and (p_cursor is null or v.id>p_cursor) and public.word_collection_matches(v.tags,p_collection)
 and (p_search='' or strpos(lower(v.term),lower(p_search))>0 or strpos(lower(v.definition),lower(p_search))>0)
 order by v.id limit 251;
$$;
create or replace function public.word_collection_reviews(p_collection text)
returns setof public.vocabulary language sql stable security invoker set search_path='' as $$
 select v.* from public.vocabulary v where v.owner_id=(select auth.uid())
 and v.interval_days>0 and v.due_at<=now() and public.word_collection_matches(v.tags,p_collection)
 order by v.due_at,v.id limit 100;
$$;
revoke all on function public.word_collection_search(text,text,uuid),public.word_collection_reviews(text) from public,anon;
grant execute on function public.word_collection_search(text,text,uuid),public.word_collection_reviews(text) to authenticated;
