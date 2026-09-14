-- ─── Take list (spec §7.8) ───────────────────────────────────────────────
-- A 24-hour private link that carries the grocery list to a phone. The token (32 random bytes, base64url) is
-- returned once, to the display that asked for it, and only its SHA-256 hash is stored. The phone page calls the
-- token RPCs with the anon key: each one looks the link up by hash and requires it to be unexpired, unrevoked and
-- in a live household. Only grocery items are ever returned, and the page can check items off but not add or
-- delete them. One active link per household: creating a link revokes the previous one.

-- take_list_links is reachable only through the RPCs below (it was member-readable before).
drop policy take_list_links_select on public.take_list_links;
revoke all on public.take_list_links from anon, authenticated;

-- At most one unrevoked link per household (create_take_list_link revokes the others first, under a lock).
create unique index take_list_links_one_active_per_household
  on public.take_list_links (household_id) where revoked_at is null;

-- The household of an active link, or a 42501 error. Called only from the security-definer RPCs below.
create function private.take_list_household(p_token text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_household uuid;
begin
  if p_token is not null and p_token ~ '^[A-Za-z0-9_-]{43}$' then
    select l.household_id into v_household
    from public.take_list_links l
    join public.households h on h.id = l.household_id and h.deleted_at is null
    where l.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
      and l.expires_at > now() and l.revoked_at is null;
  end if;
  if v_household is null then
    raise exception 'this list has expired' using errcode = '42501';
  end if;
  return v_household;
end $$;

-- ─── Display side (members and displays) ─────────────────────────────────
create function public.create_take_list_link(p_household_id uuid)
returns table (out_token text, out_expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_token text := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  v_expires_at timestamptz := now() + interval '24 hours';
begin
  if p_household_id is null or not private.is_household_member(p_household_id) then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  -- Serialize link creation per household so only one link is ever active.
  perform 1 from public.households where id = p_household_id for update;
  update public.take_list_links set revoked_at = now() where household_id = p_household_id and revoked_at is null;
  insert into public.take_list_links (household_id, token_hash, expires_at)
  values (p_household_id, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_expires_at);
  return query select v_token, v_expires_at;
end $$;

create function public.revoke_take_list_link(p_household_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_household_id is null or not private.is_household_member(p_household_id) then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  update public.take_list_links set revoked_at = now() where household_id = p_household_id and revoked_at is null;
end $$;

-- ─── Phone page (anon, token only) ───────────────────────────────────────
-- Unchecked items (oldest first), then items checked in the last 24 hours (the same rule as the display's list).
create function public.take_list_items(p_token text)
returns table (out_id uuid, out_text text, out_checked boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_household uuid := private.take_list_household(p_token);
begin
  return query
  select g.id, g.text, g.checked_at is not null
  from public.grocery_items g
  where g.household_id = v_household
    and (g.checked_at is null or g.checked_at > now() - interval '24 hours')
  order by g.checked_at is not null, g.created_at, g.id;
end $$;

-- Checking an already-checked item keeps its original time. Changes reach the displays through Realtime.
create function public.take_list_set_checked(p_token text, p_item_id uuid, p_checked boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_household uuid := private.take_list_household(p_token);
begin
  if p_checked is null then
    raise exception 'checked is required' using errcode = '22023';
  end if;
  update public.grocery_items
  set checked_at = case when p_checked then coalesce(checked_at, now()) else null end
  where id = p_item_id and household_id = v_household;
  if not found then
    raise exception 'item not found' using errcode = '22023';
  end if;
end $$;

-- "Done shopping" on the phone: ends the link.
create function public.take_list_done(p_token text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_household uuid := private.take_list_household(p_token);
begin
  update public.take_list_links set revoked_at = now()
  where household_id = v_household and revoked_at is null
    and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
end $$;

-- ─── Grants ──────────────────────────────────────────────────────────────
-- Explicit grants after explicit revokes, so neither Supabase's default function privileges nor the default
-- privilege revokes in the RLS migration decide who can call these.
revoke execute on function private.take_list_household(text) from public, anon, authenticated;

revoke execute on function
  public.create_take_list_link(uuid), public.revoke_take_list_link(uuid),
  public.take_list_items(text), public.take_list_set_checked(text, uuid, boolean), public.take_list_done(text)
from public, anon, authenticated;

grant execute on function public.create_take_list_link(uuid), public.revoke_take_list_link(uuid) to authenticated;

grant execute on function
  public.take_list_items(text), public.take_list_set_checked(text, uuid, boolean), public.take_list_done(text)
to anon, authenticated;
