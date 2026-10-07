-- ─── Night Mode on/off (spec §7.7, §7.9) ───────────────────────────────
-- A household can switch Night Mode off in Settings → Household → Night Mode schedule. Off, the display never shows
-- the Night screen and sounds stay on (Nap Mode still mutes), whatever the schedule says; the schedule is kept for
-- when it is switched back on. Existing households stay on.
alter table public.households add column night_mode_enabled boolean not null default true;

-- update_household_settings takes the switch as one more required argument. The old signature (and its grants) goes.
drop function public.update_household_settings(uuid, text, text, text, text, int, time, time, time, time, boolean);

create function public.update_household_settings(
  p_membership_id uuid, p_pin text, p_name text, p_zip text, p_time_zone text, p_leave_by_buffer_min int,
  p_default_night_start time, p_default_night_end time, p_night_mode_start time, p_night_mode_end time,
  p_diaper_log_enabled boolean, p_night_mode_enabled boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.require_settings_pin(p_membership_id, p_pin);
  v_name text := btrim(p_name);
  v_zip text := nullif(btrim(p_zip), '');
begin
  if v_name is null or char_length(v_name) not between 1 and 80 then
    raise exception 'household name must be 1 to 80 characters' using errcode = '22023';
  end if;
  if v_zip is not null and v_zip !~ '^\d{5}$' then
    raise exception 'ZIP code must be 5 digits' using errcode = '22023';
  end if;
  if p_time_zone is null or not exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = p_time_zone) then
    raise exception 'unknown time zone %', p_time_zone using errcode = '22023';
  end if;
  if p_leave_by_buffer_min is null or p_leave_by_buffer_min not between 0 and 120 then
    raise exception 'leave-by buffer must be 0 to 120 minutes' using errcode = '22023';
  end if;
  if p_default_night_start is null or p_default_night_end is null
     or p_night_mode_start is null or p_night_mode_end is null then
    raise exception 'night-sleep and Night Mode times are required' using errcode = '22023';
  end if;
  if p_diaper_log_enabled is null then
    raise exception 'diaper log on/off is required' using errcode = '22023';
  end if;
  if p_night_mode_enabled is null then
    raise exception 'Night Mode on/off is required' using errcode = '22023';
  end if;

  update public.households set
    name = v_name, zip = v_zip, time_zone = p_time_zone, leave_by_buffer_min = p_leave_by_buffer_min,
    default_night_sleep_start = p_default_night_start, default_night_sleep_end = p_default_night_end,
    night_mode_start = p_night_mode_start, night_mode_end = p_night_mode_end,
    diaper_log_enabled = p_diaper_log_enabled, night_mode_enabled = p_night_mode_enabled
  where id = v_household;

  perform private.audit_setting(v_household, p_membership_id, 'household', 'update', v_household, jsonb_build_object(
    'name', v_name, 'zip', v_zip, 'time_zone', p_time_zone, 'leave_by_buffer_min', p_leave_by_buffer_min,
    'default_night_sleep_start', p_default_night_start, 'default_night_sleep_end', p_default_night_end,
    'night_mode_start', p_night_mode_start, 'night_mode_end', p_night_mode_end,
    'diaper_log_enabled', p_diaper_log_enabled, 'night_mode_enabled', p_night_mode_enabled));
end $$;

revoke execute on function
  public.update_household_settings(uuid, text, text, text, text, int, time, time, time, time, boolean, boolean)
from public, anon;
grant execute on function
  public.update_household_settings(uuid, text, text, text, text, int, time, time, time, time, boolean, boolean)
to authenticated;
