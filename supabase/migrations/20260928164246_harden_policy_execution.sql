-- Keep the member directory's privileged lookup outside the exposed API schema.
create or replace function private.list_members()
returns table(id uuid, display_name text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_active_member() then
    raise exception 'inactive account';
  end if;
  return query select p.id, p.display_name from public.profiles p
    where p.status = 'active' order by p.created_at;
end;
$$;
revoke all on function private.list_members() from public, anon, authenticated;
grant execute on function private.list_members() to authenticated, service_role;

create or replace function public.list_members()
returns table(id uuid, display_name text)
language sql stable security invoker set search_path = ''
as $$ select * from private.list_members() $$;
revoke all on function public.list_members() from public, anon;
grant execute on function public.list_members() to authenticated, service_role;

-- Evaluate caller-only checks once per statement, rather than for each row.
-- Expressions depending on the current row (share targets, recipients) stay
-- correlated, so this does not change ownership or sharing semantics.
do $$
declare
  policy record;
  predicate text;
  check_predicate text;
  statement text;
begin
  for policy in
    select p.polname, n.nspname, c.relname,
      pg_get_expr(p.polqual, p.polrelid) as predicate,
      pg_get_expr(p.polwithcheck, p.polrelid) as check_predicate
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where (n.nspname = 'public' and c.relname in (
      'profiles', 'study_tasks', 'materials', 'practice_attempts',
      'vocabulary', 'writing_drafts', 'share_grants', 'share_comments', 'ai_usage'
    )) or (n.nspname = 'storage' and c.relname = 'objects'
      and p.polname in ('own_files_upload', 'own_files_read', 'own_files_delete'))
  loop
    predicate := replace(replace(replace(policy.predicate,
      'auth.uid()', '(select auth.uid())'),
      'private.is_active_member()', '(select private.is_active_member())'),
      'private.is_group_admin()', '(select private.is_group_admin())');
    check_predicate := replace(replace(replace(policy.check_predicate,
      'auth.uid()', '(select auth.uid())'),
      'private.is_active_member()', '(select private.is_active_member())'),
      'private.is_group_admin()', '(select private.is_group_admin())');
    statement := format('alter policy %I on %I.%I', policy.polname, policy.nspname, policy.relname);
    if predicate is not null then
      statement := statement || ' using (' || predicate || ')';
    end if;
    if check_predicate is not null then
      statement := statement || ' with check (' || check_predicate || ')';
    end if;
    execute statement;
  end loop;
end;
$$;
