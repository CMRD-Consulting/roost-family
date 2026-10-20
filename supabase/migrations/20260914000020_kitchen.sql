-- ─── Kitchen: shopping lists, to-dos, recipes and the meal plan ──────────
-- Spec: docs/superpowers/specs/2026-09-21-roost-kitchen-design.md (§3 shopping lists, §4 to-dos,
-- §5 recipes and meal plan, §6 data model).
--
-- Everything here is household content, not safety configuration, so it carries the same trust level as the
-- grocery list and jots today (kitchen spec §2): members and displays read and write these tables directly,
-- with no PIN and no RPC in the way. What the database still owns is what a client cannot be trusted to keep:
-- household isolation (RLS plus composite foreign keys), the per-household limits, and the two rules that make
-- the list dimension safe to add to a table that is already being written by builds in the field —
-- every household has a list, and an item with no list lands on it.
--
-- Why grocery_items gains a column instead of a new table: the `grocery.*` commands and their offline queue
-- keep their shape, so nothing already queued on a display breaks (kitchen spec §3.1). The column is added in
-- the only order that is safe on a live table: nullable, backfilled, defaulted by a trigger, and only then
-- `not null` with its foreign key.

-- ─── Tables ──────────────────────────────────────────────────────────────
-- A household has one or more shopping lists; every grocery item belongs to exactly one. Lists archive
-- (archived_at), they are never deleted: archiving hides the list and its items everywhere, and the last
-- un-archived list cannot be archived, so the default list below always exists.
-- `unique (id, household_id)` is what lets grocery_items reference a list with a composite key.
create table public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, household_id)
);

-- A household to-do (kitchen spec §4.1): free text, optionally assigned to one adult membership and due on one
-- household-local day. Assignee and display are cleared rather than cascaded when the member or display goes,
-- so the task itself survives (an unassigned task reads as "Family"). A task is open while done_at is null.
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 100),
  assigned_membership_id uuid,
  due_on date,
  display_id uuid,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  foreign key (assigned_membership_id, household_id) references public.memberships (id, household_id)
    on delete set null (assigned_membership_id),
  foreign key (display_id, household_id) references public.displays (id, household_id) on delete set null (display_id)
);

-- Recipes archive like lists and medicines; a plan that points at an archived recipe keeps the day and the
-- title it copied, so archiving never empties the meal plan (kitchen spec §8).
create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  source_url text check (char_length(source_url) between 1 and 500),
  servings smallint check (servings between 1 and 99),
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, household_id)
);

-- An ingredient is deliberately the same shape as a grocery item, so pushing one onto a shopping list is a
-- plain copy of its text (kitchen spec §5.3). `sort` orders the lines; the client rewrites it on reorder.
create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  recipe_id uuid not null,
  text text not null check (char_length(text) between 1 and 100),
  sort smallint not null check (sort between 0 and 199),
  foreign key (recipe_id, household_id) references public.recipes (id, household_id) on delete cascade
);

-- A step is an ingredient with more room: it is read from across the kitchen, not off a shelf label.
create table public.recipe_steps (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  recipe_id uuid not null,
  text text not null check (char_length(text) between 1 and 500),
  sort smallint not null check (sort between 0 and 199),
  foreign key (recipe_id, household_id) references public.recipes (id, household_id) on delete cascade
);

-- One planned dinner per household per day. `text` is always the label the display shows, even when the day was
-- planned from the recipe box: planning copies the recipe's title in, and recipe_id is the extra link that lets
-- the Kitchen screen open the recipe. An archived (or unlinked) recipe therefore leaves the label standing.
create table public.meal_plan_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  day date not null,
  text text not null check (char_length(text) between 1 and 80),
  recipe_id uuid,
  created_at timestamptz not null default now(),
  unique (household_id, day),
  foreign key (recipe_id, household_id) references public.recipes (id, household_id) on delete set null (recipe_id)
);

-- ─── grocery_items joins a list ──────────────────────────────────────────
-- Step 1: the column, nullable, so existing rows and in-flight inserts keep working.
alter table public.grocery_items add column list_id uuid;

-- Step 2: one "Groceries" list per household, created as of the household itself so it is the oldest list and
-- therefore that household's default; then every existing item onto it. Soft-deleted households are included:
-- their rows are still there until the 30-day purge, and they must satisfy the not-null below.
insert into public.shopping_lists (household_id, name, created_at)
select h.id, 'Groceries', h.created_at from public.households h;

update public.grocery_items g
set list_id = l.id
from public.shopping_lists l
where l.household_id = g.household_id and g.list_id is null;

-- Step 3: the default-list trigger, before the column is required, so an insert that arrives during the rest of
-- this migration is already filled in. A `grocery.add` queued by an older build carries no list_id at all, and
-- this is what keeps it replayable: it lands on the household's default list, the oldest un-archived one.
create function private.grocery_item_default_list() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.list_id is null then
    select l.id into new.list_id
    from public.shopping_lists l
    where l.household_id = new.household_id and l.archived_at is null
    order by l.created_at, l.id
    limit 1;
    -- Unreachable through the app: every household is created with a list and keeps at least one.
    if new.list_id is null then
      raise exception 'this household has no shopping list' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

create trigger grocery_items_default_list before insert on public.grocery_items
  for each row execute function private.grocery_item_default_list();

-- Step 4 and 5: now that nothing can insert a null, require it and tie the item to a list of its own household.
-- Archiving a list hides its items; deleting one (which only a purge does) takes them with it.
alter table public.grocery_items alter column list_id set not null;
alter table public.grocery_items
  add foreign key (list_id, household_id) references public.shopping_lists (id, household_id) on delete cascade;

create index on public.grocery_items (list_id);

-- ─── Tonight's dinner becomes the meal plan ──────────────────────────────
-- The main screen's dinner line now reads today's meal-plan entry (kitchen spec §5.5), so each household's
-- current free-text dinner moves to today *in that household's own time zone* — the same day its displays are
-- showing. Blank text is not a dinner: households.dinner_tonight allows '' where a meal-plan entry does not.
-- Nothing writes households.dinner_tonight again; the column and its RPC stay only so a queued `dinner.set`
-- still replays somewhere harmless.
insert into public.meal_plan_entries (household_id, day, text)
select h.id, (now() at time zone h.time_zone)::date, btrim(h.dinner_tonight)
from public.households h
where nullif(btrim(h.dinner_tonight), '') is not null;

-- ─── New households ──────────────────────────────────────────────────────
-- Replaces migration 2's: a new household gets its "Groceries" list in the same transaction as the household,
-- its owner and its sticker categories, so `setup_household` (and `create_household`) can never leave a
-- household that cannot take a grocery item. Everything else is unchanged.
create or replace function private.create_household_for(
  p_user uuid, p_name text, p_time_zone text, p_zip text, p_lat double precision, p_lon double precision,
  p_invite_code text, p_display_name text, p_color text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid;
  v_invites_required boolean;
begin
  if not exists (select 1 from public.consent_records c where c.user_id = p_user and c.health_data_consent) then
    raise exception 'consent required' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = p_time_zone) then
    raise exception 'unknown time zone %', p_time_zone using errcode = '22023';
  end if;

  -- Serialize this user's household creation so the ownership limit holds under concurrency.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('roost.create_household:' || p_user::text, 0));
  if (
    select count(*) from public.memberships m
    join public.households h on h.id = m.household_id and h.deleted_at is null
    where m.user_id = p_user and m.role = 'owner' and m.left_at is null
  ) >= 3 then
    raise exception 'a user can own at most 3 households' using errcode = '22023';
  end if;

  select coalesce((c.value #>> '{}')::boolean, true) into v_invites_required
  from public.app_config c where c.key = 'invites_required';
  v_invites_required := coalesce(v_invites_required, true);

  if v_invites_required then
    perform 1 from public.invite_codes i
    where i.code = upper(p_invite_code) and i.used_at is null
    for update;
    if not found then
      raise exception 'invalid invite code' using errcode = '22023';
    end if;
  end if;

  insert into public.households (name, time_zone, zip, lat, lon)
  values (p_name, p_time_zone, nullif(p_zip, ''), p_lat, p_lon)
  returning id into v_household;

  if v_invites_required then
    update public.invite_codes set used_by_household_id = v_household, used_at = now()
    where code = upper(p_invite_code);
  end if;

  insert into public.memberships (user_id, household_id, role, display_name, color)
  values (p_user, v_household, 'owner', p_display_name, p_color);

  insert into public.sticker_categories (household_id, name, icon_key, sort_order) values
    (v_household, 'Potty', 'potty', 0),
    (v_household, 'Teeth', 'teeth', 1),
    (v_household, 'Tried a new food', 'new-food', 2);

  -- The household's first (and, until someone adds another, default) shopping list (kitchen spec §3.1).
  insert into public.shopping_lists (household_id, name) values (v_household, 'Groceries');

  return v_household;
end $$;

-- ─── Limits ──────────────────────────────────────────────────────────────
-- The per-household limits of kitchen spec §2, enforced where no client can skip them. They are guard rails on
-- a shared surface, not safety rules, and they are deliberately cheap: the counts are read without locking the
-- household, so two displays adding at the same instant — or one multi-row insert, whose rows cannot see each
-- other — can land a few rows past a limit. The cost of that is a few extra rows; the cost of the lock would be
-- serializing every add in the house. Every failure is 22023 with the message the screen shows inline (§8).
-- `old` is only read under `tg_op = 'UPDATE'`: on an insert it is an unassigned record, and touching a field of
-- it would raise before either rule ran.
create function private.enforce_shopping_list_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_count_lists boolean := tg_op = 'INSERT' and new.archived_at is null;
begin
  if tg_op = 'UPDATE' then
    -- Archiving the last un-archived list would leave the household with nowhere to put an item, and the
    -- default of every queued `grocery.add` with it. The Archive action is disabled in that state (spec §8).
    if old.archived_at is null and new.archived_at is not null then
      if not exists (
        select 1 from public.shopping_lists l
        where l.household_id = new.household_id and l.id <> new.id and l.archived_at is null
      ) then
        raise exception 'a household keeps at least one list' using errcode = '22023';
      end if;
    -- Restoring counts against the limit too: archiving is not a way past it.
    elsif old.archived_at is not null and new.archived_at is null then
      v_count_lists := true;
    end if;
  end if;

  if v_count_lists and (
    select count(*) from public.shopping_lists l
    where l.household_id = new.household_id and l.archived_at is null
  ) >= 6 then
    raise exception 'a household can have at most 6 shopping lists' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger shopping_lists_rules before insert or update of archived_at on public.shopping_lists
  for each row execute function private.enforce_shopping_list_rules();

-- Runs after grocery_items_default_list (row triggers fire in name order, and 'd' < 'l'), so list_id is filled
-- by the time it counts. Checked items do not count: a long list is the open one, and clearing the checked rows
-- is exactly what the list's "Clear checked" action is for.
create function private.enforce_grocery_item_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (
    select count(*) from public.grocery_items g
    where g.list_id = new.list_id and g.checked_at is null
  ) >= 200 then
    raise exception 'this list holds at most 200 items' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger grocery_items_limit before insert on public.grocery_items
  for each row execute function private.enforce_grocery_item_limit();

create function private.enforce_task_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.tasks t where t.household_id = new.household_id and t.done_at is null) >= 200 then
    raise exception 'a household can have at most 200 open tasks' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger tasks_limit before insert on public.tasks
  for each row execute function private.enforce_task_limit();

create function private.enforce_recipe_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (
    select count(*) from public.recipes r
    where r.household_id = new.household_id and r.archived_at is null
  ) >= 300 then
    raise exception 'a household can have at most 300 recipes' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger recipes_limit before insert on public.recipes
  for each row execute function private.enforce_recipe_limit();

create function private.enforce_recipe_ingredient_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.recipe_ingredients i where i.recipe_id = new.recipe_id) >= 50 then
    raise exception 'a recipe holds at most 50 ingredients' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger recipe_ingredients_limit before insert on public.recipe_ingredients
  for each row execute function private.enforce_recipe_ingredient_limit();

create function private.enforce_recipe_step_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.recipe_steps s where s.recipe_id = new.recipe_id) >= 40 then
    raise exception 'a recipe holds at most 40 steps' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger recipe_steps_limit before insert on public.recipe_steps
  for each row execute function private.enforce_recipe_step_limit();

-- ─── Client access ───────────────────────────────────────────────────────
-- One policy per table, `for all` on household membership: adults and displays read and write their own
-- household's Kitchen and nothing else. Full replica identity so Realtime DELETE events carry household_id for
-- the `household_id=eq.…` filter the displays subscribe with (as for jots and grocery items).
do $$
declare t text;
begin
  foreach t in array array[
    'shopping_lists', 'tasks', 'recipes', 'recipe_ingredients', 'recipe_steps', 'meal_plan_entries'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (private.is_household_member(household_id))
         with check (private.is_household_member(household_id))',
      t || '_member_all', t);
    -- Supabase's default privileges hand anon everything on a new table in public; take it all back, and leave
    -- authenticated with the four row privileges only.
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke truncate, references, trigger on public.%I from authenticated', t);
    if current_setting('server_version_num')::int >= 170000 then
      execute format('revoke maintain on public.%I from authenticated', t);
    end if;
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;

alter publication supabase_realtime add table
  public.shopping_lists, public.tasks, public.recipes, public.recipe_ingredients, public.recipe_steps,
  public.meal_plan_entries;

create index on public.shopping_lists (household_id);
create index on public.tasks (household_id);
create index on public.recipes (household_id);
create index on public.recipe_ingredients (household_id);
create index on public.recipe_ingredients (recipe_id);
create index on public.recipe_steps (household_id);
create index on public.recipe_steps (recipe_id);
-- meal_plan_entries needs no index of its own: `unique (household_id, day)` is exactly the index the snapshot's
-- 14-day window and the day lookups use.

-- ─── Take list ───────────────────────────────────────────────────────────
-- The phone page stays one household-wide link (kitchen spec §3.3); it now groups the items under their list's
-- name, so one scan covers every stop. Replaced rather than `create or replace`d: adding output columns changes
-- the function's return type, which Postgres will not replace in place. Its grants are restated below.
-- Items of an archived list are left out, because archiving hides a list and its items everywhere.
drop function public.take_list_items(text);

create function public.take_list_items(p_token text)
returns table (out_id uuid, out_text text, out_checked boolean, out_list_id uuid, out_list_name text)
language plpgsql stable security definer set search_path = '' as $$
declare v_household uuid := private.take_list_household(p_token);
begin
  return query
  select g.id, g.text, g.checked_at is not null, l.id, l.name
  from public.grocery_items g
  join public.shopping_lists l on l.id = g.list_id and l.household_id = g.household_id
  where g.household_id = v_household
    and l.archived_at is null
    and (g.checked_at is null or g.checked_at > now() - interval '24 hours')
  -- Lists in the order the displays show them (oldest first, id to break a tie so one list's items stay
  -- together), then each list's unchecked items oldest first, then the ones checked in the last 24 hours.
  order by l.created_at, l.id, g.checked_at is not null, g.created_at, g.id;
end $$;

-- ─── Retention ───────────────────────────────────────────────────────────
-- Replaces migration 13's: as before, plus the Kitchen's own retention (kitchen spec §6). A meal plan older
-- than 60 days, an item checked off more than 30 days ago and a task finished more than 90 days ago are all
-- history no screen reads; nothing else in the Kitchen expires, because a list, a recipe or an open task is
-- still in use however old it is.
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

  delete from public.meal_plan_entries m where m.day < current_date - 60;
  delete from public.grocery_items g where g.checked_at < now() - interval '30 days';
  delete from public.tasks t where t.done_at < now() - interval '90 days';

  perform private.purge_calendar_oauth_states();
  perform private.purge_old_exports();
  return v_count;
end $$;

-- ─── Grants ──────────────────────────────────────────────────────────────
-- Explicit revokes after explicit creates: functions in `private` get execute for PUBLIC by default (the
-- default-privilege revokes in the RLS migration cover schema public only), and a trigger function is called by
-- the server, never by a client.
revoke execute on function
  private.grocery_item_default_list(),
  private.enforce_shopping_list_rules(),
  private.enforce_grocery_item_limit(),
  private.enforce_task_limit(),
  private.enforce_recipe_limit(),
  private.enforce_recipe_ingredient_limit(),
  private.enforce_recipe_step_limit()
from public, anon, authenticated, service_role;

revoke execute on function
  private.create_household_for(uuid, text, text, text, double precision, double precision, text, text, text),
  private.purge_deleted_households()
from public, anon, authenticated;

-- The replaced take_list_items starts with fresh privileges; these are the ones it had (migration 4).
revoke execute on function public.take_list_items(text) from public, anon, authenticated;
grant execute on function public.take_list_items(text) to anon, authenticated;
