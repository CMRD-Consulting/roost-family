-- ─── Phase 4a hardening (review) ────────────────────────────────────────
-- Amends earlier functions with `create or replace` rather than editing their migrations.
--   1. Weather: at most one NWS attempt per household every 5 minutes, succeeded or failed (spec §5.6).
--   2. Photos: an upload quota for files never recorded, a total photo cap, and Settings thumbnails (spec §11.1).
--   3. Take list: links that ended more than 7 days ago are deleted by the daily purge (spec §11.2).

-- ═══ 1. Weather attempts ═══
-- When the `weather` function last asked NWS for this household, successfully or not.
alter table public.household_weather add column attempted_at timestamptz;

-- Claims an NWS attempt for the household: true (and attempted_at = now) unless an attempt started in the last
-- 5 minutes. One statement, so displays refreshing at the same moment make one request between them. Service role only.
create function public.svc_claim_weather_attempt(p_household_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_claimed boolean;
begin
  insert into public.household_weather as w (household_id, attempted_at)
  values (p_household_id, now())
  on conflict (household_id) do update set attempted_at = excluded.attempted_at
    where w.attempted_at is null or w.attempted_at <= now() - interval '5 minutes'
  returning true into v_claimed;
  return coalesce(v_claimed, false);
end $$;

revoke execute on function public.svc_claim_weather_attempt(uuid) from public, anon, authenticated;
grant execute on function public.svc_claim_weather_attempt(uuid) to service_role;

-- ═══ 2. Photos ═══
-- Thumbnails: Settings shows a ~320 px JPEG uploaded next to each photo, `<household>/<photo>.thumb.jpg`, instead of
-- decoding up to 200 full-size photos (local and self-hosted Storage may have image transforms off). A thumbnail is
-- not a `photos` row: it is readable exactly when its photo's row exists, the storage sweep erases it with its photo,
-- and the export (built from `photos` rows) never includes it. Photos added before thumbnails have none; Settings
-- falls back to the photo itself.

-- The household of an object named exactly `<uuid>/<uuid>.jpg` or `<uuid>/<uuid>.thumb.jpg`, or null for any other
-- name (replaces migration 6's, which allowed only the first).
create or replace function private.photo_object_household(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.thumb)?\.jpg$'
      then split_part(p_name, '/', 1)::uuid
  end
$$;

-- The photo path an object belongs to: a thumbnail's photo, or the name itself.
create function private.photo_original_path(p_name text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(p_name, '\.thumb\.jpg$', '.jpg')
$$;

-- True when the object is a recorded photo, or a recorded photo's thumbnail, of a household the caller belongs to
-- (replaces migration 7's). Runs inside the storage select policy.
create or replace function private.photo_object_readable(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.photos p
    where p.storage_path = private.photo_original_path(p_name) and private.is_household_member(p.household_id)
  )
$$;

-- Upload quota. Any member or display may upload (adding needs the PIN), so without a limit a display session could
-- fill the bucket with files `add_photo` never records. At most 40 unrecorded objects (20 photos with their
-- thumbnails) created in the last hour per household folder; recorded photos, their thumbnails and older orphans
-- (which the hourly storage sweep erases) don't count. Runs inside the storage insert policy.
create function private.photo_upload_allowed(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_household uuid := private.photo_object_household(p_name);
begin
  if v_household is null or not private.is_household_member(v_household) then
    return false;
  end if;
  return (
    select count(*) from storage.objects o
    where o.bucket_id = 'household-photos'
      and o.name like v_household::text || '/%'
      and o.created_at > now() - interval '1 hour'
      and not exists (select 1 from public.photos p where p.storage_path = private.photo_original_path(o.name))
  ) < 40;
end $$;

drop policy household_photos_insert on storage.objects;
create policy household_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'household-photos' and private.photo_upload_allowed(name));

-- ─── add_photo (replaces migration 6's): a total cap ─────────────────────
-- As before, plus at most 300 photos of all kinds per household: the spec's 200 slideshow photos (§2, §7.9) and up to
-- 100 child and routine-step photos, which the spec doesn't limit.
create or replace function public.add_photo(p_membership_id uuid, p_pin text, p_photo_id uuid, p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.require_settings_pin(p_membership_id, p_pin);
  v_path text;
  v_existing record;
begin
  if p_photo_id is null then
    raise exception 'a photo id is required' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('slideshow', 'avatar', 'step') then
    raise exception 'photo kind must be slideshow, avatar or step' using errcode = '22023';
  end if;
  v_path := v_household::text || '/' || p_photo_id::text || '.jpg';

  -- Serializes adds per household so two displays can't both take the last slot.
  perform 1 from public.households where id = v_household for update;

  select p.household_id, p.kind into v_existing from public.photos p where p.id = p_photo_id;
  if found then
    if v_existing.household_id <> v_household then
      raise exception 'photo not found' using errcode = '42501';
    end if;
    if v_existing.kind <> p_kind then
      raise exception 'this photo was already added as another kind' using errcode = '22023';
    end if;
    return;
  end if;

  if not exists (select 1 from storage.objects o where o.bucket_id = 'household-photos' and o.name = v_path) then
    raise exception 'upload the photo before adding it' using errcode = '22023';
  end if;
  if p_kind = 'slideshow'
     and (select count(*) from public.photos p where p.household_id = v_household and p.kind = 'slideshow') >= 200 then
    raise exception 'a household can have at most 200 slideshow photos' using errcode = '22023';
  end if;
  if (select count(*) from public.photos p where p.household_id = v_household) >= 300 then
    raise exception 'a household can have at most 300 photos' using errcode = '22023';
  end if;

  insert into public.photos (id, household_id, storage_path, kind) values (p_photo_id, v_household, v_path, p_kind);
  perform private.audit_setting(v_household, p_membership_id, 'photos', 'add', p_photo_id, jsonb_build_object('kind', p_kind));
end $$;

revoke execute on function private.photo_original_path(text) from public, anon;
grant execute on function private.photo_original_path(text) to authenticated;
revoke execute on function private.photo_object_household(text) from public, anon;
grant execute on function private.photo_object_household(text) to authenticated;
revoke execute on function private.photo_object_readable(text) from public, anon;
grant execute on function private.photo_object_readable(text) to authenticated;
revoke execute on function private.photo_upload_allowed(text) from public, anon;
grant execute on function private.photo_upload_allowed(text) to authenticated;
revoke execute on function public.add_photo(uuid, text, uuid, text) from public, anon;
grant execute on function public.add_photo(uuid, text, uuid, text) to authenticated;

-- ═══ 3. Take list links ═══
-- ─── Purge (replaces migration 10's) ─────────────────────────────────────
-- As before, plus: deletes Take list links that ended (expired or were revoked, whichever came first) more than
-- 7 days ago. Only token hashes are stored, but an ended link has no use.
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

  -- Photo and export files stay until the storage sweep finds them unowned and erases them through the Storage API.
  delete from public.households where deleted_at is not null and deleted_at < now() - interval '30 days';
  get diagnostics v_count = row_count;

  -- After the households (and so their displays) are gone; a device bound to a display elsewhere is kept.
  delete from auth.users u
  where u.id = any (v_devices) and u.is_anonymous
    and not exists (select 1 from public.displays d where d.auth_user_id = u.id);

  -- least() ignores a null revoked_at.
  delete from public.take_list_links l where least(l.expires_at, l.revoked_at) < now() - interval '7 days';

  perform private.purge_calendar_oauth_states();
  perform private.purge_old_exports();
  return v_count;
end $$;

revoke execute on function private.purge_deleted_households() from public, anon, authenticated;
