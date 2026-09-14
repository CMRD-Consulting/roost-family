-- ─── Private helpers ─────────────────────────────────────────────────────
-- Helpers live outside the API-exposed public schema. Policies call them as the querying role,
-- so authenticated needs usage and execute; nothing else does.
create schema private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- Households the caller belongs to, as an adult member or through an active display.
-- Soft-deleted households are excluded, which closes every policy and RPC over them.
create function private.my_household_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.household_id from public.memberships m
  join public.households h on h.id = m.household_id and h.deleted_at is null
  where m.user_id = auth.uid() and m.left_at is null
  union
  select d.household_id from public.displays d
  join public.households h on h.id = d.household_id and h.deleted_at is null
  where d.auth_user_id = auth.uid() and d.revoked_at is null
$$;

create function private.is_household_member(p_household_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.my_household_ids() as h (household_id) where h.household_id = p_household_id)
$$;

create function private.is_household_owner(p_household_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    join public.households h on h.id = m.household_id and h.deleted_at is null
    where m.user_id = auth.uid() and m.household_id = p_household_id and m.role = 'owner' and m.left_at is null
  )
$$;

create function private.child_in_my_household(p_child_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.child_households ch
    where ch.child_id = p_child_id and private.is_household_member(ch.household_id)
  )
$$;

-- A real adult sign-in: not anonymous, and not a device credential bound to a display.
create function private.require_adult() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null
     or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
     or exists (select 1 from public.displays d where d.auth_user_id = auth.uid()) then
    raise exception 'adult sign-in required' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

-- True when the membership is active and the PIN matches. Does not check the caller; callers must
-- first establish that the membership belongs to a household the caller is a member of.
create function private.pin_ok(p_membership_id uuid, p_pin text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.member_pins p
    join public.memberships m on m.id = p.membership_id and m.left_at is null
    where p.membership_id = p_membership_id
      and p_pin ~ '^\d{4}$'
      and p.pin_hash = extensions.crypt(p_pin, p.pin_hash)
  )
$$;

revoke execute on all functions in schema private from public;
grant execute on function
  private.my_household_ids(), private.is_household_member(uuid), private.is_household_owner(uuid),
  private.child_in_my_household(uuid), private.require_adult()
to authenticated;
-- private.pin_ok is deliberately not granted: it is only called from security-definer RPCs,
-- and on its own it would be a PIN oracle for any membership id.

-- ─── Enable RLS everywhere ───────────────────────────────────────────────
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ─── Table privileges for authenticated ──────────────────────────────────
-- Secrets and config: reachable only through security-definer functions.
revoke all on public.app_config, public.invite_codes, public.member_pins, public.display_claims from authenticated;

-- Written only by RPCs.
revoke insert, update, delete on
  public.memberships, public.consent_records, public.displays, public.child_households
from authenticated;

-- Sitter Mode starts and ends with an adult's PIN (spec §7.6): read directly, written through RPCs.
revoke insert, update, delete on public.sitter_sessions from authenticated;

-- Configuration (spec §7.3): read directly, written later through PIN-checked RPCs.
revoke insert, update, delete on
  public.households, public.children, public.medicines, public.feature_overrides,
  public.sticker_categories, public.routines, public.routine_day_overrides, public.photos,
  public.take_list_links
from authenticated;

-- Doses are append-only: insert here, void and acknowledge through RPCs (spec §11.4).
revoke update, delete on public.dose_entries from authenticated;

-- The settings audit trail is written only by the security-definer settings RPCs (private.audit_setting),
-- never inserted directly by a member's own client.
revoke insert, update, delete on public.settings_audit from authenticated;

-- ─── Policies ────────────────────────────────────────────────────────────
-- Tables with RLS on and no policies (app_config, invite_codes, member_pins, display_claims)
-- are reachable only through the security-definer functions below.
create policy households_select on public.households for select to authenticated
  using (private.is_household_member(id));

create policy memberships_select on public.memberships for select to authenticated
  using (private.is_household_member(household_id));

create policy consent_select_own on public.consent_records for select to authenticated
  using (user_id = auth.uid());

create policy displays_select on public.displays for select to authenticated
  using (private.is_household_member(household_id));

create policy children_select on public.children for select to authenticated
  using (private.child_in_my_household(id));

create policy child_households_select on public.child_households for select to authenticated
  using (private.is_household_member(household_id));

create policy feature_overrides_select on public.feature_overrides for select to authenticated
  using (private.child_in_my_household(child_id));

create policy sitter_sessions_select on public.sitter_sessions for select to authenticated
  using (private.is_household_member(household_id));

-- Configuration tables: members read; writes are revoked above.
do $$
declare t text;
begin
  foreach t in array array[
    'medicines', 'sticker_categories', 'routines', 'routine_day_overrides', 'take_list_links', 'photos'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (private.is_household_member(household_id))',
      t || '_select', t);
  end loop;
end $$;

-- Logs and lists: members (adults and displays) can read and write.
do $$
declare t text;
begin
  foreach t in array array[
    'sleep_entries', 'feeding_entries', 'sticker_entries', 'diaper_entries',
    'routine_progress', 'jots', 'grocery_items'
  ] loop
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (private.is_household_member(household_id))
         with check (private.is_household_member(household_id))',
      t || '_member_all', t);
  end loop;
end $$;

create policy dose_entries_select on public.dose_entries for select to authenticated
  using (private.is_household_member(household_id));
create policy dose_entries_insert on public.dose_entries for insert to authenticated
  with check (private.is_household_member(household_id));

-- No insert policy: settings_audit is written only by security-definer RPCs (private.audit_setting),
-- which are not subject to RLS; a member's own client can never insert into it directly.
create policy settings_audit_select on public.settings_audit for select to authenticated
  using (private.is_household_member(household_id));

-- ─── RPC: consent and household creation ─────────────────────────────────
create function public.record_consent(p_policy_version text, p_health_data_consent boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_adult();
begin
  if not p_health_data_consent then
    raise exception 'health data consent is required' using errcode = '22023';
  end if;
  insert into public.consent_records (user_id, policy_version, health_data_consent)
  values (v_user, p_policy_version, true);
end $$;

-- Shared bodies for household setup. Called only from the security-definer RPCs below (which
-- establish the caller with private.require_adult()); never granted to any client role.
create function private.create_household_for(
  p_user uuid, p_name text, p_time_zone text, p_zip text, p_lat double precision, p_lon double precision,
  p_invite_code text, p_display_name text, p_color text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid;
  v_invites_required boolean;
begin
  if not exists (select 1 from public.consent_records c where c.user_id = p_user and c.health_data_consent) then
    raise exception 'consent required' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = p_time_zone) then
    raise exception 'unknown time zone %', p_time_zone using errcode = '22023';
  end if;

  -- Serialize this user's household creation so the ownership limit holds under concurrency.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('roost.create_household:' || p_user::text, 0));
  if (
    select count(*) from public.memberships m
    join public.households h on h.id = m.household_id and h.deleted_at is null
    where m.user_id = p_user and m.role = 'owner' and m.left_at is null
  ) >= 3 then
    raise exception 'a user can own at most 3 households' using errcode = '22023';
  end if;

  select coalesce((c.value #>> '{}')::boolean, true) into v_invites_required
  from public.app_config c where c.key = 'invites_required';
  v_invites_required := coalesce(v_invites_required, true);

  if v_invites_required then
    perform 1 from public.invite_codes i
    where i.code = upper(p_invite_code) and i.used_at is null
    for update;
    if not found then
      raise exception 'invalid invite code' using errcode = '22023';
    end if;
  end if;

  insert into public.households (name, time_zone, zip, lat, lon)
  values (p_name, p_time_zone, nullif(p_zip, ''), p_lat, p_lon)
  returning id into v_household;

  if v_invites_required then
    update public.invite_codes set used_by_household_id = v_household, used_at = now()
    where code = upper(p_invite_code);
  end if;

  insert into public.memberships (user_id, household_id, role, display_name, color)
  values (p_user, v_household, 'owner', p_display_name, p_color);

  insert into public.sticker_categories (household_id, name, icon_key, sort_order) values
    (v_household, 'Potty', 'potty', 0),
    (v_household, 'Teeth', 'teeth', 1),
    (v_household, 'Tried a new food', 'new-food', 2);

  return v_household;
end $$;

-- Does not check the caller; callers must first establish membership of p_household_id.
create function private.add_child_to(p_household_id uuid, p_name text, p_birthday date, p_color text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_child uuid;
  v_today date;
begin
  if p_name is null or char_length(p_name) not between 1 and 40 then
    raise exception 'a child''s name must be 1 to 40 characters' using errcode = '22023';
  end if;
  -- Lock the household so concurrent calls cannot both pass the limit check.
  select (now() at time zone h.time_zone)::date into v_today
  from public.households h where h.id = p_household_id
  for update;
  if p_birthday is null or p_birthday > v_today then
    raise exception 'a child''s birthday cannot be in the future' using errcode = '22023';
  end if;
  if (select count(*) from public.child_households ch where ch.household_id = p_household_id) >= 8 then
    raise exception 'a household can have at most 8 children' using errcode = '22023';
  end if;
  insert into public.children (name, birthday, color) values (p_name, p_birthday, p_color) returning id into v_child;
  insert into public.child_households (child_id, household_id) values (v_child, p_household_id);
  return v_child;
end $$;

create function private.set_pin_for(p_user uuid, p_household_id uuid, p_pin text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_pin is null or p_pin !~ '^\d{4}$' then
    raise exception 'PIN must be 4 digits' using errcode = '22023';
  end if;
  insert into public.member_pins (membership_id, pin_hash)
  select m.id, extensions.crypt(p_pin, extensions.gen_salt('bf', 8))
  from public.memberships m
  where m.user_id = p_user and m.household_id = p_household_id and m.left_at is null
  on conflict (membership_id) do update set pin_hash = excluded.pin_hash, updated_at = now();
  if not found then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
end $$;

revoke execute on function
  private.create_household_for(uuid, text, text, text, double precision, double precision, text, text, text),
  private.add_child_to(uuid, text, date, text),
  private.set_pin_for(uuid, uuid, text)
from public;

create function public.create_household(
  p_name text, p_time_zone text, p_zip text, p_lat double precision, p_lon double precision,
  p_invite_code text, p_display_name text, p_color text
) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  return private.create_household_for(
    private.require_adult(), p_name, p_time_zone, p_zip, p_lat, p_lon, p_invite_code, p_display_name, p_color);
end $$;

create function public.add_child(p_household_id uuid, p_name text, p_birthday date, p_color text) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_adult();
  if not private.is_household_member(p_household_id) then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  return private.add_child_to(p_household_id, p_name, p_birthday, p_color);
end $$;

-- The whole setup wizard in one transaction (spec §7.1): household, owner membership, kids and the
-- owner's PIN. Any failure rolls everything back, so the invite code stays unused and a retry is clean.
-- p_kids: [{"name": text, "birthday": "YYYY-MM-DD", "color": "#RRGGBB"}], 1 to 8 entries.
create function public.setup_household(
  p_name text, p_time_zone text, p_zip text, p_lat double precision, p_lon double precision,
  p_invite_code text, p_display_name text, p_color text, p_kids jsonb, p_pin text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_adult();
  v_household uuid;
  v_kid jsonb;
begin
  if p_kids is null or jsonb_typeof(p_kids) <> 'array' or jsonb_array_length(p_kids) not between 1 and 8 then
    raise exception 'a household needs 1 to 8 children' using errcode = '22023';
  end if;
  if p_pin is null or p_pin !~ '^\d{4}$' then
    raise exception 'PIN must be 4 digits' using errcode = '22023';
  end if;

  v_household := private.create_household_for(
    v_user, p_name, p_time_zone, p_zip, p_lat, p_lon, p_invite_code, p_display_name, p_color);

  for v_kid in select k.value from jsonb_array_elements(p_kids) as k (value) loop
    if jsonb_typeof(v_kid) <> 'object' then
      raise exception 'each child must be an object' using errcode = '22023';
    end if;
    perform private.add_child_to(
      v_household, btrim(v_kid ->> 'name'), (v_kid ->> 'birthday')::date, v_kid ->> 'color');
  end loop;

  perform private.set_pin_for(v_user, v_household, p_pin);
  return v_household;
end $$;

-- ─── RPC: household lists ────────────────────────────────────────────────
-- Tonight's dinner is edited with a long-press on the main screen (spec §7.2), so any member can set it.
create function public.set_dinner_tonight(p_household_id uuid, p_text text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_text text := nullif(btrim(p_text), '');
begin
  if not private.is_household_member(p_household_id) then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  if char_length(v_text) > 80 then
    raise exception 'dinner must be at most 80 characters' using errcode = '22023';
  end if;
  update public.households set dinner_tonight = v_text where id = p_household_id;
end $$;

-- ─── RPC: routine progress ───────────────────────────────────────────────
-- Kids' Corner marks one step done (or not done) at a time (spec §7.5). The change is applied to the stored
-- array inside one upsert, which locks the row, so two displays finishing different steps at once both keep
-- their step (a client-side "write the whole array" would lose one). Returns the new array, sorted.
create function public.set_routine_step(p_child_id uuid, p_routine_id uuid, p_day date, p_step_index int, p_done boolean)
returns int[]
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid;
  v_step_count int;
  v_completed int[];
begin
  if p_child_id is null or not private.child_in_my_household(p_child_id) then
    raise exception 'child not found' using errcode = '42501';
  end if;
  select jsonb_array_length(r.steps) into v_step_count
  from public.routines r where r.id = p_routine_id and r.child_id = p_child_id;
  if v_step_count is null then
    raise exception 'routine not found for this child' using errcode = '22023';
  end if;
  if p_day is null or p_done is null then
    raise exception 'day and done are required' using errcode = '22023';
  end if;
  if p_step_index is null or p_step_index < 0 or p_step_index >= v_step_count then
    raise exception 'step index out of range' using errcode = '22023';
  end if;
  select ch.household_id into v_household from public.child_households ch where ch.child_id = p_child_id;

  insert into public.routine_progress as rp (household_id, child_id, routine_id, day, completed_step_indexes)
  values (v_household, p_child_id, p_routine_id, p_day, case when p_done then array[p_step_index] else '{}'::int[] end)
  on conflict (child_id, routine_id, day) do update
  set completed_step_indexes = case
    when not p_done then array_remove(rp.completed_step_indexes, p_step_index)
    when p_step_index = any (rp.completed_step_indexes) then rp.completed_step_indexes
    else array(select i from unnest(array_append(rp.completed_step_indexes, p_step_index)) as u (i) order by i)
  end
  returning rp.completed_step_indexes into v_completed;
  return v_completed;
end $$;
revoke execute on function public.set_routine_step(uuid, uuid, date, int, boolean) from public, anon;
grant execute on function public.set_routine_step(uuid, uuid, date, int, boolean) to authenticated;

-- ─── RPC: PINs ───────────────────────────────────────────────────────────
create function public.set_my_pin(p_household_id uuid, p_pin text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.set_pin_for(private.require_adult(), p_household_id, p_pin);
end $$;

create function public.verify_pin(p_membership_id uuid, p_pin text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_household uuid;
begin
  select m.household_id into v_household from public.memberships m
  where m.id = p_membership_id and m.left_at is null;
  if v_household is null or not private.is_household_member(v_household) then
    return false;
  end if;
  return private.pin_ok(p_membership_id, p_pin);
end $$;

-- ─── RPC: doses ──────────────────────────────────────────────────────────
-- Both RPCs need an adult's PIN (spec §7.3). The caller (adult or display) must be a member of the
-- dose's household, and the PIN's membership must belong to that same household.
create function public.void_dose(p_dose_id uuid, p_membership_id uuid, p_pin text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid;
  v_voided_at timestamptz;
  v_reason text := btrim(p_reason);
begin
  select d.household_id, d.voided_at into v_household, v_voided_at
  from public.dose_entries d where d.id = p_dose_id
  for update;
  if v_household is null or not private.is_household_member(v_household) then
    raise exception 'dose not found' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.id = p_membership_id and m.household_id = v_household and m.left_at is null
  ) or not private.pin_ok(p_membership_id, p_pin) then
    raise exception 'incorrect PIN' using errcode = '42501';
  end if;
  if v_voided_at is not null then
    raise exception 'dose is already voided' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) not between 1 and 200 then
    raise exception 'a void reason of 1 to 200 characters is required' using errcode = '22023';
  end if;
  update public.dose_entries
  set voided_at = now(), voided_by = p_membership_id, void_reason = v_reason
  where id = p_dose_id;
end $$;

-- Idempotent: a dose already acknowledged keeps its first acknowledgement.
create function public.acknowledge_dose_conflict(p_dose_id uuid, p_membership_id uuid, p_pin text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_household uuid;
begin
  select d.household_id into v_household
  from public.dose_entries d where d.id = p_dose_id
  for update;
  if v_household is null or not private.is_household_member(v_household) then
    raise exception 'dose not found' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.id = p_membership_id and m.household_id = v_household and m.left_at is null
  ) or not private.pin_ok(p_membership_id, p_pin) then
    raise exception 'incorrect PIN' using errcode = '42501';
  end if;
  update public.dose_entries
  set conflict_acknowledged_at = now(), conflict_acknowledged_by = p_membership_id
  where id = p_dose_id and conflict_acknowledged_at is null;
end $$;

-- ─── RPC: sitter sessions ────────────────────────────────────────────────
-- Sitter Mode (spec §7.6) is household-wide and needs an adult's PIN to start and to end. The caller (adult or
-- display) must be a member of the household, and the PIN must belong to one of its owners or adults.
-- Name and display are optional; a blank name is stored as null (logs then show "Sitter").
-- The session id comes from the device (like log entry ids), so the optimistic session and logs attributed to it
-- already carry the real id. A retry with the same id in the same household returns that id instead of failing.
create function public.start_sitter_session(
  p_session_id uuid, p_household_id uuid, p_membership_id uuid, p_pin text,
  p_sitter_name text default null, p_display_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := nullif(btrim(p_sitter_name), '');
  v_existing_household uuid;
begin
  if p_household_id is null or not private.is_household_member(p_household_id) then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.id = p_membership_id and m.household_id = p_household_id
      and m.role in ('owner', 'adult') and m.left_at is null
  ) or not private.pin_ok(p_membership_id, p_pin) then
    raise exception 'incorrect PIN' using errcode = '42501';
  end if;
  if p_session_id is null then
    raise exception 'a session id is required' using errcode = '22023';
  end if;
  if char_length(v_name) > 40 then
    raise exception 'a sitter name must be at most 40 characters' using errcode = '22023';
  end if;
  if p_display_id is not null and not exists (
    select 1 from public.displays d where d.id = p_display_id and d.household_id = p_household_id
  ) then
    raise exception 'display not found in this household' using errcode = '22023';
  end if;
  select s.household_id into v_existing_household from public.sitter_sessions s where s.id = p_session_id;
  if v_existing_household = p_household_id then
    return p_session_id;
  elsif v_existing_household is not null then
    raise exception 'sitter session not found' using errcode = '42501';
  end if;
  -- The partial unique index allows one open session per household, also under concurrent starts.
  begin
    insert into public.sitter_sessions (id, household_id, display_id, sitter_name)
    values (p_session_id, p_household_id, p_display_id, v_name);
  exception when unique_violation then
    -- A concurrent retry of this same start may have inserted it first.
    if exists (select 1 from public.sitter_sessions s where s.id = p_session_id and s.household_id = p_household_id) then
      return p_session_id;
    end if;
    raise exception 'a sitter session is already active' using errcode = '23505';
  end;
  return p_session_id;
end $$;

create function public.end_sitter_session(p_session_id uuid, p_membership_id uuid, p_pin text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid;
  v_ended_at timestamptz;
begin
  select s.household_id, s.ended_at into v_household, v_ended_at
  from public.sitter_sessions s where s.id = p_session_id
  for update;
  if v_household is null or not private.is_household_member(v_household) then
    raise exception 'sitter session not found' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.id = p_membership_id and m.household_id = v_household
      and m.role in ('owner', 'adult') and m.left_at is null
  ) or not private.pin_ok(p_membership_id, p_pin) then
    raise exception 'incorrect PIN' using errcode = '42501';
  end if;
  if v_ended_at is not null then
    raise exception 'sitter session has already ended' using errcode = '22023';
  end if;
  update public.sitter_sessions set ended_at = now() where id = p_session_id
  returning ended_at into v_ended_at;
  return v_ended_at;
end $$;

-- The display that ends a session shows the "While You Were Out" summary and marks it shown; other displays
-- stop offering it. Idempotent: the first time is kept.
create function public.mark_sitter_summary_shown(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid;
  v_ended_at timestamptz;
begin
  select s.household_id, s.ended_at into v_household, v_ended_at
  from public.sitter_sessions s where s.id = p_session_id
  for update;
  if v_household is null or not private.is_household_member(v_household) then
    raise exception 'sitter session not found' using errcode = '42501';
  end if;
  if v_ended_at is null then
    raise exception 'sitter session has not ended' using errcode = '22023';
  end if;
  update public.sitter_sessions set summary_shown_at = coalesce(summary_shown_at, now()) where id = p_session_id;
end $$;

-- ─── RPC: displays ───────────────────────────────────────────────────────
create function public.register_display(p_household_id uuid, p_name text)
returns table (out_display_id uuid, out_claim_token text)
language plpgsql security definer set search_path = '' as $$
declare
  v_display uuid;
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  perform private.require_adult();
  if not private.is_household_owner(p_household_id) then
    raise exception 'only an owner can add a display' using errcode = '42501';
  end if;
  -- Lock the household so concurrent calls cannot both pass the limit check.
  perform 1 from public.households where id = p_household_id for update;
  if (
    select count(*) from public.displays d
    where d.household_id = p_household_id and d.revoked_at is null
      and (d.auth_user_id is not null
           or exists (select 1 from public.display_claims c where c.display_id = d.id and c.expires_at > now()))
  ) >= 3 then
    raise exception 'a household can have at most 3 displays' using errcode = '22023';
  end if;

  insert into public.displays (household_id, name) values (p_household_id, p_name) returning id into v_display;
  insert into public.display_claims (display_id, token_hash, expires_at)
  values (v_display, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '10 minutes');

  return query select v_display, v_token;
end $$;

create function public.claim_display(p_token text)
returns table (out_display_id uuid, out_household_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_display uuid;
  v_household uuid;
begin
  if auth.uid() is null or not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'a display must claim with a device session' using errcode = '42501';
  end if;

  -- A device whose display was revoked may join again: release its old binding first.
  update public.displays set auth_user_id = null
  where auth_user_id = auth.uid() and revoked_at is not null;
  if exists (select 1 from public.displays d where d.auth_user_id = auth.uid()) then
    raise exception 'this device is already registered as an active display' using errcode = '22023';
  end if;

  select c.display_id into v_display
  from public.display_claims c
  join public.displays d on d.id = c.display_id
  where c.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and c.expires_at > now() and d.revoked_at is null and d.auth_user_id is null
  for update of c;
  if v_display is null then
    raise exception 'invalid or expired display claim' using errcode = '22023';
  end if;

  update public.displays set auth_user_id = auth.uid(), last_seen_at = now()
  where id = v_display returning household_id into v_household;
  delete from public.display_claims where display_id = v_display;

  return query select v_display, v_household;
end $$;

create function public.my_display()
returns table (out_display_id uuid, out_household_id uuid, out_name text, out_revoked boolean)
language sql stable security definer set search_path = '' as $$
  select d.id, d.household_id, d.name, d.revoked_at is not null
  from public.displays d where d.auth_user_id = auth.uid()
$$;

-- True while this device is bound to an active display in a live household; false once the display
-- was revoked (or the household deleted) or the device is not bound at all.
create function public.display_heartbeat() returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.displays d set last_seen_at = now()
  where d.auth_user_id = auth.uid() and d.revoked_at is null
    and exists (select 1 from public.households h where h.id = d.household_id and h.deleted_at is null);
  return found;
end $$;

create function public.revoke_display(p_display_id uuid) returns void
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
end $$;

-- ─── Final grants ────────────────────────────────────────────────────────
-- Runs last so it covers every table and function above. anon gets nothing; authenticated gets
-- only the table privileges left above (minus truncate/references/trigger) and the RPCs below.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke truncate, references, trigger on all tables in schema public from authenticated;
do $$
begin
  -- MAINTAIN (vacuum, analyze, lock table, ...) exists from Postgres 17.
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on all tables in schema public from authenticated';
  end if;
end $$;

grant execute on function
  public.record_consent(text, boolean),
  public.create_household(text, text, text, double precision, double precision, text, text, text),
  public.add_child(uuid, text, date, text),
  public.setup_household(text, text, text, double precision, double precision, text, text, text, jsonb, text),
  public.set_dinner_tonight(uuid, text),
  public.set_routine_step(uuid, uuid, date, int, boolean),
  public.set_my_pin(uuid, text), public.verify_pin(uuid, text),
  public.void_dose(uuid, uuid, text, text), public.acknowledge_dose_conflict(uuid, uuid, text),
  public.start_sitter_session(uuid, uuid, uuid, text, text, uuid), public.end_sitter_session(uuid, uuid, text),
  public.mark_sitter_summary_shown(uuid),
  public.register_display(uuid, text), public.claim_display(text), public.my_display(),
  public.display_heartbeat(), public.revoke_display(uuid)
to authenticated;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from public, anon;
