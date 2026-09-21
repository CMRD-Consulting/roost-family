-- ─── PIN-authorised calendar actions (spec §5.5, §6.3, §7.9) ────────────
-- Managing calendars on a display used to need a second, email-code sign-in on top of the PIN that opened Settings
-- (migration 14 removed the same second sign-in from Members, Displays and Delete household). A display's session is
-- anonymous, so private.require_adult() can never be satisfied there; the PIN is what the tablet has.
--
-- These RPCs mirror the account-authenticated ones one for one, keeping every rule of the original and only swapping
-- how the caller is authenticated: (p_membership_id, p_pin, …) like every other settings RPC, verified by
-- private.require_settings_pin (which re-uses private.pin_ok, and so its wrong-PIN delay, and already requires an
-- active owner or adult of a live household that the caller's own session belongs to — which excludes a revoked
-- display). The acting membership is that PIN's membership, never one named in a request.
--
-- The account versions stay as they are: /manage runs in a browser, where an adult has no PIN pad. Google and
-- Microsoft still connect only from /manage, so calendar-oauth-start and calendar-oauth-finish gain no PIN twin.

-- ─── Show and assign (mirrors set_calendar_selection, migration 11's version) ─
-- Own connections only, an assignee of the same household, a shown calendar needs exactly one person, same audit row.
create function public.set_calendar_selection_pin(
  p_membership_id uuid, p_pin text, p_selection_id uuid, p_visible boolean,
  p_assigned_membership_id uuid, p_assigned_child_id uuid
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.require_settings_pin(p_membership_id, p_pin);
  v_actor uuid := p_membership_id;
  v_selection_household uuid;
  v_owner uuid;
begin
  -- Lock order: memberships (the caller's and the new assignee's, by id), then the selection, as end_membership does.
  perform 1 from public.memberships m
  where m.id in (v_actor, p_assigned_membership_id)
  order by m.id
  for share of m;

  select s.household_id, c.membership_id into v_selection_household, v_owner
  from public.calendar_selections s
  join public.calendar_connections c on c.id = s.connection_id
  where s.id = p_selection_id
  for update of s;
  if v_selection_household is null or v_selection_household <> v_household or v_owner <> v_actor then
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

-- ─── Disconnect (mirrors disconnect_calendar) ────────────────────────────
-- The connection and its selections go, and the trigger deletes its Vault secret. Own connections only.
create function public.disconnect_calendar_pin(p_membership_id uuid, p_pin text, p_connection_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.require_settings_pin(p_membership_id, p_pin);
  v_actor uuid := p_membership_id;
  v_connection_household uuid;
  v_owner uuid;
  v_provider text;
begin
  select c.household_id, c.membership_id, c.provider into v_connection_household, v_owner, v_provider
  from public.calendar_connections c where c.id = p_connection_id
  for update;
  if v_connection_household is null or v_connection_household <> v_household or v_owner <> v_actor then
    raise exception 'calendar not found' using errcode = '42501';
  end if;
  delete from public.calendar_connections where id = p_connection_id;
  perform private.audit_setting(v_household, v_actor, 'calendars', 'disconnect', p_connection_id,
    jsonb_build_object('provider', v_provider));
end $$;

-- ─── Connecting a link from a display (for calendar-connect-ics) ─────────
-- The PIN twin of my_calendar_membership: calendar-connect-ics calls it with the display's own JWT instead of
-- requiring a full sign-in adult, and creates the connection for the membership it returns — never for one named in
-- the request body. Raises 42501 for a wrong PIN, a caregiver, a membership of another household, a deleted
-- household, or a caller (e.g. a revoked display) that is not a member of that household.
create function public.calendar_pin_membership(p_membership_id uuid, p_pin text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_settings_pin(p_membership_id, p_pin);
  return p_membership_id;
end $$;

-- ─── Grants ──────────────────────────────────────────────────────────────
revoke execute on function
  public.set_calendar_selection_pin(uuid, text, uuid, boolean, uuid, uuid),
  public.disconnect_calendar_pin(uuid, text, uuid),
  public.calendar_pin_membership(uuid, text)
from public, anon;

grant execute on function
  public.set_calendar_selection_pin(uuid, text, uuid, boolean, uuid, uuid),
  public.disconnect_calendar_pin(uuid, text, uuid),
  public.calendar_pin_membership(uuid, text)
to authenticated;
