-- ─── Photos (spec §7.7, §7.9, §11.1) ─────────────────────────────────────
-- Photos live in the private Storage bucket `household-photos` at `<household_id>/<photo_id>.jpg`. The app resizes
-- them on the device (≤ 1600 px, JPEG, metadata stripped by re-encoding) before upload. Members and displays upload
-- and read objects in their own household's folder through storage RLS; nobody updates or deletes objects directly.
-- A `photos` row is written after the upload by the PIN-checked `add_photo`, and `delete_photo` removes the row
-- and the object together. The app shows photos through short-lived signed URLs.
--
-- About deleting objects from SQL: Supabase blocks `delete from storage.objects` unless
-- `storage.allow_delete_query` is on (storage.protect_delete), because deleting the object record does not remove
-- the file bytes from the storage backend (local disk or S3). delete_photo and the household purge turn it on for
-- their own statements only. That makes the file unreachable at once — every Storage API read, list and signed URL
-- goes through storage.objects, so a removed record serves nothing — but the bytes stay in the backend. Removing
-- them needs the Storage API; a follow-up Edge Function (service role) can sweep backend files that have no
-- storage.objects record. Until then, deleted photos are unreachable but not erased.

-- ─── Bucket ──────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('household-photos', 'household-photos', false, 5 * 1024 * 1024, array['image/jpeg'])
on conflict (id) do nothing;

-- ─── Object names ────────────────────────────────────────────────────────
-- The household of a photo object named exactly `<uuid>/<uuid>.jpg`, or null for any other name (so a malformed
-- name never casts, and never matches a household).
create function private.photo_object_household(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
      then split_part(p_name, '/', 1)::uuid
  end
$$;

-- ─── Storage policies ────────────────────────────────────────────────────
-- Read and upload only; no UPDATE or DELETE policy, so clients can neither overwrite nor remove objects.
create policy household_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'household-photos' and public.is_my_household(private.photo_object_household(name)));

create policy household_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'household-photos' and public.is_my_household(private.photo_object_household(name)));

-- ─── photos table ────────────────────────────────────────────────────────
-- Tighten the path to exactly the object add_photo checked.
alter table public.photos drop constraint photos_check;
alter table public.photos add constraint photos_storage_path_check
  check (storage_path = household_id::text || '/' || id::text || '.jpg');
create index on public.photos (household_id, kind);

-- Displays reload when photos change; DELETE events need the old row's household_id for the filter.
alter table public.photos replica identity full;
alter publication supabase_realtime add table public.photos;

-- Deletes the object record at p_path in the household's folder, or every object in the folder when p_path is null.
-- Turns storage.allow_delete_query on for these statements only, then restores it.
create function private.delete_photo_objects(p_household_id uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_previous text := current_setting('storage.allow_delete_query', true);
begin
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects o
  where o.bucket_id = 'household-photos'
    and (case when p_path is null then o.name like p_household_id::text || '/%' else o.name = p_path end);
  perform set_config('storage.allow_delete_query', coalesce(v_previous, 'false'), true);
end $$;

-- ─── RPCs ────────────────────────────────────────────────────────────────
-- Records a photo already uploaded to `<household>/<p_photo_id>.jpg`. Kinds: slideshow (at most 200 per household),
-- avatar, step. Retrying with the same id and kind is a no-op, so a lost response can be retried safely.
create function public.add_photo(p_membership_id uuid, p_pin text, p_photo_id uuid, p_kind text) returns void
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

  -- Serializes adds per household so two displays can't both take the 200th slot.
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

  insert into public.photos (id, household_id, storage_path, kind) values (p_photo_id, v_household, v_path, p_kind);
  perform private.audit_setting(v_household, p_membership_id, 'photos', 'add', p_photo_id, jsonb_build_object('kind', p_kind));
end $$;

-- Deletes the photo row and its storage object record (see the note at the top about the file bytes), and clears
-- any child profile photo or routine step that used it.
create function public.delete_photo(p_membership_id uuid, p_pin text, p_photo_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.require_settings_pin(p_membership_id, p_pin);
  v_path text;
  v_kind text;
begin
  delete from public.photos where id = p_photo_id and household_id = v_household returning storage_path, kind into v_path, v_kind;
  if v_path is null then
    raise exception 'photo not found' using errcode = '42501';
  end if;

  perform private.delete_photo_objects(v_household, v_path);

  update public.children c set photo_id = null
  from public.child_households ch
  where ch.child_id = c.id and ch.household_id = v_household and c.photo_id = p_photo_id;

  update public.routines r
  set steps = (
    select coalesce(jsonb_agg(case when s ->> 'photoId' = p_photo_id::text then jsonb_set(s, '{photoId}', 'null') else s end
                              order by i), '[]'::jsonb)
    from jsonb_array_elements(r.steps) with ordinality as e (s, i)
  )
  where r.household_id = v_household and r.steps @> jsonb_build_array(jsonb_build_object('photoId', p_photo_id::text));

  perform private.audit_setting(v_household, p_membership_id, 'photos', 'delete', p_photo_id, jsonb_build_object('kind', v_kind));
end $$;

-- ─── Household purge (replaces migration 3's) ────────────────────────────
-- Also removes the purged households' photo object records (see the note at the top about the file bytes).
create or replace function private.purge_deleted_households() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
  v_household uuid;
begin
  for v_household in
    select h.id from public.households h where h.deleted_at is not null and h.deleted_at < now() - interval '30 days'
  loop
    perform private.delete_photo_objects(v_household, null);
  end loop;

  delete from public.households where deleted_at is not null and deleted_at < now() - interval '30 days';
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ─── Grants ──────────────────────────────────────────────────────────────
-- The name helper runs inside the storage policies, as the caller.
revoke execute on function private.photo_object_household(text) from public, anon;
grant execute on function private.photo_object_household(text) to authenticated;
revoke execute on function private.purge_deleted_households() from public, anon, authenticated;
revoke execute on function private.delete_photo_objects(uuid, text) from public, anon, authenticated;

revoke execute on function
  public.add_photo(uuid, text, uuid, text),
  public.delete_photo(uuid, text, uuid)
from public, anon;

grant execute on function
  public.add_photo(uuid, text, uuid, text),
  public.delete_photo(uuid, text, uuid)
to authenticated;
