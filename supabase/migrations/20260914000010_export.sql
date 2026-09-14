-- ═══ Household export (spec §6.3, §7.10, §11.3) ═══
-- A full sign-in owner asks for an export in Manage household. `request_household_export` records a pending row; the
-- browser then asks the `export-household` Edge Function to build it. The function checks, with the owner's own JWT
-- (`my_household_export`), that the caller owns the export's household and the export is pending, claims it with the
-- service role (`svc_claim_household_export`, once), reads the household's rows and photos, uploads
-- `<household>/<export>.zip` to the private `exports` bucket, marks the row ready (`svc_mark_export_ready`) or failed
-- (`svc_mark_export_failed`, a short code, never a message or stack) and emails the requesting owner a link to
-- /manage/export/<id>. That page signs the owner in again and asks the same function for a 10-minute signed URL.
--
-- Access:
--   - household_exports: owners of the household SELECT; nobody else, and no client writes.
--   - exports bucket: no storage policies at all, so clients can neither list, read nor upload objects. Only the
--     service role writes, and downloads use signed URLs the Edge Function creates after the owner check.
-- Lifetime:
--   - A ready export expires 24 hours after it became ready; the download is refused after that.
--   - The storage sweep (`storage-sweep`, hourly) erases through the Storage API every exports object whose row is
--     gone, failed or expired (SQL can't erase Storage bytes; see migration 7).
--   - `private.purge_old_exports()` (from the daily household purge, and on every request) marks pending exports that
--     never finished within 15 minutes failed ('timeout') and deletes rows older than 7 days. Rows outlive their
--     files for a week so an old emailed link says "expired" rather than "not available"; they hold no household
--     data beyond ids and times.
--   - Deleting a household (soft delete) deletes its export rows at once, so no owner can download them and the sweep
--     erases the files.
-- Rate limit: one export per household per hour (pending or ready; failed ones don't count). A refused request raises
-- SQLSTATE RL001 with DETAIL `retry_after_minutes=<n>`.

-- ─── Bucket ──────────────────────────────────────────────────────────────
-- No file_size_limit here: the project's global upload limit applies (50 MiB locally and on the free plan). The Edge
-- Function keeps photos under 40 MB so a ZIP fits (see supabase/functions/export-household/handler.ts).
insert into storage.buckets (id, name, public, allowed_mime_types)
values ('exports', 'exports', false, array['application/zip'])
on conflict (id) do nothing;

-- ─── Table ───────────────────────────────────────────────────────────────
create table public.household_exports (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  requested_by uuid not null,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  storage_path text,
  error text check (error ~ '^[a-z_]{1,40}$'),
  created_at timestamptz not null default now(),
  -- When the Edge Function claimed it (null until then; a claimed export is never built twice).
  started_at timestamptz,
  ready_at timestamptz,
  expires_at timestamptz not null default now() + interval '24 hours',
  foreign key (requested_by, household_id) references public.memberships (id, household_id) on delete cascade,
  check ((status = 'ready') = (storage_path is not null and ready_at is not null)),
  check ((status = 'failed') = (error is not null)),
  check (storage_path = household_id::text || '/' || id::text || '.zip')
);
create index on public.household_exports (household_id, created_at);
create index on public.household_exports (requested_by);

alter table public.household_exports enable row level security;
revoke all on public.household_exports from anon, authenticated;
grant select on public.household_exports to authenticated;

create policy household_exports_select on public.household_exports for select to authenticated
  using (private.is_household_owner(household_id));

-- ─── Purge ───────────────────────────────────────────────────────────────
-- Fails pending exports that didn't finish within 15 minutes (the function crashed or was never called) and deletes
-- rows older than 7 days. Returns how many rows were deleted.
create function private.purge_old_exports() returns int
language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  update public.household_exports set status = 'failed', error = 'timeout'
  where status = 'pending' and created_at < now() - interval '15 minutes';
  delete from public.household_exports where created_at < now() - interval '7 days';
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ─── Deleting a household ends its exports at once ───────────────────────
create function private.delete_exports_of_deleted_household() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.household_exports where household_id = new.id;
  return null;
end $$;

create trigger delete_exports_of_deleted_household after update of deleted_at on public.households
  for each row when (new.deleted_at is not null and old.deleted_at is null)
  execute function private.delete_exports_of_deleted_household();

-- ─── Client RPCs ─────────────────────────────────────────────────────────
-- Records a pending export for a full sign-in owner of a live household and returns its id. The browser then invokes
-- the `export-household` Edge Function with the id.
create function public.request_household_export(p_household_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_membership uuid;
  v_last timestamptz;
  v_id uuid;
begin
  perform private.require_adult();
  -- Serializes requests per household so two owners can't both get past the limit.
  perform 1 from public.households h where h.id = p_household_id and h.deleted_at is null for update;
  if not found or not private.is_household_owner(p_household_id) then
    raise exception 'only an owner can export the household' using errcode = '42501';
  end if;
  v_membership := private.my_membership_id(p_household_id);

  perform private.purge_old_exports();
  select max(e.created_at) into v_last from public.household_exports e
  where e.household_id = p_household_id and e.status <> 'failed' and e.created_at > now() - interval '1 hour';
  if v_last is not null then
    raise exception 'an export was requested less than an hour ago'
      using errcode = 'RL001',
            detail = 'retry_after_minutes=' || greatest(1, ceil(extract(epoch from (v_last + interval '1 hour' - now())) / 60))::int;
  end if;

  insert into public.household_exports (household_id, requested_by) values (p_household_id, v_membership)
  returning id into v_id;
  perform private.audit_setting(p_household_id, v_membership, 'export', 'request', v_id, null);
  return v_id;
end $$;

-- One export, for a full sign-in owner of its (live) household; 42501 for anyone else and for an unknown id. `expired`
-- is true once a ready export's 24 hours are over. The Edge Function calls this with the caller's JWT.
create function public.my_household_export(p_export_id uuid)
returns table (
  id uuid, household_id uuid, status text, error text, created_at timestamptz, ready_at timestamptz,
  expires_at timestamptz, expired boolean
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform private.require_adult();
  return query
  select e.id, e.household_id, e.status, e.error, e.created_at, e.ready_at, e.expires_at, e.expires_at <= now()
  from public.household_exports e
  where e.id = p_export_id and private.is_household_owner(e.household_id);
  if not found then
    raise exception 'export not found' using errcode = '42501';
  end if;
end $$;

-- ─── Service wrappers (export-household Edge Function) ───────────────────
-- Claims a pending, unclaimed export of a live household whose requester is still an active owner, and returns what
-- the build and the email need. No row when it can't be claimed (already claimed, ready, failed, gone).
create function public.svc_claim_household_export(p_export_id uuid)
returns table (household_id uuid, household_name text, time_zone text, requester_email text)
language sql security definer set search_path = '' as $$
  with claimed as (
    update public.household_exports e set started_at = now()
    where e.id = p_export_id and e.status = 'pending' and e.started_at is null
      and exists (select 1 from public.households h where h.id = e.household_id and h.deleted_at is null)
      and exists (
        select 1 from public.memberships m
        where m.id = e.requested_by and m.role = 'owner' and m.left_at is null
      )
    returning e.household_id, e.requested_by
  )
  select c.household_id, h.name, h.time_zone, u.email::text
  from claimed c
  join public.households h on h.id = c.household_id
  join public.memberships m on m.id = c.requested_by
  join auth.users u on u.id = m.user_id
$$;

-- Marks a pending export ready at exactly `<household>/<export>.zip`, expiring 24 hours from now. 22023 when the
-- export isn't pending or the path is wrong (a deleted household's export is gone: also 22023).
create function public.svc_mark_export_ready(p_export_id uuid, p_storage_path text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.household_exports e
  set status = 'ready', storage_path = p_storage_path, ready_at = now(), expires_at = now() + interval '24 hours'
  where e.id = p_export_id and e.status = 'pending'
    and p_storage_path = e.household_id::text || '/' || e.id::text || '.zip';
  if not found then
    raise exception 'export is not pending, or the path is wrong' using errcode = '22023';
  end if;
end $$;

-- Marks a pending export failed with a short code (lowercase letters and underscores, at most 40); anything else is
-- stored as 'internal', so an error message or stack never lands in the table. 22023 when it isn't pending.
create function public.svc_mark_export_failed(p_export_id uuid, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.household_exports e
  set status = 'failed', error = case when p_error ~ '^[a-z_]{1,40}$' then p_error else 'internal' end
  where e.id = p_export_id and e.status = 'pending';
  if not found then
    raise exception 'export is not pending' using errcode = '22023';
  end if;
end $$;

-- ─── Purge (replaces migration 9's): also fails stale and deletes old exports ─
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

  perform private.purge_calendar_oauth_states();
  perform private.purge_old_exports();
  return v_count;
end $$;

-- ─── Grants ──────────────────────────────────────────────────────────────
revoke execute on function
  private.purge_old_exports(),
  private.delete_exports_of_deleted_household(),
  private.purge_deleted_households()
from public, anon, authenticated, service_role;

revoke execute on function public.request_household_export(uuid), public.my_household_export(uuid) from public, anon;
grant execute on function public.request_household_export(uuid), public.my_household_export(uuid) to authenticated;

revoke execute on function
  public.svc_claim_household_export(uuid),
  public.svc_mark_export_ready(uuid, text),
  public.svc_mark_export_failed(uuid, text)
from public, anon, authenticated;
grant execute on function
  public.svc_claim_household_export(uuid),
  public.svc_mark_export_ready(uuid, text),
  public.svc_mark_export_failed(uuid, text)
to service_role;
