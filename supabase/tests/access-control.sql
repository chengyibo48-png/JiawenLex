-- Run as postgres in SQL Editor, only against a fresh, empty JiawenLex project.
-- All fixtures, invitation changes, and checks are rolled back. No email is sent.
begin;
do $$
declare
  admin_id uuid := gen_random_uuid();
  owner_id uuid := gen_random_uuid();
  recipient_id uuid := gen_random_uuid();
  material_id uuid := gen_random_uuid();
  attempt_id uuid := gen_random_uuid();
  share_id uuid := gen_random_uuid();
  attempt_share_id uuid := gen_random_uuid();
  denied boolean;
  affected integer;
  member_number integer;
  fixture_invite text := 'JiawenLex-transactional-fixture-only';
begin
  if exists (select 1 from auth.users) or exists (select 1 from public.profiles) then
    raise exception 'Use a fresh empty project; this check never modifies real accounts';
  end if;
  insert into public.invite_control(id, code_hash, active)
  values (1, encode(sha256(convert_to(fixture_invite, 'UTF8')), 'hex'), true)
  on conflict (id) do update set code_hash = excluded.code_hash, active = true;

  denied := false;
  begin
    insert into auth.users(id, email, raw_user_meta_data)
    values (gen_random_uuid(), 'blocked@example.invalid', '{}'::jsonb);
  exception when others then
    if sqlerrm <> 'Invalid invitation code' then raise; end if;
    denied := true;
  end;
  if not denied then raise exception 'Missing invite was accepted'; end if;

  update public.invite_control set active = false where id = 1;
  denied := false;
  begin
    insert into auth.users(id, email, raw_user_meta_data)
    values (gen_random_uuid(), 'disabled@example.invalid', jsonb_build_object('invite_code', fixture_invite));
  exception when others then
    if sqlerrm <> 'Invalid invitation code' then raise; end if;
    denied := true;
  end;
  if not denied then raise exception 'Disabled invite was accepted'; end if;
  update public.invite_control set active = true where id = 1;

  insert into auth.users(id, email, raw_user_meta_data) values
    (admin_id, 'admin@example.invalid', jsonb_build_object('invite_code', fixture_invite, 'display_name', 'Admin')),
    (owner_id, 'owner@example.invalid', jsonb_build_object('invite_code', fixture_invite, 'display_name', 'Owner')),
    (recipient_id, 'recipient@example.invalid', jsonb_build_object('invite_code', fixture_invite, 'display_name', 'Recipient'));
  if (select role from public.profiles where id = admin_id) <> 'admin'
    or (select role from public.profiles where id = owner_id) <> 'member' then
    raise exception 'Initial administrator bootstrap failed';
  end if;
  if exists (select 1 from auth.users where raw_user_meta_data ? 'invite_code') then
    raise exception 'Invitation leaked into retained user metadata';
  end if;

  insert into auth.sessions(id,user_id) values (admin_id,admin_id),(owner_id,owner_id),(recipient_id,recipient_id);

  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'session_id', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.materials(id, owner_id, title, skill)
  values (material_id, owner_id, 'Private writing prompt', 'writing');
  insert into public.practice_attempts(id, owner_id, material_id, skill, mode, answer_body)
  values (attempt_id, owner_id, material_id, 'writing', 'practice', '{"body":"Private essay"}');
  insert into public.share_grants(id, owner_id, recipient_id, target_type, target_id) values
    (share_id, owner_id, recipient_id, 'material', material_id),
    (attempt_share_id, owner_id, recipient_id, 'attempt', attempt_id);
  if (select count(*) from public.profiles) <> 1 then raise exception 'Private profiles leaked'; end if;
  if (select count(*) from public.list_members()) <> 3 then raise exception 'Member directory failed'; end if;
  denied := false;
  begin
    update public.profiles set role = 'admin' where id = owner_id;
  exception when others then
    if sqlerrm <> 'Only the service can change account roles or status' then raise; end if;
    denied := true;
  end;
  if not denied then raise exception 'Member changed own administrative role'; end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_id, 'session_id', admin_id, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.materials where id = material_id)
    or exists (select 1 from public.practice_attempts where id = attempt_id) then
    raise exception 'Administrator can read member private data';
  end if;
  if has_table_privilege('authenticated', 'public.provider_keys', 'SELECT')
    or has_table_privilege('anon', 'public.invite_control', 'SELECT') then
    raise exception 'Private credentials or invitation control is exposed';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', recipient_id, 'session_id', recipient_id, 'role', 'authenticated')::text, true);
  if not exists (select 1 from public.materials where id = material_id)
    or not exists (select 1 from public.practice_attempts where id = attempt_id) then
    raise exception 'Recipient cannot read granted material and attempt';
  end if;
  insert into public.share_comments(share_id, author_id, body) values (share_id, recipient_id, 'Recipient comment');
  update public.materials set title = 'Forbidden edit' where id = material_id;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Recipient changed shared material'; end if;
  denied := false;
  begin
    insert into public.materials(owner_id, title, skill) values (owner_id, 'Forged ownership', 'writing');
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Recipient forged another member ownership'; end if;

  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
  update public.share_grants set revoked_at = now() where id in (share_id, attempt_share_id);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', recipient_id, 'session_id', recipient_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if exists (select 1 from public.materials where id = material_id)
    or exists (select 1 from public.practice_attempts where id = attempt_id)
    or exists (select 1 from public.share_comments where author_id = recipient_id) then
    raise exception 'Revocation did not immediately remove access';
  end if;
  denied := false;
  begin
    insert into public.share_comments(share_id, author_id, body) values (share_id, recipient_id, 'Forbidden after revoke');
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Revoked recipient can still comment'; end if;

  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
  for member_number in 4..5 loop
    insert into auth.users(id, email, raw_user_meta_data)
    values (gen_random_uuid(), 'member' || member_number || '@example.invalid', jsonb_build_object('invite_code', fixture_invite));
  end loop;
  denied := false;
  begin
    insert into auth.users(id, email, raw_user_meta_data)
    values (gen_random_uuid(), 'sixth@example.invalid', jsonb_build_object('invite_code', fixture_invite));
  exception when others then
    if sqlerrm <> 'The group is full' then raise; end if;
    denied := true;
  end;
  if not denied then raise exception 'Sixth active account was accepted'; end if;

  update public.profiles set status = 'removed' where id = owner_id;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'session_id', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if exists (select 1 from public.materials) or exists (select 1 from public.practice_attempts)
    or exists (select 1 from public.profiles) then
    raise exception 'Removed user retains access with an old token';
  end if;
  denied := false;
  begin
    perform * from public.list_members();
  exception when others then
    if sqlerrm <> 'inactive account' then raise; end if;
    denied := true;
  end;
  if not denied then raise exception 'Removed account can read member directory'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
end;
$$;
select 'PASS: invitation, five-account limit, owner isolation, admin isolation, sharing, comments, revocation, removed-account denial' as checks;
rollback;
