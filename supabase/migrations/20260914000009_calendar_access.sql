-- ═══ Calendar access hardening (review of migration 8; spec §5.5, §6.2, §6.3) ═══
-- 1. A connection can no longer outlive its member's removal: the membership checks in
--    private.create_calendar_connection and private.require_calendar_assignee lock the membership row (`for share`),
--    so a concurrent end_membership or role change waits for the insert, then deletes what it created (or the check
--    re-reads the ended membership and refuses).
-- 2. Only an active owner or adult has calendars. A role change to anything else (caregiver) deletes the member's
--    connections, whose trigger deletes the Vault secrets. private.calendar_secret, set_calendar_selection,
--    add_calendar_selection and update_calendar_secret also require the connection's member to be an active owner or
--    adult of a live household. disconnect_calendar is unchanged: the connection's own member, while active, may always
--    remove it.
-- 3. A connection label can never contain a URL (a check constraint); labels come from calendar names or account
--    emails, never from the subscription link.
-- 4. calendar_selections.external_calendar_id (often an email address) is no longer readable by clients: authenticated
--    gets column-level SELECT on every other column, as calendar_connections does. Client queries must list columns.

-- ─── 3. Labels never contain URLs ────────────────────────────────────────
alter table public.calendar_connections
  add constraint calendar_connections_label_no_url check (label !~* '(https?|webcal)://');

-- ─── 4. external_calendar_id is server-only ──────────────────────────────
revoke select on public.calendar_selections from authenticated;
grant select (id, household_id, connection_id, name, assigned_membership_id, assigned_child_id, visible, gone, created_at)
  on public.calendar_selections to authenticated;

-- ─── 1. Membership row locks ─────────────────────────────────────────────
-- Volatile now: row locks are not allowed in stable functions.
create or replace function private.require_calendar_assignee(
  p_household_id uuid, p_membership_id uuid, p_child_id uuid, p_visible boolean
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_membership_id is not null and p_child_id is not null then
    raise exception 'a calendar belongs to one person: a member or a child' using errcode = '22023';
  end if;
  if p_visible and p_membership_id is null and p_child_id is null then
    raise exception 'choose whose calendar this is before showing it' using errcode = '22023';
  end if;
  if p_membership_id is not null and not exists (
    select 1 from public.memberships m
    where m.id = p_membership_id and m.household_id = p_household_id and m.left_at is null
    for share of m
  ) then
    raise exception 'member not found' using errcode = '42501';
  end if;
  if p_child_id is not null then
    perform private.require_child_of(p_household_id, p_child_id);
  end if;
end $$;

create or replace function private.create_calendar_connection(
  p_household_id uuid, p_membership_id uuid, p_provider text, p_label text, p_secret text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_label text := btrim(p_label);
  v_connection uuid;
begin
  if not exists (
    select 1 from public.memberships m
    join public.households h on h.id = m.household_id and h.deleted_at is null
    where m.id = p_membership_id and m.household_id = p_household_id
      and m.role in ('owner', 'adult') and m.left_at is null
    for share of m
  ) then
    raise exception 'member not found' using errcode = '42501';
  end if;
  if p_provider is null or p_provider not in ('ics', 'google', 'microsoft') then
    raise exception 'calendar provider must be ics, google or microsoft' using errcode = '22023';
  end if;
  if v_label is null or char_length(v_label) not between 1 and 200 then
    raise exception 'a calendar label must be 1 to 200 characters' using errcode = '22023';
  end if;

  insert into public.calendar_connections (household_id, membership_id, provider, label, vault_secret_id)
  values (p_household_id, p_membership_id, p_provider, v_label,
    private.store_calendar_secret(p_secret, 'roost_calendar_' || p_provider))
  returning id into v_connection;

  perform private.audit_setting(p_household_id, p_membership_id, 'calendars', 'connect', v_connection,
    jsonb_build_object('provider', p_provider));
  return v_connection;
end $$;

-- ─── 2. Owners and adults only ───────────────────────────────────────────
create function private.disconnect_calendars_on_role_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.calendar_connections where membership_id = new.id;
  return null;
end $$;

create trigger disconnect_calendars_on_role_change after update of role on public.memberships
  for each row when (new.role not in ('owner', 'adult'))
  execute function private.disconnect_calendars_on_role_change();

create or replace function private.calendar_secret(p_connection_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select ds.decrypted_secret
  from public.calendar_connections c
  join public.memberships m on m.id = c.membership_id and m.left_at is null and m.role in ('owner', 'adult')
  join public.households h on h.id = c.household_id and h.deleted_at is null
  join vault.decrypted_secrets ds on ds.id = c.vault_secret_id
  where c.id = p_connection_id
$$;

-- ─── 5. Service helpers require a live household and an active owner or adult ─
create or replace function private.update_calendar_secret(p_connection_id uuid, p_secret text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_secret uuid;
begin
  select c.vault_secret_id into v_secret
  from public.calendar_connections c
  join public.households h on h.id = c.household_id and h.deleted_at is null
  join public.memberships m on m.id = c.membership_id and m.left_at is null and m.role in ('owner', 'adult')
  where c.id = p_connection_id
  for update of c;
  if v_secret is null then
    raise exception 'calendar connection not found' using errcode = '42501';
  end if;
  if p_secret is null or btrim(p_secret) = '' then
    raise exception 'a calendar secret is required' using errcode = '22023';
  end if;
  if char_length(p_secret) > 8192 then
    raise exception 'a calendar secret must be at most 8192 characters' using errcode = '22023';
  end if;
  perform vault.update_secret(v_secret, p_secret);
end $$;

create or replace function private.add_calendar_selection(
  p_connection_id uuid, p_external_calendar_id text, p_name text, p_visible boolean,
  p_assigned_membership_id uuid, p_assigned_child_id uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid;
  v_visible boolean := coalesce(p_visible, false);
  v_name text := left(coalesce(nullif(btrim(p_name), ''), 'Calendar'), 200);
  v_selection uuid;
begin
  select c.household_id into v_household
  from public.calendar_connections c
  join public.households h on h.id = c.household_id and h.deleted_at is null
  join public.memberships m on m.id = c.membership_id and m.left_at is null and m.role in ('owner', 'adult')
  where c.id = p_connection_id
  for update of c;
  if v_household is null then
    raise exception 'calendar connection not found' using errcode = '42501';
  end if;
  if p_external_calendar_id is null or char_length(p_external_calendar_id) not between 1 and 1024 then
    raise exception 'an external calendar id of 1 to 1024 characters is required' using errcode = '22023';
  end if;
  perform private.require_calendar_assignee(v_household, p_assigned_membership_id, p_assigned_child_id, v_visible);

  insert into public.calendar_selections as s
    (household_id, connection_id, external_calendar_id, name, visible, assigned_membership_id, assigned_child_id)
  values (v_household, p_connection_id, p_external_calendar_id, v_name, v_visible, p_assigned_membership_id, p_assigned_child_id)
  on conflict (connection_id, external_calendar_id) do update set name = excluded.name, gone = false
  returning s.id into v_selection;
  return v_selection;
end $$;

create or replace function public.set_calendar_selection(
  p_selection_id uuid, p_visible boolean, p_assigned_membership_id uuid, p_assigned_child_id uuid
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid;
  v_owner uuid;
  v_actor uuid;
begin
  perform private.require_adult();
  select s.household_id, c.membership_id into v_household, v_owner
  from public.calendar_selections s
  join public.calendar_connections c on c.id = s.connection_id
  where s.id = p_selection_id
  for update of s;
  v_actor := private.my_membership_id(v_household);
  if v_household is null or v_actor is null or v_owner <> v_actor
     or not exists (select 1 from public.memberships m where m.id = v_actor and m.role in ('owner', 'adult')) then
    raise exception 'calendar not found' using errcode = '42501';
  end if;
  if p_visible is null then
    raise exception 'visible is required' using errcode = '22023';
  end if;
  perform private.require_calendar_assignee(v_household, p_assigned_membership_id, p_assigned_child_id, p_visible);

  update public.calendar_selections
  set visible = p_visible, assigned_membership_id = p_assigned_membership_id, assigned_child_id = p_assigned_child_id
  where id = p_selection_id;

  perform private.audit_setting(v_household, v_actor, 'calendars', 'selection', p_selection_id, jsonb_build_object(
    'visible', p_visible, 'assigned_membership_id', p_assigned_membership_id, 'assigned_child_id', p_assigned_child_id));
end $$;

-- ─── Grants ──────────────────────────────────────────────────────────────
-- `create or replace` keeps the replaced functions' grants; the new trigger function is not callable by anyone.
revoke execute on function private.disconnect_calendars_on_role_change() from public, anon, authenticated, service_role;

-- ═══ Calendar Edge Function callers (spec §5.5, §6.3) ═══
-- The calendar Edge Functions decide who is calling with the caller's own JWT, so these rules stay the source of truth:
--   - my_calendar_caller(household): a member or display of the household (calendar-events). One row, or none.
--   - my_calendar_membership(household): a full sign-in owner or adult of the household (calendar-connect-ics,
--     calendar-oauth-start), through private.require_adult. Returns the membership id or raises 42501. The functions
--     create connections for this membership only, never for one named in a request.

-- The caller's relation to a live household: 'member' (an active membership, with its id) or 'display' (an active
-- display's device account). No row for anyone else.
create function public.my_calendar_caller(p_household_id uuid)
returns table (user_id uuid, kind text, membership_id uuid)
language sql stable security definer set search_path = '' as $$
  select auth.uid(),
    case when private.my_membership_id(p_household_id) is null then 'display' else 'member' end,
    private.my_membership_id(p_household_id)
  where auth.uid() is not null and p_household_id is not null and private.is_household_member(p_household_id)
$$;

create function public.my_calendar_membership(p_household_id uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_membership uuid;
begin
  perform private.require_adult();
  v_membership := private.my_membership_id(p_household_id);
  if v_membership is null or not exists (
    select 1 from public.memberships m where m.id = v_membership and m.role in ('owner', 'adult')
  ) then
    raise exception 'adult sign-in required' using errcode = '42501';
  end if;
  return v_membership;
end $$;

revoke execute on function public.my_calendar_caller(uuid), public.my_calendar_membership(uuid) from public, anon;
grant execute on function public.my_calendar_caller(uuid), public.my_calendar_membership(uuid) to authenticated;

-- ═══ Calendar OAuth states (spec §5.5, §6.3) ═══
-- calendar-oauth-start stores one row per Google / Microsoft consent attempt: the SHA-256 (hex) of the random `state`
-- sent to the provider (never the state itself), the PKCE code verifier, who is connecting and which page to return
-- to. calendar-oauth-callback consumes it atomically: the row is deleted on first use, and one past its 10-minute
-- expiry is refused. Clients have no access at all; only the service-role wrappers touch the table. Expired rows are
-- removed whenever a state is created and by the daily household purge.

create table public.calendar_oauth_states (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique check (state_hash ~ '^[0-9a-f]{64}$'),
  code_verifier text not null check (code_verifier ~ '^[A-Za-z0-9._~-]{43,128}$'),
  household_id uuid not null references public.households (id) on delete cascade,
  membership_id uuid not null,
  provider text not null check (provider in ('google', 'microsoft')),
  redirect_to text not null check (redirect_to in ('settings', 'manage')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  foreign key (membership_id, household_id) references public.memberships (id, household_id) on delete cascade
);
create index on public.calendar_oauth_states (household_id);
create index on public.calendar_oauth_states (membership_id);
create index on public.calendar_oauth_states (expires_at);

alter table public.calendar_oauth_states enable row level security;
revoke all on public.calendar_oauth_states from anon, authenticated, service_role;

-- Deletes expired states; returns how many.
create function private.purge_calendar_oauth_states() returns int
language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  delete from public.calendar_oauth_states where expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Records a consent attempt for an active owner or adult of a live household. Returns the state's id.
create function private.create_calendar_oauth_state(
  p_state_hash text, p_code_verifier text, p_household_id uuid, p_membership_id uuid, p_provider text, p_redirect_to text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not exists (
    select 1 from public.memberships m
    join public.households h on h.id = m.household_id and h.deleted_at is null
    where m.id = p_membership_id and m.household_id = p_household_id
      and m.role in ('owner', 'adult') and m.left_at is null
  ) then
    raise exception 'member not found' using errcode = '42501';
  end if;
  if p_provider is null or p_provider not in ('google', 'microsoft') then
    raise exception 'OAuth provider must be google or microsoft' using errcode = '22023';
  end if;
  if p_redirect_to is null or p_redirect_to not in ('settings', 'manage') then
    raise exception 'return page must be settings or manage' using errcode = '22023';
  end if;
  if p_state_hash is null or p_state_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'state hash must be 64 lowercase hex characters' using errcode = '22023';
  end if;
  if p_code_verifier is null or p_code_verifier !~ '^[A-Za-z0-9._~-]{43,128}$' then
    raise exception 'code verifier must be 43 to 128 unreserved characters' using errcode = '22023';
  end if;

  perform private.purge_calendar_oauth_states();
  insert into public.calendar_oauth_states (state_hash, code_verifier, household_id, membership_id, provider, redirect_to)
  values (p_state_hash, p_code_verifier, p_household_id, p_membership_id, p_provider, p_redirect_to)
  returning id into v_id;
  return v_id;
end $$;

-- Deletes the state with this hash and returns it, with `expired` true when it was already past its expiry (the
-- caller must refuse it). No row for an unknown or already used state.
create function private.consume_calendar_oauth_state(p_state_hash text)
returns table (household_id uuid, membership_id uuid, provider text, code_verifier text, redirect_to text, expired boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  return query
  delete from public.calendar_oauth_states s where s.state_hash = p_state_hash
  returning s.household_id, s.membership_id, s.provider, s.code_verifier, s.redirect_to, s.expires_at <= now();
end $$;

create function public.svc_create_calendar_oauth_state(
  p_state_hash text, p_code_verifier text, p_household_id uuid, p_membership_id uuid, p_provider text, p_redirect_to text
) returns uuid
language sql security definer set search_path = '' as $$
  select private.create_calendar_oauth_state(p_state_hash, p_code_verifier, p_household_id, p_membership_id, p_provider, p_redirect_to)
$$;

create function public.svc_consume_calendar_oauth_state(p_state_hash text)
returns table (household_id uuid, membership_id uuid, provider text, code_verifier text, redirect_to text, expired boolean)
language sql security definer set search_path = '' as $$
  select * from private.consume_calendar_oauth_state(p_state_hash)
$$;

-- ─── Purge (replaces migration 7's): also removes expired OAuth states ───
create or replace function private.purge_deleted_households() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
  v_devices uuid[];
begin
  select coalesce(array_agg(distinct d.auth_user_id), '{}') into v_devices
  from public.displays d
  join public.households h on h.id = d.household_id
  join auth.users u on u.id = d.auth_user_id and u.is_anonymous
  where h.deleted_at is not null and h.deleted_at < now() - interval '30 days';

  -- Photo files stay until the storage sweep finds their household gone and erases them through the Storage API.
  delete from public.households where deleted_at is not null and deleted_at < now() - interval '30 days';
  get diagnostics v_count = row_count;

  -- After the households (and so their displays) are gone; a device bound to a display elsewhere is kept.
  delete from auth.users u
  where u.id = any (v_devices) and u.is_anonymous
    and not exists (select 1 from public.displays d where d.auth_user_id = u.id);

  perform private.purge_calendar_oauth_states();
  return v_count;
end $$;

revoke execute on function
  private.purge_calendar_oauth_states(),
  private.create_calendar_oauth_state(text, text, uuid, uuid, text, text),
  private.consume_calendar_oauth_state(text),
  private.purge_deleted_households()
from public, anon, authenticated, service_role;

revoke execute on function
  public.svc_create_calendar_oauth_state(text, text, uuid, uuid, text, text),
  public.svc_consume_calendar_oauth_state(text)
from public, anon, authenticated;
grant execute on function
  public.svc_create_calendar_oauth_state(text, text, uuid, uuid, text, text),
  public.svc_consume_calendar_oauth_state(text)
to service_role;
