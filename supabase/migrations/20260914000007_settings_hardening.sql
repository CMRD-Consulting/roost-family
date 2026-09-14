-- ─── Settings hardening (Phase 3c review) ────────────────────────────────
-- Amends earlier RPCs with `create or replace` rather than editing their migrations.

-- ═══ Audit gaps and PIN-checked entry edits (spec §6.5, §7.9) ═══

-- ─── revoke_display (replaces migration 2's): now audited ────────────────
create or replace function public.revoke_display(p_display_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_household uuid;
begin
  perform private.require_adult();
  select d.household_id into v_household from public.displays d where d.id = p_display_id;
  if v_household is null or not private.is_household_owner(v_household) then
    raise exception 'only an owner can remove a display' using errcode = '42501';
  end if;
  update public.displays set revoked_at = now() where id = p_display_id and revoked_at is null;
  delete from public.display_claims where display_id = p_display_id;
  perform private.audit_setting(v_household, private.my_membership_id(v_household), 'displays', 'revoke', p_display_id, null);
end $$;

-- ─── set_my_pin (replaces migration 2's): live household only, audited ───
-- The PIN itself is never written to the audit.
create or replace function public.set_my_pin(p_household_id uuid, p_pin text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_adult();
  v_membership uuid := private.my_membership_id(p_household_id);
begin
  if v_membership is null then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  perform private.set_pin_for(v_user, p_household_id, p_pin);
  perform private.audit_setting(p_household_id, v_membership, 'my_account', 'pin', v_membership, null);
end $$;

-- ─── Entry edits from Settings > Logs and Inbox ──────────────────────────
-- The columns Settings may change per log table. Doses are never edited or deleted here (spec §11.4): they are voided.
create function private.editable_entry_columns(p_table text) returns text[]
language sql immutable set search_path = '' as $$
  select case p_table
    when 'sleep_entries' then array['start_at', 'end_at']
    when 'feeding_entries' then array['at', 'type', 'amount', 'note']
    when 'sticker_entries' then array['at', 'category_id']
    when 'diaper_entries' then array['at', 'kind']
    when 'jots' then array['text', 'done_at']
  end
$$;

-- Changes the given columns (p_fields: {column: value}, only the table's editable columns) of one entry in the PIN's
-- household. An entry of another household, or one that no longer exists, reads as not found (22023).
create function public.update_entry(
  p_membership_id uuid, p_pin text, p_table text, p_entry_id uuid, p_fields jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.require_settings_pin(p_membership_id, p_pin);
  v_columns text[] := private.editable_entry_columns(p_table);
  v_set text;
  v_count int;
  v_constraint text;
begin
  if v_columns is null then
    raise exception 'entries of type % cannot be edited', p_table using errcode = '22023';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' or p_fields = '{}'::jsonb then
    raise exception 'fields to change are required' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_fields) as k where k <> all (v_columns)) then
    raise exception 'only % can be changed on %', array_to_string(v_columns, ', '), p_table using errcode = '22023';
  end if;
  if p_table = 'jots' and p_fields ? 'text' then
    p_fields := jsonb_set(p_fields, '{text}', to_jsonb(btrim(p_fields ->> 'text')));
  end if;

  select string_agg(format('%I = r.%I', k, k), ', ') into v_set from jsonb_object_keys(p_fields) as k;
  begin
    -- jsonb_populate_record casts each value to its column's type, as an insert of the same JSON would.
    execute format(
      'update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r where t.id = $2 and t.household_id = $3',
      p_table, v_set, p_table)
    using p_fields, p_entry_id, v_household;
    get diagnostics v_count = row_count;
  exception
    when check_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'sleep_entries_check' then
        raise exception 'the end time can''t be before the start' using errcode = '22023';
      end if;
      raise exception 'that value isn''t allowed (%)', v_constraint using errcode = '22023';
    when not_null_violation then
      raise exception 'that field can''t be empty' using errcode = '22023';
    when foreign_key_violation then
      raise exception 'that sticker category isn''t in this household' using errcode = '22023';
    when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception 'a field has a value of the wrong type' using errcode = '22023';
  end;
  if v_count = 0 then
    raise exception 'entry not found' using errcode = '22023';
  end if;

  perform private.audit_setting(v_household, p_membership_id, 'logs', 'update_entry', p_entry_id,
    jsonb_build_object('table', p_table, 'fields', p_fields));
end $$;

-- Deletes one non-dose entry or jot in the PIN's household; not found (or another household's) is 22023.
create function public.delete_entry(p_membership_id uuid, p_pin text, p_table text, p_entry_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.require_settings_pin(p_membership_id, p_pin);
  v_count int;
begin
  if private.editable_entry_columns(p_table) is null then
    raise exception 'entries of type % cannot be deleted', p_table using errcode = '22023';
  end if;
  execute format('delete from public.%I where id = $1 and household_id = $2', p_table) using p_entry_id, v_household;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'entry not found' using errcode = '22023';
  end if;
  perform private.audit_setting(v_household, p_membership_id, 'logs', 'delete_entry', p_entry_id,
    jsonb_build_object('table', p_table));
end $$;

revoke execute on function private.editable_entry_columns(text) from public, anon, authenticated;
revoke execute on function
  public.update_entry(uuid, text, text, uuid, jsonb),
  public.delete_entry(uuid, text, text, uuid)
from public, anon;
grant execute on function
  public.update_entry(uuid, text, text, uuid, jsonb),
  public.delete_entry(uuid, text, text, uuid)
to authenticated;

-- ═══ Weather location (spec §5.6) ═══
-- The weather location is set from the tablet's location (setup or Settings > Household), never implied by the ZIP.
-- Stored rounded to 2 decimals (about 1 km). Both null clears it (weather hidden). The coordinates are not audited.
create function public.set_household_location(p_membership_id uuid, p_pin text, p_lat double precision, p_lon double precision)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_household uuid := private.require_settings_pin(p_membership_id, p_pin);
begin
  if (p_lat is null) <> (p_lon is null) then
    raise exception 'set both latitude and longitude, or neither' using errcode = '22023';
  end if;
  if p_lat is not null and (p_lat = 'NaN'::float8 or p_lon = 'NaN'::float8
     or p_lat not between -90 and 90 or p_lon not between -180 and 180) then
    raise exception 'that location is out of range' using errcode = '22023';
  end if;
  update public.households
  set lat = round(p_lat::numeric, 2)::double precision, lon = round(p_lon::numeric, 2)::double precision
  where id = v_household;
  perform private.audit_setting(v_household, p_membership_id, 'household', 'location', v_household,
    jsonb_build_object('set', p_lat is not null));
end $$;

revoke execute on function public.set_household_location(uuid, text, double precision, double precision) from public, anon;
grant execute on function public.set_household_location(uuid, text, double precision, double precision) to authenticated;

-- ═══ Household deletion and purge (spec §11.3) ═══

-- ─── delete_household (replaces migration 3's): PINs end at once ─────────
-- As before, plus every member's PIN is deleted immediately (nothing PIN-checked works on a deleted household anyway;
-- this removes the hashes now rather than at the purge).
create or replace function public.delete_household(p_household_id uuid, p_confirm_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_actor uuid;
begin
  perform private.require_adult();
  select h.name into v_name from public.households h where h.id = p_household_id and h.deleted_at is null for update;
  if v_name is null or not private.is_household_owner(p_household_id) then
    raise exception 'only an owner can delete the household' using errcode = '42501';
  end if;
  if p_confirm_name is null or btrim(p_confirm_name) <> btrim(v_name) then
    raise exception 'type the household name exactly to confirm' using errcode = '22023';
  end if;
  v_actor := private.my_membership_id(p_household_id);

  update public.households set deleted_at = now() where id = p_household_id;
  update public.displays set revoked_at = now() where household_id = p_household_id and revoked_at is null;
  delete from public.display_claims c using public.displays d where d.id = c.display_id and d.household_id = p_household_id;
  delete from public.member_invites where household_id = p_household_id;
  delete from public.member_pins p using public.memberships m where m.id = p.membership_id and m.household_id = p_household_id;
  update public.take_list_links set revoked_at = now() where household_id = p_household_id and revoked_at is null;

  perform private.audit_setting(p_household_id, v_actor, 'household', 'delete', p_household_id,
    jsonb_build_object('name', v_name));
end $$;

-- ─── Purge (replaces migration 6's) ──────────────────────────────────────
-- Also deletes the anonymous device accounts bound to the purged households' displays (a display's credential is
-- useless once its household is gone). Adult accounts are never deleted here.
create or replace function private.purge_deleted_households() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
  v_household uuid;
  v_devices uuid[];
begin
  select coalesce(array_agg(distinct d.auth_user_id), '{}') into v_devices
  from public.displays d
  join public.households h on h.id = d.household_id
  join auth.users u on u.id = d.auth_user_id and u.is_anonymous
  where h.deleted_at is not null and h.deleted_at < now() - interval '30 days';

  for v_household in
    select h.id from public.households h where h.deleted_at is not null and h.deleted_at < now() - interval '30 days'
  loop
    perform private.delete_photo_objects(v_household, null);
  end loop;

  delete from public.households where deleted_at is not null and deleted_at < now() - interval '30 days';
  get diagnostics v_count = row_count;

  -- After the households (and so their displays) are gone; a device bound to a display elsewhere is kept.
  delete from auth.users u
  where u.id = any (v_devices) and u.is_anonymous
    and not exists (select 1 from public.displays d where d.auth_user_id = u.id);
  return v_count;
end $$;

revoke execute on function private.purge_deleted_households() from public, anon, authenticated;
