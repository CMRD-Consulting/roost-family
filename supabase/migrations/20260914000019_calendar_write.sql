-- ═══ Adding an event to a connected calendar (spec §5.5, §6.3, §7.2, §11.2) ═══
-- An adult can now add an event from Roost, and it lands in their real Google or Microsoft calendar. Roost still
-- stores no event data: `calendar-create-event` posts it to the provider, and the normal feed shows it afterwards.
--
-- 1. calendar_connections.can_write. Writing needs a scope the account granted, and **existing connections keep the
--    grant they already have** — Google's `calendar.readonly` and Microsoft's `Calendars.Read` cannot create an
--    event. The Edge Functions read the granted scopes off the token response at connect time and record the answer
--    here, so nothing has to be guessed later and no adult is offered a button that would fail. Default false: every
--    connection made before this migration is read-only until its owner connects the account again. ICS is never
--    writable (a subscription link is one-way), and that is enforced here, not only in the function.
--    Clients may read it (it decides what the tablet offers), so it joins the column grants.
-- 2. calendar_connections.events_changed_at. The events function caches a connection's events in the memory of
--    whichever isolate served the request, for 5 minutes. A new event is written by a *different* function, in a
--    different isolate, so there is no shared memory to clear: instead the write bumps this column, the events
--    function reads it with the connection and mixes it into its cache key, and every isolate's entry for that
--    connection misses at once. Also readable by clients (it is not a secret; it says nothing but "something
--    changed").
-- 3. A separate rate limit for adding events. calendar_connect_attempts gains `kind`, so adding an event does not
--    eat the hourly budget for connecting ICS links, and private.record_calendar_attempt serves both.
-- 4. Auditing. A created event is a settings change like any other, so it appends a `settings_audit` row through
--    private.audit_setting — recording the connection and selection only, never the title or the location.
--    private.record_calendar_event_created does the audit and the cache bump in one transaction.
--
-- Errors keep the house codes: 42501 for authorization and not found, 22023 for invalid input.

-- ─── 1. can_write, and 2. events_changed_at ──────────────────────────────
alter table public.calendar_connections
  add column can_write boolean not null default false,
  add column events_changed_at timestamptz not null default now(),
  -- A subscription link is read-only, whatever a caller claims.
  add constraint calendar_connections_ics_is_read_only check (provider <> 'ics' or not can_write);

grant select (can_write, events_changed_at) on public.calendar_connections to authenticated;

-- The pending OAuth attempt carries the answer from the callback (where the token response is) to the finish call
-- (where the connection is created).
alter table public.calendar_oauth_attempts add column can_write boolean not null default false;

-- ─── 3. One attempt log, two limits ──────────────────────────────────────
alter table public.calendar_connect_attempts
  add column kind text not null default 'connect' check (kind in ('connect', 'create_event'));
create index on public.calendar_connect_attempts (membership_id, kind, created_at);

-- At most p_limit attempts of this kind by this member in the last hour; false (and nothing recorded) past it.
create function private.record_calendar_attempt(p_membership_id uuid, p_kind text, p_limit int) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_membership_id is null then
    raise exception 'membership is required' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('connect', 'create_event') then
    raise exception 'attempt kind must be connect or create_event' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('roost_calendar_attempt:' || p_kind || ':' || p_membership_id::text, 0));
  delete from public.calendar_connect_attempts a
  where a.membership_id = p_membership_id and a.created_at < now() - interval '1 hour';
  if (select count(*) from public.calendar_connect_attempts a
      where a.membership_id = p_membership_id and a.kind = p_kind) >= p_limit then
    return false;
  end if;
  insert into public.calendar_connect_attempts (membership_id, kind) values (p_membership_id, p_kind);
  return true;
end $$;

-- Replaces migration 11's: same 10 ICS connects an hour, now counted per kind.
create or replace function private.record_calendar_connect_attempt(p_membership_id uuid) returns boolean
language sql security definer set search_path = '' as $$
  select private.record_calendar_attempt(p_membership_id, 'connect', 10)
$$;

-- Adding an event is an everyday action, so its limit is higher than connecting an account.
create function private.record_calendar_event_attempt(p_membership_id uuid) returns boolean
language sql security definer set search_path = '' as $$
  select private.record_calendar_attempt(p_membership_id, 'create_event', 30)
$$;

-- ─── 4. A created event: audited, and the events cache invalidated ───────
-- Called by calendar-create-event after the provider accepted the event. The membership must own the connection and
-- be an active owner or adult of the live household the selection belongs to — the same rule the function already
-- checked, re-checked here so the audit row can never name someone else.
create function private.record_calendar_event_created(p_membership_id uuid, p_selection_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid;
  v_connection uuid;
begin
  select s.household_id, c.id into v_household, v_connection
  from public.calendar_selections s
  join public.calendar_connections c on c.id = s.connection_id
  join public.memberships m on m.id = c.membership_id and m.left_at is null and m.role in ('owner', 'adult')
  join public.households h on h.id = c.household_id and h.deleted_at is null
  where s.id = p_selection_id and c.membership_id = p_membership_id
  for update of c;
  if v_household is null then
    raise exception 'calendar not found' using errcode = '42501';
  end if;

  update public.calendar_connections set events_changed_at = now() where id = v_connection;
  -- The selection and connection only: a title or a location would be event data, which Roost never stores (§11.2).
  perform private.audit_setting(v_household, p_membership_id, 'calendars', 'create_event', p_selection_id,
    jsonb_build_object('connection_id', v_connection));
end $$;

-- ─── Connections remember what they may do ───────────────────────────────
-- Replaces migration 11's create_calendar_connection_with_selections, with p_can_write. Everything else is as it
-- was; an ICS connection is forced read-only, and an OAuth account that connects again takes the grant it just gave
-- (so re-consenting with only the old read-only scopes correctly turns writing off again).
drop function public.svc_create_calendar_connection_with_selections(uuid, uuid, text, text, text, uuid, text, jsonb);
drop function private.create_calendar_connection_with_selections(uuid, uuid, text, text, text, uuid, text, jsonb);

create function private.create_calendar_connection_with_selections(
  p_household_id uuid, p_membership_id uuid, p_provider text, p_label text, p_secret text, p_vault_secret_id uuid,
  p_fingerprint text, p_calendars jsonb, p_can_write boolean
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
  v_can_write boolean := coalesce(p_can_write, false) and p_provider <> 'ics';
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
        status_changed_at = case when c.status <> 'ok' then now() else c.status_changed_at end,
        -- The grant just given, which may be narrower than last time.
        can_write = v_can_write,
        events_changed_at = case when c.can_write is distinct from v_can_write then now() else c.events_changed_at end
    where c.id = v_existing.id;
    v_connection := v_existing.id;
    v_label := v_existing.label;
    perform private.audit_setting(p_household_id, p_membership_id, 'calendars', 'reconnect', v_connection,
      jsonb_build_object('provider', p_provider, 'can_write', v_can_write));
  else
    if p_vault_secret_id is not null then
      -- The attempt's secret becomes the connection's (same id), under a connection secret name.
      perform vault.update_secret(p_vault_secret_id, v_secret, 'roost_calendar_' || p_provider || '_' || gen_random_uuid()::text);
    end if;
    insert into public.calendar_connections
      (household_id, membership_id, provider, label, vault_secret_id, secret_fingerprint, can_write)
    values (p_household_id, p_membership_id, p_provider, v_label,
      coalesce(p_vault_secret_id, private.store_calendar_secret(v_secret, 'roost_calendar_' || p_provider)), p_fingerprint, v_can_write)
    returning id into v_connection;
    perform private.audit_setting(p_household_id, p_membership_id, 'calendars', 'connect', v_connection,
      jsonb_build_object('provider', p_provider, 'can_write', v_can_write));
  end if;

  for v_item in select e.value from jsonb_array_elements(v_calendars) as e loop
    v_ids := v_ids || private.add_calendar_selection(v_connection, v_item ->> 'id', v_item ->> 'name', false, null, null);
  end loop;

  return query select v_connection, v_existing.id is not null, v_label,
    (select count(*)::int from public.calendar_selections s where s.connection_id = v_connection), v_ids;
end $$;

-- ─── The pending attempt carries the grant ───────────────────────────────
-- Replaces migration 11's, with p_can_write.
drop function public.svc_create_calendar_oauth_attempt(text, uuid, uuid, text, text, text, text, jsonb);
drop function private.create_calendar_oauth_attempt(text, uuid, uuid, text, text, text, text, jsonb);

create function private.create_calendar_oauth_attempt(
  p_attempt_hash text, p_household_id uuid, p_membership_id uuid, p_provider text, p_secret text, p_account_label text,
  p_fingerprint text, p_calendars jsonb, p_can_write boolean
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
    (attempt_hash, household_id, membership_id, provider, vault_secret_id, account_label, secret_fingerprint, calendars, can_write)
  values (p_attempt_hash, p_household_id, p_membership_id, p_provider,
    private.store_calendar_secret(p_secret, 'roost_calendar_attempt_' || p_provider), v_label, p_fingerprint, v_calendars,
    coalesce(p_can_write, false))
  returning id into v_id;
  return v_id;
end $$;

-- Replaces migration 11's: passes the attempt's grant into the connection.
create or replace function private.finish_calendar_oauth_attempt(p_attempt_hash text, p_membership_id uuid)
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
    null, v_attempt.vault_secret_id, v_attempt.secret_fingerprint, v_attempt.calendars, v_attempt.can_write) as r;
  delete from public.calendar_oauth_attempts a where a.id = v_attempt.id;
  return query select 'ok'::text, v_result.connection_id, v_result.label, v_result.calendar_count;
end $$;

-- ─── Service-role wrappers (Edge Functions only) ─────────────────────────
create function public.svc_create_calendar_connection_with_selections(
  p_household_id uuid, p_membership_id uuid, p_provider text, p_label text, p_secret text, p_vault_secret_id uuid,
  p_fingerprint text, p_calendars jsonb, p_can_write boolean
) returns table (connection_id uuid, already_connected boolean, label text, calendar_count int, selection_ids uuid[])
language sql security definer set search_path = '' as $$
  select * from private.create_calendar_connection_with_selections(
    p_household_id, p_membership_id, p_provider, p_label, p_secret, p_vault_secret_id, p_fingerprint, p_calendars, p_can_write)
$$;

create function public.svc_create_calendar_oauth_attempt(
  p_attempt_hash text, p_household_id uuid, p_membership_id uuid, p_provider text, p_secret text, p_account_label text,
  p_fingerprint text, p_calendars jsonb, p_can_write boolean
) returns uuid
language sql security definer set search_path = '' as $$
  select private.create_calendar_oauth_attempt(
    p_attempt_hash, p_household_id, p_membership_id, p_provider, p_secret, p_account_label, p_fingerprint, p_calendars, p_can_write)
$$;

create function public.svc_record_calendar_event_attempt(p_membership_id uuid) returns boolean
language sql security definer set search_path = '' as $$
  select private.record_calendar_event_attempt(p_membership_id)
$$;

create function public.svc_record_calendar_event_created(p_membership_id uuid, p_selection_id uuid) returns void
language sql security definer set search_path = '' as $$
  select private.record_calendar_event_created(p_membership_id, p_selection_id)
$$;

-- ─── Grants ──────────────────────────────────────────────────────────────
revoke execute on function
  private.record_calendar_attempt(uuid, text, int),
  private.record_calendar_event_attempt(uuid),
  private.record_calendar_event_created(uuid, uuid),
  private.create_calendar_connection_with_selections(uuid, uuid, text, text, text, uuid, text, jsonb, boolean),
  private.create_calendar_oauth_attempt(text, uuid, uuid, text, text, text, text, jsonb, boolean)
from public, anon, authenticated, service_role;

revoke execute on function
  public.svc_create_calendar_connection_with_selections(uuid, uuid, text, text, text, uuid, text, jsonb, boolean),
  public.svc_create_calendar_oauth_attempt(text, uuid, uuid, text, text, text, text, jsonb, boolean),
  public.svc_record_calendar_event_attempt(uuid),
  public.svc_record_calendar_event_created(uuid, uuid)
from public, anon, authenticated;
grant execute on function
  public.svc_create_calendar_connection_with_selections(uuid, uuid, text, text, text, uuid, text, jsonb, boolean),
  public.svc_create_calendar_oauth_attempt(text, uuid, uuid, text, text, text, text, jsonb, boolean),
  public.svc_record_calendar_event_attempt(uuid),
  public.svc_record_calendar_event_created(uuid, uuid)
to service_role;

-- Default privileges hand anon a grant on every new table; these are not new tables, but the columns are new.
revoke all on public.calendar_connections, public.calendar_oauth_attempts, public.calendar_connect_attempts from anon;
