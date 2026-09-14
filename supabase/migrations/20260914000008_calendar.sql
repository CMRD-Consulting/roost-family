-- ─── Calendars (spec §5.5, §6.2, §6.3, §11.2–§11.3) ──────────────────────
-- An adult connects a calendar account (an ICS subscription link, or a Google / Microsoft OAuth refresh token) and
-- chooses which of its calendars show on the household's displays and whose they are. Event data is never stored:
-- the calendar Edge Functions fetch events on request and keep them in memory only.
--
-- Secrets. The ICS URL or refresh token lives in Supabase Vault. calendar_connections keeps only vault_secret_id,
-- and clients can't select even that: authenticated gets column-level SELECT on every other column (a view would
-- be a second object to keep in step, and the codebase has none). A client query must therefore list its columns;
-- `select('*')` on calendar_connections fails with 42501 rather than returning the id. Realtime applies the same
-- column privileges to change payloads.
--
-- Writes. Clients never write these tables. A full-sign-in adult (private.require_adult: a real, non-anonymous
-- account that isn't a display's device credential) changes their own calendars with set_calendar_selection and
-- disconnect_calendar. The Edge Functions create connections, record discovered calendars, rotate secrets and
-- record provider errors with the service role.
--
-- Service-role helpers. The helpers live in `private`, which config.toml deliberately does not expose to PostgREST
-- (exposing it would publish every internal helper as an endpoint). Each one the Edge Functions need has a thin
-- security-definer `public.svc_*` wrapper that only service_role may execute; anon and authenticated can't.
--
-- Cleanup. Vault secrets have no foreign key to cascade from, so an AFTER DELETE trigger on calendar_connections
-- deletes the secret whenever a connection row goes, whichever way it goes: disconnect_calendar, a member leaving or
-- being removed (private.end_membership, below), delete_household (below, at once, spec §11.3), an account deletion
-- cascading through memberships, and the 30-day household purge cascading through households (so
-- private.purge_deleted_households needs no change). Selections assigned to a member who leaves, or to a child
-- who is removed, become hidden and unassigned.
--
-- Errors: 42501 for authorization and not found (another adult's or another household's calendar, member or child),
-- 22023 for invalid input.

-- ─── Tables ──────────────────────────────────────────────────────────────
-- A selection's child must belong to the selection's household; the composite key makes that a foreign key.
alter table public.child_households add constraint child_households_child_id_household_id_key unique (child_id, household_id);

create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  membership_id uuid not null,
  provider text not null check (provider in ('ics', 'google', 'microsoft')),
  label text not null check (char_length(label) between 1 and 200),
  vault_secret_id uuid not null unique,
  status text not null default 'ok' check (status in ('ok', 'auth_expired', 'unreachable')),
  status_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (membership_id, household_id) references public.memberships (id, household_id) on delete cascade
);
create index on public.calendar_connections (household_id);
create index on public.calendar_connections (membership_id);

-- One row per calendar of a connection. Right after connecting, a calendar is hidden and unassigned; it can be shown
-- only once it belongs to exactly one member or child. `gone` marks a calendar the provider no longer has (a 404 for
-- that one calendar), without failing the whole connection.
create table public.calendar_selections (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  connection_id uuid not null,
  external_calendar_id text not null check (char_length(external_calendar_id) between 1 and 1024),
  name text not null check (char_length(name) between 1 and 200),
  assigned_membership_id uuid,
  assigned_child_id uuid,
  visible boolean not null default false,
  gone boolean not null default false,
  created_at timestamptz not null default now(),
  unique (connection_id, external_calendar_id),
  constraint calendar_selections_one_assignee
    check (num_nonnulls(assigned_membership_id, assigned_child_id) <= 1),
  constraint calendar_selections_visible_needs_assignee
    check (not visible or num_nonnulls(assigned_membership_id, assigned_child_id) = 1),
  foreign key (connection_id, household_id) references public.calendar_connections (id, household_id) on delete cascade,
  foreign key (assigned_membership_id, household_id) references public.memberships (id, household_id)
    on delete set null (assigned_membership_id),
  foreign key (assigned_child_id, household_id) references public.child_households (child_id, household_id)
    on delete set null (assigned_child_id)
);
create index on public.calendar_selections (household_id);
create index on public.calendar_selections (assigned_membership_id);
create index on public.calendar_selections (assigned_child_id);

-- ─── Integrity triggers ──────────────────────────────────────────────────
-- When a selection loses its assignee (the member's or child's row was deleted and the foreign key cleared it), it is
-- hidden too, so the visible-needs-assignee check still holds.
create function private.hide_unassigned_calendar_selection() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.assigned_membership_id is null and new.assigned_child_id is null
     and (old.assigned_membership_id is not null or old.assigned_child_id is not null) then
    new.visible := false;
  end if;
  return new;
end $$;

create trigger hide_unassigned_calendar_selection
  before update of assigned_membership_id, assigned_child_id on public.calendar_selections
  for each row execute function private.hide_unassigned_calendar_selection();

-- Every deleted connection takes its Vault secret with it (see Cleanup above).
create function private.delete_calendar_vault_secret() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets where id = old.vault_secret_id;
  return null;
end $$;

create trigger delete_calendar_vault_secret after delete on public.calendar_connections
  for each row execute function private.delete_calendar_vault_secret();

-- ─── Client access ───────────────────────────────────────────────────────
-- Members and displays read their household's connections (without vault_secret_id) and selections: the Today panel
-- shows whose calendar is which and which need reconnecting. Nothing is written directly.
alter table public.calendar_connections enable row level security;
alter table public.calendar_selections enable row level security;

revoke all on public.calendar_connections, public.calendar_selections from anon, authenticated, service_role;
grant select (id, household_id, membership_id, provider, label, status, status_changed_at, created_at)
  on public.calendar_connections to authenticated;
grant select on public.calendar_selections to authenticated;
-- The Edge Functions read directly and write only through the svc_* wrappers, which keep the secret and row together.
grant select on public.calendar_connections, public.calendar_selections to service_role;

create policy calendar_connections_select on public.calendar_connections for select to authenticated
  using (private.is_household_member(household_id));
create policy calendar_selections_select on public.calendar_selections for select to authenticated
  using (private.is_household_member(household_id));

-- Displays reload when calendars change; DELETE events need the old row's household_id for the filter.
alter table public.calendar_connections replica identity full;
alter table public.calendar_selections replica identity full;
alter publication supabase_realtime add table public.calendar_connections, public.calendar_selections;

-- ─── Private helpers ─────────────────────────────────────────────────────
-- Validates a selection's assignee: at most one; one is required to show it; a member must be active in the
-- household and a child must belong to it (anything else reads as not found).
create function private.require_calendar_assignee(
  p_household_id uuid, p_membership_id uuid, p_child_id uuid, p_visible boolean
) returns void
language plpgsql stable security definer set search_path = '' as $$
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
  ) then
    raise exception 'member not found' using errcode = '42501';
  end if;
  if p_child_id is not null then
    perform private.require_child_of(p_household_id, p_child_id);
  end if;
end $$;

-- Stores a secret in Vault under a unique name (p_name plus a random uuid) and returns its id.
create function private.store_calendar_secret(p_secret text, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if p_secret is null or btrim(p_secret) = '' then
    raise exception 'a calendar secret is required' using errcode = '22023';
  end if;
  if char_length(p_secret) > 8192 then
    raise exception 'a calendar secret must be at most 8192 characters' using errcode = '22023';
  end if;
  return vault.create_secret(
    p_secret,
    coalesce(nullif(btrim(p_name), ''), 'roost_calendar') || '_' || gen_random_uuid()::text,
    'Roost calendar connection secret');
end $$;

-- Replaces a connection's secret in place (Microsoft rotates refresh tokens on every refresh).
create function private.update_calendar_secret(p_connection_id uuid, p_secret text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_secret uuid;
begin
  select c.vault_secret_id into v_secret from public.calendar_connections c where c.id = p_connection_id for update;
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

-- The decrypted secret of a connection whose member is active in a live household, else null.
create function private.calendar_secret(p_connection_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select ds.decrypted_secret
  from public.calendar_connections c
  join public.memberships m on m.id = c.membership_id and m.left_at is null
  join public.households h on h.id = c.household_id and h.deleted_at is null
  join vault.decrypted_secrets ds on ds.id = c.vault_secret_id
  where c.id = p_connection_id
$$;

-- Stores the secret and creates the connection in one transaction, for an active owner or adult of a live household.
-- Audited as the member (the provider only; never the label's source or the secret).
create function private.create_calendar_connection(
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

-- Records one calendar of a connection. New calendars take p_visible and the assignee (validated as in
-- set_calendar_selection; p_visible null means hidden). Re-recording a calendar the connection already has updates
-- only its name and clears `gone`, keeping the adult's visibility and assignment. A blank name becomes 'Calendar';
-- long names are cut to 200 characters. Returns the selection id.
create function private.add_calendar_selection(
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
  select c.household_id into v_household from public.calendar_connections c where c.id = p_connection_id for update;
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

-- status_changed_at moves only when the status actually changes.
create function private.set_calendar_status(p_connection_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status is null or p_status not in ('ok', 'auth_expired', 'unreachable') then
    raise exception 'calendar status must be ok, auth_expired or unreachable' using errcode = '22023';
  end if;
  update public.calendar_connections
  set status = p_status,
      status_changed_at = case when status is distinct from p_status then now() else status_changed_at end
  where id = p_connection_id;
  if not found then
    raise exception 'calendar connection not found' using errcode = '42501';
  end if;
end $$;

create function private.set_calendar_selection_gone(p_selection_id uuid, p_gone boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_gone is null then
    raise exception 'gone is required' using errcode = '22023';
  end if;
  update public.calendar_selections set gone = p_gone where id = p_selection_id;
  if not found then
    raise exception 'calendar not found' using errcode = '42501';
  end if;
end $$;

-- ─── Service-role wrappers (Edge Functions only) ─────────────────────────
create function public.svc_create_calendar_connection(
  p_household_id uuid, p_membership_id uuid, p_provider text, p_label text, p_secret text
) returns uuid
language sql security definer set search_path = '' as $$
  select private.create_calendar_connection(p_household_id, p_membership_id, p_provider, p_label, p_secret)
$$;

create function public.svc_add_calendar_selection(
  p_connection_id uuid, p_external_calendar_id text, p_name text, p_visible boolean,
  p_assigned_membership_id uuid, p_assigned_child_id uuid
) returns uuid
language sql security definer set search_path = '' as $$
  select private.add_calendar_selection(
    p_connection_id, p_external_calendar_id, p_name, p_visible, p_assigned_membership_id, p_assigned_child_id)
$$;

create function public.svc_calendar_secret(p_connection_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select private.calendar_secret(p_connection_id)
$$;

create function public.svc_update_calendar_secret(p_connection_id uuid, p_secret text) returns void
language sql security definer set search_path = '' as $$
  select private.update_calendar_secret(p_connection_id, p_secret)
$$;

create function public.svc_set_calendar_status(p_connection_id uuid, p_status text) returns void
language sql security definer set search_path = '' as $$
  select private.set_calendar_status(p_connection_id, p_status)
$$;

create function public.svc_set_calendar_selection_gone(p_selection_id uuid, p_gone boolean) returns void
language sql security definer set search_path = '' as $$
  select private.set_calendar_selection_gone(p_selection_id, p_gone)
$$;

-- ─── RPCs (full sign-in adult, own calendars only) ───────────────────────
-- Shows or hides one of the caller's calendars and sets whose it is (a member or a child of the same household).
create function public.set_calendar_selection(
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
  if v_household is null or v_actor is null or v_owner <> v_actor then
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

-- Disconnects one of the caller's calendar accounts: the connection and its selections go, and the trigger deletes
-- the Vault secret.
create function public.disconnect_calendar(p_connection_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid;
  v_owner uuid;
  v_provider text;
  v_actor uuid;
begin
  perform private.require_adult();
  select c.household_id, c.membership_id, c.provider into v_household, v_owner, v_provider
  from public.calendar_connections c where c.id = p_connection_id
  for update;
  v_actor := private.my_membership_id(v_household);
  if v_household is null or v_actor is null or v_owner <> v_actor then
    raise exception 'calendar not found' using errcode = '42501';
  end if;
  delete from public.calendar_connections where id = p_connection_id;
  perform private.audit_setting(v_household, v_actor, 'calendars', 'disconnect', p_connection_id,
    jsonb_build_object('provider', v_provider));
end $$;

-- ═══ Members and household deletion disconnect calendars (spec §6.2, §11.3) ═══

-- ─── end_membership (replaces migration 3's) ─────────────────────────────
-- Used by remove_member and leave_household. As before, plus the member's calendars disconnect at once (their Vault
-- secrets go with the rows) and calendars assigned to them become hidden and unassigned.
create or replace function private.end_membership(p_membership_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.memberships set left_at = now() where id = p_membership_id;
  delete from public.member_pins where membership_id = p_membership_id;
  delete from public.calendar_connections where membership_id = p_membership_id;
  update public.calendar_selections set assigned_membership_id = null, visible = false
  where assigned_membership_id = p_membership_id;
$$;

-- ─── delete_household (replaces migration 7's): calendars disconnect at once ─
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
  delete from public.calendar_connections where household_id = p_household_id;

  perform private.audit_setting(p_household_id, v_actor, 'household', 'delete', p_household_id,
    jsonb_build_object('name', v_name));
end $$;

-- ─── Grants ──────────────────────────────────────────────────────────────
revoke execute on function
  private.hide_unassigned_calendar_selection(),
  private.delete_calendar_vault_secret(),
  private.require_calendar_assignee(uuid, uuid, uuid, boolean),
  private.store_calendar_secret(text, text),
  private.update_calendar_secret(uuid, text),
  private.calendar_secret(uuid),
  private.create_calendar_connection(uuid, uuid, text, text, text),
  private.add_calendar_selection(uuid, text, text, boolean, uuid, uuid),
  private.set_calendar_status(uuid, text),
  private.set_calendar_selection_gone(uuid, boolean),
  private.end_membership(uuid)
from public, anon, authenticated, service_role;

revoke execute on function
  public.svc_create_calendar_connection(uuid, uuid, text, text, text),
  public.svc_add_calendar_selection(uuid, text, text, boolean, uuid, uuid),
  public.svc_calendar_secret(uuid),
  public.svc_update_calendar_secret(uuid, text),
  public.svc_set_calendar_status(uuid, text),
  public.svc_set_calendar_selection_gone(uuid, boolean)
from public, anon, authenticated;
grant execute on function
  public.svc_create_calendar_connection(uuid, uuid, text, text, text),
  public.svc_add_calendar_selection(uuid, text, text, boolean, uuid, uuid),
  public.svc_calendar_secret(uuid),
  public.svc_update_calendar_secret(uuid, text),
  public.svc_set_calendar_status(uuid, text),
  public.svc_set_calendar_selection_gone(uuid, boolean)
to service_role;

revoke execute on function
  public.set_calendar_selection(uuid, boolean, uuid, uuid),
  public.disconnect_calendar(uuid),
  public.delete_household(uuid, text)
from public, anon;
grant execute on function
  public.set_calendar_selection(uuid, boolean, uuid, uuid),
  public.disconnect_calendar(uuid),
  public.delete_household(uuid, text)
to authenticated;
