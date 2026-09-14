create extension if not exists pgcrypto with schema extensions;

-- ─── Config ──────────────────────────────────────────────────────────────
create table public.app_config (
  key text primary key,
  value jsonb not null
);
insert into public.app_config (key, value) values ('invites_required', 'true');

-- ─── Households, people, displays ────────────────────────────────────────
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  time_zone text not null,
  zip text check (zip ~ '^\d{5}$'),
  lat double precision,
  lon double precision,
  plan text not null default 'free',
  default_night_sleep_start time not null default '18:00',
  default_night_sleep_end time not null default '05:00',
  night_mode_start time not null default '20:00',
  night_mode_end time not null default '06:00',
  leave_by_buffer_min int not null default 20 check (leave_by_buffer_min between 0 and 120),
  diaper_log_enabled boolean not null default false,
  dinner_tonight text check (char_length(dinner_tonight) <= 80),
  sitter_info jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.invite_codes (
  code text primary key check (code ~ '^[A-Z0-9]{6}$'),
  used_by_household_id uuid references public.households (id) on delete set null,
  used_at timestamptz
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  role text not null check (role in ('owner', 'adult', 'caregiver')),
  display_name text not null check (char_length(display_name) between 1 and 40),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  unique (user_id, household_id)
);

-- PIN hashes live apart from memberships so no client query can ever select them.
create table public.member_pins (
  membership_id uuid primary key references public.memberships (id) on delete cascade,
  pin_hash text not null,
  updated_at timestamptz not null default now()
);

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  policy_version text not null,
  health_data_consent boolean not null,
  accepted_at timestamptz not null default now()
);

create table public.displays (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- One-time claim tokens (hashed), readable only through security-definer functions.
create table public.display_claims (
  display_id uuid primary key references public.displays (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null
);

create table public.children (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  birthday date not null,
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  photo_id uuid,
  allergies text not null default '',
  food_rules text not null default '',
  night_sleep_start time,
  night_sleep_end time,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  check ((night_sleep_start is null) = (night_sleep_end is null))
);

create table public.child_households (
  child_id uuid primary key references public.children (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade
);

create table public.feature_overrides (
  child_id uuid not null references public.children (id) on delete cascade,
  feature text not null check (feature in ('wakeWindow', 'feeding', 'kidsCorner', 'diaper')),
  enabled boolean not null,
  primary key (child_id, feature)
);

create table public.sitter_sessions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  display_id uuid references public.displays (id) on delete set null,
  sitter_name text check (char_length(sitter_name) <= 40),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  summary_shown_at timestamptz
);

-- ─── Logs ────────────────────────────────────────────────────────────────
-- Entry ids are generated on the device so offline replay is idempotent.
create table public.sleep_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz,
  type text not null check (type in ('nap', 'night')),
  display_id uuid references public.displays (id) on delete set null,
  logged_by_membership_id uuid references public.memberships (id) on delete set null,
  sitter_session_id uuid references public.sitter_sessions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at is null or end_at >= start_at)
);

create table public.feeding_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  at timestamptz not null,
  type text not null check (type in ('milk', 'meal', 'snack')),
  amount text check (char_length(amount) <= 20),
  note text check (char_length(note) <= 200),
  display_id uuid references public.displays (id) on delete set null,
  logged_by_membership_id uuid references public.memberships (id) on delete set null,
  sitter_session_id uuid references public.sitter_sessions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.medicines (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  min_interval_hours numeric(4, 1) not null check (min_interval_hours > 0 and min_interval_hours <= 72),
  max_doses_per_24h int check (max_doses_per_24h between 1 and 24),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.dose_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  medicine_id uuid not null references public.medicines (id) on delete cascade,
  at timestamptz not null,
  note text check (char_length(note) <= 200),
  logged_offline boolean not null default false,
  warnings_confirmed text[] not null default '{}',
  conflict_acknowledged_at timestamptz,
  conflict_acknowledged_by uuid references public.memberships (id) on delete set null,
  voided_at timestamptz,
  voided_by uuid references public.memberships (id) on delete set null,
  void_reason text check (char_length(void_reason) <= 200),
  display_id uuid references public.displays (id) on delete set null,
  logged_by_membership_id uuid references public.memberships (id) on delete set null,
  sitter_session_id uuid references public.sitter_sessions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((voided_at is null) = (void_reason is null)),
  -- medicine doses must name who gave them: an adult or a sitter session
  check (logged_by_membership_id is not null or sitter_session_id is not null)
);

create table public.sticker_categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  icon_key text not null,
  sort_order int not null default 0,
  archived_at timestamptz
);

create table public.sticker_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  category_id uuid not null references public.sticker_categories (id) on delete cascade,
  at timestamptz not null,
  display_id uuid references public.displays (id) on delete set null,
  logged_by_membership_id uuid references public.memberships (id) on delete set null,
  sitter_session_id uuid references public.sitter_sessions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.diaper_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  at timestamptz not null,
  kind text not null check (kind in ('wet', 'dirty', 'both')),
  display_id uuid references public.displays (id) on delete set null,
  logged_by_membership_id uuid references public.memberships (id) on delete set null,
  sitter_session_id uuid references public.sitter_sessions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Routines ────────────────────────────────────────────────────────────
create table public.routines (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  weekdays smallint[] not null default '{}' check (weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.routine_progress (
  household_id uuid not null references public.households (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  routine_id uuid not null references public.routines (id) on delete cascade,
  day date not null,
  completed_step_indexes int[] not null default '{}',
  primary key (child_id, routine_id, day)
);

create table public.routine_day_overrides (
  household_id uuid not null references public.households (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  day date not null,
  routine_id uuid not null references public.routines (id) on delete cascade,
  primary key (child_id, day)
);

-- ─── Household lists ─────────────────────────────────────────────────────
create table public.jots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 500),
  display_id uuid references public.displays (id) on delete set null,
  created_at timestamptz not null default now(),
  done_at timestamptz
);

create table public.grocery_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 100),
  display_id uuid references public.displays (id) on delete set null,
  created_at timestamptz not null default now(),
  checked_at timestamptz
);

create table public.take_list_links (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  storage_path text not null,
  kind text not null check (kind in ('avatar', 'step', 'slideshow')),
  added_at timestamptz not null default now()
);

create table public.settings_audit (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  membership_id uuid references public.memberships (id) on delete set null,
  change jsonb not null,
  at timestamptz not null default now()
);

-- ─── Integrity triggers ──────────────────────────────────────────────────
create function public.enforce_child_household() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.child_households ch
    where ch.child_id = new.child_id and ch.household_id = new.household_id
  ) then
    raise exception 'child % does not belong to household %', new.child_id, new.household_id
      using errcode = '23514';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'sleep_entries', 'feeding_entries', 'medicines', 'dose_entries', 'sticker_entries',
    'diaper_entries', 'routines', 'routine_progress', 'routine_day_overrides'
  ] loop
    execute format(
      'create trigger enforce_child_household before insert or update of child_id, household_id on public.%I
       for each row execute function public.enforce_child_household()', t);
  end loop;
end $$;

create function public.enforce_dose_medicine_child() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.medicines m where m.id = new.medicine_id and m.child_id = new.child_id) then
    raise exception 'medicine % is not defined for child %', new.medicine_id, new.child_id using errcode = '23514';
  end if;
  return new;
end $$;

create trigger enforce_dose_medicine_child before insert or update of medicine_id, child_id on public.dose_entries
  for each row execute function public.enforce_dose_medicine_child();

create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['sleep_entries', 'feeding_entries', 'dose_entries', 'sticker_entries', 'diaper_entries'] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ─── Indexes ─────────────────────────────────────────────────────────────
create index on public.memberships (household_id);
create index on public.displays (household_id);
create index on public.child_households (household_id);
create index on public.sleep_entries (household_id, start_at desc);
create index on public.feeding_entries (household_id, at desc);
create index on public.dose_entries (household_id, at desc);
create index on public.sticker_entries (household_id, at desc);
create index on public.diaper_entries (household_id, at desc);
create index on public.medicines (household_id);
create index on public.routines (household_id);
create index on public.jots (household_id);
create index on public.grocery_items (household_id);

-- ─── Realtime ────────────────────────────────────────────────────────────
alter publication supabase_realtime add table
  public.households, public.memberships, public.displays, public.children, public.child_households,
  public.feature_overrides, public.sitter_sessions, public.sleep_entries, public.feeding_entries,
  public.medicines, public.dose_entries, public.sticker_categories, public.sticker_entries,
  public.diaper_entries, public.routines, public.routine_progress, public.routine_day_overrides,
  public.jots, public.grocery_items;
