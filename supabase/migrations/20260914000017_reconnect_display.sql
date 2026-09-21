-- ─── Reconnect and sign out a display (spec §6.4, §7.9) ─────────────────
-- A display is a row of public.displays bound to one anonymous device user (auth_user_id). A tablet that loses that
-- session (cleared browser data, a kiosk reset, a reinstall) comes back as a new anonymous user, and the only way in
-- was register_display: a new row, a new name, one more of the household's 3, while the old row stayed bound to a
-- user nobody can sign in as again, with every entry that names it (display_id) pointing at a ghost.
--
-- reconnect_display puts an existing row back into the state register_display leaves a new one in — unbound, with a
-- 10-minute claim — so the tablet's unchanged claim_display binds it to the same display. sign_out_display_pin is
-- the deliberate way into that state from the tablet itself.

-- ─── Reconnect (account-authenticated: the tablet has no household yet, so there is no PIN to check) ─────────────
-- Mirrors register_display: an owner's full sign-in, the household locked for the limit check, a hashed token that
-- expires in 10 minutes. Whatever device held the display stops being it at once: its heartbeat answers false and it
-- shows "This display was removed", so one display is never two tablets. Every refusal reads the same, so display
-- ids cannot be probed.
create function public.reconnect_display(p_display_id uuid)
returns table (out_claim_token text)
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid;
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  perform private.require_adult();
  select d.household_id into v_household
  from public.displays d
  join public.households h on h.id = d.household_id and h.deleted_at is null
  where d.id = p_display_id and d.revoked_at is null;
  if v_household is null or not private.is_household_owner(v_household) then
    raise exception 'display not found' using errcode = '42501';
  end if;

  -- Lock order: the household, then the display, as register_display and claim_display do.
  perform 1 from public.households where id = v_household for update;
  perform 1 from public.displays where id = p_display_id and revoked_at is null for update;
  if not found then
    raise exception 'display not found' using errcode = '42501';
  end if;

  -- register_display counts a display while it is bound or has a live claim. One that is neither (signed out, or a
  -- reconnect that was never finished) stopped counting, so bringing it back must not make a fourth.
  if (
    select count(*) from public.displays d
    where d.household_id = v_household and d.revoked_at is null and d.id <> p_display_id
      and (d.auth_user_id is not null
           or exists (select 1 from public.display_claims c where c.display_id = d.id and c.expires_at > now()))
  ) >= 3 then
    raise exception 'a household can have at most 3 displays' using errcode = '22023';
  end if;

  update public.displays set auth_user_id = null where id = p_display_id;
  insert into public.display_claims (display_id, token_hash, expires_at)
  values (p_display_id, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '10 minutes')
  on conflict (display_id) do update set token_hash = excluded.token_hash, expires_at = excluded.expires_at;

  perform private.audit_setting(v_household, private.my_membership_id(v_household), 'displays', 'reconnect', p_display_id, null);
  return query select v_token;
end $$;

-- ─── Sign out (PIN-authorised, like every Settings action on a display) ──
-- Only ever the display the call comes from: there is no display id to name. Signing another tablet out is what
-- revoke_display_pin and reconnect_display are for. The row, its name and its history stay; it stops counting
-- towards the limit until it is reconnected.
create function public.sign_out_display_pin(p_membership_id uuid, p_pin text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.require_settings_owner(p_membership_id, p_pin);
  v_display uuid;
begin
  update public.displays set auth_user_id = null
  where auth_user_id = auth.uid() and household_id = v_household and revoked_at is null
  returning id into v_display;
  if v_display is null then
    raise exception 'this device is not a display' using errcode = '22023';
  end if;
  delete from public.display_claims where display_id = v_display;
  perform private.audit_setting(v_household, p_membership_id, 'displays', 'sign_out', v_display, null);
end $$;

-- ─── Grants ──────────────────────────────────────────────────────────────
revoke execute on function public.reconnect_display(uuid), public.sign_out_display_pin(uuid, text) from public, anon;
grant execute on function public.reconnect_display(uuid), public.sign_out_display_pin(uuid, text) to authenticated;
