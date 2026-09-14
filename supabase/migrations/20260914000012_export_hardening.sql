-- ═══ Household export hardening (review of migration 10; spec §11.3) ═══
-- 1. No build outlives its claim unnoticed:
--    - The purge fails a pending export 15 minutes after it was claimed (or, if never claimed, requested), not 15
--      minutes after it was requested, so a build claimed late is not failed under it.
--    - An export can only be claimed within 15 minutes of the request.
--    - `svc_export_still_claimed` lets the Edge Function check, just before uploading, that the export is still pending,
--      claimed and in a live household; otherwise it uploads nothing.
--    - `svc_mark_export_ready` requires the claim.
--    - The Edge Function marks the export ready before emailing; if the email fails, `svc_mark_export_failed` moves it
--      from ready to failed ('email_failed'), clearing its path. It accepts pending or ready exports.
-- 2. Rate limit: still one pending or ready export per household per hour, and now at most 3 requests per household
--    per hour in total, counting failed ones except those the purge failed as 'timeout' (an export whose build never
--    started). Refusals still raise RL001 with DETAIL `retry_after_minutes=<n>`.

-- ─── Purge (replaces migration 10's) ─────────────────────────────────────
create or replace function private.purge_old_exports() returns int
language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  update public.household_exports set status = 'failed', error = 'timeout'
  where status = 'pending' and coalesce(started_at, created_at) < now() - interval '15 minutes';
  delete from public.household_exports where created_at < now() - interval '7 days';
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ─── request_household_export (replaces migration 10's): two limits ──────
create or replace function public.request_household_export(p_household_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_membership uuid;
  v_last_active timestamptz;
  v_third timestamptz;
  v_until timestamptz;
  v_id uuid;
begin
  perform private.require_adult();
  -- Serializes requests per household so two owners can't both get past the limits.
  perform 1 from public.households h where h.id = p_household_id and h.deleted_at is null for update;
  if not found or not private.is_household_owner(p_household_id) then
    raise exception 'only an owner can export the household' using errcode = '42501';
  end if;
  v_membership := private.my_membership_id(p_household_id);

  perform private.purge_old_exports();

  -- One pending or ready export an hour.
  select max(e.created_at) into v_last_active from public.household_exports e
  where e.household_id = p_household_id and e.status <> 'failed' and e.created_at > now() - interval '1 hour';
  if v_last_active is not null then
    v_until := v_last_active + interval '1 hour';
  end if;

  -- At most 3 requests an hour, failed ones included (but not purge timeouts): the next one is allowed once the third
  -- most recent counted request is an hour old.
  select e.created_at into v_third from public.household_exports e
  where e.household_id = p_household_id and e.created_at > now() - interval '1 hour'
    and not (e.status = 'failed' and e.error = 'timeout')
  order by e.created_at desc offset 2 limit 1;
  if v_third is not null then
    v_until := greatest(v_until, v_third + interval '1 hour');
  end if;

  if v_until is not null then
    raise exception 'too many exports were requested in the last hour'
      using errcode = 'RL001',
            detail = 'retry_after_minutes=' || greatest(1, ceil(extract(epoch from (v_until - now())) / 60))::int;
  end if;

  insert into public.household_exports (household_id, requested_by) values (p_household_id, v_membership)
  returning id into v_id;
  perform private.audit_setting(p_household_id, v_membership, 'export', 'request', v_id, null);
  return v_id;
end $$;

-- ─── Claim (replaces migration 10's): within 15 minutes of the request ───
create or replace function public.svc_claim_household_export(p_export_id uuid)
returns table (household_id uuid, household_name text, time_zone text, requester_email text)
language sql security definer set search_path = '' as $$
  with claimed as (
    update public.household_exports e set started_at = now()
    where e.id = p_export_id and e.status = 'pending' and e.started_at is null
      and e.created_at > now() - interval '15 minutes'
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

-- ─── Still claimed (new) ─────────────────────────────────────────────────
-- True when the export is pending, claimed and its household is live: checked right before the upload.
create function public.svc_export_still_claimed(p_export_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.household_exports e
    join public.households h on h.id = e.household_id and h.deleted_at is null
    where e.id = p_export_id and e.status = 'pending' and e.started_at is not null
  )
$$;

-- ─── Ready (replaces migration 10's): requires the claim ─────────────────
create or replace function public.svc_mark_export_ready(p_export_id uuid, p_storage_path text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.household_exports e
  set status = 'ready', storage_path = p_storage_path, ready_at = now(), expires_at = now() + interval '24 hours'
  where e.id = p_export_id and e.status = 'pending' and e.started_at is not null
    and p_storage_path = e.household_id::text || '/' || e.id::text || '.zip'
    and exists (select 1 from public.households h where h.id = e.household_id and h.deleted_at is null);
  if not found then
    raise exception 'export is not a claimed pending export, or the path is wrong' using errcode = '22023';
  end if;
end $$;

-- ─── Failed (replaces migration 10's): from pending or ready ─────────────
create or replace function public.svc_mark_export_failed(p_export_id uuid, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.household_exports e
  set status = 'failed', error = case when p_error ~ '^[a-z_]{1,40}$' then p_error else 'internal' end,
      storage_path = null, ready_at = null
  where e.id = p_export_id and e.status in ('pending', 'ready');
  if not found then
    raise exception 'export is not pending or ready' using errcode = '22023';
  end if;
end $$;

-- ─── Grants ──────────────────────────────────────────────────────────────
-- `create or replace` keeps the replaced functions' grants.
revoke execute on function public.svc_export_still_claimed(uuid) from public, anon, authenticated;
grant execute on function public.svc_export_still_claimed(uuid) to service_role;
