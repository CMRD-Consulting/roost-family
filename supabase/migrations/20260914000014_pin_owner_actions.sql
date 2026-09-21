-- ─── PIN-authorised owner actions (spec §6.3, §7.9) ─────────────────────
-- On a display, the adult PIN that opened Settings authorises every Settings action, including members,
-- displays and deleting the household. Those actions used to need a second, email-code sign-in, which a
-- one-owner household had to repeat for each section; the PIN is what the tablet has.
--
-- These RPCs mirror the account-authenticated ones one for one, keeping every rule of the original and only
-- swapping how the caller is authenticated: (p_membership_id, p_pin) like every other settings RPC, verified
-- by private.require_settings_owner (which re-uses private.pin_ok, and so its wrong-PIN delay). The account
-- versions stay as they are: /manage runs in a browser, where an adult has no PIN pad.

-- ─── Private helper ──────────────────────────────────────────────────────
-- Like private.require_settings_pin, but the PIN's membership must be an *owner*: returns its household, or
-- raises 42501 (wrong PIN, not an owner, another household's membership, or a deleted household). The caller's
-- own session must belong to that household too, so a revoked display — which is no longer a member — is refused.
create function private.require_settings_owner(p_membership_id uuid, p_pin text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_household uuid;
begin
  select m.household_id into v_household
  from public.memberships m
  join public.households h on h.id = m.household_id and h.deleted_at is null
  where m.id = p_membership_id and m.role = 'owner' and m.left_at is null;
  if v_household is null
     or not private.is_household_member(v_household)
     or not private.pin_ok(p_membership_id, p_pin) then
    raise exception 'incorrect PIN' using errcode = '42501';
  end if;
  return v_household;
end $$;

-- ─── Invites (mirrors create_member_invite) ──────────────────────────────
create function public.create_member_invite_pin(p_membership_id uuid, p_pin text, p_role text)
returns table (out_token text, out_expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.require_settings_owner(p_membership_id, p_pin);
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
  v_invite uuid;
  v_expires_at timestamptz := now() + interval '10 minutes';
begin
  if p_role is null or p_role not in ('owner', 'adult') then
    raise exception 'role must be owner or adult' using errcode = '22023';
  end if;
  delete from public.member_invites where household_id = v_household and used_at is null and expires_at <= now();
  insert into public.member_invites (household_id, role, token_hash, expires_at, created_by)
  values (v_household, p_role, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_expires_at, p_membership_id)
  returning id into v_invite;
  perform private.audit_setting(v_household, p_membership_id, 'members', 'invite', v_invite,
    jsonb_build_object('role', p_role));
  return query select v_token, v_expires_at;
end $$;

-- ─── Cancelling an invite (mirrors revoke_member_invite) ─────────────────
-- The token-only revoke_member_invite stays: the new adult cancels the hand-off after Settings has closed, so
-- there is no PIN to check by then. This one is for cancelling while Settings is still open, and only within
-- the owner's own household. An unknown or used token is a quiet no-op, as before.
create function public.revoke_member_invite_pin(p_membership_id uuid, p_pin text, p_invite_token text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.require_settings_owner(p_membership_id, p_pin);
  v_invite uuid;
begin
  if p_invite_token is null then
    return;
  end if;
  delete from public.member_invites
  where token_hash = encode(extensions.digest(p_invite_token, 'sha256'), 'hex')
    and used_at is null and household_id = v_household
  returning id into v_invite;
  if v_invite is not null then
    perform private.audit_setting(v_household, p_membership_id, 'members', 'invite_cancel', v_invite, null);
  end if;
end $$;

-- ─── Roles (mirrors set_member_role) ─────────────────────────────────────
create function public.set_member_role_pin(p_membership_id uuid, p_pin text, p_target_id uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.require_settings_owner(p_membership_id, p_pin);
  v_target_household uuid;
  v_role text;
begin
  -- The household row is locked first (as set_member_role does) so concurrent role changes and removals serialize.
  select m.household_id into v_target_household from public.memberships m where m.id = p_target_id and m.left_at is null;
  if v_target_household is null or v_target_household <> v_household then
    raise exception 'only an owner can change roles' using errcode = '42501';
  end if;
  perform 1 from public.households h where h.id = v_household for update;
  select m.role into v_role from public.memberships m where m.id = p_target_id and m.left_at is null;
  if v_role is null then
    raise exception 'only an owner can change roles' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('owner', 'adult') then
    raise exception 'role must be owner or adult' using errcode = '22023';
  end if;
  if v_role = 'owner' and p_role <> 'owner' then
    perform private.require_other_owner(v_household, p_target_id);
  end if;
  update public.memberships set role = p_role where id = p_target_id;
  perform private.audit_setting(v_household, p_membership_id, 'members', 'role', p_target_id,
    jsonb_build_object('role', p_role));
end $$;

-- ─── Removal (mirrors remove_member) ─────────────────────────────────────
create function public.remove_member_pin(p_membership_id uuid, p_pin text, p_target_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.require_settings_owner(p_membership_id, p_pin);
  v_target_household uuid;
  v_role text;
begin
  select m.household_id into v_target_household from public.memberships m where m.id = p_target_id and m.left_at is null;
  if v_target_household is null or v_target_household <> v_household then
    raise exception 'only an owner can remove a member' using errcode = '42501';
  end if;
  perform 1 from public.households h where h.id = v_household for update;
  select m.role into v_role from public.memberships m where m.id = p_target_id and m.left_at is null;
  if v_role is null then
    raise exception 'only an owner can remove a member' using errcode = '42501';
  end if;
  if v_role = 'owner' then
    perform private.require_other_owner(v_household, p_target_id);
  end if;
  perform private.end_membership(p_target_id);
  perform private.audit_setting(v_household, p_membership_id, 'members', 'remove', p_target_id, null);
end $$;

-- ─── Displays (mirror rename_display and revoke_display) ─────────────────
create function public.rename_display_pin(p_membership_id uuid, p_pin text, p_display_id uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.require_settings_owner(p_membership_id, p_pin);
  v_display_household uuid;
  v_name text := btrim(p_name);
begin
  select d.household_id into v_display_household from public.displays d where d.id = p_display_id;
  if v_display_household is null or v_display_household <> v_household then
    raise exception 'only an owner can rename a display' using errcode = '42501';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 40 then
    raise exception 'display name must be 1 to 40 characters' using errcode = '22023';
  end if;
  update public.displays set name = v_name where id = p_display_id;
  perform private.audit_setting(v_household, p_membership_id, 'displays', 'rename', p_display_id,
    jsonb_build_object('name', v_name));
end $$;

create function public.revoke_display_pin(p_membership_id uuid, p_pin text, p_display_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.require_settings_owner(p_membership_id, p_pin);
  v_display_household uuid;
begin
  select d.household_id into v_display_household from public.displays d where d.id = p_display_id;
  if v_display_household is null or v_display_household <> v_household then
    raise exception 'only an owner can remove a display' using errcode = '42501';
  end if;
  update public.displays set revoked_at = now() where id = p_display_id and revoked_at is null;
  delete from public.display_claims where display_id = p_display_id;
  perform private.audit_setting(v_household, p_membership_id, 'displays', 'revoke', p_display_id, null);
end $$;

-- ─── Household deletion (mirrors delete_household, spec §11.3) ───────────
-- The typed household name is still required; the PIN replaces the email-code sign-in, nothing else.
create function public.delete_household_pin(p_membership_id uuid, p_pin text, p_confirm_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.require_settings_owner(p_membership_id, p_pin);
  v_name text;
begin
  select h.name into v_name from public.households h where h.id = v_household and h.deleted_at is null for update;
  if v_name is null then
    raise exception 'only an owner can delete the household' using errcode = '42501';
  end if;
  if p_confirm_name is null or btrim(p_confirm_name) <> btrim(v_name) then
    raise exception 'type the household name exactly to confirm' using errcode = '22023';
  end if;

  update public.households set deleted_at = now() where id = v_household;
  update public.displays set revoked_at = now() where household_id = v_household and revoked_at is null;
  delete from public.display_claims c using public.displays d where d.id = c.display_id and d.household_id = v_household;
  delete from public.member_invites where household_id = v_household;
  delete from public.member_pins p using public.memberships m where m.id = p.membership_id and m.household_id = v_household;
  update public.take_list_links set revoked_at = now() where household_id = v_household and revoked_at is null;
  delete from public.calendar_connections where household_id = v_household;

  perform private.audit_setting(v_household, p_membership_id, 'household', 'delete', v_household,
    jsonb_build_object('name', v_name));
end $$;

-- ─── Grants ──────────────────────────────────────────────────────────────
revoke execute on function private.require_settings_owner(uuid, text) from public, anon, authenticated;

revoke execute on function
  public.create_member_invite_pin(uuid, text, text),
  public.revoke_member_invite_pin(uuid, text, text),
  public.set_member_role_pin(uuid, text, uuid, text),
  public.remove_member_pin(uuid, text, uuid),
  public.rename_display_pin(uuid, text, uuid, text),
  public.revoke_display_pin(uuid, text, uuid),
  public.delete_household_pin(uuid, text, text)
from public, anon;

grant execute on function
  public.create_member_invite_pin(uuid, text, text),
  public.revoke_member_invite_pin(uuid, text, text),
  public.set_member_role_pin(uuid, text, uuid, text),
  public.remove_member_pin(uuid, text, uuid),
  public.rename_display_pin(uuid, text, uuid, text),
  public.revoke_display_pin(uuid, text, uuid),
  public.delete_household_pin(uuid, text, text)
to authenticated;
