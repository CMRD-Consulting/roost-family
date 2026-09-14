-- RLS, grants and integrity regression checks. Runs in one transaction that is rolled back.
--   psql -h 127.0.0.1 -p 55432 -U postgres -d roost_check -v ON_ERROR_STOP=1 -f supabase/manual-checks/rls_smoke.sql
-- Each check is announced with \echo; a failed assertion raises and (with ON_ERROR_STOP) stops the script.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
begin;

-- ─── Helpers (temporary, invoker rights: they run as whatever role is current) ───
create function pg_temp.v(p_name text) returns uuid
language sql stable as $$ select current_setting('smoke.' || p_name)::uuid $$;

create function pg_temp.expect(p_label text, p_ok boolean) returns void
language plpgsql as $$
begin
  if p_ok is not true then
    raise exception 'FAIL: %', p_label;
  end if;
end $$;

-- Runs p_sql and requires it to fail with p_sqlstate.
create function pg_temp.expect_error(p_label text, p_sql text, p_sqlstate text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate <> p_sqlstate then
      raise exception 'FAIL: % (expected SQLSTATE %, got %: %)', p_label, p_sqlstate, sqlstate, sqlerrm;
    end if;
    return;
  end;
  raise exception 'FAIL: % (statement succeeded but should have failed)', p_label;
end $$;

grant execute on all functions in schema pg_temp to anon, authenticated;

\set A '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","is_anonymous":false}'
\set B '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated","is_anonymous":false}'
\set D '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated","is_anonymous":true}'
\set D_NOT_ANON '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated","is_anonymous":false}'
\set E '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated","is_anonymous":true}'
\set F '{"sub":"00000000-0000-0000-0000-00000000000f","role":"authenticated","is_anonymous":false}'

-- ─── Fixtures ────────────────────────────────────────────────────────────
-- Adults A and B, adult C (deleted later), anonymous device users D (A's display) and E (B's display),
-- adult F (runs setup_household).
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, is_anonymous, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@roost.test', '{}', '{}', false, now(), now()),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@roost.test', '{}', '{}', false, now(), now()),
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@roost.test', '{}', '{}', false, now(), now()),
  ('00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, '{}', '{}', true, now(), now()),
  ('00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, '{}', '{}', true, now(), now()),
  ('00000000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f@roost.test', '{}', '{}', false, now(), now());
insert into public.invite_codes (code) values ('SMOKE1'), ('SMOKE2'), ('SMOKE3'), ('SMOKE4'), ('SMOKE5'), ('SMOKE6');

set local role authenticated;

-- As adult A: consent + household + child + PIN
select set_config('request.jwt.claims', :'A', true);
select public.record_consent('2026-09-14', true);
select public.create_household('A family', 'America/New_York', '28202', null, null, 'SMOKE1', 'Alex', '#5B6ACF') as household_a \gset
select public.add_child(:'household_a', 'Kid A', '2024-01-01', '#C2477A') as kid_a \gset
select public.set_my_pin(:'household_a', '4242');
select m.id as membership_a from public.memberships m where m.user_id = '00000000-0000-0000-0000-00000000000a' \gset

-- As adult B: own household + child + PIN
select set_config('request.jwt.claims', :'B', true);
select public.record_consent('2026-09-14', true);
select public.create_household('B family', 'America/Chicago', '60601', null, null, 'SMOKE2', 'Blair', '#2F86A6') as household_b \gset
select public.add_child(:'household_b', 'Kid B', '2023-01-01', '#8A56AC') as kid_b \gset
select public.set_my_pin(:'household_b', '1111');
select m.id as membership_b from public.memberships m where m.user_id = '00000000-0000-0000-0000-00000000000b' \gset
select s.id as category_b from public.sticker_categories s where s.household_id = :'household_b' limit 1 \gset
insert into public.sitter_sessions (household_id, sitter_name) values (:'household_b', 'Robin') returning id as sitter_session_b \gset

-- Configuration rows are written by privileged code (future PIN-checked RPCs); create them as postgres.
reset role;
insert into public.medicines (household_id, child_id, name, min_interval_hours, max_doses_per_24h)
values (:'household_a', :'kid_a', 'Test medicine', 6, 4) returning id as medicine_a \gset
insert into public.routines (household_id, child_id, name) values (:'household_b', :'kid_b', 'B routine') returning id as routine_b \gset
insert into public.routines (household_id, child_id, name) values (:'household_a', :'kid_a', 'A routine') returning id as routine_a \gset
select set_config('smoke.household_a', :'household_a', true), set_config('smoke.household_b', :'household_b', true),
       set_config('smoke.kid_a', :'kid_a', true), set_config('smoke.kid_b', :'kid_b', true),
       set_config('smoke.membership_a', :'membership_a', true), set_config('smoke.membership_b', :'membership_b', true),
       set_config('smoke.category_b', :'category_b', true), set_config('smoke.sitter_session_b', :'sitter_session_b', true),
       set_config('smoke.medicine_a', :'medicine_a', true), set_config('smoke.routine_a', :'routine_a', true),
       set_config('smoke.routine_b', :'routine_b', true);
set local role authenticated;

-- ─── Cross-household isolation ───────────────────────────────────────────
\echo '[01] B cannot see A''s household or children'
select set_config('request.jwt.claims', :'B', true);
select pg_temp.expect('B sees A household', (select count(*) from public.households where id = pg_temp.v('household_a')) = 0);
select pg_temp.expect('B sees only its own child', (select count(*) from public.children) = 1
  and (select id from public.children) = pg_temp.v('kid_b'));

-- ─── Displays ────────────────────────────────────────────────────────────
\echo '[02] A registers a display and anonymous device D claims it'
select set_config('request.jwt.claims', :'A', true);
select out_display_id as display_a1, out_claim_token as token_a1 from public.register_display(:'household_a', 'Kitchen tablet') \gset
select set_config('request.jwt.claims', :'D', true);
select public.claim_display(:'token_a1');
select set_config('smoke.display_a1', :'display_a1', true);

\echo '[03] Display D sees A''s children and none of B''s'
select pg_temp.expect('display sees A children', (select count(*) from public.children) = 1
  and (select id from public.children) = pg_temp.v('kid_a'));

\echo '[04] Display D cannot update children or households, or insert medicines'
select pg_temp.expect_error('display updates children',
  $q$update public.children set name = 'Hacked' where id = pg_temp.v('kid_a')$q$, '42501');
select pg_temp.expect_error('display updates households',
  $q$update public.households set name = 'Hacked' where id = pg_temp.v('household_a')$q$, '42501');
select pg_temp.expect_error('display inserts medicine',
  $q$insert into public.medicines (household_id, child_id, name, min_interval_hours) values (pg_temp.v('household_a'), pg_temp.v('kid_a'), 'X', 4)$q$, '42501');
select pg_temp.expect_error('display deletes a routine',
  $q$delete from public.routines where id = pg_temp.v('routine_a')$q$, '42501');

\echo '[05] A display-bound user is not an adult even with a non-anonymous token'
select set_config('request.jwt.claims', :'D_NOT_ANON', true);
select pg_temp.expect_error('display-bound user adds child',
  $q$select public.add_child(pg_temp.v('household_a'), 'Kid X', '2024-01-01', '#C2477A')$q$, '42501');

\echo '[06] set_dinner_tonight: member display can set it; non-member and over-length rejected'
select set_config('request.jwt.claims', :'D', true);
select public.set_dinner_tonight(:'household_a', '  Pasta  ');
select pg_temp.expect('dinner set by display', (select dinner_tonight from public.households where id = pg_temp.v('household_a')) = 'Pasta');
select pg_temp.expect_error('dinner over 80 chars',
  $q$select public.set_dinner_tonight(pg_temp.v('household_a'), repeat('x', 81))$q$, '22023');
select set_config('request.jwt.claims', :'B', true);
select pg_temp.expect_error('non-member sets dinner',
  $q$select public.set_dinner_tonight(pg_temp.v('household_a'), 'Soup')$q$, '42501');

-- ─── Composite household foreign keys ────────────────────────────────────
select set_config('request.jwt.claims', :'A', true);
\echo '[07] Cross-household sticker category rejected'
select pg_temp.expect_error('sticker entry with B category',
  $q$insert into public.sticker_entries (household_id, child_id, category_id, at)
     values (pg_temp.v('household_a'), pg_temp.v('kid_a'), pg_temp.v('category_b'), now())$q$, '23503');

\echo '[08] Cross-household routine rejected'
select pg_temp.expect_error('routine progress with B routine',
  $q$insert into public.routine_progress (household_id, child_id, routine_id, day)
     values (pg_temp.v('household_a'), pg_temp.v('kid_a'), pg_temp.v('routine_b'), current_date)$q$, '23503');

\echo '[08b] set_routine_step: members set and unset steps without losing each other''s updates'
reset role;
update public.routines set steps = '[{"label":"Teeth"},{"label":"Shoes"}]' where id = :'routine_a';
update public.routines set steps = '[{"label":"Bath"}]' where id = :'routine_b';
set local role authenticated;
select set_config('request.jwt.claims', :'A', true);
select pg_temp.expect('A sets step 0', public.set_routine_step(pg_temp.v('kid_a'), pg_temp.v('routine_a'), '2026-09-14', 0, true) = '{0}'::int[]);
-- Two separate calls (e.g. two tablets): the second must add to the first, not overwrite it.
select set_config('request.jwt.claims', :'D', true);
select pg_temp.expect('display sets step 1', public.set_routine_step(pg_temp.v('kid_a'), pg_temp.v('routine_a'), '2026-09-14', 1, true) = '{0,1}'::int[]);
select pg_temp.expect('setting a done step again is a no-op', public.set_routine_step(pg_temp.v('kid_a'), pg_temp.v('routine_a'), '2026-09-14', 0, true) = '{0,1}'::int[]);
select pg_temp.expect('stored array is {0,1}', (select completed_step_indexes from public.routine_progress
  where child_id = pg_temp.v('kid_a') and routine_id = pg_temp.v('routine_a') and day = '2026-09-14') = '{0,1}'::int[]);
select pg_temp.expect('stored row is in A household', (select household_id from public.routine_progress
  where child_id = pg_temp.v('kid_a') and routine_id = pg_temp.v('routine_a') and day = '2026-09-14') = pg_temp.v('household_a'));
select set_config('request.jwt.claims', :'A', true);
select pg_temp.expect('A unsets step 0', public.set_routine_step(pg_temp.v('kid_a'), pg_temp.v('routine_a'), '2026-09-14', 0, false) = '{1}'::int[]);
select pg_temp.expect('unsetting a step that is not done is a no-op', public.set_routine_step(pg_temp.v('kid_a'), pg_temp.v('routine_a'), '2026-09-14', 0, false) = '{1}'::int[]);
select pg_temp.expect('set 1 again then 0 keeps the array sorted', public.set_routine_step(pg_temp.v('kid_a'), pg_temp.v('routine_a'), '2026-09-14', 0, true) = '{0,1}'::int[]);
select pg_temp.expect('unsetting on a new day creates an empty row', public.set_routine_step(pg_temp.v('kid_a'), pg_temp.v('routine_a'), '2026-09-15', 1, false) = '{}'::int[]);
select pg_temp.expect_error('step index past the last step',
  $q$select public.set_routine_step(pg_temp.v('kid_a'), pg_temp.v('routine_a'), '2026-09-14', 2, true)$q$, '22023');
select pg_temp.expect_error('negative step index',
  $q$select public.set_routine_step(pg_temp.v('kid_a'), pg_temp.v('routine_a'), '2026-09-14', -1, true)$q$, '22023');
select pg_temp.expect_error('routine of another child',
  $q$select public.set_routine_step(pg_temp.v('kid_a'), pg_temp.v('routine_b'), '2026-09-14', 0, true)$q$, '22023');
select set_config('request.jwt.claims', :'B', true);
select pg_temp.expect_error('other household sets a step',
  $q$select public.set_routine_step(pg_temp.v('kid_a'), pg_temp.v('routine_a'), '2026-09-14', 0, true)$q$, '42501');
select pg_temp.expect_error('other household unsets a step',
  $q$select public.set_routine_step(pg_temp.v('kid_a'), pg_temp.v('routine_a'), '2026-09-14', 1, false)$q$, '42501');
reset role;
select pg_temp.expect('row still {0,1}', (select completed_step_indexes from public.routine_progress
  where child_id = :'kid_a' and routine_id = :'routine_a' and day = '2026-09-14') = '{0,1}'::int[]);
select pg_temp.expect('anon cannot execute set_routine_step',
  not has_function_privilege('anon', 'public.set_routine_step(uuid, uuid, date, int, boolean)', 'execute'));
select pg_temp.expect('authenticated can execute set_routine_step',
  has_function_privilege('authenticated', 'public.set_routine_step(uuid, uuid, date, int, boolean)', 'execute'));
set local role authenticated;
select set_config('request.jwt.claims', :'A', true);

\echo '[09] Cross-household membership attribution rejected'
select pg_temp.expect_error('sleep entry logged by B membership',
  $q$insert into public.sleep_entries (household_id, child_id, start_at, type, logged_by_membership_id)
     values (pg_temp.v('household_a'), pg_temp.v('kid_a'), now(), 'nap', pg_temp.v('membership_b'))$q$, '23503');

\echo '[10] Cross-household sitter session rejected'
select pg_temp.expect_error('sleep entry in B sitter session',
  $q$insert into public.sleep_entries (household_id, child_id, start_at, type, sitter_session_id)
     values (pg_temp.v('household_a'), pg_temp.v('kid_a'), now(), 'nap', pg_temp.v('sitter_session_b'))$q$, '23503');

\echo '[11] Same-household attribution works and snapshots the name'
insert into public.sleep_entries (household_id, child_id, start_at, type, logged_by_membership_id, logged_by_name)
values (:'household_a', :'kid_a', now(), 'nap', :'membership_a', 'Spoofed') returning id as sleep_a \gset
select set_config('smoke.sleep_a', :'sleep_a', true);
select pg_temp.expect('sleep logged_by_name = Alex', (select logged_by_name from public.sleep_entries where id = pg_temp.v('sleep_a')) = 'Alex');
update public.sleep_entries set logged_by_name = 'Spoofed' where id = :'sleep_a';
select pg_temp.expect('logged_by_name not client-writable', (select logged_by_name from public.sleep_entries where id = pg_temp.v('sleep_a')) = 'Alex');

\echo '[12] Members can append to the settings audit, attributed only within their household'
insert into public.settings_audit (household_id, membership_id, change) values (:'household_a', :'membership_a', '{"k":"v"}');
select pg_temp.expect_error('settings audit attributed to B membership',
  $q$insert into public.settings_audit (household_id, membership_id, change) values (pg_temp.v('household_a'), pg_temp.v('membership_b'), '{}')$q$, '23503');
select pg_temp.expect_error('settings audit update',
  $q$update public.settings_audit set change = '{}' where household_id = pg_temp.v('household_a')$q$, '42501');

-- ─── Doses ───────────────────────────────────────────────────────────────
\echo '[13] Dose insert requires an adult or sitter session'
select pg_temp.expect_error('dose without who-gave-it',
  $q$insert into public.dose_entries (household_id, child_id, medicine_id, at)
     values (pg_temp.v('household_a'), pg_temp.v('kid_a'), pg_temp.v('medicine_a'), now())$q$, '23514');
insert into public.dose_entries (household_id, child_id, medicine_id, at, logged_by_membership_id)
values (:'household_a', :'kid_a', :'medicine_a', now(), :'membership_a') returning id as dose_a \gset
select set_config('smoke.dose_a', :'dose_a', true);
select pg_temp.expect('dose logged_by_name = Alex', (select logged_by_name from public.dose_entries where id = pg_temp.v('dose_a')) = 'Alex');

\echo '[14] Members cannot UPDATE or DELETE doses'
select pg_temp.expect_error('member updates dose',
  $q$update public.dose_entries set note = 'edited' where id = pg_temp.v('dose_a')$q$, '42501');
select pg_temp.expect_error('member deletes dose',
  $q$delete from public.dose_entries where id = pg_temp.v('dose_a')$q$, '42501');

\echo '[15] void_dose rejects a wrong PIN and a PIN from another household'
select set_config('request.jwt.claims', :'D', true);
select pg_temp.expect_error('void with wrong PIN',
  $q$select public.void_dose(pg_temp.v('dose_a'), pg_temp.v('membership_a'), '0000', 'logged by mistake')$q$, '42501');
select pg_temp.expect_error('void with other household membership',
  $q$select public.void_dose(pg_temp.v('dose_a'), pg_temp.v('membership_b'), '1111', 'logged by mistake')$q$, '42501');
select set_config('request.jwt.claims', :'B', true);
select pg_temp.expect_error('non-member voids dose',
  $q$select public.void_dose(pg_temp.v('dose_a'), pg_temp.v('membership_b'), '1111', 'logged by mistake')$q$, '42501');

\echo '[16] void_dose with the right PIN works (called from the display)'
select set_config('request.jwt.claims', :'D', true);
select public.void_dose(:'dose_a', :'membership_a', '4242', 'logged by mistake');
select pg_temp.expect('dose voided', (select voided_at is not null and voided_by = pg_temp.v('membership_a') and void_reason = 'logged by mistake'
  from public.dose_entries where id = pg_temp.v('dose_a')));

\echo '[17] Voiding twice and un-voiding are impossible'
select pg_temp.expect_error('void already voided dose',
  $q$select public.void_dose(pg_temp.v('dose_a'), pg_temp.v('membership_a'), '4242', 'again')$q$, '22023');
select pg_temp.expect_error('member un-voids dose',
  $q$update public.dose_entries set voided_at = null, voided_by = null, void_reason = null where id = pg_temp.v('dose_a')$q$, '42501');
reset role;
select pg_temp.expect_error('privileged role un-voids dose',
  $q$update public.dose_entries set voided_at = null, voided_by = null, void_reason = null where id = pg_temp.v('dose_a')$q$, '42501');
set local role authenticated;

\echo '[18] acknowledge_dose_conflict checks the PIN and records who acknowledged'
select set_config('request.jwt.claims', :'D', true);
select pg_temp.expect_error('acknowledge with wrong PIN',
  $q$select public.acknowledge_dose_conflict(pg_temp.v('dose_a'), pg_temp.v('membership_a'), '9999')$q$, '42501');
select public.acknowledge_dose_conflict(:'dose_a', :'membership_a', '4242');
select pg_temp.expect('conflict acknowledged', (select conflict_acknowledged_at is not null and conflict_acknowledged_by = pg_temp.v('membership_a')
  from public.dose_entries where id = pg_temp.v('dose_a')));

\echo '[19] Members cannot DELETE medicines'
select set_config('request.jwt.claims', :'A', true);
select pg_temp.expect_error('member deletes medicine',
  $q$delete from public.medicines where id = pg_temp.v('medicine_a')$q$, '42501');
reset role;
select pg_temp.expect_error('medicine with doses cannot be deleted even by a privileged role',
  $q$delete from public.medicines where id = pg_temp.v('medicine_a')$q$, '23503');
set local role authenticated;

\echo '[20] verify_pin true for the right PIN, false for a wrong one'
select set_config('request.jwt.claims', :'A', true);
select pg_temp.expect('verify_pin correct', public.verify_pin(pg_temp.v('membership_a'), '4242'));
select pg_temp.expect('verify_pin wrong', not public.verify_pin(pg_temp.v('membership_a'), '0000'));

-- ─── Display revoke and re-claim ─────────────────────────────────────────
\echo '[21] After revoke_display, the display sees nothing and my_display reports revoked'
select public.revoke_display(:'display_a1');
select set_config('request.jwt.claims', :'D', true);
select pg_temp.expect('revoked display sees 0 children', (select count(*) from public.children) = 0);
select pg_temp.expect('revoked display sees 0 doses', (select count(*) from public.dose_entries) = 0);
select pg_temp.expect('my_display revoked', (select out_revoked from public.my_display()));
select pg_temp.expect('heartbeat false for a revoked display', not public.display_heartbeat());

\echo '[22] claim_display works for a device whose previous display was revoked'
select set_config('request.jwt.claims', :'A', true);
select out_claim_token as token_a2 from public.register_display(:'household_a', 'Playroom') \gset
select out_claim_token as token_a3 from public.register_display(:'household_a', 'Hallway') \gset
select set_config('request.jwt.claims', :'D', true);
select public.claim_display(:'token_a2');
select pg_temp.expect('re-claimed display sees A children', (select count(*) from public.children) = 1);
select pg_temp.expect('my_display active', (select not out_revoked and out_name = 'Playroom' from public.my_display()));
select pg_temp.expect('heartbeat true for an active display', public.display_heartbeat());

select set_config('request.jwt.claims', :'A', true);
select pg_temp.expect('heartbeat false for an unbound user', not public.display_heartbeat());
select set_config('request.jwt.claims', :'D', true);

\echo '[23] claim_display rejects a device already bound to an active display'
select pg_temp.expect_error('claim while bound to active display',
  format('select public.claim_display(%L)', :'token_a3'), '22023');

-- ─── B's display ─────────────────────────────────────────────────────────
\echo '[24] B''s display still sees 0 of A''s rows in every household-scoped table'
select set_config('request.jwt.claims', :'B', true);
select out_claim_token as token_b1 from public.register_display(:'household_b', 'B kitchen') \gset
select set_config('request.jwt.claims', :'E', true);
select public.claim_display(:'token_b1');
do $$
declare
  t text;
  n bigint;
  checked int := 0;
begin
  for t in
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'household_id' and not a.attisdropped
    where case when c.relkind = 'r' then has_table_privilege(c.oid, 'select') else false end
  loop
    execute format('select count(*) from public.%I where household_id = $1', t) into n using pg_temp.v('household_a');
    if n <> 0 then
      raise exception 'FAIL: B display sees % rows of A in %', n, t;
    end if;
    checked := checked + 1;
  end loop;
  if checked < 19 then
    raise exception 'FAIL: expected to scan at least 19 household-scoped tables, scanned %', checked;
  end if;
  if exists (select 1 from public.households where id = pg_temp.v('household_a'))
     or exists (select 1 from public.children where id = pg_temp.v('kid_a'))
     or exists (select 1 from public.feature_overrides where child_id = pg_temp.v('kid_a')) then
    raise exception 'FAIL: B display sees A household, child or overrides';
  end if;
  if (select count(*) from public.children) <> 1 then
    raise exception 'FAIL: B display should see exactly its own child';
  end if;
end $$;

-- ─── anon ────────────────────────────────────────────────────────────────
\echo '[25] anon cannot execute any public function or read any table'
reset role;
select pg_temp.expect('anon has no execute on any public function', not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')));
select pg_temp.expect('anon has no privilege on any public table', not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and case when c.relkind = 'r' then has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate, references, trigger') else false end));
select pg_temp.expect('anon has no privilege on any public sequence', not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and case when c.relkind = 'S' then has_sequence_privilege('anon', c.oid, 'usage, select, update') else false end));
select pg_temp.expect('anon has no execute on private functions', not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and has_function_privilege('anon', p.oid, 'execute')));
select pg_temp.expect('authenticated cannot execute private write helpers', not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname in ('create_household_for', 'add_child_to', 'set_pin_for', 'pin_ok')
    and has_function_privilege('authenticated', p.oid, 'execute')));
-- Privilege checks rather than calls made as anon: on the Supabase Postgres image, invoking a
-- pg_temp helper under `set role anon` that then hits a permission error segfaults the backend.
-- The REST-level anon check lives in supabase/manual-checks/anon_api_check.sh.
select pg_temp.expect('anon cannot execute create_household',
  not has_function_privilege('anon', 'public.create_household(text, text, text, double precision, double precision, text, text, text)', 'execute'));
select pg_temp.expect('anon cannot execute verify_pin',
  not has_function_privilege('anon', 'public.verify_pin(uuid, text)', 'execute'));
select pg_temp.expect('anon cannot select households',
  not has_table_privilege('anon', 'public.households', 'select'));
select pg_temp.expect('authenticated has no truncate/references/trigger', not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and case when c.relkind = 'r' then has_table_privilege('authenticated', c.oid, 'truncate, references, trigger') else false end));
select pg_temp.expect('authenticated cannot execute trigger functions', not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prorettype = 'trigger'::regtype and has_function_privilege('authenticated', p.oid, 'execute')));
set local role authenticated;

-- ─── Deleted households ──────────────────────────────────────────────────
\echo '[26] A soft-deleted household is invisible to its members and displays'
reset role;
update public.households set deleted_at = now() where id = :'household_b';
set local role authenticated;
select set_config('request.jwt.claims', :'B', true);
select pg_temp.expect('owner sees no deleted household', (select count(*) from public.households) = 0);
select pg_temp.expect('owner sees no children of deleted household', (select count(*) from public.children) = 0);
select set_config('request.jwt.claims', :'E', true);
select pg_temp.expect('display sees no deleted household', (select count(*) from public.sticker_categories) = 0);
reset role;
update public.households set deleted_at = null where id = :'household_b';
set local role authenticated;

-- ─── Validation ──────────────────────────────────────────────────────────
\echo '[27] Invalid time zone, coordinates and photo paths rejected'
reset role;
select pg_temp.expect_error('invalid time_zone update',
  $q$update public.households set time_zone = 'Mars/Olympus_Mons' where id = pg_temp.v('household_a')$q$, '22023');
select pg_temp.expect_error('latitude out of range',
  $q$update public.households set lat = 91 where id = pg_temp.v('household_a')$q$, '23514');
select pg_temp.expect_error('oversized sitter_info',
  $q$update public.households set sitter_info = jsonb_build_object('notes', (select string_agg(md5(i::text), '') from generate_series(1, 1000) i)) where id = pg_temp.v('household_a')$q$, '23514');
select pg_temp.expect_error('photo outside household prefix',
  $q$insert into public.photos (household_id, storage_path, kind) values (pg_temp.v('household_a'), pg_temp.v('household_b')::text || '/x.jpg', 'avatar')$q$, '23514');
insert into public.photos (household_id, storage_path, kind) values (:'household_a', :'household_a' || '/avatar.jpg', 'avatar');
set local role authenticated;

\echo '[28] A user can own at most 3 households'
select set_config('request.jwt.claims', :'A', true);
select public.create_household('A2', 'America/New_York', '28202', null, null, 'SMOKE3', 'Alex', '#5B6ACF');
select public.create_household('A3', 'America/New_York', '28202', null, null, 'SMOKE4', 'Alex', '#5B6ACF');
select pg_temp.expect_error('fourth household',
  $q$select public.create_household('A4', 'America/New_York', '28202', null, null, 'SMOKE5', 'Alex', '#5B6ACF')$q$, '22023');

-- ─── Account and household deletion ──────────────────────────────────────
\echo '[29] Deleting an account that logged doses succeeds and keeps logged_by_name'
reset role;
insert into public.memberships (user_id, household_id, role, display_name, color)
values ('00000000-0000-0000-0000-00000000000c', :'household_a', 'adult', 'Casey', '#2F86A6') returning id as membership_c \gset
insert into public.dose_entries (household_id, child_id, medicine_id, at, logged_by_membership_id)
values (:'household_a', :'kid_a', :'medicine_a', now(), :'membership_c') returning id as dose_c \gset
select set_config('smoke.dose_c', :'dose_c', true);
insert into public.member_pins (membership_id, pin_hash) values (:'membership_c', extensions.crypt('7777', extensions.gen_salt('bf', 8)));
set local role authenticated;
select set_config('request.jwt.claims', :'A', true);
select public.void_dose(:'dose_c', :'membership_c', '7777', 'duplicate');
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('dose keeps logged_by_name after account deletion', (
  select logged_by_membership_id is null and voided_by is null and voided_at is not null and logged_by_name = 'Casey'
  from public.dose_entries where id = pg_temp.v('dose_c')));

\echo '[30] Deleting a household purges its children (no orphans)'
delete from public.households where id = :'household_a';
select pg_temp.expect('no orphan children', not exists (
  select 1 from public.children c where not exists (select 1 from public.child_households ch where ch.child_id = c.id)));
select pg_temp.expect('A child gone', not exists (select 1 from public.children where id = pg_temp.v('kid_a')));
select pg_temp.expect('A doses gone', not exists (select 1 from public.dose_entries where household_id = pg_temp.v('household_a')));
select pg_temp.expect('B child untouched', exists (select 1 from public.children where id = pg_temp.v('kid_b')));

\echo '[31] Realtime DELETE payloads carry only surrogate ids on former natural-key tables'
select pg_temp.expect('surrogate primary keys', (
  select count(*) from pg_constraint k
  where k.contype = 'p' and k.conrelid in ('public.routine_progress'::regclass, 'public.routine_day_overrides'::regclass, 'public.feature_overrides'::regclass)
    and k.conkey = array[(select a.attnum from pg_attribute a where a.attrelid = k.conrelid and a.attname = 'id')]::int2[]
) = 3);

-- ─── setup_household ─────────────────────────────────────────────────────
\echo '[32] setup_household rolls back everything when a child is invalid'
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'F', true);
select public.record_consent('2026-09-14', true);
select pg_temp.expect_error('setup with a 41-character child name',
  $q$select public.setup_household('F family', 'America/Denver', '', null, null, 'smoke6', 'Frankie', '#2C7F8C',
     jsonb_build_array(jsonb_build_object('name', 'Ok kid', 'birthday', '2024-01-01', 'color', '#653437'),
                       jsonb_build_object('name', repeat('x', 41), 'birthday', '2024-01-01', 'color', '#887425')), '2468')$q$,
  '22023');
select pg_temp.expect_error('setup with a future birthday',
  $q$select public.setup_household('F family', 'America/Denver', '', null, null, 'SMOKE6', 'Frankie', '#2C7F8C',
     jsonb_build_array(jsonb_build_object('name', 'Kid', 'birthday', (current_date + 2)::text, 'color', '#653437')), '2468')$q$,
  '22023');
select pg_temp.expect_error('setup with no children',
  $q$select public.setup_household('F family', 'America/Denver', '', null, null, 'SMOKE6', 'Frankie', '#2C7F8C', '[]'::jsonb, '2468')$q$,
  '22023');
select pg_temp.expect_error('setup with a bad PIN',
  $q$select public.setup_household('F family', 'America/Denver', '', null, null, 'SMOKE6', 'Frankie', '#2C7F8C',
     jsonb_build_array(jsonb_build_object('name', 'Kid', 'birthday', '2024-01-01', 'color', '#653437')), '24x8')$q$,
  '22023');
reset role;
select pg_temp.expect('failed setup left no membership', not exists (
  select 1 from public.memberships where user_id = '00000000-0000-0000-0000-00000000000f'));
select pg_temp.expect('failed setup left no household', not exists (select 1 from public.households where name = 'F family'));
select pg_temp.expect('failed setup left the invite unused', (
  select used_at is null and used_by_household_id is null from public.invite_codes where code = 'SMOKE6'));

\echo '[33] setup_household creates the household, children and a verifiable PIN in one call'
set local role authenticated;
select set_config('request.jwt.claims', :'F', true);
select public.setup_household('F family', 'America/Denver', '80202', 39.74, -104.99, 'smoke6', 'Frankie', '#2C7F8C',
  jsonb_build_array(jsonb_build_object('name', '  Ivy ', 'birthday', '2023-04-10', 'color', '#653437'),
                    jsonb_build_object('name', 'Theo', 'birthday', '2025-06-02', 'color', '#887425')), '2468') as household_f \gset
select set_config('smoke.household_f', :'household_f', true);
select m.id as membership_f from public.memberships m where m.user_id = '00000000-0000-0000-0000-00000000000f' \gset
select set_config('smoke.membership_f', :'membership_f', true);
select pg_temp.expect('F owns the new household', (
  select role = 'owner' and display_name = 'Frankie' from public.memberships where id = pg_temp.v('membership_f')));
select pg_temp.expect('F household has two children', (
  select count(*) from public.child_households where household_id = pg_temp.v('household_f')) = 2);
select pg_temp.expect('child names are trimmed', exists (select 1 from public.children where name = 'Ivy'));
select pg_temp.expect('F household has default sticker categories', (
  select count(*) from public.sticker_categories where household_id = pg_temp.v('household_f')) = 3);
select pg_temp.expect('F PIN verifies', public.verify_pin(pg_temp.v('membership_f'), '2468'));
select pg_temp.expect('F wrong PIN rejected', not public.verify_pin(pg_temp.v('membership_f'), '8642'));
reset role;
select pg_temp.expect('invite marked used by F household', (
  select used_at is not null and used_by_household_id = pg_temp.v('household_f') from public.invite_codes where code = 'SMOKE6'));

\o
\echo 'ALL RLS SMOKE CHECKS PASSED'
rollback;
