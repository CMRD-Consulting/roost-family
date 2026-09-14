-- ─── Grants: nothing for anon; column-limited updates on households ─────
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon, public;

revoke insert, update, delete on public.households from authenticated;
grant update (
  name, time_zone, zip, lat, lon, default_night_sleep_start, default_night_sleep_end,
  night_mode_start, night_mode_end, leave_by_buffer_min, diaper_log_enabled, dinner_tonight, sitter_info
) on public.households to authenticated;

-- ─── Helper functions ────────────────────────────────────────────────────
create function public.my_household_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.household_id from public.memberships m
  where m.user_id = auth.uid() and m.left_at is null
  union
  select d.household_id from public.displays d
  where d.auth_user_id = auth.uid() and d.revoked_at is null
$$;

create function public.is_household_member(p_household_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.my_household_ids() as h (household_id) where h.household_id = p_household_id)
$$;

create function public.is_household_owner(p_household_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.household_id = p_household_id and m.role = 'owner' and m.left_at is null
  )
$$;

create function public.child_in_my_household(p_child_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.child_households ch
    where ch.child_id = p_child_id and public.is_household_member(ch.household_id)
  )
$$;

create function public.require_adult() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'adult sign-in required' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

-- ─── Enable RLS everywhere ───────────────────────────────────────────────
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
-- Tables with RLS on and no policies (app_config, invite_codes, member_pins, display_claims)
-- are reachable only through the security-definer functions below.

-- ─── Policies ────────────────────────────────────────────────────────────
create policy households_select on public.households for select to authenticated
  using (public.is_household_member(id));
create policy households_update on public.households for update to authenticated
  using (public.is_household_member(id)) with check (public.is_household_member(id));

create policy memberships_select on public.memberships for select to authenticated
  using (public.is_household_member(household_id));

create policy consent_select_own on public.consent_records for select to authenticated
  using (user_id = auth.uid());

create policy displays_select on public.displays for select to authenticated
  using (public.is_household_member(household_id));

create policy children_select on public.children for select to authenticated
  using (public.child_in_my_household(id));
create policy children_update on public.children for update to authenticated
  using (public.child_in_my_household(id)) with check (public.child_in_my_household(id));

create policy child_households_select on public.child_households for select to authenticated
  using (public.is_household_member(household_id));

create policy feature_overrides_all on public.feature_overrides for all to authenticated
  using (public.child_in_my_household(child_id)) with check (public.child_in_my_household(child_id));

-- Household-scoped tables: members (adults and displays) can read and write.
do $$
declare t text;
begin
  foreach t in array array[
    'sitter_sessions', 'sleep_entries', 'feeding_entries', 'medicines', 'sticker_categories',
    'sticker_entries', 'diaper_entries', 'routines', 'routine_progress', 'routine_day_overrides',
    'jots', 'grocery_items', 'take_list_links', 'photos'
  ] loop
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.is_household_member(household_id))
         with check (public.is_household_member(household_id))',
      t || '_member_all', t);
  end loop;
end $$;

-- Doses are never deleted (spec §11.4): select, insert, update only.
create policy dose_entries_select on public.dose_entries for select to authenticated
  using (public.is_household_member(household_id));
create policy dose_entries_insert on public.dose_entries for insert to authenticated
  with check (public.is_household_member(household_id));
create policy dose_entries_update on public.dose_entries for update to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

create policy settings_audit_select on public.settings_audit for select to authenticated
  using (public.is_household_member(household_id));
create policy settings_audit_insert on public.settings_audit for insert to authenticated
  with check (public.is_household_member(household_id));

-- ─── RPC: consent and household creation ─────────────────────────────────
create function public.record_consent(p_policy_version text, p_health_data_consent boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := public.require_adult();
begin
  if not p_health_data_consent then
    raise exception 'health data consent is required' using errcode = '22023';
  end if;
  insert into public.consent_records (user_id, policy_version, health_data_consent)
  values (v_user, p_policy_version, true);
end $$;

create function public.create_household(
  p_name text, p_time_zone text, p_zip text, p_lat double precision, p_lon double precision,
  p_invite_code text, p_display_name text, p_color text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := public.require_adult();
  v_household uuid;
  v_invites_required boolean;
begin
  if not exists (select 1 from public.consent_records c where c.user_id = v_user and c.health_data_consent) then
    raise exception 'consent required' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = p_time_zone) then
    raise exception 'unknown time zone %', p_time_zone using errcode = '22023';
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
  values (v_user, v_household, 'owner', p_display_name, p_color);

  insert into public.sticker_categories (household_id, name, icon_key, sort_order) values
    (v_household, 'Potty', 'potty', 0),
    (v_household, 'Teeth', 'teeth', 1),
    (v_household, 'Tried a new food', 'new-food', 2);

  return v_household;
end $$;

create function public.add_child(p_household_id uuid, p_name text, p_birthday date, p_color text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_child uuid;
begin
  if not public.is_household_member(p_household_id) then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  if (select count(*) from public.child_households ch where ch.household_id = p_household_id) >= 8 then
    raise exception 'a household can have at most 8 children' using errcode = '22023';
  end if;
  insert into public.children (name, birthday, color) values (p_name, p_birthday, p_color) returning id into v_child;
  insert into public.child_households (child_id, household_id) values (v_child, p_household_id);
  return v_child;
end $$;

-- ─── RPC: PINs ───────────────────────────────────────────────────────────
create function public.set_my_pin(p_household_id uuid, p_pin text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := public.require_adult();
begin
  if p_pin !~ '^\d{4}$' then
    raise exception 'PIN must be 4 digits' using errcode = '22023';
  end if;
  insert into public.member_pins (membership_id, pin_hash)
  select m.id, extensions.crypt(p_pin, extensions.gen_salt('bf', 8))
  from public.memberships m
  where m.user_id = v_user and m.household_id = p_household_id and m.left_at is null
  on conflict (membership_id) do update set pin_hash = excluded.pin_hash, updated_at = now();
  if not found then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
end $$;

create function public.verify_pin(p_membership_id uuid, p_pin text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_household uuid;
begin
  select m.household_id into v_household from public.memberships m
  where m.id = p_membership_id and m.left_at is null;
  if v_household is null or not public.is_household_member(v_household) then
    return false;
  end if;
  return exists (
    select 1 from public.member_pins p
    where p.membership_id = p_membership_id and p.pin_hash = extensions.crypt(p_pin, p.pin_hash)
  );
end $$;

-- ─── RPC: displays ───────────────────────────────────────────────────────
create function public.register_display(p_household_id uuid, p_name text)
returns table (out_display_id uuid, out_claim_token text)
language plpgsql security definer set search_path = '' as $$
declare
  v_display uuid;
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  perform public.require_adult();
  if not public.is_household_owner(p_household_id) then
    raise exception 'only an owner can add a display' using errcode = '42501';
  end if;
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

create function public.display_heartbeat() returns void
language sql security definer set search_path = '' as $$
  update public.displays set last_seen_at = now()
  where auth_user_id = auth.uid() and revoked_at is null
$$;

create function public.revoke_display(p_display_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_household uuid;
begin
  perform public.require_adult();
  select d.household_id into v_household from public.displays d where d.id = p_display_id;
  if v_household is null or not public.is_household_owner(v_household) then
    raise exception 'only an owner can remove a display' using errcode = '42501';
  end if;
  update public.displays set revoked_at = now() where id = p_display_id and revoked_at is null;
  delete from public.display_claims where display_id = p_display_id;
end $$;

-- ─── Execute grants ──────────────────────────────────────────────────────
grant execute on function
  public.my_household_ids(), public.is_household_member(uuid), public.is_household_owner(uuid),
  public.child_in_my_household(uuid), public.require_adult(),
  public.record_consent(text, boolean),
  public.create_household(text, text, text, double precision, double precision, text, text, text),
  public.add_child(uuid, text, date, text),
  public.set_my_pin(uuid, text), public.verify_pin(uuid, text),
  public.register_display(uuid, text), public.claim_display(text), public.my_display(),
  public.display_heartbeat(), public.revoke_display(uuid)
to authenticated;
