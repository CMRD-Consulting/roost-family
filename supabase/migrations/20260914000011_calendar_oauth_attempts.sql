-- ═══ Calendar OAuth attempts, connection fingerprints and review hardening (spec §5.5, §6.3) ═══
-- 1. Pending OAuth attempts. calendar-oauth-callback no longer connects anything: whoever completes consent may not be
--    the adult who started it (a consent link can be forwarded), so it parks the refresh token in Vault and the
--    account's calendar list in calendar_oauth_attempts for 15 minutes, keyed by the SHA-256 of a one-time token it
--    hands to the browser. calendar-oauth-finish consumes it only for the signed-in adult whose membership started it
--    (a different caller leaves it in place), creating the connection and its selections in one transaction and moving
--    the Vault secret to the connection. Deleting an attempt deletes its secret unless a connection now owns it.
-- 2. Fingerprints and one transaction. calendar_connections.secret_fingerprint is an HMAC (key held by the Edge
--    Functions) of the normalized ICS URL or of the provider account id, unique per member and provider, and not
--    readable by clients (no column grant). create_calendar_connection_with_selections creates a connection with all its
--    selections at once; for a fingerprint the member already has, an ICS link returns the existing connection unchanged
--    and an OAuth account gets its new token in place, status ok, and its calendars re-recorded.
-- 3. Light rate limits: at most 5 unexpired OAuth states per member (SQLSTATE PT429, which PostgREST answers with
--    HTTP 429) and at most 10 ICS connect attempts per member per hour (svc_record_calendar_connect_attempt).
-- 4. set_calendar_selection locks memberships before the selection row, the same order as end_membership (membership,
--    then calendar rows), so the two cannot deadlock.
-- 5. A role change away from owner or adult also drops the member's pending OAuth states and attempts.
-- Expired states, attempts and old connect-attempt rows are removed by purge_calendar_oauth_states, which runs on
-- every new state and attempt and in the daily household purge.

-- ─── Fingerprints ────────────────────────────────────────────────────────
alter table public.calendar_connections
  add column secret_fingerprint text check (secret_fingerprint ~ '^[0-9a-f]{64}$'),
  add constraint calendar_connections_membership_provider_fingerprint_key unique (membership_id, provider, secret_fingerprint);
-- authenticated keeps its column-level SELECT grants from migration 8, which do not include the new column.

-- ─── Tables ──────────────────────────────────────────────────────────────
create table public.calendar_oauth_attempts (
  id uuid primary key default gen_random_uuid(),
  attempt_hash text not null unique check (attempt_hash ~ '^[0-9a-f]{64}$'),
  household_id uuid not null references public.households (id) on delete cascade,
  membership_id uuid not null,
  provider text not null check (provider in ('google', 'microsoft')),
  vault_secret_id uuid not null unique,
  account_label text check (account_label is null
    or (char_length(account_label) between 1 and 200 and account_label !~* '(https?|webcal)://')),
  secret_fingerprint text not null check (secret_fingerprint ~ '^[0-9a-f]{64}$'),
  -- [{ id, name }] only.
  calendars jsonb not null default '[]'::jsonb check (jsonb_typeof(calendars) = 'array'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  foreign key (membership_id, household_id) references public.memberships (id, household_id) on delete cascade
);
create index on public.calendar_oauth_attempts (household_id);
create index on public.calendar_oauth_attempts (membership_id);
create index on public.calendar_oauth_attempts (expires_at);

create table public.calendar_connect_attempts (
  id bigint generated always as identity primary key,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index on public.calendar_connect_attempts (membership_id, created_at);

alter table public.calendar_oauth_attempts enable row level security;
alter table public.calendar_connect_attempts enable row level security;
revoke all on public.calendar_oauth_attempts, public.calendar_connect_attempts from anon, authenticated, service_role;

-- An attempt's secret goes with it, unless finishing moved it to a connection.
create function private.delete_calendar_attempt_vault_secret() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets s
  where s.id = old.vault_secret_id
    and not exists (select 1 from public.calendar_connections c where c.vault_secret_id = old.vault_secret_id);
  return null;
end $$;

create trigger delete_calendar_attempt_vault_secret after delete on public.calendar_oauth_attempts
  for each row execute function private.delete_calendar_attempt_vault_secret();

-- ─── Purge (replaces migration 9's): states, attempts and connect-attempt rows ─
create or replace function private.purge_calendar_oauth_states() returns int
language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  delete from public.calendar_oauth_states where expires_at <= now();
  get diagnostics v_count = row_count;
  delete from public.calendar_oauth_attempts where expires_at <= now();
  delete from public.calendar_connect_attempts where created_at < now() - interval '1 hour';
  return v_count;
end $$;

-- ─── Helpers ─────────────────────────────────────────────────────────────
-- A calendar list as [{ id, name }]: at most 500 entries, ids of 1 to 1024 characters (duplicates dropped), names
-- trimmed and cut to 200 characters ('Calendar' when blank). Anything else in the entries is dropped.
create function private.normalize_calendar_list(p_calendars jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v_item jsonb;
  v_out jsonb := '[]'::jsonb;
  v_ids text[] := '{}';
begin
  if p_calendars is null or jsonb_typeof(p_calendars) <> 'array' or jsonb_array_length(p_calendars) > 500 then
    raise exception 'calendars must be an array of at most 500 entries' using errcode = '22023';
  end if;
  for v_item in select e.value from jsonb_array_elements(p_calendars) as e loop
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item -> 'id') is distinct from 'string'
       or char_length(v_item ->> 'id') not between 1 and 1024 then
      raise exception 'each calendar needs an id of 1 to 1024 characters' using errcode = '22023';
    end if;
    continue when (v_item ->> 'id') = any (v_ids);
    v_ids := v_ids || (v_item ->> 'id');
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', v_item ->> 'id',
      'name', left(coalesce(nullif(btrim(case when jsonb_typeof(v_item -> 'name') = 'string' then v_item ->> 'name' end), ''), 'Calendar'), 200)));
  end loop;
  return v_out;
end $$;

-- Creates a connection and all its selections (hidden, unassigned) in one transaction for an active owner or adult of
-- a live household, with the secret given as text (stored in Vault) or as an existing Vault secret id (an OAuth
-- attempt's, moved to the connection). When the member already has a connection with this provider and fingerprint:
-- an ICS link returns it unchanged; an OAuth account gets the new secret in place, status ok, and its calendars
-- re-recorded (keeping its label and the adult's visibility and assignments). selection_ids follow p_calendars' order.
create function private.create_calendar_connection_with_selections(
  p_household_id uuid, p_membership_id uuid, p_provider text, p_label text, p_secret text, p_vault_secret_id uuid,
  p_fingerprint text, p_calendars jsonb
) returns table (connection_id uuid, already_connected boolean, label text, calendar_count int, selection_ids uuid[])
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_label text := left(btrim(p_label), 200);
  v_calendars jsonb;
  v_existing public.calendar_connections;
  v_connection uuid;
  v_secret text;
  v_item jsonb;
  v_ids uuid[] := '{}';
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
  if v_label is null or char_length(v_label) < 1 then
    raise exception 'a calendar label must be 1 to 200 characters' using errcode = '22023';
  end if;
  if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'fingerprint must be 64 lowercase hex characters' using errcode = '22023';
  end if;
  if (p_secret is null) = (p_vault_secret_id is null) then
    raise exception 'give either a secret or a Vault secret id' using errcode = '22023';
  end if;
  if p_vault_secret_id is not null then
    select ds.decrypted_secret into v_secret from vault.decrypted_secrets ds where ds.id = p_vault_secret_id;
    if v_secret is null or exists (select 1 from public.calendar_connections c where c.vault_secret_id = p_vault_secret_id) then
      raise exception 'unknown Vault secret' using errcode = '22023';
    end if;
  else
    v_secret := p_secret;
  end if;
  if btrim(v_secret) = '' or char_length(v_secret) > 8192 then
    raise exception 'a calendar secret of at most 8192 characters is required' using errcode = '22023';
  end if;
  v_calendars := private.normalize_calendar_list(p_calendars);

  -- Serializes connects of the same account or link by the same member.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'roost_calendar_connection:' || p_membership_id::text || ':' || p_provider || ':' || p_fingerprint, 0));
  select c.* into v_existing from public.calendar_connections c
  where c.membership_id = p_membership_id and c.provider = p_provider and c.secret_fingerprint = p_fingerprint
  for update of c;

  if v_existing.id is not null and p_provider = 'ics' then
    select coalesce(array_agg(s.id order by e.ord), '{}') into v_ids
    from jsonb_array_elements(v_calendars) with ordinality as e (value, ord)
    join public.calendar_selections s on s.connection_id = v_existing.id and s.external_calendar_id = e.value ->> 'id';
    return query select v_existing.id, true, v_existing.label,
      (select count(*)::int from public.calendar_selections s where s.connection_id = v_existing.id), v_ids;
    return;
  end if;

  if v_existing.id is not null then
    perform vault.update_secret(v_existing.vault_secret_id, v_secret);
    update public.calendar_connections c
    set status = 'ok',
        status_changed_at = case when c.status <> 'ok' then now() else c.status_changed_at end
    where c.id = v_existing.id;
    v_connection := v_existing.id;
    v_label := v_existing.label;
    perform private.audit_setting(p_household_id, p_membership_id, 'calendars', 'reconnect', v_connection,
      jsonb_build_object('provider', p_provider));
  else
    if p_vault_secret_id is not null then
      -- The attempt's secret becomes the connection's (same id), under a connection secret name.
      perform vault.update_secret(p_vault_secret_id, v_secret, 'roost_calendar_' || p_provider || '_' || gen_random_uuid()::text);
    end if;
    insert into public.calendar_connections (household_id, membership_id, provider, label, vault_secret_id, secret_fingerprint)
    values (p_household_id, p_membership_id, p_provider, v_label,
      coalesce(p_vault_secret_id, private.store_calendar_secret(v_secret, 'roost_calendar_' || p_provider)), p_fingerprint)
    returning id into v_connection;
    perform private.audit_setting(p_household_id, p_membership_id, 'calendars', 'connect', v_connection,
      jsonb_build_object('provider', p_provider));
  end if;

  for v_item in select e.value from jsonb_array_elements(v_calendars) as e loop
    v_ids := v_ids || private.add_calendar_selection(v_connection, v_item ->> 'id', v_item ->> 'name', false, null, null);
  end loop;

  return query select v_connection, v_existing.id is not null, v_label,
    (select count(*)::int from public.calendar_selections s where s.connection_id = v_connection), v_ids;
end $$;

-- Records one ICS connect attempt for the member; false (and nothing recorded) when they already made 10 in the last
-- hour.
create function private.record_calendar_connect_attempt(p_membership_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_membership_id is null then
    raise exception 'membership is required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('roost_calendar_connect:' || p_membership_id::text, 0));
  delete from public.calendar_connect_attempts a where a.membership_id = p_membership_id and a.created_at < now() - interval '1 hour';
  if (select count(*) from public.calendar_connect_attempts a where a.membership_id = p_membership_id) >= 10 then
    return false;
  end if;
  insert into public.calendar_connect_attempts (membership_id) values (p_membership_id);
  return true;
end $$;

-- ─── OAuth states (replaces migration 9's): at most 5 unexpired per member ─
create or replace function private.create_calendar_oauth_state(
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

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('roost_calendar_oauth_state:' || p_membership_id::text, 0));
  perform private.purge_calendar_oauth_states();
  if (select count(*) from public.calendar_oauth_states s where s.membership_id = p_membership_id) >= 5 then
    raise exception 'too many calendar connections in progress' using errcode = 'PT429';
  end if;
  insert into public.calendar_oauth_states (state_hash, code_verifier, household_id, membership_id, provider, redirect_to)
  values (p_state_hash, p_code_verifier, p_household_id, p_membership_id, p_provider, p_redirect_to)
  returning id into v_id;
  return v_id;
end $$;

-- ─── OAuth attempts ──────────────────────────────────────────────────────
-- Parks a completed consent for an active owner or adult of a live household. A blank or URL-like label is dropped.
create function private.create_calendar_oauth_attempt(
  p_attempt_hash text, p_household_id uuid, p_membership_id uuid, p_provider text, p_secret text, p_account_label text,
  p_fingerprint text, p_calendars jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_label text := left(nullif(btrim(p_account_label), ''), 200);
  v_calendars jsonb;
  v_id uuid;
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
  if p_attempt_hash is null or p_attempt_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'attempt hash must be 64 lowercase hex characters' using errcode = '22023';
  end if;
  if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'fingerprint must be 64 lowercase hex characters' using errcode = '22023';
  end if;
  if v_label ~* '(https?|webcal)://' then
    v_label := null;
  end if;
  v_calendars := private.normalize_calendar_list(p_calendars);

  perform private.purge_calendar_oauth_states();
  insert into public.calendar_oauth_attempts
    (attempt_hash, household_id, membership_id, provider, vault_secret_id, account_label, secret_fingerprint, calendars)
  values (p_attempt_hash, p_household_id, p_membership_id, p_provider,
    private.store_calendar_secret(p_secret, 'roost_calendar_attempt_' || p_provider), v_label, p_fingerprint, v_calendars)
  returning id into v_id;
  return v_id;
end $$;

-- The household of the attempt with this hash (expired or not), or null. Used to check the caller before finishing.
create function private.peek_calendar_oauth_attempt(p_attempt_hash text) returns uuid
language sql stable security definer set search_path = '' as $$
  select a.household_id from public.calendar_oauth_attempts a where a.attempt_hash = p_attempt_hash
$$;

-- Finishes an attempt for p_membership_id (from the caller's JWT check). Outcomes: invalid_attempt (none), expired
-- (deleted), forbidden (another member's; left in place), ok (consumed; connection and selections created, or the
-- member's existing connection for the same account updated).
create function private.finish_calendar_oauth_attempt(p_attempt_hash text, p_membership_id uuid)
returns table (outcome text, connection_id uuid, label text, calendar_count int)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_attempt public.calendar_oauth_attempts;
  v_result record;
begin
  select a.* into v_attempt from public.calendar_oauth_attempts a where a.attempt_hash = p_attempt_hash for update of a;
  if v_attempt.id is null then
    return query select 'invalid_attempt'::text, null::uuid, null::text, null::int;
    return;
  end if;
  if v_attempt.expires_at <= now() then
    delete from public.calendar_oauth_attempts a where a.id = v_attempt.id;
    return query select 'expired'::text, null::uuid, null::text, null::int;
    return;
  end if;
  if p_membership_id is null or v_attempt.membership_id <> p_membership_id then
    return query select 'forbidden'::text, null::uuid, null::text, null::int;
    return;
  end if;

  select r.* into v_result from private.create_calendar_connection_with_selections(
    v_attempt.household_id, v_attempt.membership_id, v_attempt.provider,
    coalesce(v_attempt.account_label, case v_attempt.provider when 'google' then 'Google Calendar' else 'Outlook Calendar' end),
    null, v_attempt.vault_secret_id, v_attempt.secret_fingerprint, v_attempt.calendars) as r;
  delete from public.calendar_oauth_attempts a where a.id = v_attempt.id;
  return query select 'ok'::text, v_result.connection_id, v_result.label, v_result.calendar_count;
end $$;

-- ─── Role changes (replaces migration 9's): also drop pending OAuth states and attempts ─
create or replace function private.disconnect_calendars_on_role_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.calendar_connections where membership_id = new.id;
  delete from public.calendar_oauth_attempts where membership_id = new.id;
  delete from public.calendar_oauth_states where membership_id = new.id;
  return null;
end $$;

-- ─── set_calendar_selection (replaces migration 9's): memberships locked before the selection ─
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
  select s.household_id into v_household from public.calendar_selections s where s.id = p_selection_id;
  v_actor := private.my_membership_id(v_household);
  -- Lock order: memberships (the caller's and the new assignee's, by id), then the selection, as end_membership does.
  perform 1 from public.memberships m
  where m.id in (v_actor, p_assigned_membership_id)
  order by m.id
  for share of m;

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

-- ─── Service-role wrappers ───────────────────────────────────────────────
create function public.svc_create_calendar_connection_with_selections(
  p_household_id uuid, p_membership_id uuid, p_provider text, p_label text, p_secret text, p_vault_secret_id uuid,
  p_fingerprint text, p_calendars jsonb
) returns table (connection_id uuid, already_connected boolean, label text, calendar_count int, selection_ids uuid[])
language sql security definer set search_path = '' as $$
  select * from private.create_calendar_connection_with_selections(
    p_household_id, p_membership_id, p_provider, p_label, p_secret, p_vault_secret_id, p_fingerprint, p_calendars)
$$;

create function public.svc_record_calendar_connect_attempt(p_membership_id uuid) returns boolean
language sql security definer set search_path = '' as $$
  select private.record_calendar_connect_attempt(p_membership_id)
$$;

create function public.svc_create_calendar_oauth_attempt(
  p_attempt_hash text, p_household_id uuid, p_membership_id uuid, p_provider text, p_secret text, p_account_label text,
  p_fingerprint text, p_calendars jsonb
) returns uuid
language sql security definer set search_path = '' as $$
  select private.create_calendar_oauth_attempt(
    p_attempt_hash, p_household_id, p_membership_id, p_provider, p_secret, p_account_label, p_fingerprint, p_calendars)
$$;

create function public.svc_peek_calendar_oauth_attempt(p_attempt_hash text) returns uuid
language sql stable security definer set search_path = '' as $$
  select private.peek_calendar_oauth_attempt(p_attempt_hash)
$$;

create function public.svc_finish_calendar_oauth_attempt(p_attempt_hash text, p_membership_id uuid)
returns table (outcome text, connection_id uuid, label text, calendar_count int)
language sql security definer set search_path = '' as $$
  select * from private.finish_calendar_oauth_attempt(p_attempt_hash, p_membership_id)
$$;

-- ─── Grants ──────────────────────────────────────────────────────────────
revoke execute on function
  private.delete_calendar_attempt_vault_secret(),
  private.purge_calendar_oauth_states(),
  private.normalize_calendar_list(jsonb),
  private.create_calendar_connection_with_selections(uuid, uuid, text, text, text, uuid, text, jsonb),
  private.record_calendar_connect_attempt(uuid),
  private.create_calendar_oauth_state(text, text, uuid, uuid, text, text),
  private.create_calendar_oauth_attempt(text, uuid, uuid, text, text, text, text, jsonb),
  private.peek_calendar_oauth_attempt(text),
  private.finish_calendar_oauth_attempt(text, uuid),
  private.disconnect_calendars_on_role_change()
from public, anon, authenticated, service_role;

revoke execute on function
  public.svc_create_calendar_connection_with_selections(uuid, uuid, text, text, text, uuid, text, jsonb),
  public.svc_record_calendar_connect_attempt(uuid),
  public.svc_create_calendar_oauth_attempt(text, uuid, uuid, text, text, text, text, jsonb),
  public.svc_peek_calendar_oauth_attempt(text),
  public.svc_finish_calendar_oauth_attempt(text, uuid)
from public, anon, authenticated;
grant execute on function
  public.svc_create_calendar_connection_with_selections(uuid, uuid, text, text, text, uuid, text, jsonb),
  public.svc_record_calendar_connect_attempt(uuid),
  public.svc_create_calendar_oauth_attempt(text, uuid, uuid, text, text, text, text, jsonb),
  public.svc_peek_calendar_oauth_attempt(text),
  public.svc_finish_calendar_oauth_attempt(text, uuid)
to service_role;
