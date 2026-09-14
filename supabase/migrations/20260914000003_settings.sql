-- ─── Settings (spec §7.9) ────────────────────────────────────────────────
-- Every configuration write goes through a security-definer RPC. PIN-checked RPCs take
-- (p_membership_id, p_pin): the PIN's membership must be an active owner or adult of a live household
-- that the caller (a signed-in adult or a display) is a member of. Each change appends to settings_audit.
-- Errors: 42501 for authorization (wrong PIN, other household, not found), 22023 for invalid input.

-- ─── Private helpers ─────────────────────────────────────────────────────
-- Returns the household of the PIN's membership, or raises 42501.
create function private.require_settings_pin(p_membership_id uuid, p_pin text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_household uuid;
begin
  select m.household_id into v_household
  from public.memberships m
  join public.households h on h.id = m.household_id and h.deleted_at is null
  where m.id = p_membership_id and m.role in ('owner', 'adult') and m.left_at is null;
  if v_household is null
     or not private.is_household_member(v_household)
     or not private.pin_ok(p_membership_id, p_pin) then
    raise exception 'incorrect PIN' using errcode = '42501';
  end if;
  return v_household;
end $$;

create function private.audit_setting(
  p_household_id uuid, p_membership_id uuid, p_section text, p_action text, p_target_id uuid, p_fields jsonb
) returns void
language sql security definer set search_path = '' as $$
  insert into public.settings_audit (household_id, membership_id, change)
  values (p_household_id, p_membership_id, jsonb_build_object(
    'section', p_section, 'action', p_action, 'target_id', p_target_id, 'fields', coalesce(p_fields, '{}'::jsonb)));
$$;

create function private.require_color(p_color text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_color is null or p_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'color must be a #RRGGBB hex value' using errcode = '22023';
  end if;
end $$;

-- A child of the household, or 42501 (another household's child reads as not found).
create function private.require_child_of(p_household_id uuid, p_child_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_child_id is null or not exists (
    select 1 from public.child_households ch where ch.child_id = p_child_id and ch.household_id = p_household_id
  ) then
    raise exception 'child not found' using errcode = '42501';
  end if;
end $$;

-- ─── Enter Settings ──────────────────────────────────────────────────────
create function public.settings_verify(p_membership_id uuid, p_pin text)
returns table (out_role text, out_display_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_settings_pin(p_membership_id, p_pin);
  return query select m.role, m.display_name from public.memberships m where m.id = p_membership_id;
end $$;

-- ─── Household ───────────────────────────────────────────────────────────
create function public.update_household_settings(
  p_membership_id uuid, p_pin text, p_name text, p_zip text, p_time_zone text, p_leave_by_buffer_min int,
  p_default_night_start time, p_default_night_end time, p_night_mode_start time, p_night_mode_end time,
  p_diaper_log_enabled boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.require_settings_pin(p_membership_id, p_pin);
  v_name text := btrim(p_name);
  v_zip text := nullif(btrim(p_zip), '');
begin
  if v_name is null or char_length(v_name) not between 1 and 80 then
    raise exception 'household name must be 1 to 80 characters' using errcode = '22023';
  end if;
  if v_zip is not null and v_zip !~ '^\d{5}$' then
    raise exception 'ZIP code must be 5 digits' using errcode = '22023';
  end if;
  if p_time_zone is null or not exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = p_time_zone) then
    raise exception 'unknown time zone %', p_time_zone using errcode = '22023';
  end if;
  if p_leave_by_buffer_min is null or p_leave_by_buffer_min not between 0 and 120 then
    raise exception 'leave-by buffer must be 0 to 120 minutes' using errcode = '22023';
  end if;
  if p_default_night_start is null or p_default_night_end is null
     or p_night_mode_start is null or p_night_mode_end is null then
    raise exception 'night-sleep and Night Mode times are required' using errcode = '22023';
  end if;
  if p_diaper_log_enabled is null then
    raise exception 'diaper log on/off is required' using errcode = '22023';
  end if;

  update public.households set
    name = v_name, zip = v_zip, time_zone = p_time_zone, leave_by_buffer_min = p_leave_by_buffer_min,
    default_night_sleep_start = p_default_night_start, default_night_sleep_end = p_default_night_end,
    night_mode_start = p_night_mode_start, night_mode_end = p_night_mode_end,
    diaper_log_enabled = p_diaper_log_enabled
  where id = v_household;

  perform private.audit_setting(v_household, p_membership_id, 'household', 'update', v_household, jsonb_build_object(
    'name', v_name, 'zip', v_zip, 'time_zone', p_time_zone, 'leave_by_buffer_min', p_leave_by_buffer_min,
    'default_night_sleep_start', p_default_night_start, 'default_night_sleep_end', p_default_night_end,
    'night_mode_start', p_night_mode_start, 'night_mode_end', p_night_mode_end,
    'diaper_log_enabled', p_diaper_log_enabled));
end $$;

-- Replaces sitter_info. Only the known keys; each a string of at most 1000 characters. Blank values are dropped.
create function public.update_sitter_info(p_membership_id uuid, p_pin text, p_info jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.require_settings_pin(p_membership_id, p_pin);
  v_key text;
  v_value jsonb;
  v_info jsonb := '{}'::jsonb;
begin
  if p_info is null or jsonb_typeof(p_info) <> 'object' then
    raise exception 'sitter info must be an object' using errcode = '22023';
  end if;
  for v_key, v_value in select e.key, e.value from jsonb_each(p_info) as e (key, value) loop
    if v_key not in ('napInstructions', 'bedtime', 'foodRules', 'emergencyContacts', 'pediatrician', 'address', 'whereThings') then
      raise exception 'unknown sitter info field %', v_key using errcode = '22023';
    end if;
    if jsonb_typeof(v_value) = 'null' then
      continue;
    end if;
    if jsonb_typeof(v_value) <> 'string' then
      raise exception 'sitter info field % must be text', v_key using errcode = '22023';
    end if;
    if char_length(v_value #>> '{}') > 1000 then
      raise exception 'sitter info field % must be at most 1000 characters', v_key using errcode = '22023';
    end if;
    if btrim(v_value #>> '{}') <> '' then
      v_info := v_info || jsonb_build_object(v_key, btrim(v_value #>> '{}'));
    end if;
  end loop;

  begin
    update public.households set sitter_info = v_info where id = v_household;
  exception when check_violation then
    raise exception 'sitter info is too large' using errcode = '22023';
  end;

  perform private.audit_setting(v_household, p_membership_id, 'sitter_info', 'update', v_household,
    jsonb_build_object('keys', (select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from jsonb_object_keys(v_info) as k)));
end $$;

-- ─── Children ────────────────────────────────────────────────────────────
create function public.add_child_pin(p_membership_id uuid, p_pin text, p_name text, p_birthday date, p_color text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.require_settings_pin(p_membership_id, p_pin);
  v_child uuid;
begin
  perform private.require_color(p_color);
  -- add_child_to validates name and birthday and locks the household row for the 8-child limit.
  v_child := private.add_child_to(v_household, btrim(p_name), p_birthday, p_color);
  update public.children set sort_order = (
    select coalesce(max(c.sort_order) + 1, 0) from public.children c
    join public.child_households ch on ch.child_id = c.id
    where ch.household_id = v_household and c.id <> v_child
  ) where id = v_child;
  perform private.audit_setting(v_household, p_membership_id, 'children', 'add', v_child,
    jsonb_build_object('name', btrim(p_name), 'birthday', p_birthday, 'color', p_color));
  return v_child;
end $$;

create function public.update_child(
  p_membership_id uuid, p_pin text, p_child_id uuid, p_name text, p_birthday date, p_color text,
  p_allergies text, p_food_rules text, p_night_start time, p_night_end time
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.require_settings_pin(p_membership_id, p_pin);
  v_name text := btrim(p_name);
  v_allergies text := coalesce(btrim(p_allergies), '');
  v_food_rules text := coalesce(btrim(p_food_rules), '');
begin
  perform private.require_child_of(v_household, p_child_id);
  if v_name is null or char_length(v_name) not between 1 and 40 then
    raise exception 'a child''s name must be 1 to 40 characters' using errcode = '22023';
  end if;
  if p_birthday is null or p_birthday > (
    select (now() at time zone h.time_zone)::date from public.households h where h.id = v_household
  ) then
    raise exception 'a child''s birthday cannot be in the future' using errcode = '22023';
  end if;
  perform private.require_color(p_color);
  if char_length(v_allergies) > 1000 or char_length(v_food_rules) > 1000 then
    raise exception 'allergies and food rules must be at most 1000 characters' using errcode = '22023';
  end if;
  if (p_night_start is null) <> (p_night_end is null) then
    raise exception 'set both night-sleep times or neither' using errcode = '22023';
  end if;

  update public.children set
    name = v_name, birthday = p_birthday, color = p_color, allergies = v_allergies, food_rules = v_food_rules,
    night_sleep_start = p_night_start, night_sleep_end = p_night_end
  where id = p_child_id;

  perform private.audit_setting(v_household, p_membership_id, 'children', 'update', p_child_id, jsonb_build_object(
    'name', v_name, 'birthday', p_birthday, 'color', p_color, 'allergies', v_allergies, 'food_rules', v_food_rules,
    'night_sleep_start', p_night_start, 'night_sleep_end', p_night_end));
end $$;

-- p_enabled null clears the override (back to the age-based default).
create function public.set_feature_override(
  p_membership_id uuid, p_pin text, p_child_id uuid, p_feature text, p_enabled boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_household uuid := private.require_settings_pin(p_membership_id, p_pin);
begin
  perform private.require_child_of(v_household, p_child_id);
  if p_feature is null or p_feature not in ('wakeWindow', 'feeding', 'kidsCorner', 'diaper') then
    raise exception 'unknown feature %', p_feature using errcode = '22023';
  end if;
  if p_enabled is null then
    delete from public.feature_overrides where child_id = p_child_id and feature = p_feature;
  else
    insert into public.feature_overrides (child_id, feature, enabled) values (p_child_id, p_feature, p_enabled)
    on conflict (child_id, feature) do update set enabled = excluded.enabled;
  end if;
  perform private.audit_setting(v_household, p_membership_id, 'children', 'feature_override', p_child_id,
    jsonb_build_object('feature', p_feature, 'enabled', p_enabled));
end $$;

-- ─── Routines ────────────────────────────────────────────────────────────
-- p_steps: array of at most 20 {iconKey: text|null, photoId: uuid|null, label: 1–40 chars, time: 'HH:MM'|null}.
-- Missing keys read as null; other keys are rejected. Stored normalized (all four keys, trimmed label).
create function public.upsert_routine(
  p_membership_id uuid, p_pin text, p_routine_id uuid, p_child_id uuid, p_name text, p_weekdays smallint[], p_steps jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.require_settings_pin(p_membership_id, p_pin);
  v_name text := btrim(p_name);
  v_weekdays smallint[];
  v_step jsonb;
  v_steps jsonb := '[]'::jsonb;
  v_icon text;
  v_photo text;
  v_label text;
  v_time text;
  v_existing_child uuid;
  v_routine uuid;
begin
  perform private.require_child_of(v_household, p_child_id);
  if p_routine_id is not null then
    select r.child_id into v_existing_child from public.routines r
    where r.id = p_routine_id and r.household_id = v_household
    for update;
    if v_existing_child is null then
      raise exception 'routine not found' using errcode = '42501';
    end if;
    if v_existing_child <> p_child_id then
      raise exception 'a routine cannot move to another child' using errcode = '22023';
    end if;
  end if;
  if v_name is null or char_length(v_name) not between 1 and 40 then
    raise exception 'routine name must be 1 to 40 characters' using errcode = '22023';
  end if;
  if p_weekdays is null or array_position(p_weekdays, null) is not null
     or not (p_weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]) then
    raise exception 'weekdays must be values from 0 (Sunday) to 6 (Saturday)' using errcode = '22023';
  end if;
  v_weekdays := array(select distinct d from unnest(p_weekdays) as u (d) order by d);

  if p_steps is null or jsonb_typeof(p_steps) <> 'array' then
    raise exception 'steps must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_steps) > 20 then
    raise exception 'a routine can have at most 20 steps' using errcode = '22023';
  end if;
  for v_step in select s.value from jsonb_array_elements(p_steps) as s (value) loop
    if jsonb_typeof(v_step) <> 'object' then
      raise exception 'each step must be an object' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_object_keys(v_step) as k where k not in ('iconKey', 'photoId', 'label', 'time')) then
      raise exception 'steps may only have iconKey, photoId, label and time' using errcode = '22023';
    end if;
    if jsonb_typeof(v_step -> 'iconKey') not in ('string', 'null')
       or jsonb_typeof(v_step -> 'photoId') not in ('string', 'null')
       or jsonb_typeof(v_step -> 'label') is distinct from 'string'
       or jsonb_typeof(v_step -> 'time') not in ('string', 'null') then
      raise exception 'step fields have the wrong type' using errcode = '22023';
    end if;
    v_icon := v_step ->> 'iconKey';
    v_photo := v_step ->> 'photoId';
    v_label := btrim(v_step ->> 'label');
    v_time := v_step ->> 'time';
    if v_icon is not null and v_icon !~ '^[a-z0-9-]{1,40}$' then
      raise exception 'invalid step icon %', v_icon using errcode = '22023';
    end if;
    if v_photo is not null and (
      v_photo !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or not exists (select 1 from public.photos p where p.id = v_photo::uuid and p.household_id = v_household)
    ) then
      raise exception 'step photo not found' using errcode = '22023';
    end if;
    if char_length(v_label) not between 1 and 40 then
      raise exception 'step labels must be 1 to 40 characters' using errcode = '22023';
    end if;
    if v_time is not null and v_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'step time must be HH:MM' using errcode = '22023';
    end if;
    v_steps := v_steps || jsonb_build_array(jsonb_build_object(
      'iconKey', v_icon, 'photoId', lower(v_photo), 'label', v_label, 'time', v_time));
  end loop;

  if p_routine_id is null then
    insert into public.routines (household_id, child_id, name, weekdays, steps, sort_order)
    values (v_household, p_child_id, v_name, v_weekdays, v_steps,
      (select coalesce(max(r.sort_order) + 1, 0) from public.routines r where r.child_id = p_child_id))
    returning id into v_routine;
  else
    update public.routines set name = v_name, weekdays = v_weekdays, steps = v_steps
    where id = p_routine_id returning id into v_routine;
  end if;

  perform private.audit_setting(v_household, p_membership_id, 'routines',
    case when p_routine_id is null then 'add' else 'update' end, v_routine,
    jsonb_build_object('child_id', p_child_id, 'name', v_name, 'weekdays', to_jsonb(v_weekdays), 'steps', v_steps));
  return v_routine;
end $$;

-- Progress and day overrides for the routine go with it (on delete cascade).
create function public.delete_routine(p_membership_id uuid, p_pin text, p_routine_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.require_settings_pin(p_membership_id, p_pin);
  v_name text;
begin
  delete from public.routines where id = p_routine_id and household_id = v_household returning name into v_name;
  if v_name is null then
    raise exception 'routine not found' using errcode = '42501';
  end if;
  perform private.audit_setting(v_household, p_membership_id, 'routines', 'delete', p_routine_id,
    jsonb_build_object('name', v_name));
end $$;

-- "Switch today's routine". p_routine_id null clears the override (back to the weekday default).
create function public.set_routine_day_override(
  p_membership_id uuid, p_pin text, p_child_id uuid, p_day date, p_routine_id uuid
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_household uuid := private.require_settings_pin(p_membership_id, p_pin);
begin
  perform private.require_child_of(v_household, p_child_id);
  if p_day is null then
    raise exception 'day is required' using errcode = '22023';
  end if;
  if p_routine_id is null then
    delete from public.routine_day_overrides where child_id = p_child_id and day = p_day;
  else
    if not exists (select 1 from public.routines r where r.id = p_routine_id and r.child_id = p_child_id) then
      raise exception 'routine not found for this child' using errcode = '22023';
    end if;
    insert into public.routine_day_overrides (household_id, child_id, day, routine_id)
    values (v_household, p_child_id, p_day, p_routine_id)
    on conflict (child_id, day) do update set routine_id = excluded.routine_id;
  end if;
  perform private.audit_setting(v_household, p_membership_id, 'routines', 'day_override', p_child_id,
    jsonb_build_object('day', p_day, 'routine_id', p_routine_id));
end $$;

-- ─── Medicines ───────────────────────────────────────────────────────────
-- The child of an existing medicine cannot change; archived medicines cannot be edited.
create function public.upsert_medicine(
  p_membership_id uuid, p_pin text, p_medicine_id uuid, p_child_id uuid, p_name text,
  p_min_interval_hours numeric, p_max_doses_per_24h int
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.require_settings_pin(p_membership_id, p_pin);
  v_name text := btrim(p_name);
  v_existing_child uuid;
  v_archived_at timestamptz;
  v_medicine uuid;
begin
  perform private.require_child_of(v_household, p_child_id);
  if p_medicine_id is not null then
    select m.child_id, m.archived_at into v_existing_child, v_archived_at from public.medicines m
    where m.id = p_medicine_id and m.household_id = v_household
    for update;
    if v_existing_child is null then
      raise exception 'medicine not found' using errcode = '42501';
    end if;
    if v_existing_child <> p_child_id then
      raise exception 'a medicine cannot move to another child' using errcode = '22023';
    end if;
    if v_archived_at is not null then
      raise exception 'an archived medicine cannot be changed' using errcode = '22023';
    end if;
  end if;
  if v_name is null or char_length(v_name) not between 1 and 60 then
    raise exception 'medicine name must be 1 to 60 characters' using errcode = '22023';
  end if;
  if p_min_interval_hours is null or p_min_interval_hours <= 0 or p_min_interval_hours > 72
     or p_min_interval_hours <> round(p_min_interval_hours, 1) then
    raise exception 'minimum hours between doses must be more than 0 and at most 72, to one decimal place'
      using errcode = '22023';
  end if;
  if p_max_doses_per_24h is not null and p_max_doses_per_24h not between 1 and 24 then
    raise exception 'max doses in 24 hours must be 1 to 24' using errcode = '22023';
  end if;

  if p_medicine_id is null then
    insert into public.medicines (household_id, child_id, name, min_interval_hours, max_doses_per_24h)
    values (v_household, p_child_id, v_name, p_min_interval_hours, p_max_doses_per_24h)
    returning id into v_medicine;
  else
    update public.medicines set name = v_name, min_interval_hours = p_min_interval_hours,
      max_doses_per_24h = p_max_doses_per_24h
    where id = p_medicine_id returning id into v_medicine;
  end if;

  perform private.audit_setting(v_household, p_membership_id, 'medicines',
    case when p_medicine_id is null then 'add' else 'update' end, v_medicine,
    jsonb_build_object('child_id', p_child_id, 'name', v_name, 'min_interval_hours', p_min_interval_hours,
      'max_doses_per_24h', p_max_doses_per_24h));
  return v_medicine;
end $$;

-- Idempotent: an archived medicine keeps its first archived_at.
create function public.archive_medicine(p_membership_id uuid, p_pin text, p_medicine_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_household uuid := private.require_settings_pin(p_membership_id, p_pin);
begin
  update public.medicines set archived_at = coalesce(archived_at, now())
  where id = p_medicine_id and household_id = v_household;
  if not found then
    raise exception 'medicine not found' using errcode = '42501';
  end if;
  perform private.audit_setting(v_household, p_membership_id, 'medicines', 'archive', p_medicine_id, null);
end $$;

-- ─── Sticker categories ──────────────────────────────────────────────────
-- p_sort_order null appends a new category, or keeps an existing category's order.
create function public.upsert_sticker_category(
  p_membership_id uuid, p_pin text, p_category_id uuid, p_name text, p_icon_key text, p_sort_order int
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.require_settings_pin(p_membership_id, p_pin);
  v_name text := btrim(p_name);
  v_category uuid;
begin
  if p_category_id is not null and not exists (
    select 1 from public.sticker_categories s where s.id = p_category_id and s.household_id = v_household
  ) then
    raise exception 'sticker category not found' using errcode = '42501';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 30 then
    raise exception 'sticker category name must be 1 to 30 characters' using errcode = '22023';
  end if;
  if p_icon_key is null or p_icon_key !~ '^[a-z0-9-]{1,40}$' then
    raise exception 'invalid icon %', p_icon_key using errcode = '22023';
  end if;
  if p_sort_order is not null and p_sort_order not between 0 and 10000 then
    raise exception 'sort order must be 0 to 10000' using errcode = '22023';
  end if;

  if p_category_id is null then
    insert into public.sticker_categories (household_id, name, icon_key, sort_order)
    values (v_household, v_name, p_icon_key, coalesce(p_sort_order,
      (select coalesce(max(s.sort_order) + 1, 0) from public.sticker_categories s where s.household_id = v_household)))
    returning id into v_category;
  else
    update public.sticker_categories set name = v_name, icon_key = p_icon_key,
      sort_order = coalesce(p_sort_order, sort_order)
    where id = p_category_id returning id into v_category;
  end if;

  perform private.audit_setting(v_household, p_membership_id, 'stickers',
    case when p_category_id is null then 'add' else 'update' end, v_category,
    jsonb_build_object('name', v_name, 'icon_key', p_icon_key, 'sort_order', p_sort_order));
  return v_category;
end $$;

-- Idempotent: an archived category keeps its first archived_at. Its past sticker entries stay.
create function public.archive_sticker_category(p_membership_id uuid, p_pin text, p_category_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_household uuid := private.require_settings_pin(p_membership_id, p_pin);
begin
  update public.sticker_categories set archived_at = coalesce(archived_at, now())
  where id = p_category_id and household_id = v_household;
  if not found then
    raise exception 'sticker category not found' using errcode = '42501';
  end if;
  perform private.audit_setting(v_household, p_membership_id, 'stickers', 'archive', p_category_id, null);
end $$;

-- ─── My account ──────────────────────────────────────────────────────────
create function public.set_my_color(p_membership_id uuid, p_pin text, p_color text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_household uuid := private.require_settings_pin(p_membership_id, p_pin);
begin
  perform private.require_color(p_color);
  update public.memberships set color = p_color where id = p_membership_id;
  perform private.audit_setting(v_household, p_membership_id, 'my_account', 'color', p_membership_id,
    jsonb_build_object('color', p_color));
end $$;

-- ─── Logs retention (spec §11.2) ─────────────────────────────────────────
-- Bulk-deletes one log type's entries older than p_before, which must be at least 2 years ago.
-- Doses are never deleted (spec §11.4). Returns the number of rows deleted.
create function public.delete_old_entries(p_membership_id uuid, p_pin text, p_table text, p_before timestamptz)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.require_settings_pin(p_membership_id, p_pin);
  v_time_column text;
  v_count int;
begin
  v_time_column := case p_table
    when 'sleep_entries' then 'start_at'
    when 'feeding_entries' then 'at'
    when 'sticker_entries' then 'at'
    when 'diaper_entries' then 'at'
    when 'jots' then 'created_at'
  end;
  if v_time_column is null then
    raise exception 'logs of type % cannot be bulk-deleted', p_table using errcode = '22023';
  end if;
  if p_before is null or p_before > now() - interval '2 years' then
    raise exception 'only logs older than 2 years can be bulk-deleted' using errcode = '22023';
  end if;

  execute format('delete from public.%I where household_id = $1 and %I < $2', p_table, v_time_column)
  using v_household, p_before;
  get diagnostics v_count = row_count;

  perform private.audit_setting(v_household, p_membership_id, 'logs', 'delete_old', null,
    jsonb_build_object('table', p_table, 'before', p_before, 'deleted', v_count));
  return v_count;
end $$;

-- ─── Grants ──────────────────────────────────────────────────────────────
-- New private helpers are called only from the security-definer RPCs above; no client role executes them.
revoke execute on all functions in schema private from public;
revoke execute on function
  private.require_settings_pin(uuid, text), private.audit_setting(uuid, uuid, text, text, uuid, jsonb),
  private.require_color(text), private.require_child_of(uuid, uuid)
from authenticated;

revoke execute on function
  public.settings_verify(uuid, text),
  public.update_household_settings(uuid, text, text, text, text, int, time, time, time, time, boolean),
  public.update_sitter_info(uuid, text, jsonb),
  public.add_child_pin(uuid, text, text, date, text),
  public.update_child(uuid, text, uuid, text, date, text, text, text, time, time),
  public.set_feature_override(uuid, text, uuid, text, boolean),
  public.upsert_routine(uuid, text, uuid, uuid, text, smallint[], jsonb),
  public.delete_routine(uuid, text, uuid),
  public.set_routine_day_override(uuid, text, uuid, date, uuid),
  public.upsert_medicine(uuid, text, uuid, uuid, text, numeric, int),
  public.archive_medicine(uuid, text, uuid),
  public.upsert_sticker_category(uuid, text, uuid, text, text, int),
  public.archive_sticker_category(uuid, text, uuid),
  public.set_my_color(uuid, text, text),
  public.delete_old_entries(uuid, text, text, timestamptz)
from public, anon;

grant execute on function
  public.settings_verify(uuid, text),
  public.update_household_settings(uuid, text, text, text, text, int, time, time, time, time, boolean),
  public.update_sitter_info(uuid, text, jsonb),
  public.add_child_pin(uuid, text, text, date, text),
  public.update_child(uuid, text, uuid, text, date, text, text, text, time, time),
  public.set_feature_override(uuid, text, uuid, text, boolean),
  public.upsert_routine(uuid, text, uuid, uuid, text, smallint[], jsonb),
  public.delete_routine(uuid, text, uuid),
  public.set_routine_day_override(uuid, text, uuid, date, uuid),
  public.upsert_medicine(uuid, text, uuid, uuid, text, numeric, int),
  public.archive_medicine(uuid, text, uuid),
  public.upsert_sticker_category(uuid, text, uuid, text, text, int),
  public.archive_sticker_category(uuid, text, uuid),
  public.set_my_color(uuid, text, text),
  public.delete_old_entries(uuid, text, text, timestamptz)
to authenticated;

-- ═══ Members, displays and household deletion (owner or adult full sign-in, spec §6.2–§6.4, §11.3) ═══

-- One-time invites for a new adult to join on the display (hashed token, 10 minutes).
-- Reachable only through the security-definer RPCs below: RLS on, no policies, no client privileges.
create table public.member_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  role text not null check (role in ('owner', 'adult')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_by uuid,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (created_by, household_id) references public.memberships (id, household_id) on delete set null (created_by)
);
create index on public.member_invites (household_id);
alter table public.member_invites enable row level security;
revoke all on public.member_invites from anon, authenticated;

-- The caller's active membership in a live household, or null.
create function private.my_membership_id(p_household_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.id from public.memberships m
  join public.households h on h.id = m.household_id and h.deleted_at is null
  where m.user_id = auth.uid() and m.household_id = p_household_id and m.left_at is null
$$;

-- Raises 22023 when the household would be left without an active owner once p_membership_id stops being one.
-- Callers lock the household row first so concurrent role changes and removals serialize.
create function private.require_other_owner(p_household_id uuid, p_membership_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.memberships m
    where m.household_id = p_household_id and m.role = 'owner' and m.left_at is null and m.id <> p_membership_id
  ) then
    raise exception 'a household must keep at least one owner' using errcode = '22023';
  end if;
end $$;

-- ─── Invites ─────────────────────────────────────────────────────────────
create function public.create_member_invite(p_household_id uuid, p_role text)
returns table (out_token text, out_expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
  v_invite uuid;
  v_expires_at timestamptz := now() + interval '10 minutes';
begin
  perform private.require_adult();
  if p_household_id is null or not private.is_household_owner(p_household_id) then
    raise exception 'only an owner can add an adult' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('owner', 'adult') then
    raise exception 'role must be owner or adult' using errcode = '22023';
  end if;
  delete from public.member_invites where household_id = p_household_id and used_at is null and expires_at <= now();
  insert into public.member_invites (household_id, role, token_hash, expires_at, created_by)
  values (p_household_id, p_role, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_expires_at,
    private.my_membership_id(p_household_id))
  returning id into v_invite;
  perform private.audit_setting(p_household_id, private.my_membership_id(p_household_id), 'members', 'invite', v_invite,
    jsonb_build_object('role', p_role));
  return query select v_token, v_expires_at;
end $$;

-- The new adult, signed in with their own account and having recorded consent, joins with a name, color and PIN.
-- A former member of the household rejoins on their old membership row.
create function public.accept_member_invite(p_token text, p_display_name text, p_color text, p_pin text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_adult();
  v_name text := btrim(p_display_name);
  v_invite uuid;
  v_household uuid;
  v_role text;
  v_membership uuid;
  v_left_at timestamptz;
begin
  if not exists (select 1 from public.consent_records c where c.user_id = v_user and c.health_data_consent) then
    raise exception 'consent required' using errcode = '42501';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 40 then
    raise exception 'name must be 1 to 40 characters' using errcode = '22023';
  end if;
  perform private.require_color(p_color);
  if p_pin is null or p_pin !~ '^\d{4}$' then
    raise exception 'PIN must be 4 digits' using errcode = '22023';
  end if;

  select i.id, i.household_id, i.role into v_invite, v_household, v_role
  from public.member_invites i
  join public.households h on h.id = i.household_id and h.deleted_at is null
  where i.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and i.used_at is null and i.expires_at > now()
  for update of i;
  if v_invite is null then
    raise exception 'invalid or expired invite' using errcode = '22023';
  end if;

  select m.id, m.left_at into v_membership, v_left_at
  from public.memberships m where m.user_id = v_user and m.household_id = v_household
  for update;
  if v_membership is not null and v_left_at is null then
    raise exception 'already a member of this household' using errcode = '22023';
  end if;

  if v_membership is null then
    insert into public.memberships (user_id, household_id, role, display_name, color)
    values (v_user, v_household, v_role, v_name, p_color)
    returning id into v_membership;
  else
    update public.memberships
    set role = v_role, display_name = v_name, color = p_color, left_at = null, joined_at = now()
    where id = v_membership;
  end if;
  perform private.set_pin_for(v_user, v_household, p_pin);
  update public.member_invites set used_at = now() where id = v_invite;

  perform private.audit_setting(v_household, v_membership, 'members', 'join', v_membership,
    jsonb_build_object('role', v_role, 'display_name', v_name, 'invite_id', v_invite));
  return v_membership;
end $$;

-- ─── Roles and removal ───────────────────────────────────────────────────
create function public.set_member_role(p_membership_id uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid;
  v_role text;
begin
  perform private.require_adult();
  select m.household_id into v_household from public.memberships m where m.id = p_membership_id and m.left_at is null;
  if v_household is not null then
    perform 1 from public.households h where h.id = v_household for update;
    select m.role into v_role from public.memberships m where m.id = p_membership_id and m.left_at is null;
  end if;
  if v_role is null or not private.is_household_owner(v_household) then
    raise exception 'only an owner can change roles' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('owner', 'adult') then
    raise exception 'role must be owner or adult' using errcode = '22023';
  end if;
  if v_role = 'owner' and p_role <> 'owner' then
    perform private.require_other_owner(v_household, p_membership_id);
  end if;
  update public.memberships set role = p_role where id = p_membership_id;
  perform private.audit_setting(v_household, private.my_membership_id(v_household), 'members', 'role', p_membership_id,
    jsonb_build_object('role', p_role));
end $$;

-- Ends a membership (left_at) and deletes its PIN. Past entries keep the member's name.
create function private.end_membership(p_membership_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.memberships set left_at = now() where id = p_membership_id;
  delete from public.member_pins where membership_id = p_membership_id;
$$;

create function public.remove_member(p_membership_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid;
  v_role text;
  v_actor uuid;
begin
  perform private.require_adult();
  select m.household_id into v_household from public.memberships m where m.id = p_membership_id and m.left_at is null;
  if v_household is not null then
    perform 1 from public.households h where h.id = v_household for update;
    select m.role into v_role from public.memberships m where m.id = p_membership_id and m.left_at is null;
  end if;
  if v_role is null or not private.is_household_owner(v_household) then
    raise exception 'only an owner can remove a member' using errcode = '42501';
  end if;
  if v_role = 'owner' then
    perform private.require_other_owner(v_household, p_membership_id);
  end if;
  v_actor := private.my_membership_id(v_household);
  perform private.end_membership(p_membership_id);
  perform private.audit_setting(v_household, v_actor, 'members', 'remove', p_membership_id, null);
end $$;

create function public.leave_household(p_household_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_membership uuid;
begin
  perform private.require_adult();
  if private.my_membership_id(p_household_id) is null then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  perform 1 from public.households h where h.id = p_household_id for update;
  v_membership := private.my_membership_id(p_household_id);
  if v_membership is null then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  if (select m.role from public.memberships m where m.id = v_membership) = 'owner' then
    perform private.require_other_owner(p_household_id, v_membership);
  end if;
  perform private.end_membership(v_membership);
  perform private.audit_setting(p_household_id, v_membership, 'members', 'leave', v_membership, null);
end $$;

-- ─── Displays ────────────────────────────────────────────────────────────
create function public.rename_display(p_display_id uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid;
  v_name text := btrim(p_name);
begin
  perform private.require_adult();
  select d.household_id into v_household from public.displays d where d.id = p_display_id;
  if v_household is null or not private.is_household_owner(v_household) then
    raise exception 'only an owner can rename a display' using errcode = '42501';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 40 then
    raise exception 'display name must be 1 to 40 characters' using errcode = '22023';
  end if;
  update public.displays set name = v_name where id = p_display_id;
  perform private.audit_setting(v_household, private.my_membership_id(v_household), 'displays', 'rename', p_display_id,
    jsonb_build_object('name', v_name));
end $$;

-- ─── Household deletion (spec §11.3) ─────────────────────────────────────
-- Soft delete: every policy and RPC already ignores households with deleted_at set, so members lose access at
-- once. Displays, pending display claims, member invites and take-list links are revoked immediately.
-- private.purge_deleted_households() hard-deletes the data after 30 days.
create function public.delete_household(p_household_id uuid, p_confirm_name text) returns void
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
  update public.take_list_links set revoked_at = now() where household_id = p_household_id and revoked_at is null;

  perform private.audit_setting(p_household_id, v_actor, 'household', 'delete', p_household_id,
    jsonb_build_object('name', v_name));
end $$;

-- Hard-deletes households deleted more than 30 days ago (cascades to all household data; doses are removed first
-- by the purge_doses_before_delete trigger). Not callable by clients. Returns the number of households purged.
-- Storage objects and calendar tokens join this purge when those features land (Phase 4).
create function private.purge_deleted_households() returns int
language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  delete from public.households where deleted_at is not null and deleted_at < now() - interval '30 days';
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Scheduling: daily via pg_cron when the extension is installed. On hosted Supabase, enable pg_cron
-- (Database → Extensions) and run once:
--   select cron.schedule('roost-purge-deleted-households', '17 3 * * *', 'select private.purge_deleted_households()');
do $$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    perform cron.schedule('roost-purge-deleted-households', '17 3 * * *', 'select private.purge_deleted_households()');
  end if;
end $$;

-- ─── Grants ──────────────────────────────────────────────────────────────
revoke execute on all functions in schema private from public;
revoke execute on function
  private.my_membership_id(uuid), private.require_other_owner(uuid, uuid), private.end_membership(uuid),
  private.purge_deleted_households()
from authenticated;

revoke execute on function
  public.create_member_invite(uuid, text),
  public.accept_member_invite(text, text, text, text),
  public.set_member_role(uuid, text),
  public.remove_member(uuid),
  public.leave_household(uuid),
  public.rename_display(uuid, text),
  public.delete_household(uuid, text)
from public, anon;

grant execute on function
  public.create_member_invite(uuid, text),
  public.accept_member_invite(text, text, text, text),
  public.set_member_role(uuid, text),
  public.remove_member(uuid),
  public.leave_household(uuid),
  public.rename_display(uuid, text),
  public.delete_household(uuid, text)
to authenticated;
