-- ─── Weather (spec §5.6) ─────────────────────────────────────────────────
-- One cached National Weather Service summary per household. The `weather` Edge Function refreshes it (with the
-- service role) when it is older than 30 minutes; displays and members only read it, and see changes through
-- Realtime. On a failed refresh the function records `error` and keeps the last good values.
create table public.household_weather (
  household_id uuid primary key references public.households (id) on delete cascade,
  -- When the values below were last fetched successfully; null until the first success.
  fetched_at timestamptz,
  current_temp_f int,
  high_f int,
  low_f int,
  precip_chance int check (precip_chance between 0 and 100),
  summary text check (char_length(summary) <= 200),
  icon text check (icon in ('sun', 'partly', 'cloud', 'rain', 'snow', 'storm', 'fog', 'wind')),
  -- The last refresh's failure, or null when it succeeded.
  error text check (char_length(error) <= 500),
  -- NWS /points lookup for the household's lat/lon, cached so each refresh needs two requests, not three.
  points_forecast_url text,
  points_hourly_url text,
  updated_at timestamptz not null default now()
);

alter table public.household_weather enable row level security;

-- Members and displays read their own household's row; nothing but the service role writes.
revoke all on public.household_weather from anon, authenticated;
grant select on public.household_weather to authenticated;
grant select, insert, update, delete on public.household_weather to service_role;

create policy household_weather_select on public.household_weather for select to authenticated
  using (private.is_household_member(household_id));

-- Realtime DELETE events carry the old row's household_id (for the household_id=eq.… filter) only with full
-- replica identity; rows are deleted when the household's location changes (below).
alter table public.household_weather replica identity full;
alter publication supabase_realtime add table public.household_weather;

-- A new location invalidates both the cached forecast and the cached /points URLs. Deleting the row (rather than
-- blanking it) tells displays through Realtime to hide the old weather and ask for a refresh.
create function private.clear_weather_on_location_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.household_weather where household_id = new.id;
  return new;
end $$;

create trigger households_clear_weather_on_location_change
  after update of lat, lon on public.households
  for each row when (old.lat is distinct from new.lat or old.lon is distinct from new.lon)
  execute function private.clear_weather_on_location_change();

-- ─── Membership check for the Edge Function ──────────────────────────────
-- The function calls this with the caller's own JWT to decide whether to refresh that household's weather.
-- (private.is_household_member is not reachable through the API; this is its public face.)
create function public.is_my_household(p_household_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_household_id is not null and private.is_household_member(p_household_id)
$$;

-- ─── Grants ──────────────────────────────────────────────────────────────
revoke execute on function private.clear_weather_on_location_change() from public, anon, authenticated;
revoke execute on function public.is_my_household(uuid) from public, anon, authenticated;
grant execute on function public.is_my_household(uuid) to authenticated;
