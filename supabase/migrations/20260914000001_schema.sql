create extension if not exists pgcrypto with schema extensions;

-- ─── Config ──────────────────────────────────────────────────────────────
create table public.app_config (
  key text primary key,
  value jsonb not null
);
insert into public.app_config (key, value) values ('invites_required', 'true');

-- ─── Households, people, displays ────────────────────────────────────────
-- Household-owned rows that point at other household-owned rows use composite foreign keys
-- that include household_id (or child_id), so a row can never reference another household's data.
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  time_zone text not null, -- validated against pg_timezone_names by trigger
  zip text check (zip ~ '^\d{5}$'),
  lat double precision check (lat between -90 and 90),
  lon double precision check (lon between -180 and 180),
  plan text not null default 'free',
  default_night_sleep_start time not null default '18:00',
  default_night_sleep_end time not null default '05:00',
  night_mode_start time not null default '20:00',
  night_mode_end time not null default '06:00',
  leave_by_buffer_min int not null default 20 check (leave_by_buffer_min between 0 and 120),
  diaper_log_enabled boolean not null default false,
  dinner_tonight text check (char_length(dinner_tonight) <= 80),
  sitter_info jsonb not null default '{}'::jsonb check (pg_column_size(sitter_info) < 16000),
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
  unique (user_id, household_id),
  unique (id, household_id)
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
  created_at timestamptz not null default now(),
  unique (id, household_id)
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

-- Surrogate ids on natural-key tables so Realtime DELETE events expose only an opaque id.
create table public.feature_overrides (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children (id) on delete cascade,
  feature text not null check (feature in ('wakeWindow', 'feeding', 'kidsCorner', 'diaper')),
  enabled boolean not null,
  unique (child_id, feature)
);

create table public.sitter_sessions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  display_id uuid,
  sitter_name text check (char_length(sitter_name) <= 40),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  summary_shown_at timestamptz,
  unique (id, household_id),
  foreign key (display_id, household_id) references public.displays (id, household_id) on delete set null (display_id)
);

-- ─── Logs ────────────────────────────────────────────────────────────────
-- Entry ids are generated on the device so offline replay is idempotent.
-- Attribution on every kid log: display_id, logged_by_membership_id, sitter_session_id (all nullable,
-- cleared when the referenced row is deleted) plus logged_by_name, a server-filled snapshot of who
-- logged it that survives member removal and account deletion.
create table public.sleep_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz,
  type text not null check (type in ('nap', 'night')),
  display_id uuid,
  logged_by_membership_id uuid,
  sitter_session_id uuid,
  logged_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at is null or end_at >= start_at),
  foreign key (display_id, household_id) references public.displays (id, household_id) on delete set null (display_id),
  foreign key (logged_by_membership_id, household_id) references public.memberships (id, household_id) on delete set null (logged_by_membership_id),
  foreign key (sitter_session_id, household_id) references public.sitter_sessions (id, household_id) on delete set null (sitter_session_id)
);

create table public.feeding_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  at timestamptz not null,
  type text not null check (type in ('milk', 'meal', 'snack')),
  amount text check (char_length(amount) <= 20),
  note text check (char_length(note) <= 200),
  display_id uuid,
  logged_by_membership_id uuid,
  sitter_session_id uuid,
  logged_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (display_id, household_id) references public.displays (id, household_id) on delete set null (display_id),
  foreign key (logged_by_membership_id, household_id) references public.memberships (id, household_id) on delete set null (logged_by_membership_id),
  foreign key (sitter_session_id, household_id) references public.sitter_sessions (id, household_id) on delete set null (sitter_session_id)
);

-- Medicines are archived (archived_at), never deleted by clients.
create table public.medicines (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  min_interval_hours numeric(4, 1) not null check (min_interval_hours > 0 and min_interval_hours <= 72),
  max_doses_per_24h int check (max_doses_per_24h between 1 and 24),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, child_id)
);

-- Doses are append-only (spec §11.4): never deleted by clients, and changed only by void_dose and
-- acknowledge_dose_conflict. The guard_dose_update trigger enforces this even for privileged roles.
create table public.dose_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  medicine_id uuid not null,
  at timestamptz not null,
  note text check (char_length(note) <= 200),
  logged_offline boolean not null default false,
  warnings_confirmed text[] not null default '{}',
  conflict_acknowledged_at timestamptz,
  conflict_acknowledged_by uuid,
  voided_at timestamptz,
  voided_by uuid,
  void_reason text check (char_length(void_reason) between 1 and 200),
  display_id uuid,
  logged_by_membership_id uuid,
  sitter_session_id uuid,
  logged_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((voided_at is null) = (void_reason is null)),
  check (voided_by is null or voided_at is not null),
  check (conflict_acknowledged_by is null or conflict_acknowledged_at is not null),
  -- Who gave the dose is required. An adult or sitter session is required at insert time
  -- (set_logged_by_name trigger); the name snapshot keeps it after those rows are deleted.
  check (logged_by_name is not null),
  -- The medicine must be defined for this dose's child, and cannot be deleted while doses reference it.
  foreign key (medicine_id, child_id) references public.medicines (id, child_id) on delete restrict,
  foreign key (conflict_acknowledged_by, household_id) references public.memberships (id, household_id) on delete set null (conflict_acknowledged_by),
  foreign key (voided_by, household_id) references public.memberships (id, household_id) on delete set null (voided_by),
  foreign key (display_id, household_id) references public.displays (id, household_id) on delete set null (display_id),
  foreign key (logged_by_membership_id, household_id) references public.memberships (id, household_id) on delete set null (logged_by_membership_id),
  foreign key (sitter_session_id, household_id) references public.sitter_sessions (id, household_id) on delete set null (sitter_session_id)
);

create table public.sticker_categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  icon_key text not null,
  sort_order int not null default 0,
  archived_at timestamptz,
  unique (id, household_id)
);

create table public.sticker_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  category_id uuid not null,
  at timestamptz not null,
  display_id uuid,
  logged_by_membership_id uuid,
  sitter_session_id uuid,
  logged_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (category_id, household_id) references public.sticker_categories (id, household_id) on delete cascade,
  foreign key (display_id, household_id) references public.displays (id, household_id) on delete set null (display_id),
  foreign key (logged_by_membership_id, household_id) references public.memberships (id, household_id) on delete set null (logged_by_membership_id),
  foreign key (sitter_session_id, household_id) references public.sitter_sessions (id, household_id) on delete set null (sitter_session_id)
);

create table public.diaper_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  at timestamptz not null,
  kind text not null check (kind in ('wet', 'dirty', 'both')),
  display_id uuid,
  logged_by_membership_id uuid,
  sitter_session_id uuid,
  logged_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (display_id, household_id) references public.displays (id, household_id) on delete set null (display_id),
  foreign key (logged_by_membership_id, household_id) references public.memberships (id, household_id) on delete set null (logged_by_membership_id),
  foreign key (sitter_session_id, household_id) references public.sitter_sessions (id, household_id) on delete set null (sitter_session_id)
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
  created_at timestamptz not null default now(),
  unique (id, child_id)
);

create table public.routine_progress (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  routine_id uuid not null,
  day date not null,
  completed_step_indexes int[] not null default '{}',
  unique (child_id, routine_id, day),
  foreign key (routine_id, child_id) references public.routines (id, child_id) on delete cascade
);

create table public.routine_day_overrides (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  day date not null,
  routine_id uuid not null,
  unique (child_id, day),
  foreign key (routine_id, child_id) references public.routines (id, child_id) on delete cascade
);

-- ─── Household lists ─────────────────────────────────────────────────────
create table public.jots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 500),
  display_id uuid,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  foreign key (display_id, household_id) references public.displays (id, household_id) on delete set null (display_id)
);

create table public.grocery_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 100),
  display_id uuid,
  created_at timestamptz not null default now(),
  checked_at timestamptz,
  foreign key (display_id, household_id) references public.displays (id, household_id) on delete set null (display_id)
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
  -- Objects live under a per-household prefix in Storage: '<household_id>/...'
  storage_path text not null check (storage_path like (household_id::text || '/%')),
  kind text not null check (kind in ('avatar', 'step', 'slideshow')),
  added_at timestamptz not null default now()
);

create table public.settings_audit (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  membership_id uuid,
  change jsonb not null,
  at timestamptz not null default now(),
  foreign key (membership_id, household_id) references public.memberships (id, household_id) on delete set null (membership_id)
);

-- ─── Integrity triggers ──────────────────────────────────────────────────
create function public.enforce_household_time_zone() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = new.time_zone) then
    raise exception 'unknown time zone %', new.time_zone using errcode = '22023';
  end if;
  return new;
end $$;

create trigger enforce_household_time_zone before insert or update of time_zone on public.households
  for each row execute function public.enforce_household_time_zone();

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

-- Server-filled attribution snapshot: the member's display name, else '<sitter> (sitter)', else the
-- display's name. Recomputed only when an attribution id is set to a new non-null value, so clearing
-- ids (on delete set null) keeps the snapshot and clients cannot write the name directly.
create function public.set_logged_by_name() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and not (new.logged_by_membership_id is not null and new.logged_by_membership_id is distinct from old.logged_by_membership_id)
     and not (new.sitter_session_id is not null and new.sitter_session_id is distinct from old.sitter_session_id)
     and not (new.display_id is not null and new.display_id is distinct from old.display_id) then
    new.logged_by_name := old.logged_by_name;
    return new;
  end if;

  if tg_op = 'INSERT' and tg_table_name = 'dose_entries'
     and new.logged_by_membership_id is null and new.sitter_session_id is null then
    raise exception 'a dose must record who gave it (an adult or a sitter session)' using errcode = '23514';
  end if;

  new.logged_by_name := coalesce(
    (select m.display_name from public.memberships m
      where m.id = new.logged_by_membership_id and m.household_id = new.household_id),
    (select coalesce(nullif(btrim(s.sitter_name), '') || ' (sitter)', 'Sitter') from public.sitter_sessions s
      where s.id = new.sitter_session_id and s.household_id = new.household_id),
    (select d.name from public.displays d
      where d.id = new.display_id and d.household_id = new.household_id)
  );
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['sleep_entries', 'feeding_entries', 'dose_entries', 'sticker_entries', 'diaper_entries'] loop
    execute format(
      'create trigger set_logged_by_name
       before insert or update of display_id, logged_by_membership_id, sitter_session_id, logged_by_name on public.%I
       for each row execute function public.set_logged_by_name()', t);
  end loop;
end $$;

-- Doses: only first-time void and first-time conflict acknowledgement may change a row, plus attribution
-- ids being cleared by on-delete-set-null. Everything else, including un-voiding, is rejected.
create function public.guard_dose_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.id, new.household_id, new.child_id, new.medicine_id, new.at, new.note, new.logged_offline,
      new.warnings_confirmed, new.logged_by_name, new.created_at)
     is distinct from
     (old.id, old.household_id, old.child_id, old.medicine_id, old.at, old.note, old.logged_offline,
      old.warnings_confirmed, old.logged_by_name, old.created_at) then
    raise exception 'dose entries cannot be edited; void the dose instead' using errcode = '42501';
  end if;
  if old.voided_at is not null
     and (new.voided_at is distinct from old.voided_at or new.void_reason is distinct from old.void_reason) then
    raise exception 'a voided dose cannot be changed or un-voided' using errcode = '42501';
  end if;
  if old.conflict_acknowledged_at is not null
     and new.conflict_acknowledged_at is distinct from old.conflict_acknowledged_at then
    raise exception 'a dose conflict acknowledgement cannot be changed' using errcode = '42501';
  end if;
  if (old.voided_by is not null and new.voided_by is distinct from old.voided_by and new.voided_by is not null)
     or (old.conflict_acknowledged_by is not null and new.conflict_acknowledged_by is not null
         and new.conflict_acknowledged_by is distinct from old.conflict_acknowledged_by)
     or (new.display_id is not null and new.display_id is distinct from old.display_id)
     or (new.logged_by_membership_id is not null and new.logged_by_membership_id is distinct from old.logged_by_membership_id)
     or (new.sitter_session_id is not null and new.sitter_session_id is distinct from old.sitter_session_id) then
    raise exception 'dose attribution cannot be reassigned' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger guard_dose_update before update on public.dose_entries
  for each row execute function public.guard_dose_update();

-- Purging a household or child removes its doses first, so the restrict FK from dose_entries to
-- medicines protects medicines from direct deletion without blocking cascaded purges.
create function public.purge_doses_before_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'households' then
    delete from public.dose_entries where household_id = old.id;
  else
    delete from public.dose_entries where child_id = old.id;
  end if;
  return old;
end $$;

create trigger purge_doses_before_delete before delete on public.households
  for each row execute function public.purge_doses_before_delete();
create trigger purge_doses_before_delete before delete on public.children
  for each row execute function public.purge_doses_before_delete();

-- Deleting a household (or unlinking a child) deletes the child once no household references it.
create function public.purge_unlinked_child() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.children c
  where c.id = old.child_id
    and not exists (select 1 from public.child_households ch where ch.child_id = old.child_id);
  return null;
end $$;

create trigger purge_unlinked_child after delete on public.child_households
  for each row execute function public.purge_unlinked_child();

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
create index on public.dose_entries (medicine_id, child_id);
create index on public.dose_entries (child_id);
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

-- Row-level filters on Realtime DELETE events (household_id=eq.…) require the old row's
-- filter column, so tables that clients can delete from keep full replica identity.
-- With RLS enabled, Realtime still sends only the primary key in old_record.
do $$
declare t text;
begin
  foreach t in array array[
    'sleep_entries', 'feeding_entries', 'sticker_entries', 'diaper_entries', 'routine_progress',
    'routine_day_overrides', 'feature_overrides', 'jots', 'grocery_items', 'sitter_sessions',
    'children', 'child_households', 'medicines', 'routines', 'sticker_categories', 'memberships', 'displays'
  ] loop
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;

-- At most one open sitter session per household.
create unique index sitter_sessions_one_open_per_household
  on public.sitter_sessions (household_id) where ended_at is null;
