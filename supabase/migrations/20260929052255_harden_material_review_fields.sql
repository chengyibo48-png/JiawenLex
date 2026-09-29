-- Review permission covers all present and future content fields.
create or replace function private.protect_material_identity()
returns trigger language plpgsql set search_path = public
as $$
begin
  if auth.uid() is not null and (new.owner_id is distinct from old.owner_id or new.id is distinct from old.id) then
    raise exception 'Cannot change material ownership';
  end if;
  if auth.uid() is not null and private.is_group_admin() and new.owner_id is distinct from auth.uid()
    and (to_jsonb(new) - 'approval' - 'revision' - 'updated_at')
        is distinct from (to_jsonb(old) - 'approval' - 'revision' - 'updated_at') then
    raise exception 'Admin may only review shared material';
  end if;
  if auth.uid() is not null and not private.is_group_admin() and old.approval = 'approved' and new.visibility = 'shared' then
    new.approval := 'pending';
  end if;
  return new;
end;
$$;
