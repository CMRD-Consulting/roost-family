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

create function pg_temp.v_text(p_name text) returns text
language sql stable as $$ select current_setting('smoke.' || p_name) $$;

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

-- Configuration rows are written by privileged code (future PIN-checked RPCs); create them as postgres.
-- Sitter sessions are written only through PIN-checked RPCs; this open one is a fixture.
reset role;
insert into public.sitter_sessions (household_id, sitter_name) values (:'household_b', 'Robin') returning id as sitter_session_b \gset
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

\echo '[12] settings_audit is written only by RPCs: display and adult cannot insert it directly'
select set_config('request.jwt.claims', :'D', true);
select pg_temp.expect_error('display inserts settings audit directly',
  $q$insert into public.settings_audit (household_id, membership_id, change) values (pg_temp.v('household_a'), pg_temp.v('membership_a'), '{"k":"v"}')$q$, '42501');
select set_config('request.jwt.claims', :'A', true);
select pg_temp.expect_error('adult inserts settings audit directly',
  $q$insert into public.settings_audit (household_id, membership_id, change) values (pg_temp.v('household_a'), pg_temp.v('membership_a'), '{"k":"v"}')$q$, '42501');
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
  -- take_list_links is not client-readable since the take list migration, so it is no longer scanned.
  if checked < 18 then
    raise exception 'FAIL: expected to scan at least 18 household-scoped tables, scanned %', checked;
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
\echo '[25] anon cannot execute any public function (except the take list token RPCs) or read any table'
reset role;
select pg_temp.expect('anon has no execute on any public function but the take list token RPCs', not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
    and p.oid not in ('public.take_list_items(text)'::regprocedure, 'public.take_list_set_checked(text, uuid, boolean)'::regprocedure,
                      'public.take_list_done(text)'::regprocedure)));
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
  $q$insert into public.photos (id, household_id, storage_path, kind) values ('00000000-0000-0000-0000-0000000000a1', pg_temp.v('household_a'), pg_temp.v('household_b')::text || '/00000000-0000-0000-0000-0000000000a1.jpg', 'avatar')$q$, '23514');
select pg_temp.expect_error('photo path other than <household>/<id>.jpg',
  $q$insert into public.photos (id, household_id, storage_path, kind) values ('00000000-0000-0000-0000-0000000000a1', pg_temp.v('household_a'), pg_temp.v('household_a')::text || '/avatar.jpg', 'avatar')$q$, '23514');
insert into public.photos (id, household_id, storage_path, kind)
values ('00000000-0000-0000-0000-0000000000a1', :'household_a', :'household_a' || '/00000000-0000-0000-0000-0000000000a1.jpg', 'avatar');
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

-- ─── Sitter sessions ─────────────────────────────────────────────────────
\echo '[34] start_sitter_session rejects a wrong PIN, a caregiver, another household and bad input'
-- As postgres: a medicine in F, a caregiver member of F with a PIN (user G), and B's display id.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, is_anonymous, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'g@roost.test', '{}', '{}', false, now(), now());
select ch.child_id as kid_f from public.child_households ch where ch.household_id = :'household_f' limit 1 \gset
insert into public.medicines (household_id, child_id, name, min_interval_hours)
values (:'household_f', :'kid_f', 'F medicine', 4) returning id as medicine_f \gset
insert into public.memberships (user_id, household_id, role, display_name, color)
values ('00000000-0000-0000-0000-000000000010', :'household_f', 'caregiver', 'Gale', '#2F86A6') returning id as membership_g \gset
insert into public.member_pins (membership_id, pin_hash) values (:'membership_g', extensions.crypt('3333', extensions.gen_salt('bf', 8)));
select d.id as display_b from public.displays d where d.household_id = :'household_b' limit 1 \gset
select set_config('smoke.kid_f', :'kid_f', true), set_config('smoke.medicine_f', :'medicine_f', true),
       set_config('smoke.membership_g', :'membership_g', true), set_config('smoke.display_b', :'display_b', true);
set local role authenticated;
select set_config('request.jwt.claims', :'F', true);
select out_display_id as display_f from public.register_display(:'household_f', 'F kitchen') \gset
select set_config('smoke.display_f', :'display_f', true);
select out_display_id as display_f_revoked from public.register_display(:'household_f', 'F old tablet') \gset
select set_config('smoke.display_f_revoked', :'display_f_revoked', true);
select public.revoke_display(:'display_f_revoked');
select pg_temp.expect_error('start with a wrong PIN',
  $q$select public.start_sitter_session(gen_random_uuid(), pg_temp.v('household_f'), pg_temp.v('membership_f'), '0000', 'Jess', null)$q$, '42501');
select pg_temp.expect_error('start with another household''s membership and PIN',
  $q$select public.start_sitter_session(gen_random_uuid(), pg_temp.v('household_f'), pg_temp.v('membership_b'), '1111', 'Jess', null)$q$, '42501');
select pg_temp.expect_error('start with a caregiver''s PIN',
  $q$select public.start_sitter_session(gen_random_uuid(), pg_temp.v('household_f'), pg_temp.v('membership_g'), '3333', 'Jess', null)$q$, '42501');
select pg_temp.expect_error('start on another household''s display',
  $q$select public.start_sitter_session(gen_random_uuid(), pg_temp.v('household_f'), pg_temp.v('membership_f'), '2468', 'Jess', pg_temp.v('display_b'))$q$, '22023');
select pg_temp.expect_error('start on a revoked display',
  $q$select public.start_sitter_session(gen_random_uuid(), pg_temp.v('household_f'), pg_temp.v('membership_f'), '2468', 'Jess', pg_temp.v('display_f_revoked'))$q$, '22023');
select pg_temp.expect_error('start with a 41-character sitter name',
  $q$select public.start_sitter_session(gen_random_uuid(), pg_temp.v('household_f'), pg_temp.v('membership_f'), '2468', repeat('x', 41), null)$q$, '22023');
select pg_temp.expect_error('start without a session id',
  $q$select public.start_sitter_session(null, pg_temp.v('household_f'), pg_temp.v('membership_f'), '2468', 'Jess', null)$q$, '22023');
select pg_temp.expect_error('start reusing another household''s session id',
  $q$select public.start_sitter_session(pg_temp.v('sitter_session_b'), pg_temp.v('household_f'), pg_temp.v('membership_f'), '2468', 'Jess', null)$q$, '42501');
select set_config('request.jwt.claims', :'B', true);
select pg_temp.expect_error('non-member starts a session',
  $q$select public.start_sitter_session(gen_random_uuid(), pg_temp.v('household_f'), pg_temp.v('membership_b'), '1111', 'Jess', null)$q$, '42501');
reset role;
select pg_temp.expect('rejected starts left no session in F', not exists (
  select 1 from public.sitter_sessions where household_id = :'household_f'));
select pg_temp.expect('rejected starts left no sitter audit in F', not exists (
  select 1 from public.settings_audit where household_id = :'household_f' and change ->> 'section' = 'sitter'));
set local role authenticated;

\echo '[35] start_sitter_session with the right PIN starts one session with the client id; retries are idempotent; a second is rejected while it is open'
select set_config('request.jwt.claims', :'F', true);
select gen_random_uuid() as sitter_f \gset
select set_config('smoke.sitter_f', :'sitter_f', true);
select pg_temp.expect('start returns the client session id',
  public.start_sitter_session(:'sitter_f', :'household_f', :'membership_f', '2468', '  Jess  ', :'display_f') = :'sitter_f'::uuid);
select pg_temp.expect('session stored with a trimmed name, the display and who started it', (
  select household_id = pg_temp.v('household_f') and sitter_name = 'Jess' and display_id = pg_temp.v('display_f')
     and started_by = pg_temp.v('membership_f') and ended_by is null
     and ended_at is null and summary_shown_at is null
  from public.sitter_sessions where id = pg_temp.v('sitter_f')));
select pg_temp.expect('repeating a start with the same session id returns it (idempotent retry)',
  public.start_sitter_session(:'sitter_f', :'household_f', :'membership_f', '2468', 'Jess', :'display_f') = :'sitter_f'::uuid);
select pg_temp.expect('the start is audited once (not again for the retry)', (
  select count(*) = 1 and bool_and(membership_id = pg_temp.v('membership_f') and change ->> 'action' = 'start'
     and change ->> 'target_id' = pg_temp.v('sitter_f')::text)
  from public.settings_audit where household_id = pg_temp.v('household_f') and change ->> 'section' = 'sitter'));
select pg_temp.expect_error('second start while one is open',
  $q$select public.start_sitter_session(gen_random_uuid(), pg_temp.v('household_f'), pg_temp.v('membership_f'), '2468', 'Robin', null)$q$, '23505');
select pg_temp.expect_error('repeat start still checks the PIN',
  $q$select public.start_sitter_session(pg_temp.v('sitter_f'), pg_temp.v('household_f'), pg_temp.v('membership_f'), '0000', 'Jess', null)$q$, '42501');
select pg_temp.expect('members can still read sitter sessions', (
  select count(*) from public.sitter_sessions where household_id = pg_temp.v('household_f')) = 1);

\echo '[36] Sitter sessions cannot be inserted, updated or deleted directly'
select pg_temp.expect_error('member inserts a sitter session',
  $q$insert into public.sitter_sessions (household_id, sitter_name) values (pg_temp.v('household_f'), 'Sneaky')$q$, '42501');
select pg_temp.expect_error('member ends a sitter session directly',
  $q$update public.sitter_sessions set ended_at = now() where id = pg_temp.v('sitter_f')$q$, '42501');
select pg_temp.expect_error('member deletes a sitter session',
  $q$delete from public.sitter_sessions where id = pg_temp.v('sitter_f')$q$, '42501');

\echo '[37] Logs in a sitter session are attributed to the sitter'
insert into public.dose_entries (household_id, child_id, medicine_id, at, sitter_session_id, logged_by_name)
values (:'household_f', :'kid_f', :'medicine_f', now(), :'sitter_f', 'Spoofed') returning id as dose_f \gset
select set_config('smoke.dose_f', :'dose_f', true);
select pg_temp.expect('sitter dose logged_by_name = Jess (sitter)', (
  select logged_by_name = 'Jess (sitter)' and logged_by_membership_id is null
  from public.dose_entries where id = pg_temp.v('dose_f')));

\echo '[38] end_sitter_session checks the PIN and ends an open session once'
select pg_temp.expect_error('mark summary shown before the session ended',
  $q$select public.mark_sitter_summary_shown(pg_temp.v('sitter_f'))$q$, '22023');
select pg_temp.expect_error('end with a wrong PIN',
  $q$select public.end_sitter_session(pg_temp.v('sitter_f'), pg_temp.v('membership_f'), '0000')$q$, '42501');
select pg_temp.expect_error('end with a caregiver''s PIN',
  $q$select public.end_sitter_session(pg_temp.v('sitter_f'), pg_temp.v('membership_g'), '3333')$q$, '42501');
select pg_temp.expect_error('end with another household''s membership and PIN',
  $q$select public.end_sitter_session(pg_temp.v('sitter_f'), pg_temp.v('membership_b'), '1111')$q$, '42501');
select set_config('request.jwt.claims', :'B', true);
select pg_temp.expect_error('non-member ends a session',
  $q$select public.end_sitter_session(pg_temp.v('sitter_f'), pg_temp.v('membership_b'), '1111')$q$, '42501');
select set_config('request.jwt.claims', :'F', true);
select public.end_sitter_session(:'sitter_f', :'membership_f', '2468') as ended_f \gset
select pg_temp.expect('end returns the stored ended_at and records who ended it', (
  select ended_at = :'ended_f'::timestamptz and ended_by = pg_temp.v('membership_f')
  from public.sitter_sessions where id = pg_temp.v('sitter_f')));
select pg_temp.expect('the end is audited', exists (
  select 1 from public.settings_audit where household_id = pg_temp.v('household_f') and membership_id = pg_temp.v('membership_f')
     and change ->> 'section' = 'sitter' and change ->> 'action' = 'end' and change ->> 'target_id' = pg_temp.v('sitter_f')::text));
select pg_temp.expect_error('end a session that already ended',
  $q$select public.end_sitter_session(pg_temp.v('sitter_f'), pg_temp.v('membership_f'), '2468')$q$, '22023');
select public.start_sitter_session(gen_random_uuid(), :'household_f', :'membership_f', '2468', '   ', null) as sitter_f2 \gset
select set_config('smoke.sitter_f2', :'sitter_f2', true);
select pg_temp.expect('a blank sitter name is stored as null', (
  select sitter_name is null from public.sitter_sessions where id = pg_temp.v('sitter_f2')));
insert into public.sleep_entries (household_id, child_id, start_at, type, sitter_session_id)
values (:'household_f', :'kid_f', now(), 'nap', :'sitter_f2') returning id as sleep_f2 \gset
select set_config('smoke.sleep_f2', :'sleep_f2', true);
select pg_temp.expect('unnamed sitter log logged_by_name = Sitter', (
  select logged_by_name = 'Sitter' from public.sleep_entries where id = pg_temp.v('sleep_f2')));
select public.end_sitter_session(:'sitter_f2', :'membership_f', '2468');
-- A display (not only a signed-in adult) can end and start sessions with an adult's PIN.
select set_config('request.jwt.claims', :'E', true);
select public.end_sitter_session(:'sitter_session_b', :'membership_b', '1111');
select public.start_sitter_session(gen_random_uuid(), :'household_b', :'membership_b', '1111', null, :'display_b') as sitter_b2 \gset
select set_config('smoke.sitter_b2', :'sitter_b2', true);
select pg_temp.expect('display started a session in B', (
  select ended_at is null and display_id = pg_temp.v('display_b') from public.sitter_sessions where id = pg_temp.v('sitter_b2')));

\echo '[39] mark_sitter_summary_shown is member-only and keeps the first time'
select set_config('request.jwt.claims', :'B', true);
select pg_temp.expect_error('non-member marks summary shown',
  $q$select public.mark_sitter_summary_shown(pg_temp.v('sitter_f'))$q$, '42501');
select set_config('request.jwt.claims', :'F', true);
select public.mark_sitter_summary_shown(:'sitter_f');
select pg_temp.expect('summary marked shown', (
  select summary_shown_at is not null from public.sitter_sessions where id = pg_temp.v('sitter_f')));
reset role;
update public.sitter_sessions set summary_shown_at = '2026-01-01T00:00:00Z' where id = :'sitter_f';
set local role authenticated;
select set_config('request.jwt.claims', :'F', true);
select public.mark_sitter_summary_shown(:'sitter_f');
select pg_temp.expect('marking again keeps the first time', (
  select summary_shown_at = '2026-01-01T00:00:00Z'::timestamptz from public.sitter_sessions where id = pg_temp.v('sitter_f')));

\echo '[40] Sitter RPC and table privileges'
reset role;
select pg_temp.expect('anon cannot execute start_sitter_session',
  not has_function_privilege('anon', 'public.start_sitter_session(uuid, uuid, uuid, text, text, uuid)', 'execute'));
select pg_temp.expect('anon cannot execute end_sitter_session',
  not has_function_privilege('anon', 'public.end_sitter_session(uuid, uuid, text)', 'execute'));
select pg_temp.expect('anon cannot execute mark_sitter_summary_shown',
  not has_function_privilege('anon', 'public.mark_sitter_summary_shown(uuid)', 'execute'));
select pg_temp.expect('authenticated can execute the sitter RPCs',
  has_function_privilege('authenticated', 'public.start_sitter_session(uuid, uuid, uuid, text, text, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.end_sitter_session(uuid, uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.mark_sitter_summary_shown(uuid)', 'execute'));
select pg_temp.expect('started_by and ended_by reference a membership of the same household and clear when it is deleted', (
  select count(*) = 2 from pg_constraint c
  where c.conrelid = 'public.sitter_sessions'::regclass and c.contype = 'f' and c.confrelid = 'public.memberships'::regclass
    and c.confdeltype = 'n' and array_length(c.conkey, 1) = 2 and array_length(c.confdelsetcols, 1) = 1));
select pg_temp.expect('authenticated has no insert/update/delete on sitter_sessions',
  not has_table_privilege('authenticated', 'public.sitter_sessions', 'insert, update, delete'));
select pg_temp.expect('authenticated can select sitter_sessions',
  has_table_privilege('authenticated', 'public.sitter_sessions', 'select'));
select pg_temp.expect('sitter_sessions has no member write policy', not exists (
  select 1 from pg_policies where schemaname = 'public' and tablename = 'sitter_sessions' and cmd <> 'SELECT'));

-- ─── Settings: PIN-checked configuration RPCs ────────────────────────────
-- F owns household F (PIN 2468) and G is its caregiver (PIN 3333). B owns household B (PIN 1111) and E is B's display.
-- True when the newest audit row in the household matches (target null = any target). Runs as the current role.
create function pg_temp.audited(p_household uuid, p_membership uuid, p_section text, p_action text, p_target uuid)
returns boolean
language sql stable as $$
  select coalesce((
    select a.membership_id = p_membership and a.change ->> 'section' = p_section and a.change ->> 'action' = p_action
       and (p_target is null or a.change ->> 'target_id' = p_target::text)
    from public.settings_audit a where a.household_id = p_household order by a.id desc limit 1), false)
$$;
grant execute on all functions in schema pg_temp to authenticated;
set local role authenticated;

\echo '[41] settings_verify returns the role for the right PIN and rejects wrong PINs, caregivers and other households'
select set_config('request.jwt.claims', :'F', true);
select pg_temp.expect('F verifies as owner', (
  select out_role = 'owner' and out_display_name = 'Frankie' from public.settings_verify(pg_temp.v('membership_f'), '2468')));
select pg_temp.expect_error('verify with a wrong PIN',
  $q$select * from public.settings_verify(pg_temp.v('membership_f'), '0000')$q$, '42501');
select pg_temp.expect_error('verify with a malformed PIN',
  $q$select * from public.settings_verify(pg_temp.v('membership_f'), '24680')$q$, '42501');
select pg_temp.expect_error('verify as a caregiver',
  $q$select * from public.settings_verify(pg_temp.v('membership_g'), '3333')$q$, '42501');
select pg_temp.expect_error('verify with another household''s membership and PIN',
  $q$select * from public.settings_verify(pg_temp.v('membership_b'), '1111')$q$, '42501');
select set_config('request.jwt.claims', :'B', true);
select pg_temp.expect_error('non-member verifies with F''s PIN',
  $q$select * from public.settings_verify(pg_temp.v('membership_f'), '2468')$q$, '42501');
select set_config('request.jwt.claims', :'E', true);
select pg_temp.expect('a display verifies with its household adult''s PIN', (
  select out_role = 'owner' from public.settings_verify(pg_temp.v('membership_b'), '1111')));

\echo '[42] update_household_settings saves every field, audits, and rejects bad PINs and input'
select set_config('request.jwt.claims', :'F', true);
select public.update_household_settings(:'membership_f', '2468', '  F home ', '', 'America/Los_Angeles', 15,
  '19:00', '06:30', '21:00', '06:15', true);
select pg_temp.expect('household settings stored', (
  select name = 'F home' and zip is null and time_zone = 'America/Los_Angeles' and leave_by_buffer_min = 15
     and default_night_sleep_start = '19:00' and default_night_sleep_end = '06:30'
     and night_mode_start = '21:00' and night_mode_end = '06:15' and diaper_log_enabled
  from public.households where id = pg_temp.v('household_f')));
select pg_temp.expect('household update audited', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'household', 'update', pg_temp.v('household_f')));
select pg_temp.expect_error('household with a wrong PIN',
  $q$select public.update_household_settings(pg_temp.v('membership_f'), '1111', 'X', '80202', 'America/Denver', 20, '18:00', '05:00', '20:00', '06:00', false)$q$, '42501');
select pg_temp.expect_error('household as a caregiver',
  $q$select public.update_household_settings(pg_temp.v('membership_g'), '3333', 'X', '80202', 'America/Denver', 20, '18:00', '05:00', '20:00', '06:00', false)$q$, '42501');
select pg_temp.expect_error('household with a bad ZIP',
  $q$select public.update_household_settings(pg_temp.v('membership_f'), '2468', 'X', '8020', 'America/Denver', 20, '18:00', '05:00', '20:00', '06:00', false)$q$, '22023');
select pg_temp.expect_error('household with an unknown time zone',
  $q$select public.update_household_settings(pg_temp.v('membership_f'), '2468', 'X', '80202', 'Mars/Base', 20, '18:00', '05:00', '20:00', '06:00', false)$q$, '22023');
select pg_temp.expect_error('household with a 121-minute buffer',
  $q$select public.update_household_settings(pg_temp.v('membership_f'), '2468', 'X', '80202', 'America/Denver', 121, '18:00', '05:00', '20:00', '06:00', false)$q$, '22023');
select pg_temp.expect_error('household with a blank name',
  $q$select public.update_household_settings(pg_temp.v('membership_f'), '2468', '   ', '80202', 'America/Denver', 20, '18:00', '05:00', '20:00', '06:00', false)$q$, '22023');
select pg_temp.expect_error('household with a missing Night Mode time',
  $q$select public.update_household_settings(pg_temp.v('membership_f'), '2468', 'X', '80202', 'America/Denver', 20, '18:00', '05:00', null, '06:00', false)$q$, '22023');
select set_config('request.jwt.claims', :'B', true);
select pg_temp.expect_error('non-member updates F household with F''s PIN',
  $q$select public.update_household_settings(pg_temp.v('membership_f'), '2468', 'X', '80202', 'America/Denver', 20, '18:00', '05:00', '20:00', '06:00', false)$q$, '42501');
select set_config('request.jwt.claims', :'F', true);
select pg_temp.expect('rejected updates left F household unchanged', (
  select name = 'F home' from public.households where id = pg_temp.v('household_f')));

\echo '[43] update_sitter_info keeps known string keys only'
select public.update_sitter_info(:'membership_f', '2468',
  '{"napInstructions":"  Crib  ","bedtime":"","pediatrician":null,"whereThings":"Hall closet"}');
select pg_temp.expect('sitter info trimmed and blanks dropped', (
  select sitter_info = '{"napInstructions":"Crib","whereThings":"Hall closet"}'::jsonb
  from public.households where id = pg_temp.v('household_f')));
select pg_temp.expect('sitter info audited', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'sitter_info', 'update', null));
select pg_temp.expect_error('sitter info with an unknown key',
  $q$select public.update_sitter_info(pg_temp.v('membership_f'), '2468', '{"wifiPassword":"x"}')$q$, '22023');
select pg_temp.expect_error('sitter info with a non-string value',
  $q$select public.update_sitter_info(pg_temp.v('membership_f'), '2468', '{"bedtime":7}')$q$, '22023');
select pg_temp.expect_error('sitter info over 1000 characters',
  $q$select public.update_sitter_info(pg_temp.v('membership_f'), '2468', jsonb_build_object('address', repeat('x', 1001)))$q$, '22023');
select pg_temp.expect_error('sitter info that is not an object',
  $q$select public.update_sitter_info(pg_temp.v('membership_f'), '2468', '["x"]')$q$, '22023');
select pg_temp.expect_error('sitter info with a wrong PIN',
  $q$select public.update_sitter_info(pg_temp.v('membership_f'), '0000', '{}')$q$, '42501');
select set_config('request.jwt.claims', :'B', true);
select pg_temp.expect_error('non-member updates F sitter info',
  $q$select public.update_sitter_info(pg_temp.v('membership_f'), '2468', '{}')$q$, '42501');
select set_config('request.jwt.claims', :'F', true);

\echo '[44] add_child_pin adds children up to the limit of 8'
select public.add_child_pin(:'membership_f', '2468', ' Juno ', '2024-02-02', '#2F86A6') as kid_f3 \gset
select set_config('smoke.kid_f3', :'kid_f3', true);
select pg_temp.expect('child added to F', (
  select c.name = 'Juno' and ch.household_id = pg_temp.v('household_f')
  from public.children c join public.child_households ch on ch.child_id = c.id where c.id = pg_temp.v('kid_f3')));
select pg_temp.expect('child add audited', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'children', 'add', pg_temp.v('kid_f3')));
select pg_temp.expect_error('add child with a bad color',
  $q$select public.add_child_pin(pg_temp.v('membership_f'), '2468', 'Kid', '2024-01-01', 'red')$q$, '22023');
select pg_temp.expect_error('add child with a future birthday',
  $q$select public.add_child_pin(pg_temp.v('membership_f'), '2468', 'Kid', current_date + 30, '#2F86A6')$q$, '22023');
select pg_temp.expect_error('add child with a wrong PIN',
  $q$select public.add_child_pin(pg_temp.v('membership_f'), '0000', 'Kid', '2024-01-01', '#2F86A6')$q$, '42501');
select public.add_child_pin(:'membership_f', '2468', 'Kid ' || i, '2024-01-01', '#2F86A6') from generate_series(4, 8) as i;
select pg_temp.expect('F has 8 children', (select count(*) from public.child_households where household_id = pg_temp.v('household_f')) = 8);
select pg_temp.expect_error('ninth child',
  $q$select public.add_child_pin(pg_temp.v('membership_f'), '2468', 'Kid 9', '2024-01-01', '#2F86A6')$q$, '22023');
select set_config('request.jwt.claims', :'B', true);
select pg_temp.expect_error('non-member adds a child to F',
  $q$select public.add_child_pin(pg_temp.v('membership_f'), '2468', 'Kid', '2024-01-01', '#2F86A6')$q$, '42501');
select set_config('request.jwt.claims', :'F', true);

\echo '[45] update_child saves fields and requires both night-sleep times or neither'
select public.update_child(:'membership_f', '2468', :'kid_f3', 'Juniper', '2024-02-03', '#8A56AC', ' Eggs ', null, '19:30', '06:00');
select pg_temp.expect('child updated', (
  select name = 'Juniper' and birthday = '2024-02-03' and color = '#8A56AC' and allergies = 'Eggs' and food_rules = ''
     and night_sleep_start = '19:30' and night_sleep_end = '06:00'
  from public.children where id = pg_temp.v('kid_f3')));
select pg_temp.expect('child update audited', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'children', 'update', pg_temp.v('kid_f3')));
select public.update_child(:'membership_f', '2468', :'kid_f3', 'Juniper', '2024-02-03', '#8A56AC', '', '', null, null);
select pg_temp.expect('night window cleared', (select night_sleep_start is null and night_sleep_end is null from public.children where id = pg_temp.v('kid_f3')));
select pg_temp.expect_error('update child with only a night start',
  $q$select public.update_child(pg_temp.v('membership_f'), '2468', pg_temp.v('kid_f3'), 'Juniper', '2024-02-03', '#8A56AC', '', '', '19:00', null)$q$, '22023');
select pg_temp.expect_error('update child with a 41-character name',
  $q$select public.update_child(pg_temp.v('membership_f'), '2468', pg_temp.v('kid_f3'), repeat('x', 41), '2024-02-03', '#8A56AC', '', '', null, null)$q$, '22023');
select pg_temp.expect_error('update another household''s child',
  $q$select public.update_child(pg_temp.v('membership_f'), '2468', pg_temp.v('kid_b'), 'Hacked', '2023-01-01', '#8A56AC', '', '', null, null)$q$, '42501');
select pg_temp.expect_error('update child with a wrong PIN',
  $q$select public.update_child(pg_temp.v('membership_f'), '0000', pg_temp.v('kid_f3'), 'Juniper', '2024-02-03', '#8A56AC', '', '', null, null)$q$, '42501');

\echo '[46] set_feature_override sets, changes and clears an override'
select public.set_feature_override(:'membership_f', '2468', :'kid_f3', 'kidsCorner', false);
select pg_temp.expect('override off', (select not enabled from public.feature_overrides where child_id = pg_temp.v('kid_f3') and feature = 'kidsCorner'));
select public.set_feature_override(:'membership_f', '2468', :'kid_f3', 'kidsCorner', true);
select pg_temp.expect('override on', (select enabled from public.feature_overrides where child_id = pg_temp.v('kid_f3') and feature = 'kidsCorner'));
select pg_temp.expect('override audited', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'children', 'feature_override', pg_temp.v('kid_f3')));
select public.set_feature_override(:'membership_f', '2468', :'kid_f3', 'kidsCorner', null);
select pg_temp.expect('override cleared', not exists (select 1 from public.feature_overrides where child_id = pg_temp.v('kid_f3')));
select pg_temp.expect_error('override an unknown feature',
  $q$select public.set_feature_override(pg_temp.v('membership_f'), '2468', pg_temp.v('kid_f3'), 'teleport', true)$q$, '22023');
select pg_temp.expect_error('override another household''s child',
  $q$select public.set_feature_override(pg_temp.v('membership_f'), '2468', pg_temp.v('kid_b'), 'feeding', true)$q$, '42501');
select pg_temp.expect_error('override with a wrong PIN',
  $q$select public.set_feature_override(pg_temp.v('membership_f'), '0000', pg_temp.v('kid_f3'), 'feeding', true)$q$, '42501');

\echo '[47] upsert_routine validates and normalizes steps'
select public.upsert_routine(:'membership_f', '2468', null, :'kid_f3', ' Morning ', '{5,1,1,3}',
  '[{"iconKey":"teeth","label":" Brush teeth ","time":"07:05"},{"label":"Shoes","photoId":null,"iconKey":null,"time":null}]') as routine_f \gset
select set_config('smoke.routine_f', :'routine_f', true);
select pg_temp.expect('routine created normalized', (
  select name = 'Morning' and weekdays = '{1,3,5}'::smallint[] and household_id = pg_temp.v('household_f')
     and steps = '[{"iconKey":"teeth","photoId":null,"label":"Brush teeth","time":"07:05"},{"iconKey":null,"photoId":null,"label":"Shoes","time":null}]'::jsonb
  from public.routines where id = pg_temp.v('routine_f')));
select pg_temp.expect('routine add audited', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'routines', 'add', pg_temp.v('routine_f')));
select pg_temp.expect('routine update returns the same id',
  public.upsert_routine(pg_temp.v('membership_f'), '2468', pg_temp.v('routine_f'), pg_temp.v('kid_f3'), 'Weekday', '{1,2,3,4,5}', '[]') = pg_temp.v('routine_f'));
select pg_temp.expect('routine updated', (select name = 'Weekday' and steps = '[]'::jsonb from public.routines where id = pg_temp.v('routine_f')));
select pg_temp.expect('routine update audited', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'routines', 'update', pg_temp.v('routine_f')));
select pg_temp.expect_error('routine with 21 steps',
  $q$select public.upsert_routine(pg_temp.v('membership_f'), '2468', null, pg_temp.v('kid_f3'), 'Long', '{}',
     (select jsonb_agg(jsonb_build_object('label', 'Step ' || i)) from generate_series(1, 21) i))$q$, '22023');
select pg_temp.expect_error('routine step with a bad time',
  $q$select public.upsert_routine(pg_temp.v('membership_f'), '2468', null, pg_temp.v('kid_f3'), 'R', '{}', '[{"label":"A","time":"24:00"}]')$q$, '22023');
select pg_temp.expect_error('routine step with an unknown key',
  $q$select public.upsert_routine(pg_temp.v('membership_f'), '2468', null, pg_temp.v('kid_f3'), 'R', '{}', '[{"label":"A","url":"x"}]')$q$, '22023');
select pg_temp.expect_error('routine step with a 41-character label',
  $q$select public.upsert_routine(pg_temp.v('membership_f'), '2468', null, pg_temp.v('kid_f3'), 'R', '{}', jsonb_build_array(jsonb_build_object('label', repeat('x', 41))))$q$, '22023');
select pg_temp.expect_error('routine step without a label',
  $q$select public.upsert_routine(pg_temp.v('membership_f'), '2468', null, pg_temp.v('kid_f3'), 'R', '{}', '[{"iconKey":"teeth"}]')$q$, '22023');
select pg_temp.expect_error('routine step with an unknown photo',
  $q$select public.upsert_routine(pg_temp.v('membership_f'), '2468', null, pg_temp.v('kid_f3'), 'R', '{}', '[{"label":"A","photoId":"00000000-0000-0000-0000-000000000001"}]')$q$, '22023');
select pg_temp.expect_error('routine with weekday 7',
  $q$select public.upsert_routine(pg_temp.v('membership_f'), '2468', null, pg_temp.v('kid_f3'), 'R', '{7}', '[]')$q$, '22023');
select pg_temp.expect_error('routine moved to another child',
  $q$select public.upsert_routine(pg_temp.v('membership_f'), '2468', pg_temp.v('routine_f'), pg_temp.v('kid_f'), 'R', '{}', '[]')$q$, '22023');
select pg_temp.expect_error('update another household''s routine',
  $q$select public.upsert_routine(pg_temp.v('membership_f'), '2468', pg_temp.v('routine_b'), pg_temp.v('kid_f3'), 'R', '{}', '[]')$q$, '42501');
select pg_temp.expect_error('routine for another household''s child',
  $q$select public.upsert_routine(pg_temp.v('membership_f'), '2468', null, pg_temp.v('kid_b'), 'R', '{}', '[]')$q$, '42501');
select pg_temp.expect_error('routine with a wrong PIN',
  $q$select public.upsert_routine(pg_temp.v('membership_f'), '0000', null, pg_temp.v('kid_f3'), 'R', '{}', '[]')$q$, '42501');

\echo '[48] set_routine_day_override sets, changes and clears today''s routine'
select public.upsert_routine(:'membership_f', '2468', null, :'kid_f3', 'Sick day', '{}', '[{"label":"Rest"}]') as routine_f2 \gset
select set_config('smoke.routine_f2', :'routine_f2', true);
select public.set_routine_day_override(:'membership_f', '2468', :'kid_f3', '2026-09-14', :'routine_f');
select public.set_routine_day_override(:'membership_f', '2468', :'kid_f3', '2026-09-14', :'routine_f2');
select pg_temp.expect('override points at the second routine', (
  select routine_id = pg_temp.v('routine_f2') and household_id = pg_temp.v('household_f')
  from public.routine_day_overrides where child_id = pg_temp.v('kid_f3') and day = '2026-09-14'));
select pg_temp.expect('day override audited', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'routines', 'day_override', pg_temp.v('kid_f3')));
select public.set_routine_day_override(:'membership_f', '2468', :'kid_f3', '2026-09-14', null);
select pg_temp.expect('override cleared', not exists (select 1 from public.routine_day_overrides where child_id = pg_temp.v('kid_f3')));
select pg_temp.expect_error('override with another child''s routine',
  $q$select public.set_routine_day_override(pg_temp.v('membership_f'), '2468', pg_temp.v('kid_f'), '2026-09-14', pg_temp.v('routine_f'))$q$, '22023');
select pg_temp.expect_error('override with a wrong PIN',
  $q$select public.set_routine_day_override(pg_temp.v('membership_f'), '0000', pg_temp.v('kid_f3'), '2026-09-14', null)$q$, '42501');

\echo '[49] delete_routine removes the routine with its progress and overrides'
select public.set_routine_day_override(:'membership_f', '2468', :'kid_f3', '2026-09-15', :'routine_f2');
select public.set_routine_step(:'kid_f3', :'routine_f2', '2026-09-15', 0, true);
select pg_temp.expect_error('delete another household''s routine',
  $q$select public.delete_routine(pg_temp.v('membership_f'), '2468', pg_temp.v('routine_b'))$q$, '42501');
select pg_temp.expect_error('delete routine with a wrong PIN',
  $q$select public.delete_routine(pg_temp.v('membership_f'), '0000', pg_temp.v('routine_f2'))$q$, '42501');
select public.delete_routine(:'membership_f', '2468', :'routine_f2');
select pg_temp.expect('routine, progress and override gone', not exists (select 1 from public.routines where id = pg_temp.v('routine_f2'))
  and not exists (select 1 from public.routine_progress where routine_id = pg_temp.v('routine_f2'))
  and not exists (select 1 from public.routine_day_overrides where routine_id = pg_temp.v('routine_f2')));
select pg_temp.expect('routine delete audited', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'routines', 'delete', pg_temp.v('routine_f2')));

\echo '[50] upsert_medicine and archive_medicine'
select public.upsert_medicine(:'membership_f', '2468', null, :'kid_f3', ' Ibuprofen ', 6, 4) as medicine_f3 \gset
select set_config('smoke.medicine_f3', :'medicine_f3', true);
select pg_temp.expect('medicine created', (
  select name = 'Ibuprofen' and min_interval_hours = 6 and max_doses_per_24h = 4 and child_id = pg_temp.v('kid_f3')
  from public.medicines where id = pg_temp.v('medicine_f3')));
select pg_temp.expect('medicine add audited', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'medicines', 'add', pg_temp.v('medicine_f3')));
select public.upsert_medicine(:'membership_f', '2468', :'medicine_f3', :'kid_f3', 'Ibuprofen', 7.5, null);
select pg_temp.expect('medicine updated', (
  select min_interval_hours = 7.5 and max_doses_per_24h is null from public.medicines where id = pg_temp.v('medicine_f3')));
select pg_temp.expect_error('medicine moved to another child',
  $q$select public.upsert_medicine(pg_temp.v('membership_f'), '2468', pg_temp.v('medicine_f3'), pg_temp.v('kid_f'), 'Ibuprofen', 6, 4)$q$, '22023');
select pg_temp.expect_error('medicine with a zero interval',
  $q$select public.upsert_medicine(pg_temp.v('membership_f'), '2468', null, pg_temp.v('kid_f3'), 'X', 0, null)$q$, '22023');
select pg_temp.expect_error('medicine with a 72.05-hour interval',
  $q$select public.upsert_medicine(pg_temp.v('membership_f'), '2468', null, pg_temp.v('kid_f3'), 'X', 72.05, null)$q$, '22023');
select pg_temp.expect_error('medicine with 25 max doses',
  $q$select public.upsert_medicine(pg_temp.v('membership_f'), '2468', null, pg_temp.v('kid_f3'), 'X', 6, 25)$q$, '22023');
select pg_temp.expect_error('medicine for another household''s child',
  $q$select public.upsert_medicine(pg_temp.v('membership_f'), '2468', null, pg_temp.v('kid_b'), 'X', 6, 4)$q$, '42501');
select set_config('request.jwt.claims', :'B', true);
select pg_temp.expect_error('update another household''s medicine',
  $q$select public.upsert_medicine(pg_temp.v('membership_b'), '1111', pg_temp.v('medicine_f3'), pg_temp.v('kid_b'), 'X', 6, 4)$q$, '42501');
select set_config('request.jwt.claims', :'F', true);
select pg_temp.expect_error('medicine with a wrong PIN',
  $q$select public.upsert_medicine(pg_temp.v('membership_f'), '0000', null, pg_temp.v('kid_f3'), 'X', 6, 4)$q$, '42501');
select public.archive_medicine(:'membership_f', '2468', :'medicine_f3');
select pg_temp.expect('medicine archived', (select archived_at is not null from public.medicines where id = pg_temp.v('medicine_f3')));
select pg_temp.expect('medicine archive audited', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'medicines', 'archive', pg_temp.v('medicine_f3')));
select pg_temp.expect_error('edit an archived medicine',
  $q$select public.upsert_medicine(pg_temp.v('membership_f'), '2468', pg_temp.v('medicine_f3'), pg_temp.v('kid_f3'), 'Ibuprofen', 6, 4)$q$, '22023');
select set_config('request.jwt.claims', :'B', true);
select pg_temp.expect_error('non-member archives F medicine',
  $q$select public.archive_medicine(pg_temp.v('membership_b'), '1111', pg_temp.v('medicine_f'))$q$, '42501');
select set_config('request.jwt.claims', :'F', true);

\echo '[51] upsert_sticker_category and archive_sticker_category'
select public.upsert_sticker_category(:'membership_f', '2468', null, ' Shared ', 'star', null) as category_f \gset
select set_config('smoke.category_f', :'category_f', true);
select pg_temp.expect('category appended', (
  select name = 'Shared' and icon_key = 'star' and sort_order = 3 from public.sticker_categories where id = pg_temp.v('category_f')));
select pg_temp.expect('category add audited', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'stickers', 'add', pg_temp.v('category_f')));
select public.upsert_sticker_category(:'membership_f', '2468', :'category_f', 'Sharing', 'heart', 0);
select pg_temp.expect('category updated', (
  select name = 'Sharing' and icon_key = 'heart' and sort_order = 0 from public.sticker_categories where id = pg_temp.v('category_f')));
select pg_temp.expect_error('category with a bad icon key',
  $q$select public.upsert_sticker_category(pg_temp.v('membership_f'), '2468', null, 'X', 'Bad Icon!', null)$q$, '22023');
select pg_temp.expect_error('category with a 31-character name',
  $q$select public.upsert_sticker_category(pg_temp.v('membership_f'), '2468', null, repeat('x', 31), 'star', null)$q$, '22023');
select pg_temp.expect_error('update another household''s category',
  $q$select public.upsert_sticker_category(pg_temp.v('membership_f'), '2468', pg_temp.v('category_b'), 'X', 'star', null)$q$, '42501');
select pg_temp.expect_error('archive another household''s category',
  $q$select public.archive_sticker_category(pg_temp.v('membership_f'), '2468', pg_temp.v('category_b'))$q$, '42501');
select pg_temp.expect_error('category with a wrong PIN',
  $q$select public.upsert_sticker_category(pg_temp.v('membership_f'), '0000', null, 'X', 'star', null)$q$, '42501');
select public.archive_sticker_category(:'membership_f', '2468', :'category_f');
select pg_temp.expect('category archived', (select archived_at is not null from public.sticker_categories where id = pg_temp.v('category_f')));
select pg_temp.expect('category archive audited', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'stickers', 'archive', pg_temp.v('category_f')));

\echo '[52] set_my_color changes only the PIN adult''s color'
select public.set_my_color(:'membership_f', '2468', '#982A5D');
select pg_temp.expect('color changed', (select color = '#982A5D' from public.memberships where id = pg_temp.v('membership_f')));
select pg_temp.expect('color audited', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'my_account', 'color', pg_temp.v('membership_f')));
select pg_temp.expect_error('bad color',
  $q$select public.set_my_color(pg_temp.v('membership_f'), '2468', '#98 2A5D')$q$, '22023');
select pg_temp.expect_error('color with a wrong PIN',
  $q$select public.set_my_color(pg_temp.v('membership_f'), '0000', '#000000')$q$, '42501');

\echo '[53] delete_old_entries deletes only logs older than 2 years, never doses'
insert into public.sleep_entries (household_id, child_id, start_at, type) values
  (:'household_f', :'kid_f3', now() - interval '3 years', 'nap'),
  (:'household_f', :'kid_f3', now() - interval '1 year', 'nap');
insert into public.jots (household_id, text, created_at) values (:'household_f', 'Old jot', now() - interval '30 months');
select set_config('request.jwt.claims', :'B', true);
insert into public.jots (household_id, text, created_at) values (:'household_b', 'Old B jot', now() - interval '30 months');
select set_config('request.jwt.claims', :'F', true);
select pg_temp.expect('one old sleep entry deleted',
  public.delete_old_entries(pg_temp.v('membership_f'), '2468', 'sleep_entries', now() - interval '2 years') = 1);
select pg_temp.expect('recent sleep entry kept', (select count(*) from public.sleep_entries where child_id = pg_temp.v('kid_f3')) = 1);
select pg_temp.expect('delete old audited', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'logs', 'delete_old', null));
select pg_temp.expect('old F jot deleted',
  public.delete_old_entries(pg_temp.v('membership_f'), '2468', 'jots', now() - interval '2 years') = 1);
select pg_temp.expect_error('delete old doses',
  $q$select public.delete_old_entries(pg_temp.v('membership_f'), '2468', 'dose_entries', now() - interval '3 years')$q$, '22023');
select pg_temp.expect_error('delete logs newer than 2 years',
  $q$select public.delete_old_entries(pg_temp.v('membership_f'), '2468', 'sleep_entries', now() - interval '23 months')$q$, '22023');
select pg_temp.expect_error('delete old logs with a wrong PIN',
  $q$select public.delete_old_entries(pg_temp.v('membership_f'), '0000', 'jots', now() - interval '3 years')$q$, '42501');
select set_config('request.jwt.claims', :'B', true);
select pg_temp.expect('B''s old jot untouched', (select count(*) from public.jots where text = 'Old B jot') = 1);
select pg_temp.expect_error('non-member deletes F logs',
  $q$select public.delete_old_entries(pg_temp.v('membership_f'), '2468', 'jots', now() - interval '3 years')$q$, '42501');

\echo '[54] Settings RPC privileges'
reset role;
select pg_temp.expect('anon cannot execute any settings RPC', not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (
    'settings_verify', 'update_household_settings', 'update_sitter_info', 'add_child_pin', 'update_child',
    'set_feature_override', 'upsert_routine', 'delete_routine', 'set_routine_day_override', 'upsert_medicine',
    'archive_medicine', 'upsert_sticker_category', 'archive_sticker_category', 'set_my_color', 'delete_old_entries')
    and has_function_privilege('anon', p.oid, 'execute')));
select pg_temp.expect('authenticated can execute all 15 settings RPCs', (
  select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (
    'settings_verify', 'update_household_settings', 'update_sitter_info', 'add_child_pin', 'update_child',
    'set_feature_override', 'upsert_routine', 'delete_routine', 'set_routine_day_override', 'upsert_medicine',
    'archive_medicine', 'upsert_sticker_category', 'archive_sticker_category', 'set_my_color', 'delete_old_entries')
    and has_function_privilege('authenticated', p.oid, 'execute')) = 15);
select pg_temp.expect('authenticated cannot execute the settings helpers', not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname in ('require_settings_pin', 'audit_setting', 'require_color', 'require_child_of')
    and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))));

-- ─── Settings: members, displays and household deletion (full sign-in) ───
-- G (caregiver in F) signs in; H is a new adult with consent; I is a new adult without consent yet.
\set G '{"sub":"00000000-0000-0000-0000-000000000010","role":"authenticated","is_anonymous":false}'
\set H '{"sub":"00000000-0000-0000-0000-000000000011","role":"authenticated","is_anonymous":false}'
\set I '{"sub":"00000000-0000-0000-0000-000000000012","role":"authenticated","is_anonymous":false}'
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, is_anonymous, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'h@roost.test', '{}', '{}', false, now(), now()),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'i@roost.test', '{}', '{}', false, now(), now());
set local role authenticated;

\echo '[55] create_member_invite: owners only, hashed token, 10-minute expiry'
select set_config('request.jwt.claims', :'F', true);
select out_token as invite_1, out_expires_at as invite_1_expires from public.create_member_invite(:'household_f', 'adult') \gset
select pg_temp.expect('invite expires in 10 minutes', :'invite_1_expires'::timestamptz = now() + interval '10 minutes');
select pg_temp.expect('invite audited', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'members', 'invite', null));
select pg_temp.expect_error('members cannot read invites directly',
  $q$select * from public.member_invites$q$, '42501');
select pg_temp.expect_error('invite for the caregiver role',
  $q$select * from public.create_member_invite(pg_temp.v('household_f'), 'caregiver')$q$, '22023');
select set_config('request.jwt.claims', :'G', true);
select pg_temp.expect_error('caregiver creates an invite',
  $q$select * from public.create_member_invite(pg_temp.v('household_f'), 'adult')$q$, '42501');
select set_config('request.jwt.claims', :'B', true);
select pg_temp.expect_error('owner of another household creates an invite for F',
  $q$select * from public.create_member_invite(pg_temp.v('household_f'), 'adult')$q$, '42501');
select set_config('request.jwt.claims', :'E', true);
select pg_temp.expect_error('display creates an invite',
  $q$select * from public.create_member_invite(pg_temp.v('household_b'), 'adult')$q$, '42501');
reset role;
select pg_temp.expect('invite stored as a hash with its role and creator', (
  select role = 'adult' and created_by = pg_temp.v('membership_f') and used_at is null
     and token_hash = encode(extensions.digest(:'invite_1', 'sha256'), 'hex') and token_hash <> :'invite_1'
  from public.member_invites where household_id = pg_temp.v('household_f')));
set local role authenticated;

\echo '[56] accept_member_invite: consent required, expiry, reuse and existing members rejected'
select set_config('request.jwt.claims', :'F', true);
select out_token as invite_expired from public.create_member_invite(:'household_f', 'adult') \gset
select out_token as invite_2 from public.create_member_invite(:'household_f', 'owner') \gset
reset role;
update public.member_invites set expires_at = now() - interval '1 second'
where token_hash = encode(extensions.digest(:'invite_expired', 'sha256'), 'hex');
set local role authenticated;
select set_config('request.jwt.claims', :'I', true);
select pg_temp.expect_error('accept without consent',
  format('select public.accept_member_invite(%L, %L, %L, %L)', :'invite_1', 'Indy', '#2F86A6', '9999'), '42501');
select set_config('request.jwt.claims', :'H', true);
select public.record_consent('2026-09-14', true);
select pg_temp.expect_error('accept with a bad PIN',
  format('select public.accept_member_invite(%L, %L, %L, %L)', :'invite_1', 'Harper', '#2F86A6', '12a4'), '22023');
select pg_temp.expect_error('accept with a bad color',
  format('select public.accept_member_invite(%L, %L, %L, %L)', :'invite_1', 'Harper', 'blue', '5555'), '22023');
select pg_temp.expect_error('accept with a blank name',
  format('select public.accept_member_invite(%L, %L, %L, %L)', :'invite_1', '  ', '#2F86A6', '5555'), '22023');
select pg_temp.expect_error('accept an expired invite',
  format('select public.accept_member_invite(%L, %L, %L, %L)', :'invite_expired', 'Harper', '#2F86A6', '5555'), '22023');
select pg_temp.expect_error('accept an unknown token',
  $q$select public.accept_member_invite('nope', 'Harper', '#2F86A6', '5555')$q$, '22023');
select public.accept_member_invite(:'invite_1', ' Harper ', '#2F86A6', '5555') as membership_h \gset
select set_config('smoke.membership_h', :'membership_h', true);
select pg_temp.expect('H joined F as an adult', (
  select role = 'adult' and display_name = 'Harper' and household_id = pg_temp.v('household_f') and left_at is null
  from public.memberships where id = pg_temp.v('membership_h')));
select pg_temp.expect('H sees household F', (select count(*) from public.households where id = pg_temp.v('household_f')) = 1);
select pg_temp.expect('H PIN works for Settings', (
  select out_role = 'adult' from public.settings_verify(pg_temp.v('membership_h'), '5555')));
select pg_temp.expect('join audited', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_h'), 'members', 'join', pg_temp.v('membership_h')));
select set_config('request.jwt.claims', :'I', true);
select public.record_consent('2026-09-14', true);
select pg_temp.expect_error('reuse a used invite',
  format('select public.accept_member_invite(%L, %L, %L, %L)', :'invite_1', 'Indy', '#2F86A6', '9999'), '22023');
select set_config('request.jwt.claims', :'H', true);
select pg_temp.expect_error('existing member accepts another invite',
  format('select public.accept_member_invite(%L, %L, %L, %L)', :'invite_2', 'Harper', '#2F86A6', '5555'), '22023');
select set_config('request.jwt.claims', :'E', true);
select pg_temp.expect_error('display accepts an invite',
  format('select public.accept_member_invite(%L, %L, %L, %L)', :'invite_2', 'Kitchen', '#2F86A6', '5555'), '42501');
reset role;
select pg_temp.expect('rejected accepts left invite_2 unused', (
  select used_at is null from public.member_invites where token_hash = encode(extensions.digest(:'invite_2', 'sha256'), 'hex')));
set local role authenticated;

\echo '[57] set_member_role: owners only, and a household keeps its last owner'
select set_config('request.jwt.claims', :'H', true);
select pg_temp.expect_error('adult changes a role',
  $q$select public.set_member_role(pg_temp.v('membership_h'), 'owner')$q$, '42501');
select set_config('request.jwt.claims', :'G', true);
select pg_temp.expect_error('caregiver changes a role',
  $q$select public.set_member_role(pg_temp.v('membership_g'), 'owner')$q$, '42501');
select set_config('request.jwt.claims', :'B', true);
select pg_temp.expect_error('owner of another household changes a role',
  $q$select public.set_member_role(pg_temp.v('membership_h'), 'owner')$q$, '42501');
select set_config('request.jwt.claims', :'F', true);
select pg_temp.expect_error('role caregiver',
  $q$select public.set_member_role(pg_temp.v('membership_h'), 'caregiver')$q$, '22023');
select pg_temp.expect_error('last owner demotes self',
  $q$select public.set_member_role(pg_temp.v('membership_f'), 'adult')$q$, '22023');
select public.set_member_role(:'membership_h', 'owner');
select pg_temp.expect('H is an owner', (select role = 'owner' from public.memberships where id = pg_temp.v('membership_h')));
select pg_temp.expect('role change audited', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'members', 'role', pg_temp.v('membership_h')));
select public.set_member_role(:'membership_f', 'adult');
select pg_temp.expect('F demoted itself while H is an owner', (select role = 'adult' from public.memberships where id = pg_temp.v('membership_f')));
select set_config('request.jwt.claims', :'H', true);
select pg_temp.expect_error('H, now the last owner, demotes self',
  $q$select public.set_member_role(pg_temp.v('membership_h'), 'adult')$q$, '22023');
select public.set_member_role(:'membership_f', 'owner');
select pg_temp.expect('F is an owner again', (select role = 'owner' from public.memberships where id = pg_temp.v('membership_f')));

\echo '[58] remove_member: owners only, last-owner protection, removal hides the household and ends the PIN'
select set_config('request.jwt.claims', :'G', true);
select pg_temp.expect_error('caregiver removes a member',
  $q$select public.remove_member(pg_temp.v('membership_h'))$q$, '42501');
select set_config('request.jwt.claims', :'B', true);
select pg_temp.expect_error('owner of another household removes a member',
  $q$select public.remove_member(pg_temp.v('membership_g'))$q$, '42501');
select set_config('request.jwt.claims', :'F', true);
select public.set_member_role(:'membership_h', 'adult');
select pg_temp.expect_error('last owner removes self',
  $q$select public.remove_member(pg_temp.v('membership_f'))$q$, '22023');
select public.remove_member(:'membership_h');
select pg_temp.expect('remove audited', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'members', 'remove', pg_temp.v('membership_h')));
select pg_temp.expect_error('removed member''s PIN no longer opens Settings',
  $q$select * from public.settings_verify(pg_temp.v('membership_h'), '5555')$q$, '42501');
select pg_temp.expect_error('remove an already removed member',
  $q$select public.remove_member(pg_temp.v('membership_h'))$q$, '42501');
select set_config('request.jwt.claims', :'H', true);
select pg_temp.expect('removed member sees no household F', (select count(*) from public.households where id = pg_temp.v('household_f')) = 0);
select pg_temp.expect('removed member sees no F children', (select count(*) from public.children) = 0);
reset role;
select pg_temp.expect('removed membership kept with left_at and no PIN', (
  select left_at is not null and not exists (select 1 from public.member_pins where membership_id = pg_temp.v('membership_h'))
  from public.memberships where id = pg_temp.v('membership_h')));
set local role authenticated;
select pg_temp.expect('a former member rejoins on the same membership',
  public.accept_member_invite(:'invite_2', 'Harper', '#2F86A6', '6666') = pg_temp.v('membership_h'));
select pg_temp.expect('rejoined as owner with the new PIN', (
  select out_role = 'owner' from public.settings_verify(pg_temp.v('membership_h'), '6666')));

\echo '[59] leave_household: members leave, the last owner cannot'
select set_config('request.jwt.claims', :'E', true);
select pg_temp.expect_error('display leaves',
  $q$select public.leave_household(pg_temp.v('household_b'))$q$, '42501');
select set_config('request.jwt.claims', :'I', true);
select pg_temp.expect_error('non-member leaves',
  $q$select public.leave_household(pg_temp.v('household_f'))$q$, '42501');
select set_config('request.jwt.claims', :'H', true);
select public.leave_household(:'household_f');
select pg_temp.expect('H left and sees no household F', (select count(*) from public.households where id = pg_temp.v('household_f')) = 0);
select set_config('request.jwt.claims', :'F', true);
select pg_temp.expect('leave audited', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_h'), 'members', 'leave', pg_temp.v('membership_h')));
select pg_temp.expect_error('last owner leaves',
  $q$select public.leave_household(pg_temp.v('household_f'))$q$, '22023');

\echo '[60] rename_display: owners only'
select public.rename_display(:'display_f', '  Hallway ');
select pg_temp.expect('display renamed', (select name = 'Hallway' from public.displays where id = pg_temp.v('display_f')));
select pg_temp.expect('rename audited', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'displays', 'rename', pg_temp.v('display_f')));
select pg_temp.expect_error('rename to a blank name',
  $q$select public.rename_display(pg_temp.v('display_f'), '   ')$q$, '22023');
select set_config('request.jwt.claims', :'G', true);
select pg_temp.expect_error('caregiver renames a display',
  $q$select public.rename_display(pg_temp.v('display_f'), 'Mine')$q$, '42501');
select set_config('request.jwt.claims', :'B', true);
select pg_temp.expect_error('owner of another household renames a display',
  $q$select public.rename_display(pg_temp.v('display_f'), 'Mine')$q$, '42501');
select set_config('request.jwt.claims', :'E', true);
select pg_temp.expect_error('display renames itself',
  $q$select public.rename_display(pg_temp.v('display_b'), 'Mine')$q$, '42501');

\echo '[61] delete_household: owner and exact name required; revokes displays and hides the household at once'
select set_config('request.jwt.claims', :'B', true);
select out_token as invite_b from public.create_member_invite(:'household_b', 'adult') \gset
select pg_temp.expect_error('delete with the wrong name',
  $q$select public.delete_household(pg_temp.v('household_b'), 'B famly')$q$, '22023');
select set_config('request.jwt.claims', :'F', true);
select pg_temp.expect_error('owner of another household deletes B',
  $q$select public.delete_household(pg_temp.v('household_b'), 'B family')$q$, '42501');
select set_config('request.jwt.claims', :'E', true);
select pg_temp.expect_error('display deletes its household',
  $q$select public.delete_household(pg_temp.v('household_b'), 'B family')$q$, '42501');
select set_config('request.jwt.claims', :'B', true);
select public.delete_household(:'household_b', '  B family ');
select pg_temp.expect('B sees no households', (select count(*) from public.households) = 0);
select pg_temp.expect('B sees no children', (select count(*) from public.children) = 0);
select pg_temp.expect_error('delete again',
  $q$select public.delete_household(pg_temp.v('household_b'), 'B family')$q$, '42501');
select set_config('request.jwt.claims', :'E', true);
select pg_temp.expect('B display heartbeat false', not public.display_heartbeat());
select pg_temp.expect('B display reports revoked', (select out_revoked from public.my_display()));
select pg_temp.expect('B display sees no children', (select count(*) from public.children) = 0);
select pg_temp.expect_error('Settings PIN no longer works in a deleted household',
  $q$select * from public.settings_verify(pg_temp.v('membership_b'), '1111')$q$, '42501');
select set_config('request.jwt.claims', :'I', true);
select pg_temp.expect_error('invite to a deleted household cannot be accepted',
  format('select public.accept_member_invite(%L, %L, %L, %L)', :'invite_b', 'Indy', '#2F86A6', '9999'), '22023');
reset role;
select pg_temp.expect('B household soft-deleted, displays revoked, invites gone', (
  select deleted_at is not null from public.households where id = pg_temp.v('household_b'))
  and not exists (select 1 from public.displays where household_id = pg_temp.v('household_b') and revoked_at is null)
  and not exists (select 1 from public.member_invites where household_id = pg_temp.v('household_b')));
select pg_temp.expect('B data kept until purge', exists (select 1 from public.children where id = pg_temp.v('kid_b')));
select pg_temp.expect('B PINs deleted at once', not exists (
  select 1 from public.member_pins p join public.memberships m on m.id = p.membership_id where m.household_id = pg_temp.v('household_b')));
select pg_temp.expect('other households keep their PINs', exists (
  select 1 from public.member_pins p join public.memberships m on m.id = p.membership_id where m.household_id = pg_temp.v('household_f')));

\echo '[62] purge_deleted_households removes only households deleted more than 30 days ago'
update public.households set deleted_at = now() - interval '31 days' where id = :'household_b';
update public.households set deleted_at = now() - interval '29 days' where id = :'household_f';
insert into storage.objects (bucket_id, name) values
  ('household-photos', :'household_b' || '/00000000-0000-0000-0000-0000000000b1.jpg'),
  ('household-photos', :'household_f' || '/00000000-0000-0000-0000-0000000000f1.jpg');
-- An adult account that happens to be bound to one of B's displays is an adult, not a device: it stays.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, is_anonymous, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b9@roost.test', '{}', '{}', false, now(), now());
insert into public.displays (household_id, name, auth_user_id, revoked_at) values (:'household_b', 'B odd', '00000000-0000-0000-0000-0000000000b9', now());
select pg_temp.expect('B display device user exists before the purge', exists (
  select 1 from auth.users where id = '00000000-0000-0000-0000-00000000000e'));
select pg_temp.expect('one household purged', private.purge_deleted_households() = 1);
select pg_temp.expect('B''s anonymous display users deleted with the household', not exists (
  select 1 from auth.users where id = '00000000-0000-0000-0000-00000000000e'));
select pg_temp.expect('non-anonymous users and other households'' display users kept', exists (
  select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000b9')
  and exists (select 1 from auth.users where id = '00000000-0000-0000-0000-00000000000d'));
select pg_temp.expect('B household and its data gone', not exists (select 1 from public.households where id = pg_temp.v('household_b'))
  and not exists (select 1 from public.children where id = pg_temp.v('kid_b'))
  and not exists (select 1 from public.memberships where household_id = pg_temp.v('household_b'))
  and not exists (select 1 from public.displays where household_id = pg_temp.v('household_b')));
select pg_temp.expect('B photo files are left for the storage sweep (only the Storage API erases file bytes)', exists (
  select 1 from storage.objects where bucket_id = 'household-photos' and name like pg_temp.v('household_b')::text || '/%'));
select pg_temp.expect('F (deleted 29 days ago) kept', exists (select 1 from public.households where id = pg_temp.v('household_f'))
  and exists (select 1 from storage.objects where bucket_id = 'household-photos' and name like pg_temp.v('household_f')::text || '/%'));
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects where bucket_id = 'household-photos' and name = :'household_f' || '/00000000-0000-0000-0000-0000000000f1.jpg';
select set_config('storage.allow_delete_query', 'false', true);
update public.households set deleted_at = null where id = :'household_f';

\echo '[63] Membership, display and deletion privileges'
select pg_temp.expect('anon cannot execute the full-sign-in settings RPCs', not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (
    'create_member_invite', 'accept_member_invite', 'set_member_role', 'remove_member', 'leave_household',
    'rename_display', 'delete_household')
    and has_function_privilege('anon', p.oid, 'execute')));
select pg_temp.expect('authenticated can execute all 7 full-sign-in settings RPCs', (
  select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (
    'create_member_invite', 'accept_member_invite', 'set_member_role', 'remove_member', 'leave_household',
    'rename_display', 'delete_household')
    and has_function_privilege('authenticated', p.oid, 'execute')) = 7);
select pg_temp.expect('no client role can execute purge or the membership helpers', not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname in ('purge_deleted_households', 'my_membership_id', 'require_other_owner', 'end_membership')
    and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))));
select pg_temp.expect('member_invites: RLS on, no policies, no client privileges, not in realtime', (
  select relrowsecurity from pg_class where oid = 'public.member_invites'::regclass)
  and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'member_invites')
  and not has_table_privilege('authenticated', 'public.member_invites', 'select, insert, update, delete, truncate, references, trigger')
  and not has_table_privilege('anon', 'public.member_invites', 'select, insert, update, delete, truncate, references, trigger')
  and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'member_invites'));

-- ─── Take list (spec §7.8) ───────────────────────────────────────────────
-- The token RPCs are security definer and ignore the caller, so their behavior is checked as authenticated with
-- no claims; what anon may execute is checked with privilege functions (see the note above [26]) and
-- supabase/manual-checks/anon_api_check.sh.
\set J '{"sub":"00000000-0000-0000-0000-000000000013","role":"authenticated","is_anonymous":true}'
\set NO_CLAIMS '{"role":"anon"}'
reset role;
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, is_anonymous, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, '{}', '{}', true, now(), now());
insert into public.households (name, time_zone) values ('K family', 'America/New_York') returning id as household_k \gset
insert into public.grocery_items (household_id, text, created_at, checked_at) values
  (:'household_f', 'Milk', now() - interval '3 hours', null) returning id as grocery_milk \gset
insert into public.grocery_items (household_id, text, created_at, checked_at) values
  (:'household_f', 'Apples', now() - interval '4 hours', now() - interval '1 hour') returning id as grocery_apples \gset
insert into public.grocery_items (household_id, text, created_at, checked_at) values
  (:'household_f', 'Old bread', now() - interval '3 days', now() - interval '25 hours'),
  (:'household_f', 'Eggs', now() - interval '2 hours', null);
insert into public.grocery_items (household_id, text) values (:'household_k', 'K coffee') returning id as grocery_k \gset
select set_config('smoke.grocery_milk', :'grocery_milk', true), set_config('smoke.grocery_k', :'grocery_k', true);
set local role authenticated;

\echo '[64] create_take_list_link: members and displays only; returns a 256-bit token stored only as a hash'
select set_config('request.jwt.claims', :'A', true);
select pg_temp.expect_error('non-member creates a link',
  $q$select * from public.create_take_list_link(pg_temp.v('household_f'))$q$, '42501');
select pg_temp.expect_error('non-member revokes links',
  $q$select public.revoke_take_list_link(pg_temp.v('household_f'))$q$, '42501');
select set_config('request.jwt.claims', :'F', true);
select out_display_id as display_f2, out_claim_token as token_f2 from public.register_display(:'household_f', 'Hall tablet') \gset
select set_config('request.jwt.claims', :'J', true);
select public.claim_display(:'token_f2');
select out_token as take_token_1, out_expires_at as take_expires_1 from public.create_take_list_link(:'household_f') \gset
select set_config('smoke.take_token_1', :'take_token_1', true);
select pg_temp.expect('token is 43 base64url characters', :'take_token_1' ~ '^[A-Za-z0-9_-]{43}$');
select pg_temp.expect('link expires in 24 hours',
  :'take_expires_1'::timestamptz between now() + interval '23 hours 59 minutes' and now() + interval '24 hours 1 minute');
reset role;
select pg_temp.expect('only the SHA-256 hash is stored', (
  select count(*) from public.take_list_links
  where household_id = pg_temp.v('household_f') and token_hash = encode(extensions.digest(:'take_token_1', 'sha256'), 'hex')
    and revoked_at is null) = 1
  and not exists (select 1 from public.take_list_links where token_hash = :'take_token_1'));
set local role authenticated;

\echo '[65] take_list_items: this household''s groceries only, unchecked first, checked within 24 hours'
select set_config('request.jwt.claims', :'NO_CLAIMS', true);
select pg_temp.expect('items are Milk, Eggs (unchecked, oldest first), then Apples (checked)', (
  select array_agg(out_text || ':' || out_checked order by ord) from public.take_list_items(pg_temp.v_text('take_token_1'))
    with ordinality as t (out_id, out_text, out_checked, ord)) = array['Milk:false', 'Eggs:false', 'Apples:true']);
select pg_temp.expect_error('unknown token rejected',
  $q$select * from public.take_list_items('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')$q$, '42501');
select pg_temp.expect_error('malformed token rejected',
  $q$select * from public.take_list_items('not a token')$q$, '42501');
select pg_temp.expect_error('null token rejected',
  $q$select * from public.take_list_items(null)$q$, '42501');

\echo '[66] take_list_set_checked toggles an item of the link''s household only'
select public.take_list_set_checked(:'take_token_1', :'grocery_milk', true);
reset role;
select pg_temp.expect('milk checked', (select checked_at is not null from public.grocery_items where id = pg_temp.v('grocery_milk')));
update public.grocery_items set checked_at = now() - interval '5 minutes' where id = :'grocery_milk';
set local role authenticated;
select public.take_list_set_checked(:'take_token_1', :'grocery_milk', true);
reset role;
select pg_temp.expect('checking a checked item keeps its time', (
  select checked_at < now() - interval '4 minutes' from public.grocery_items where id = pg_temp.v('grocery_milk')));
set local role authenticated;
select public.take_list_set_checked(:'take_token_1', :'grocery_milk', false);
reset role;
select pg_temp.expect('milk unchecked', (select checked_at is null from public.grocery_items where id = pg_temp.v('grocery_milk')));
set local role authenticated;
select pg_temp.expect_error('another household''s item rejected',
  $q$select public.take_list_set_checked(pg_temp.v_text('take_token_1'), pg_temp.v('grocery_k'), true)$q$, '22023');
select pg_temp.expect_error('null checked rejected',
  $q$select public.take_list_set_checked(pg_temp.v_text('take_token_1'), pg_temp.v('grocery_milk'), null)$q$, '22023');
reset role;
select pg_temp.expect('K item untouched', (select checked_at is null from public.grocery_items where id = pg_temp.v('grocery_k')));
set local role authenticated;

\echo '[67] Creating a second link revokes the first; expired and revoked links are rejected'
select set_config('request.jwt.claims', :'F', true);
select out_token as take_token_2 from public.create_take_list_link(:'household_f') \gset
select set_config('smoke.take_token_2', :'take_token_2', true);
select set_config('request.jwt.claims', :'NO_CLAIMS', true);
select pg_temp.expect_error('first link revoked by the second',
  $q$select * from public.take_list_items(pg_temp.v_text('take_token_1'))$q$, '42501');
select pg_temp.expect_error('revoked link cannot check items',
  $q$select public.take_list_set_checked(pg_temp.v_text('take_token_1'), pg_temp.v('grocery_milk'), true)$q$, '42501');
select pg_temp.expect_error('revoked link cannot finish',
  $q$select public.take_list_done(pg_temp.v_text('take_token_1'))$q$, '42501');
select pg_temp.expect('second link works', (select count(*) from public.take_list_items(:'take_token_2')) = 3);
reset role;
select pg_temp.expect('one active link per household', (
  select count(*) from public.take_list_links where household_id = pg_temp.v('household_f') and revoked_at is null) = 1);
update public.take_list_links set expires_at = now() - interval '1 second'
where token_hash = encode(extensions.digest(:'take_token_2', 'sha256'), 'hex');
set local role authenticated;
select pg_temp.expect_error('expired link rejected',
  $q$select * from public.take_list_items(pg_temp.v_text('take_token_2'))$q$, '42501');

\echo '[68] take_list_done and revoke_take_list_link end the link'
select set_config('request.jwt.claims', :'F', true);
select out_token as take_token_3 from public.create_take_list_link(:'household_f') \gset
select set_config('smoke.take_token_3', :'take_token_3', true);
select set_config('request.jwt.claims', :'NO_CLAIMS', true);
select public.take_list_done(:'take_token_3');
select pg_temp.expect_error('done link rejected',
  $q$select * from public.take_list_items(pg_temp.v_text('take_token_3'))$q$, '42501');
reset role;
select pg_temp.expect('done revokes the link', (
  select revoked_at is not null from public.take_list_links
  where token_hash = encode(extensions.digest(:'take_token_3', 'sha256'), 'hex')));
set local role authenticated;
select set_config('request.jwt.claims', :'J', true);
select out_token as take_token_4 from public.create_take_list_link(:'household_f') \gset
select set_config('smoke.take_token_4', :'take_token_4', true);
select public.revoke_take_list_link(:'household_f');
select pg_temp.expect_error('revoked link rejected',
  $q$select * from public.take_list_items(pg_temp.v_text('take_token_4'))$q$, '42501');

\echo '[69] Take list privileges'
reset role;
select pg_temp.expect('anon and authenticated can execute the token RPCs',
  has_function_privilege('anon', 'public.take_list_items(text)', 'execute')
  and has_function_privilege('anon', 'public.take_list_set_checked(text, uuid, boolean)', 'execute')
  and has_function_privilege('anon', 'public.take_list_done(text)', 'execute')
  and has_function_privilege('authenticated', 'public.take_list_items(text)', 'execute')
  and has_function_privilege('authenticated', 'public.take_list_set_checked(text, uuid, boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.take_list_done(text)', 'execute'));
select pg_temp.expect('PUBLIC cannot execute the token RPCs', not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where n.nspname = 'public' and p.proname in ('take_list_items', 'take_list_set_checked', 'take_list_done',
    'create_take_list_link', 'revoke_take_list_link')
    and a.grantee = 0 and a.privilege_type = 'EXECUTE'));
select pg_temp.expect('only authenticated can create or revoke links',
  not has_function_privilege('anon', 'public.create_take_list_link(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.revoke_take_list_link(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.create_take_list_link(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.revoke_take_list_link(uuid)', 'execute'));
select pg_temp.expect('no client role can execute the take list helper', not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'take_list_household'
    and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))));
select pg_temp.expect('take_list_links: no client privileges and no policies',
  not has_table_privilege('authenticated', 'public.take_list_links', 'select, insert, update, delete, truncate, references, trigger')
  and not has_table_privilege('anon', 'public.take_list_links', 'select, insert, update, delete, truncate, references, trigger')
  and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'take_list_links'));

-- ─── Weather (spec §5.6) ─────────────────────────────────────────────────
\echo '[70] household_weather: members and displays read their own household''s row only'
reset role;
insert into public.household_weather (household_id, fetched_at, current_temp_f, high_f, low_f, precip_chance, summary, icon)
values (:'household_f', now(), 74, 78, 61, 20, 'Partly Sunny', 'partly'),
       (:'household_k', now(), 50, 55, 40, 0, 'Cloudy', 'cloud');
select set_config('smoke.household_k', :'household_k', true);
set local role authenticated;
select set_config('request.jwt.claims', :'F', true);
select pg_temp.expect('member reads own household''s weather', (
  select array_agg(household_id) from public.household_weather) = array[pg_temp.v('household_f')]);
select set_config('request.jwt.claims', :'J', true);
select pg_temp.expect('display reads own household''s weather', (
  select current_temp_f from public.household_weather where household_id = pg_temp.v('household_f')) = 74);
select set_config('request.jwt.claims', :'A', true);
select pg_temp.expect('other household sees no weather', not exists (select 1 from public.household_weather));
select set_config('request.jwt.claims', :'NO_CLAIMS', true);
select pg_temp.expect('signed-out caller sees no weather', not exists (select 1 from public.household_weather));
set local role anon;
select pg_temp.expect_error('anon cannot read weather', $q$select * from public.household_weather$q$, '42501');
set local role authenticated;

\echo '[71] household_weather: clients cannot write'
select set_config('request.jwt.claims', :'F', true);
select pg_temp.expect_error('member cannot insert weather',
  $q$insert into public.household_weather (household_id, current_temp_f) values (pg_temp.v('household_k'), 1)$q$, '42501');
select pg_temp.expect_error('member cannot update weather',
  $q$update public.household_weather set current_temp_f = 1 where household_id = pg_temp.v('household_f')$q$, '42501');
select pg_temp.expect_error('member cannot delete weather',
  $q$delete from public.household_weather where household_id = pg_temp.v('household_f')$q$, '42501');
select set_config('request.jwt.claims', :'J', true);
select pg_temp.expect_error('display cannot upsert weather',
  $q$insert into public.household_weather (household_id, current_temp_f) values (pg_temp.v('household_f'), 1)
     on conflict (household_id) do update set current_temp_f = 1$q$, '42501');
reset role;
select pg_temp.expect('weather untouched', (
  select current_temp_f from public.household_weather where household_id = pg_temp.v('household_f')) = 74);

\echo '[72] is_my_household, location changes clear the cache, and weather privileges'
set local role authenticated;
select set_config('request.jwt.claims', :'F', true);
select pg_temp.expect('member: is_my_household true', public.is_my_household(:'household_f'));
select pg_temp.expect('member: another household is not mine', not public.is_my_household(:'household_k'));
select pg_temp.expect('null household is not mine', not public.is_my_household(null));
select set_config('request.jwt.claims', :'J', true);
select pg_temp.expect('display: is_my_household true', public.is_my_household(:'household_f'));
select set_config('request.jwt.claims', :'A', true);
select pg_temp.expect('non-member: is_my_household false', not public.is_my_household(:'household_f'));
reset role;
update public.households set name = name where id = :'household_f';
select pg_temp.expect('non-location household update keeps the cache', exists (
  select 1 from public.household_weather where household_id = pg_temp.v('household_f')));
update public.households set lat = 35.23, lon = -80.84 where id = :'household_f';
select pg_temp.expect('changing the location deletes the cached row', not exists (
  select 1 from public.household_weather where household_id = pg_temp.v('household_f')));
select pg_temp.expect('other household''s cache untouched', exists (
  select 1 from public.household_weather where household_id = pg_temp.v('household_k')));
select pg_temp.expect('only authenticated can execute is_my_household',
  has_function_privilege('authenticated', 'public.is_my_household(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.is_my_household(uuid)', 'execute'));
select pg_temp.expect('PUBLIC cannot execute is_my_household', not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where n.nspname = 'public' and p.proname = 'is_my_household' and a.grantee = 0 and a.privilege_type = 'EXECUTE'));
select pg_temp.expect('no client role can execute the weather trigger function', not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'clear_weather_on_location_change'
    and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))));
select pg_temp.expect('household_weather: authenticated select only, anon nothing',
  has_table_privilege('authenticated', 'public.household_weather', 'select')
  and not has_table_privilege('authenticated', 'public.household_weather', 'insert, update, delete, truncate, references, trigger')
  and not has_table_privilege('anon', 'public.household_weather', 'select, insert, update, delete, truncate, references, trigger'));
select pg_temp.expect('household_weather: RLS on, one select policy, realtime published', (
  select relrowsecurity from pg_class where oid = 'public.household_weather'::regclass)
  and (select array_agg(cmd) from pg_policies where schemaname = 'public' and tablename = 'household_weather') = array['SELECT']
  and exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'household_weather'));

-- ─── Photos (spec §7.9, §11.1) ────────────────────────────────────────────
-- Storage uploads and reads are simulated by writing storage.objects as `authenticated` with the caller's claims,
-- which is what the Storage API does (it runs the same RLS policies).
\echo '[73] household-photos bucket: private; members and displays upload into their own household''s folder only'
reset role;
select gen_random_uuid() as photo_f1, gen_random_uuid() as photo_f2, gen_random_uuid() as photo_k1 \gset
select set_config('smoke.photo_f1', :'photo_f1', true), set_config('smoke.photo_f2', :'photo_f2', true),
       set_config('smoke.photo_k1', :'photo_k1', true), set_config('smoke.household_f', :'household_f', true);
select pg_temp.expect('bucket exists, private, JPEG only', exists (
  select 1 from storage.buckets where id = 'household-photos' and not public and allowed_mime_types = array['image/jpeg']
    and file_size_limit is not null));
insert into storage.objects (bucket_id, name) values ('household-photos', :'household_k' || '/' || :'photo_k1' || '.jpg');
set local role authenticated;
select set_config('request.jwt.claims', :'F', true);
insert into storage.objects (bucket_id, name) values ('household-photos', :'household_f' || '/' || :'photo_f1' || '.jpg');
select pg_temp.expect('an uploaded object is not readable until add_photo records it', not exists (
  select 1 from storage.objects where bucket_id = 'household-photos'));
select pg_temp.expect_error('member cannot upload into another household''s folder',
  $q$insert into storage.objects (bucket_id, name) values ('household-photos', pg_temp.v('household_k')::text || '/' || gen_random_uuid()::text || '.jpg')$q$, '42501');
select pg_temp.expect_error('member cannot upload a name other than <household>/<uuid>.jpg',
  $q$insert into storage.objects (bucket_id, name) values ('household-photos', pg_temp.v('household_f')::text || '/avatar.png')$q$, '42501');
select pg_temp.expect_error('member cannot upload into a nested folder',
  $q$insert into storage.objects (bucket_id, name) values ('household-photos', pg_temp.v('household_f')::text || '/x/' || gen_random_uuid()::text || '.jpg')$q$, '42501');
select pg_temp.expect_error('member cannot upload into another bucket',
  $q$insert into storage.objects (bucket_id, name) values ('other', pg_temp.v('household_f')::text || '/' || gen_random_uuid()::text || '.jpg')$q$, '42501');
update storage.objects set name = pg_temp.v('household_f')::text || '/' || gen_random_uuid()::text || '.jpg'
  where bucket_id = 'household-photos';
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects where bucket_id = 'household-photos';
select set_config('storage.allow_delete_query', 'false', true);
reset role;
select pg_temp.expect('member cannot rename or delete objects directly', (
  select count(*) from storage.objects where name = pg_temp.v('household_f')::text || '/' || pg_temp.v('photo_f1')::text || '.jpg') = 1);
set local role authenticated;
select set_config('request.jwt.claims', :'J', true);
insert into storage.objects (bucket_id, name) values ('household-photos', :'household_f' || '/' || :'photo_f2' || '.jpg');
reset role;
select pg_temp.expect('display uploads into its household''s folder', (
  select count(*) from storage.objects where bucket_id = 'household-photos' and name like pg_temp.v('household_f')::text || '/%') = 2);
set local role authenticated;
select set_config('request.jwt.claims', :'A', true);
select pg_temp.expect('non-member sees no objects', not exists (select 1 from storage.objects where bucket_id = 'household-photos'));
set local role anon;
select set_config('request.jwt.claims', :'NO_CLAIMS', true);
select pg_temp.expect('anon sees no objects', not exists (select 1 from storage.objects where bucket_id = 'household-photos'));
select pg_temp.expect_error('anon cannot upload',
  $q$insert into storage.objects (bucket_id, name) values ('household-photos', pg_temp.v('household_f')::text || '/' || gen_random_uuid()::text || '.jpg')$q$, '42501');
set local role authenticated;

\echo '[74] add_photo: PIN, uploaded object in the household''s folder, kind, 200 slideshow photos'
select set_config('request.jwt.claims', :'J', true);
select pg_temp.expect_error('add_photo wrong PIN',
  $q$select public.add_photo(pg_temp.v('membership_f'), '0000', pg_temp.v('photo_f1'), 'slideshow')$q$, '42501');
select pg_temp.expect_error('add_photo with no uploaded object',
  $q$select public.add_photo(pg_temp.v('membership_f'), '2468', gen_random_uuid(), 'slideshow')$q$, '22023');
select pg_temp.expect_error('add_photo for another household''s object',
  $q$select public.add_photo(pg_temp.v('membership_f'), '2468', pg_temp.v('photo_k1'), 'slideshow')$q$, '22023');
select pg_temp.expect_error('add_photo unknown kind',
  $q$select public.add_photo(pg_temp.v('membership_f'), '2468', pg_temp.v('photo_f1'), 'banner')$q$, '22023');
select pg_temp.expect_error('add_photo null id',
  $q$select public.add_photo(pg_temp.v('membership_f'), '2468', null, 'slideshow')$q$, '22023');
select public.add_photo(:'membership_f', '2468', :'photo_f1', 'slideshow');
select pg_temp.expect('photo row written with its storage path', exists (
  select 1 from public.photos where id = pg_temp.v('photo_f1') and household_id = pg_temp.v('household_f') and kind = 'slideshow'
    and storage_path = pg_temp.v('household_f')::text || '/' || pg_temp.v('photo_f1')::text || '.jpg'));
select pg_temp.expect('add_photo audited', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'photos', 'add', pg_temp.v('photo_f1')));
select pg_temp.expect('a recorded photo is readable by its household''s display', (
  select array_agg(name) from storage.objects where bucket_id = 'household-photos')
  = array[pg_temp.v('household_f')::text || '/' || pg_temp.v('photo_f1')::text || '.jpg']);
select set_config('request.jwt.claims', :'F', true);
select pg_temp.expect('a recorded photo is readable by its household''s members', exists (
  select 1 from storage.objects where bucket_id = 'household-photos' and name = pg_temp.v('household_f')::text || '/' || pg_temp.v('photo_f1')::text || '.jpg'));
select set_config('request.jwt.claims', :'A', true);
select pg_temp.expect('another household cannot read a recorded photo', not exists (select 1 from storage.objects where bucket_id = 'household-photos'));
select set_config('request.jwt.claims', :'J', true);
select public.add_photo(:'membership_f', '2468', :'photo_f1', 'slideshow');
select pg_temp.expect('add_photo retried with the same id is a no-op', (select count(*) from public.photos where id = pg_temp.v('photo_f1')) = 1);
select pg_temp.expect_error('add_photo retried as another kind',
  $q$select public.add_photo(pg_temp.v('membership_f'), '2468', pg_temp.v('photo_f1'), 'avatar')$q$, '22023');
select set_config('request.jwt.claims', :'A', true);
select pg_temp.expect_error('another household''s adult cannot add to F',
  $q$select public.add_photo(pg_temp.v('membership_f'), '2468', pg_temp.v('photo_f2'), 'slideshow')$q$, '42501');
reset role;
insert into public.photos (id, household_id, storage_path, kind)
select g.id, :'household_f', :'household_f' || '/' || g.id::text || '.jpg', 'slideshow'
from (select gen_random_uuid() as id from generate_series(1, 198)) g;
set local role authenticated;
select set_config('request.jwt.claims', :'F', true);
select public.add_photo(:'membership_f', '2468', :'photo_f2', 'slideshow');
select pg_temp.expect('200 slideshow photos allowed', (select count(*) from public.photos where kind = 'slideshow') = 200);
reset role;
insert into storage.objects (bucket_id, name) values ('household-photos', :'household_f' || '/' || :'photo_k1' || '.jpg');
set local role authenticated;
select pg_temp.expect_error('the 201st slideshow photo is rejected',
  $q$select public.add_photo(pg_temp.v('membership_f'), '2468', pg_temp.v('photo_k1'), 'slideshow')$q$, '22023');
select public.add_photo(:'membership_f', '2468', :'photo_k1', 'step');
select pg_temp.expect('the slideshow limit does not apply to step photos', exists (
  select 1 from public.photos where id = pg_temp.v('photo_k1') and kind = 'step'));

\echo '[75] delete_photo: PIN, own household only; removes the row and references to it, and the file stops being readable'
reset role;
update public.children set photo_id = :'photo_k1'
  where id = (select child_id from public.child_households where household_id = :'household_f' order by child_id limit 1);
set local role authenticated;
select set_config('request.jwt.claims', :'F', true);
select public.upsert_routine(:'membership_f', '2468', null,
  (select child_id from public.child_households where household_id = :'household_f' order by child_id limit 1),
  'Photo routine', '{}', jsonb_build_array(jsonb_build_object('label', 'Shoes', 'photoId', :'photo_k1'))) as routine_photo \gset
select set_config('smoke.routine_photo', :'routine_photo', true);
select pg_temp.expect_error('delete_photo wrong PIN',
  $q$select public.delete_photo(pg_temp.v('membership_f'), '0000', pg_temp.v('photo_k1'))$q$, '42501');
select pg_temp.expect_error('delete_photo of another household''s photo',
  $q$select public.delete_photo(pg_temp.v('membership_a'), '4242', pg_temp.v('photo_k1'))$q$, '42501');
select pg_temp.expect_error('delete_photo of an unknown photo',
  $q$select public.delete_photo(pg_temp.v('membership_f'), '2468', gen_random_uuid())$q$, '42501');
select pg_temp.expect('the photo is readable before it is deleted', exists (select 1 from storage.objects
  where bucket_id = 'household-photos' and name = pg_temp.v('household_f')::text || '/' || pg_temp.v('photo_k1')::text || '.jpg'));
select public.delete_photo(:'membership_f', '2468', :'photo_k1');
select pg_temp.expect('a deleted photo''s file is unreadable at once', not exists (select 1 from storage.objects
  where bucket_id = 'household-photos' and name = pg_temp.v('household_f')::text || '/' || pg_temp.v('photo_k1')::text || '.jpg'));
reset role;
select pg_temp.expect('delete_photo removes the row and leaves the file for the storage sweep', not exists (select 1 from public.photos where id = pg_temp.v('photo_k1'))
  and exists (select 1 from storage.objects where bucket_id = 'household-photos'
    and name = pg_temp.v('household_f')::text || '/' || pg_temp.v('photo_k1')::text || '.jpg'));
select pg_temp.expect('the other household''s object with the same id is untouched', exists (
  select 1 from storage.objects where bucket_id = 'household-photos' and name = pg_temp.v('household_k')::text || '/' || pg_temp.v('photo_k1')::text || '.jpg'));
select pg_temp.expect('delete_photo clears the child photo and routine step photo', not exists (
  select 1 from public.children where photo_id = pg_temp.v('photo_k1'))
  and (select steps -> 0 ->> 'photoId' from public.routines where id = pg_temp.v('routine_photo')) is null
  and (select steps -> 0 ->> 'label' from public.routines where id = pg_temp.v('routine_photo')) = 'Shoes');
select pg_temp.expect('delete_photo audited', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'photos', 'delete', pg_temp.v('photo_k1')));
select pg_temp.expect('direct deletes from storage stay blocked', coalesce(current_setting('storage.allow_delete_query', true), 'false') <> 'true');
set local role authenticated;

\echo '[76] Photo privileges'
select pg_temp.expect('only authenticated can execute add_photo and delete_photo', (
  select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('add_photo', 'delete_photo')
    and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')) = 2);
select pg_temp.expect('PUBLIC cannot execute the photo RPCs', not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where n.nspname in ('public', 'private') and p.proname in ('add_photo', 'delete_photo', 'photo_object_household', 'photo_object_readable')
    and a.grantee = 0 and a.privilege_type = 'EXECUTE'));
select pg_temp.expect('photos: clients cannot write directly',
  not has_table_privilege('authenticated', 'public.photos', 'insert, update, delete')
  and not has_table_privilege('anon', 'public.photos', 'select, insert, update, delete'));
select pg_temp.expect('photos published to realtime', exists (
  select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'photos'));
select pg_temp.expect('the old SQL object-deletion helper is gone', not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'delete_photo_objects'));
select pg_temp.expect('storage policies: select and insert only, for this bucket', (
  select array_agg(cmd order by cmd) from pg_policies where schemaname = 'storage' and tablename = 'objects'
    and policyname like 'household_photos_%') = array['INSERT', 'SELECT']);


-- ─── Settings hardening (migration 7) ────────────────────────────────────
\echo '[77] revoke_display and set_my_pin are audited'
set local role authenticated;
select set_config('request.jwt.claims', :'F', true);
select out_display_id as display_spare from public.register_display(:'household_f', 'Spare tablet') \gset
select public.revoke_display(:'display_spare');
select pg_temp.expect('revoke_display audited', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'displays', 'revoke', :'display_spare'::uuid));
select public.set_my_pin(:'household_f', '2468');
select pg_temp.expect('set_my_pin audited without the PIN', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'my_account', 'pin', pg_temp.v('membership_f'))
  and not exists (select 1 from public.settings_audit where change::text like '%2468%'));
select set_config('request.jwt.claims', :'A', true);
select pg_temp.expect_error('set_my_pin in a household the adult is not a member of',
  $q$select public.set_my_pin(pg_temp.v('household_f'), '1234')$q$, '42501');

\echo '[78] update_entry: PIN-checked, allow-listed tables and fields, own household only, audited'
reset role;
select child_id as kid_edit from public.child_households where household_id = :'household_f' order by child_id limit 1 \gset
select id as category_f from public.sticker_categories where household_id = :'household_f' limit 1 \gset
insert into public.sticker_categories (household_id, name, icon_key) values (:'household_k', 'K cat', 'star') returning id as category_k \gset
insert into public.sleep_entries (household_id, child_id, start_at, end_at, type)
  values (:'household_f', :'kid_edit', now() - interval '3 hours', now() - interval '2 hours', 'nap') returning id as sleep_edit \gset
insert into public.feeding_entries (household_id, child_id, at, type) values (:'household_f', :'kid_edit', now() - interval '1 hour', 'milk')
  returning id as feeding_edit \gset
insert into public.sticker_entries (household_id, child_id, category_id, at) values (:'household_f', :'kid_edit', :'category_f', now())
  returning id as sticker_edit \gset
insert into public.diaper_entries (household_id, child_id, at, kind) values (:'household_f', :'kid_edit', now(), 'wet')
  returning id as diaper_edit \gset
insert into public.jots (household_id, text) values (:'household_f', 'Edit me') returning id as jot_edit \gset
insert into public.jots (household_id, text) values (:'household_k', 'K jot') returning id as jot_k \gset
select set_config('smoke.sleep_edit', :'sleep_edit', true), set_config('smoke.feeding_edit', :'feeding_edit', true),
       set_config('smoke.sticker_edit', :'sticker_edit', true), set_config('smoke.jot_edit', :'jot_edit', true),
       set_config('smoke.jot_k', :'jot_k', true), set_config('smoke.category_k', :'category_k', true),
       set_config('smoke.kid_edit', :'kid_edit', true);
set local role authenticated;
select set_config('request.jwt.claims', :'J', true);
select public.update_entry(:'membership_f', '2468', 'sleep_entries', :'sleep_edit',
  jsonb_build_object('start_at', now() - interval '4 hours', 'end_at', now() - interval '90 minutes'));
select pg_temp.expect('sleep times changed from the display', (
  select start_at = now() - interval '4 hours' and end_at = now() - interval '90 minutes' from public.sleep_entries where id = pg_temp.v('sleep_edit')));
select pg_temp.expect('update_entry audited with the PIN''s membership', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'logs', 'update_entry', pg_temp.v('sleep_edit'))
  and (select change -> 'fields' -> 'fields' ? 'start_at' and change -> 'fields' ->> 'table' = 'sleep_entries' from public.settings_audit order by id desc limit 1));
select public.update_entry(:'membership_f', '2468', 'sleep_entries', :'sleep_edit', '{"end_at": null}');
select pg_temp.expect('a sleep can be reopened', (select end_at is null from public.sleep_entries where id = pg_temp.v('sleep_edit')));
select public.update_entry(:'membership_f', '2468', 'feeding_entries', :'feeding_edit', '{"type": "meal", "amount": "4 oz", "note": "Peas"}');
select pg_temp.expect('feeding fields changed', (
  select type = 'meal' and amount = '4 oz' and note = 'Peas' from public.feeding_entries where id = pg_temp.v('feeding_edit')));
select public.update_entry(:'membership_f', '2468', 'diaper_entries', :'diaper_edit', '{"kind": "both"}');
select pg_temp.expect('diaper kind changed', (select kind = 'both' from public.diaper_entries where id = :'diaper_edit'::uuid));
select public.update_entry(:'membership_f', '2468', 'jots', :'jot_edit', jsonb_build_object('text', '  Edited  ', 'done_at', now()));
select pg_temp.expect('jot text trimmed and checked off', (
  select text = 'Edited' and done_at = now() from public.jots where id = pg_temp.v('jot_edit')));
select pg_temp.expect_error('end before start',
  $q$select public.update_entry(pg_temp.v('membership_f'), '2468', 'sleep_entries', pg_temp.v('sleep_edit'), jsonb_build_object('end_at', now() - interval '5 hours'))$q$, '22023');
select pg_temp.expect_error('a field that is not editable',
  $q$select public.update_entry(pg_temp.v('membership_f'), '2468', 'sleep_entries', pg_temp.v('sleep_edit'), jsonb_build_object('child_id', gen_random_uuid()))$q$, '22023');
select pg_temp.expect_error('attribution is not editable',
  $q$select public.update_entry(pg_temp.v('membership_f'), '2468', 'feeding_entries', pg_temp.v('feeding_edit'), '{"logged_by_name": "Someone"}')$q$, '22023');
select pg_temp.expect_error('doses are never edited',
  $q$select public.update_entry(pg_temp.v('membership_f'), '2468', 'dose_entries', gen_random_uuid(), '{"at": "2026-01-01T00:00:00Z"}')$q$, '22023');
select pg_temp.expect_error('other tables are not editable',
  $q$select public.update_entry(pg_temp.v('membership_f'), '2468', 'households', pg_temp.v('household_f'), '{"name": "X"}')$q$, '22023');
select pg_temp.expect_error('empty fields',
  $q$select public.update_entry(pg_temp.v('membership_f'), '2468', 'jots', pg_temp.v('jot_edit'), '{}')$q$, '22023');
select pg_temp.expect_error('fields that are not an object',
  $q$select public.update_entry(pg_temp.v('membership_f'), '2468', 'jots', pg_temp.v('jot_edit'), '["text"]')$q$, '22023');
select pg_temp.expect_error('a malformed time',
  $q$select public.update_entry(pg_temp.v('membership_f'), '2468', 'feeding_entries', pg_temp.v('feeding_edit'), '{"at": "yesterday-ish"}')$q$, '22023');
select pg_temp.expect_error('an unknown feeding type',
  $q$select public.update_entry(pg_temp.v('membership_f'), '2468', 'feeding_entries', pg_temp.v('feeding_edit'), '{"type": "juice"}')$q$, '22023');
select pg_temp.expect_error('a required field set to null',
  $q$select public.update_entry(pg_temp.v('membership_f'), '2468', 'feeding_entries', pg_temp.v('feeding_edit'), '{"at": null}')$q$, '22023');
select pg_temp.expect_error('a blank jot',
  $q$select public.update_entry(pg_temp.v('membership_f'), '2468', 'jots', pg_temp.v('jot_edit'), '{"text": "   "}')$q$, '22023');
select pg_temp.expect_error('another household''s sticker category',
  $q$select public.update_entry(pg_temp.v('membership_f'), '2468', 'sticker_entries', pg_temp.v('sticker_edit'), jsonb_build_object('category_id', pg_temp.v('category_k')))$q$, '22023');
select pg_temp.expect_error('another household''s entry reads as not found',
  $q$select public.update_entry(pg_temp.v('membership_f'), '2468', 'jots', pg_temp.v('jot_k'), '{"text": "Mine"}')$q$, '22023');
select pg_temp.expect_error('an unknown entry',
  $q$select public.update_entry(pg_temp.v('membership_f'), '2468', 'jots', gen_random_uuid(), '{"text": "Mine"}')$q$, '22023');
select pg_temp.expect_error('update_entry with a wrong PIN',
  $q$select public.update_entry(pg_temp.v('membership_f'), '0000', 'jots', pg_temp.v('jot_edit'), '{"text": "Nope"}')$q$, '42501');
select pg_temp.expect_error('update_entry as a caregiver',
  $q$select public.update_entry(pg_temp.v('membership_g'), '3333', 'jots', pg_temp.v('jot_edit'), '{"text": "Nope"}')$q$, '42501');
select set_config('request.jwt.claims', :'A', true);
select pg_temp.expect_error('a non-member uses F''s PIN',
  $q$select public.update_entry(pg_temp.v('membership_f'), '2468', 'jots', pg_temp.v('jot_edit'), '{"text": "Nope"}')$q$, '42501');
reset role;
select pg_temp.expect('rejected edits changed nothing', (select text = 'Edited' from public.jots where id = pg_temp.v('jot_edit'))
  and (select text = 'K jot' from public.jots where id = pg_temp.v('jot_k'))
  and (select type = 'meal' and at = now() - interval '1 hour' from public.feeding_entries where id = pg_temp.v('feeding_edit')));

\echo '[79] delete_entry: PIN-checked, never doses, own household only, audited'
set local role authenticated;
select set_config('request.jwt.claims', :'J', true);
select pg_temp.expect_error('delete_entry with a wrong PIN',
  $q$select public.delete_entry(pg_temp.v('membership_f'), '0000', 'feeding_entries', pg_temp.v('feeding_edit'))$q$, '42501');
select pg_temp.expect_error('doses are never deleted',
  $q$select public.delete_entry(pg_temp.v('membership_f'), '2468', 'dose_entries', gen_random_uuid())$q$, '22023');
select pg_temp.expect_error('another household''s jot reads as not found',
  $q$select public.delete_entry(pg_temp.v('membership_f'), '2468', 'jots', pg_temp.v('jot_k'))$q$, '22023');
select public.delete_entry(:'membership_f', '2468', 'feeding_entries', :'feeding_edit');
select pg_temp.expect('feeding deleted', not exists (select 1 from public.feeding_entries where id = pg_temp.v('feeding_edit')));
select pg_temp.expect('delete_entry audited', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'logs', 'delete_entry', pg_temp.v('feeding_edit')));
select pg_temp.expect_error('deleting it again reads as not found',
  $q$select public.delete_entry(pg_temp.v('membership_f'), '2468', 'feeding_entries', pg_temp.v('feeding_edit'))$q$, '22023');
select public.delete_entry(:'membership_f', '2468', 'jots', :'jot_edit');
reset role;
select pg_temp.expect('K jot untouched', exists (select 1 from public.jots where id = pg_temp.v('jot_k')));

\echo '[80] Entry RPC privileges'
select pg_temp.expect('only authenticated can execute update_entry and delete_entry',
  has_function_privilege('authenticated', 'public.update_entry(uuid, text, text, uuid, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.delete_entry(uuid, text, text, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.update_entry(uuid, text, text, uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.delete_entry(uuid, text, text, uuid)', 'execute'));
select pg_temp.expect('PUBLIC cannot execute the entry RPCs', not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where n.nspname in ('public', 'private') and p.proname in ('update_entry', 'delete_entry', 'editable_entry_columns')
    and a.grantee = 0 and a.privilege_type = 'EXECUTE'));
select pg_temp.expect('no client role can execute the editable-columns helper',
  not has_function_privilege('authenticated', 'private.editable_entry_columns(text)', 'execute')
  and not has_function_privilege('anon', 'private.editable_entry_columns(text)', 'execute'));


\echo '[81] set_household_location: PIN-checked, rounded, validated, audited without coordinates; ZIP changes leave it alone'
reset role;
update public.households set lat = null, lon = null where id = :'household_f';
insert into public.household_weather (household_id, fetched_at, current_temp_f) values (:'household_f', now(), 70)
  on conflict (household_id) do update set current_temp_f = 70;
set local role authenticated;
select set_config('request.jwt.claims', :'J', true);
select public.set_household_location(:'membership_f', '2468', 35.226944, -80.843124);
reset role;
select pg_temp.expect('location saved, rounded to 2 decimals', (
  select lat = 35.23 and lon = -80.84 from public.households where id = pg_temp.v('household_f')));
select pg_temp.expect('a new location clears the cached weather', not exists (
  select 1 from public.household_weather where household_id = pg_temp.v('household_f')));
select pg_temp.expect('location change audited without coordinates', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'household', 'location', pg_temp.v('household_f'))
  and (select change::text not like '%35.2%' and change::text not like '%80.8%' from public.settings_audit order by id desc limit 1));
set local role authenticated;
select set_config('request.jwt.claims', :'F', true);
select public.update_household_settings(:'membership_f', '2468', 'F family', '80202', 'America/Denver', 20, '18:00', '05:00', '20:00', '06:00', false);
reset role;
select pg_temp.expect('changing the ZIP keeps the weather location', (
  select zip = '80202' and lat = 35.23 and lon = -80.84 from public.households where id = pg_temp.v('household_f')));
set local role authenticated;
select pg_temp.expect_error('location with a wrong PIN',
  $q$select public.set_household_location(pg_temp.v('membership_f'), '0000', 35.2, -80.8)$q$, '42501');
select pg_temp.expect_error('location as a caregiver',
  $q$select public.set_household_location(pg_temp.v('membership_g'), '3333', 35.2, -80.8)$q$, '42501');
select pg_temp.expect_error('latitude out of range',
  $q$select public.set_household_location(pg_temp.v('membership_f'), '2468', 91, -80.8)$q$, '22023');
select pg_temp.expect_error('longitude out of range',
  $q$select public.set_household_location(pg_temp.v('membership_f'), '2468', 35.2, -181)$q$, '22023');
select pg_temp.expect_error('only one coordinate',
  $q$select public.set_household_location(pg_temp.v('membership_f'), '2468', 35.2, null)$q$, '22023');
select pg_temp.expect_error('not a number',
  $q$select public.set_household_location(pg_temp.v('membership_f'), '2468', 'NaN'::float8, -80.8)$q$, '22023');
select set_config('request.jwt.claims', :'A', true);
select pg_temp.expect_error('a non-member uses F''s PIN',
  $q$select public.set_household_location(pg_temp.v('membership_f'), '2468', 35.2, -80.8)$q$, '42501');
select set_config('request.jwt.claims', :'F', true);
select public.set_household_location(:'membership_f', '2468', null, null);
reset role;
select pg_temp.expect('both null clears the location', (
  select lat is null and lon is null from public.households where id = pg_temp.v('household_f')));
select pg_temp.expect('only authenticated can execute set_household_location',
  has_function_privilege('authenticated', 'public.set_household_location(uuid, text, double precision, double precision)', 'execute')
  and not has_function_privilege('anon', 'public.set_household_location(uuid, text, double precision, double precision)', 'execute'));


\echo '[82] A wrong PIN is slowed on the server but still just false (no lockout)'
set local role authenticated;
select set_config('request.jwt.claims', :'F', true);
select clock_timestamp() as wrong_pin_started \gset
select pg_temp.expect('wrong PIN still returns false', not public.verify_pin(:'membership_f', '0000'));
select pg_temp.expect('the wrong PIN took at least half a second', clock_timestamp() - :'wrong_pin_started'::timestamptz >= interval '500 milliseconds');
select pg_temp.expect('the right PIN still works right after', public.verify_pin(:'membership_f', '2468'));
reset role;


\echo '[83] revoke_member_invite: the token holder (e.g. the display, after the owner signed out) cancels an unused invite'
set local role authenticated;
select set_config('request.jwt.claims', :'F', true);
select out_token as invite_cancel from public.create_member_invite(:'household_f', 'adult') \gset
select out_token as invite_keep from public.create_member_invite(:'household_f', 'owner') \gset
select set_config('smoke.invite_cancel', :'invite_cancel', true);
select set_config('request.jwt.claims', :'J', true);
select public.revoke_member_invite(:'invite_cancel');
reset role;
select pg_temp.expect('the cancelled invite is deleted, the other kept', not exists (
  select 1 from public.member_invites where token_hash = encode(extensions.digest(:'invite_cancel', 'sha256'), 'hex'))
  and exists (select 1 from public.member_invites where token_hash = encode(extensions.digest(:'invite_keep', 'sha256'), 'hex')));
select pg_temp.expect('the cancellation is audited', (
  select change ->> 'section' = 'members' and change ->> 'action' = 'invite_cancel' from public.settings_audit
  where household_id = pg_temp.v('household_f') order by id desc limit 1));
set local role authenticated;
select set_config('request.jwt.claims', :'H', true);
select pg_temp.expect_error('a cancelled invite cannot be accepted',
  format('select public.accept_member_invite(%L, %L, %L, %L)', :'invite_cancel', 'Hana', '#2F86A6', '9999'), '22023');
-- Unknown, null and repeated tokens are a quiet no-op (these would stop the script if they raised).
select public.revoke_member_invite('not-a-token'), public.revoke_member_invite(null), public.revoke_member_invite(:'invite_cancel');
reset role;
select pg_temp.expect('only authenticated can execute revoke_member_invite',
  has_function_privilege('authenticated', 'public.revoke_member_invite(text)', 'execute')
  and not has_function_privilege('anon', 'public.revoke_member_invite(text)', 'execute'));


-- ─── Calendars (migration 8, spec §5.5, §6.3, §11.3) ─────────────────────
-- F owns household F (PIN 2468), G is its caregiver, H has left it, J is its display. I joins F as an adult here.
-- A owns households A2 and A3. The service role's calls are made through the svc_* wrappers as service_role.
reset role;
insert into public.memberships (user_id, household_id, role, display_name, color)
values ('00000000-0000-0000-0000-000000000012', :'household_f', 'adult', 'Indy', '#2F86A6') returning id as membership_i \gset
select h.id as household_a2 from public.households h where h.name = 'A2' \gset
select m.id as membership_a2 from public.memberships m where m.household_id = :'household_a2' \gset
insert into public.children (name, birthday, color) values ('A2 kid', '2024-02-02', '#C2477A') returning id as kid_a2 \gset
insert into public.child_households (child_id, household_id) values (:'kid_a2', :'household_a2');
insert into public.children (name, birthday, color) values ('Pip', '2024-03-03', '#C2477A') returning id as kid_pip \gset
insert into public.child_households (child_id, household_id) values (:'kid_pip', :'household_f');
select count(*) as vault_before from vault.secrets \gset
grant execute on all functions in schema pg_temp to service_role;
set local role service_role;
select public.svc_create_calendar_connection(:'household_f', :'membership_f', 'ics', '  Family  ', 'https://calendar.test/f.ics') as conn_f \gset
select public.svc_create_calendar_connection(:'household_f', :'membership_i', 'google', 'indy@work.test', 'refresh-i-1') as conn_i \gset
select public.svc_create_calendar_connection(:'household_a2', :'membership_a2', 'microsoft', 'Alex', 'refresh-a2') as conn_a2 \gset
select public.svc_add_calendar_selection(:'conn_f', 'f-cal-1', 'Family', null, null, null) as sel_f1 \gset
select public.svc_add_calendar_selection(:'conn_f', 'f-cal-2', 'Ivy school', true, null, :'kid_f') as sel_f2 \gset
select public.svc_add_calendar_selection(:'conn_i', 'i-cal-1', 'Work', false, :'membership_i', null) as sel_i1 \gset
select public.svc_add_calendar_selection(:'conn_a2', 'a2-cal-1', 'Alex', true, :'membership_a2', null) as sel_a2 \gset
reset role;
select set_config('smoke.membership_i', :'membership_i', true), set_config('smoke.household_a2', :'household_a2', true),
       set_config('smoke.membership_a2', :'membership_a2', true), set_config('smoke.kid_a2', :'kid_a2', true),
       set_config('smoke.kid_pip', :'kid_pip', true), set_config('smoke.conn_f', :'conn_f', true),
       set_config('smoke.conn_i', :'conn_i', true), set_config('smoke.conn_a2', :'conn_a2', true),
       set_config('smoke.sel_f1', :'sel_f1', true), set_config('smoke.sel_f2', :'sel_f2', true),
       set_config('smoke.sel_i1', :'sel_i1', true), set_config('smoke.sel_a2', :'sel_a2', true);
create function pg_temp.vault_secret_exists(p_connection uuid) returns boolean
language sql stable as $$
  select exists (select 1 from vault.secrets s join public.calendar_connections c on c.vault_secret_id = s.id where c.id = p_connection)
$$;

\echo '[84] Calendars: members and displays read their household''s connections (not vault_secret_id) and selections; other households see nothing'
select pg_temp.expect('three connections create three Vault secrets', (select count(*) from vault.secrets) = :vault_before + 3);
select pg_temp.expect('the label is trimmed; a new calendar is hidden and unassigned by default', (
  select label = 'Family' and status = 'ok' from public.calendar_connections where id = pg_temp.v('conn_f'))
  and (select not visible and not gone and assigned_membership_id is null and assigned_child_id is null
       from public.calendar_selections where id = pg_temp.v('sel_f1')));
select pg_temp.expect('Vault stores the secret encrypted under a unique calendar name', (
  select s.secret <> 'https://calendar.test/f.ics' and s.name like 'roost_calendar_ics_%'
  from vault.secrets s join public.calendar_connections c on c.vault_secret_id = s.id where c.id = pg_temp.v('conn_f')));
set local role authenticated;
select set_config('request.jwt.claims', :'F', true);
select pg_temp.expect('member reads the household''s connections', (
  select array_agg(id order by label) from public.calendar_connections
  where household_id = pg_temp.v('household_f')) = array[pg_temp.v('conn_f'), pg_temp.v('conn_i')]);
select pg_temp.expect('member reads connection names, owners and status', (
  select membership_id = pg_temp.v('membership_i') and provider = 'google' and label = 'indy@work.test' and status = 'ok'
  from public.calendar_connections where id = pg_temp.v('conn_i')));
select pg_temp.expect('member reads the household''s selections only', (
  select count(*) from public.calendar_selections) = 3
  and not exists (select 1 from public.calendar_selections where household_id <> pg_temp.v('household_f')));
select pg_temp.expect_error('member cannot select vault_secret_id',
  $q$select vault_secret_id from public.calendar_connections$q$, '42501');
select pg_temp.expect_error('member cannot select * from calendar_connections (it includes vault_secret_id)',
  $q$select * from public.calendar_connections$q$, '42501');
select set_config('request.jwt.claims', :'J', true);
select pg_temp.expect('display reads its household''s selections and connections', (
  select count(*) from public.calendar_selections where household_id = pg_temp.v('household_f')) = 3
  and (select count(*) from public.calendar_connections where household_id = pg_temp.v('household_f')) = 2
  and (select assigned_child_id from public.calendar_selections where id = pg_temp.v('sel_f2')) = pg_temp.v('kid_f'));
select pg_temp.expect_error('display cannot select vault_secret_id',
  $q$select vault_secret_id from public.calendar_connections$q$, '42501');
select set_config('request.jwt.claims', :'A', true);
select pg_temp.expect('another household sees none of F''s calendars', (
  select array_agg(id) from public.calendar_connections) = array[pg_temp.v('conn_a2')]
  and (select array_agg(id) from public.calendar_selections) = array[pg_temp.v('sel_a2')]);
select set_config('request.jwt.claims', :'H', true);
select pg_temp.expect('a former member sees no calendars', not exists (select 1 from public.calendar_connections)
  and not exists (select 1 from public.calendar_selections));
reset role;
select pg_temp.expect('column privileges: authenticated selects every connection column but vault_secret_id (and secret_fingerprint, migration 11)', (
  select bool_and(has_column_privilege('authenticated', 'public.calendar_connections', a.attname, 'select') = (a.attname not in ('vault_secret_id', 'secret_fingerprint')))
  from pg_attribute a where a.attrelid = 'public.calendar_connections'::regclass and a.attnum > 0 and not a.attisdropped));

\echo '[85] Calendars: clients cannot insert, update or delete directly'
set local role authenticated;
select set_config('request.jwt.claims', :'F', true);
select pg_temp.expect_error('member inserts a connection',
  $q$insert into public.calendar_connections (household_id, membership_id, provider, label, vault_secret_id)
     values (pg_temp.v('household_f'), pg_temp.v('membership_f'), 'ics', 'X', gen_random_uuid())$q$, '42501');
select pg_temp.expect_error('member inserts a selection',
  $q$insert into public.calendar_selections (household_id, connection_id, external_calendar_id, name)
     values (pg_temp.v('household_f'), pg_temp.v('conn_f'), 'x', 'X')$q$, '42501');
select pg_temp.expect_error('member updates a connection''s status',
  $q$update public.calendar_connections set status = 'ok' where id = pg_temp.v('conn_f')$q$, '42501');
select pg_temp.expect_error('member shows a selection directly',
  $q$update public.calendar_selections set visible = false where id = pg_temp.v('sel_f2')$q$, '42501');
select pg_temp.expect_error('member deletes a connection directly',
  $q$delete from public.calendar_connections where id = pg_temp.v('conn_f')$q$, '42501');
select set_config('request.jwt.claims', :'J', true);
select pg_temp.expect_error('display deletes a selection directly',
  $q$delete from public.calendar_selections where id = pg_temp.v('sel_f1')$q$, '42501');
reset role;
select pg_temp.expect('table privileges: authenticated select only, anon nothing, service_role select only',
  not has_table_privilege('authenticated', 'public.calendar_connections', 'insert, update, delete, truncate, references, trigger')
  and has_any_column_privilege('authenticated', 'public.calendar_selections', 'select')
  and not has_table_privilege('authenticated', 'public.calendar_selections', 'insert, update, delete, truncate, references, trigger')
  and not has_table_privilege('anon', 'public.calendar_connections', 'select, insert, update, delete, truncate, references, trigger')
  and not has_table_privilege('anon', 'public.calendar_selections', 'select, insert, update, delete, truncate, references, trigger')
  and not has_any_column_privilege('anon', 'public.calendar_connections', 'select')
  and has_table_privilege('service_role', 'public.calendar_connections', 'select')
  and not has_table_privilege('service_role', 'public.calendar_connections', 'insert, update, delete')
  and not has_table_privilege('service_role', 'public.calendar_selections', 'insert, update, delete'));
select pg_temp.expect('check constraints: at most one assignee, and a visible calendar has one', (
  select count(*) from pg_constraint where conrelid = 'public.calendar_selections'::regclass
    and conname in ('calendar_selections_one_assignee', 'calendar_selections_visible_needs_assignee')) = 2);
select pg_temp.expect_error('constraint: visible without an assignee',
  $q$update public.calendar_selections set visible = true where id = pg_temp.v('sel_f1')$q$, '23514');
select pg_temp.expect_error('constraint: two assignees',
  $q$update public.calendar_selections set assigned_membership_id = pg_temp.v('membership_f') where id = pg_temp.v('sel_f2')$q$, '23514');
select pg_temp.expect_error('constraint: a selection pointing at another household''s child',
  $q$update public.calendar_selections set assigned_child_id = pg_temp.v('kid_a2') where id = pg_temp.v('sel_f1')$q$, '23503');
select pg_temp.expect_error('constraint: a connection for another household''s member',
  $q$insert into public.calendar_connections (household_id, membership_id, provider, label, vault_secret_id)
     values (pg_temp.v('household_f'), pg_temp.v('membership_a2'), 'ics', 'X', gen_random_uuid())$q$, '23503');

\echo '[86] Calendar helpers: no client role executes the private helpers or the service wrappers'
select pg_temp.expect('anon and authenticated cannot execute any private calendar helper', not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname in (
    'store_calendar_secret', 'update_calendar_secret', 'calendar_secret', 'create_calendar_connection', 'add_calendar_selection',
    'set_calendar_status', 'set_calendar_selection_gone', 'require_calendar_assignee', 'hide_unassigned_calendar_selection',
    'delete_calendar_vault_secret', 'end_membership')
    and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))));
select pg_temp.expect('only service_role can execute the 16 svc_ wrappers (6 here, 2 OAuth state wrappers in migration 9, 3 export wrappers in migration 10, 5 calendar wrappers in migration 11)', (
  select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'svc\_%'
    and has_function_privilege('service_role', p.oid, 'execute')
    and not has_function_privilege('authenticated', p.oid, 'execute')
    and not has_function_privilege('anon', p.oid, 'execute')) = 16
  and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'svc\_%') = 16);
select pg_temp.expect('anon cannot execute svc_calendar_secret',
  not has_function_privilege('anon', 'public.svc_calendar_secret(uuid)', 'execute'));
select pg_temp.expect('PUBLIC cannot execute any calendar function', not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where n.nspname in ('public', 'private') and (p.proname like '%calendar%' or p.proname like 'svc\_%')
    and a.grantee = 0 and a.privilege_type = 'EXECUTE'));
select pg_temp.expect('only authenticated can execute set_calendar_selection and disconnect_calendar',
  has_function_privilege('authenticated', 'public.set_calendar_selection(uuid, boolean, uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.disconnect_calendar(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.set_calendar_selection(uuid, boolean, uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.disconnect_calendar(uuid)', 'execute'));
-- Privilege checks rather than calls: on this Supabase Postgres image a function-execute permission error raised
-- inside a pg_temp helper crashes the backend (see the note above [26]). The REST-level check is in anon_api_check.sh.
select pg_temp.expect('authenticated cannot execute svc_calendar_secret, svc_create_calendar_connection or private.calendar_secret',
  not has_function_privilege('authenticated', 'public.svc_calendar_secret(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.svc_create_calendar_connection(uuid, uuid, text, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'private.calendar_secret(uuid)', 'execute'));

\echo '[87] set_calendar_selection: full sign-in adult, own calendars only, same-household assignee, audited'
set local role authenticated;
select set_config('request.jwt.claims', :'J', true);
select pg_temp.expect_error('a display (no full sign-in) sets a selection',
  $q$select public.set_calendar_selection(pg_temp.v('sel_f1'), true, pg_temp.v('membership_f'), null)$q$, '42501');
select set_config('request.jwt.claims', :'I', true);
select pg_temp.expect_error('another adult of the household sets F''s selection',
  $q$select public.set_calendar_selection(pg_temp.v('sel_f1'), true, pg_temp.v('membership_i'), null)$q$, '42501');
select set_config('request.jwt.claims', :'A', true);
select pg_temp.expect_error('another household''s owner sets F''s selection',
  $q$select public.set_calendar_selection(pg_temp.v('sel_f1'), true, pg_temp.v('membership_a2'), null)$q$, '42501');
select set_config('request.jwt.claims', :'F', true);
select pg_temp.expect_error('assign to another household''s member',
  $q$select public.set_calendar_selection(pg_temp.v('sel_f1'), true, pg_temp.v('membership_a2'), null)$q$, '42501');
select pg_temp.expect_error('assign to another household''s child',
  $q$select public.set_calendar_selection(pg_temp.v('sel_f1'), true, null, pg_temp.v('kid_a2'))$q$, '42501');
select pg_temp.expect_error('assign to a former member',
  $q$select public.set_calendar_selection(pg_temp.v('sel_f1'), true, pg_temp.v('membership_h'), null)$q$, '42501');
select pg_temp.expect_error('visible without an assignee',
  $q$select public.set_calendar_selection(pg_temp.v('sel_f1'), true, null, null)$q$, '22023');
select pg_temp.expect_error('two assignees',
  $q$select public.set_calendar_selection(pg_temp.v('sel_f1'), false, pg_temp.v('membership_f'), pg_temp.v('kid_f'))$q$, '22023');
select pg_temp.expect_error('visible null',
  $q$select public.set_calendar_selection(pg_temp.v('sel_f1'), null, pg_temp.v('membership_f'), null)$q$, '22023');
select pg_temp.expect_error('an unknown selection',
  $q$select public.set_calendar_selection(gen_random_uuid(), false, null, null)$q$, '42501');
select pg_temp.expect_error('F sets I''s selection',
  $q$select public.set_calendar_selection(pg_temp.v('sel_i1'), true, pg_temp.v('membership_f'), null)$q$, '42501');
reset role;
select pg_temp.expect('rejected calls changed nothing', (
  select not visible and assigned_membership_id is null and assigned_child_id is null
  from public.calendar_selections where id = pg_temp.v('sel_f1')));
set local role authenticated;
select public.set_calendar_selection(:'sel_f1', true, :'membership_i', null);
select pg_temp.expect('F shows its calendar as Indy''s', (
  select visible and assigned_membership_id = pg_temp.v('membership_i') and assigned_child_id is null
  from public.calendar_selections where id = pg_temp.v('sel_f1')));
select pg_temp.expect('set_calendar_selection audited', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'calendars', 'selection', pg_temp.v('sel_f1')));
select public.set_calendar_selection(:'sel_f1', true, null, :'kid_pip');
select pg_temp.expect('reassigned to a child', (
  select visible and assigned_membership_id is null and assigned_child_id = pg_temp.v('kid_pip')
  from public.calendar_selections where id = pg_temp.v('sel_f1')));
select public.set_calendar_selection(:'sel_f1', false, null, null);
select pg_temp.expect('hidden and unassigned is allowed', (
  select not visible and assigned_child_id is null from public.calendar_selections where id = pg_temp.v('sel_f1')));
select public.set_calendar_selection(:'sel_f1', true, :'membership_i', null);
reset role;

\echo '[88] Service helpers: read and rotate secrets, record status, gone calendars and re-discovered calendars'
set local role service_role;
select pg_temp.expect('svc_calendar_secret returns the decrypted secret',
  public.svc_calendar_secret(:'conn_f') = 'https://calendar.test/f.ics');
select pg_temp.expect('svc_calendar_secret of an unknown connection is null', public.svc_calendar_secret(gen_random_uuid()) is null);
select public.svc_update_calendar_secret(:'conn_i', 'refresh-i-2');
select pg_temp.expect('svc_update_calendar_secret rotates the secret', public.svc_calendar_secret(:'conn_i') = 'refresh-i-2');
select pg_temp.expect_error('rotate to a blank secret',
  $q$select public.svc_update_calendar_secret(pg_temp.v('conn_i'), '  ')$q$, '22023');
select pg_temp.expect_error('rotate an unknown connection''s secret',
  $q$select public.svc_update_calendar_secret(gen_random_uuid(), 'x')$q$, '42501');
reset role;
update public.calendar_connections set status_changed_at = '2026-01-01T00:00:00Z' where id = :'conn_i';
select count(*) as vault_mid from vault.secrets \gset
set local role service_role;
select public.svc_set_calendar_status(:'conn_i', 'auth_expired');
select pg_temp.expect('status recorded with the time it changed', (
  select status = 'auth_expired' and status_changed_at = now() from public.calendar_connections where id = pg_temp.v('conn_i')));
reset role;
update public.calendar_connections set status_changed_at = '2026-01-01T00:00:00Z' where id = :'conn_i';
set local role service_role;
select public.svc_set_calendar_status(:'conn_i', 'auth_expired');
select pg_temp.expect('the same status again keeps its time', (
  select status_changed_at = '2026-01-01T00:00:00Z'::timestamptz from public.calendar_connections where id = pg_temp.v('conn_i')));
select pg_temp.expect_error('an unknown status', $q$select public.svc_set_calendar_status(pg_temp.v('conn_i'), 'broken')$q$, '22023');
select pg_temp.expect_error('status of an unknown connection', $q$select public.svc_set_calendar_status(gen_random_uuid(), 'ok')$q$, '42501');
select public.svc_set_calendar_selection_gone(:'sel_f1', true);
select pg_temp.expect('one calendar marked gone, the connection still ok', (
  select gone from public.calendar_selections where id = pg_temp.v('sel_f1'))
  and (select status = 'ok' from public.calendar_connections where id = pg_temp.v('conn_f')));
select pg_temp.expect_error('gone of an unknown selection', $q$select public.svc_set_calendar_selection_gone(gen_random_uuid(), true)$q$, '42501');
select pg_temp.expect('re-recording a calendar returns the same selection',
  public.svc_add_calendar_selection(:'conn_f', 'f-cal-1', '  Family (renamed)  ', false, null, null) = :'sel_f1'::uuid);
select pg_temp.expect('re-recording renames it, clears gone, and keeps the adult''s choices', (
  select name = 'Family (renamed)' and not gone and visible and assigned_membership_id = pg_temp.v('membership_i')
  from public.calendar_selections where id = pg_temp.v('sel_f1')));
select public.svc_add_calendar_selection(:'conn_f', 'f-cal-3', '   ', null, null, null) as sel_f3 \gset
select pg_temp.expect('a blank calendar name becomes Calendar', (
  select name = 'Calendar' and not visible from public.calendar_selections where id = :'sel_f3'));
select pg_temp.expect_error('add a visible calendar without an assignee',
  $q$select public.svc_add_calendar_selection(pg_temp.v('conn_f'), 'f-cal-4', 'X', true, null, null)$q$, '22023');
select pg_temp.expect_error('add a calendar assigned to another household''s child',
  $q$select public.svc_add_calendar_selection(pg_temp.v('conn_f'), 'f-cal-4', 'X', true, null, pg_temp.v('kid_a2'))$q$, '42501');
select pg_temp.expect_error('add a calendar to an unknown connection',
  $q$select public.svc_add_calendar_selection(gen_random_uuid(), 'f-cal-4', 'X', false, null, null)$q$, '42501');
select pg_temp.expect_error('connect for a caregiver',
  $q$select public.svc_create_calendar_connection(pg_temp.v('household_f'), pg_temp.v('membership_g'), 'ics', 'X', 'https://x.test/g.ics')$q$, '42501');
select pg_temp.expect_error('connect for a former member',
  $q$select public.svc_create_calendar_connection(pg_temp.v('household_f'), pg_temp.v('membership_h'), 'ics', 'X', 'https://x.test/h.ics')$q$, '42501');
select pg_temp.expect_error('connect for another household''s member',
  $q$select public.svc_create_calendar_connection(pg_temp.v('household_f'), pg_temp.v('membership_a2'), 'ics', 'X', 'https://x.test/a.ics')$q$, '42501');
select pg_temp.expect_error('connect an unknown provider',
  $q$select public.svc_create_calendar_connection(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'yahoo', 'X', 'https://x.test/f.ics')$q$, '22023');
select pg_temp.expect_error('connect with a blank secret',
  $q$select public.svc_create_calendar_connection(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'ics', 'X', '  ')$q$, '22023');
select pg_temp.expect_error('connect with a blank label',
  $q$select public.svc_create_calendar_connection(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'ics', ' ', 'https://x.test/f.ics')$q$, '22023');
reset role;
select pg_temp.expect('rejected connects and rotations left no Vault secrets behind', (select count(*) from vault.secrets) = :vault_mid);
select pg_temp.expect('connect audited with the provider only', (
  select change -> 'fields' = '{"provider": "google"}'::jsonb and membership_id = pg_temp.v('membership_i')
  from public.settings_audit where change ->> 'section' = 'calendars' and change ->> 'action' = 'connect'
    and change ->> 'target_id' = pg_temp.v('conn_i')::text)
  and not exists (select 1 from public.settings_audit where change::text like '%refresh-i%' or change::text like '%calendar.test%'));

\echo '[89] disconnect_calendar: full sign-in adult, own connection only; removes the connection, its selections and its Vault secret'
select vault_secret_id as secret_f from public.calendar_connections where id = :'conn_f' \gset
set local role authenticated;
select set_config('request.jwt.claims', :'J', true);
select pg_temp.expect_error('a display disconnects a calendar',
  $q$select public.disconnect_calendar(pg_temp.v('conn_f'))$q$, '42501');
select set_config('request.jwt.claims', :'I', true);
select pg_temp.expect_error('another adult of the household disconnects F''s calendar',
  $q$select public.disconnect_calendar(pg_temp.v('conn_f'))$q$, '42501');
select set_config('request.jwt.claims', :'A', true);
select pg_temp.expect_error('another household''s owner disconnects F''s calendar',
  $q$select public.disconnect_calendar(pg_temp.v('conn_f'))$q$, '42501');
select set_config('request.jwt.claims', :'F', true);
select pg_temp.expect_error('an unknown connection',
  $q$select public.disconnect_calendar(gen_random_uuid())$q$, '42501');
reset role;
select pg_temp.expect('F''s secret still exists before disconnecting', exists (select 1 from vault.secrets where id = :'secret_f'));
set local role authenticated;
select public.disconnect_calendar(:'conn_f');
select pg_temp.expect('disconnect audited', pg_temp.audited(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'calendars', 'disconnect', pg_temp.v('conn_f')));
select pg_temp.expect_error('disconnecting again reads as not found',
  $q$select public.disconnect_calendar(pg_temp.v('conn_f'))$q$, '42501');
reset role;
select pg_temp.expect('connection, selections and Vault secret gone', not exists (select 1 from public.calendar_connections where id = pg_temp.v('conn_f'))
  and not exists (select 1 from public.calendar_selections where connection_id = pg_temp.v('conn_f'))
  and not exists (select 1 from vault.secrets where id = :'secret_f'));
select pg_temp.expect('I''s connection and secret untouched', pg_temp.vault_secret_exists(pg_temp.v('conn_i')));

\echo '[90] Leaving, removal and deletions: the member''s calendars and secrets go; calendars assigned to them become hidden and unassigned'
set local role service_role;
select public.svc_create_calendar_connection(:'household_f', :'membership_f', 'ics', 'Family 2', 'https://calendar.test/f2.ics') as conn_f2 \gset
select public.svc_add_calendar_selection(:'conn_f2', 'f2-indy', 'For Indy', true, :'membership_i', null) as sel_f_indy \gset
select public.svc_add_calendar_selection(:'conn_f2', 'f2-pip', 'For Pip', true, null, :'kid_pip') as sel_f_pip \gset
select public.svc_add_calendar_selection(:'conn_f2', 'f2-frankie', 'For Frankie', true, :'membership_f', null) as sel_f_frankie \gset
reset role;
select vault_secret_id as secret_i from public.calendar_connections where id = :'conn_i' \gset
set local role authenticated;
select set_config('request.jwt.claims', :'F', true);
select public.remove_member(:'membership_i');
reset role;
select pg_temp.expect('remove_member removes the member''s connections, selections and Vault secrets',
  not exists (select 1 from public.calendar_connections where membership_id = pg_temp.v('membership_i'))
  and not exists (select 1 from public.calendar_selections where id = pg_temp.v('sel_i1'))
  and not exists (select 1 from vault.secrets where id = :'secret_i'));
select pg_temp.expect('a calendar assigned to the removed member is hidden and unassigned', (
  select not visible and assigned_membership_id is null and assigned_child_id is null
  from public.calendar_selections where id = :'sel_f_indy'));
select pg_temp.expect('other calendars keep their assignment', (
  select visible and assigned_membership_id = pg_temp.v('membership_f') from public.calendar_selections where id = :'sel_f_frankie'));
delete from public.children where id = :'kid_pip';
select pg_temp.expect('a calendar assigned to a deleted child is hidden and unassigned', (
  select not visible and assigned_child_id is null and assigned_membership_id is null
  from public.calendar_selections where id = :'sel_f_pip'));
-- I rejoins F (on the same membership) with the unused owner invite from [83], connects, then leaves.
set local role authenticated;
select set_config('request.jwt.claims', :'I', true);
select public.accept_member_invite(:'invite_keep', 'Indy', '#2F86A6', '9999');
reset role;
set local role service_role;
select public.svc_create_calendar_connection(:'household_f', :'membership_i', 'microsoft', 'Indy', 'refresh-i-3') as conn_i2 \gset
reset role;
select vault_secret_id as secret_i2 from public.calendar_connections where id = :'conn_i2' \gset
set local role authenticated;
select public.leave_household(:'household_f');
reset role;
select pg_temp.expect('leave_household removes the member''s connection and its Vault secret',
  not exists (select 1 from public.calendar_connections where id = :'conn_i2')
  and not exists (select 1 from vault.secrets where id = :'secret_i2'));
-- Deleting an account deletes its memberships; the foreign keys take the connections, and the trigger their secrets.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, is_anonymous, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'q@roost.test', '{}', '{}', false, now(), now());
insert into public.memberships (user_id, household_id, role, display_name, color)
values ('00000000-0000-0000-0000-000000000014', :'household_f', 'adult', 'Quinn', '#2F86A6') returning id as membership_q \gset
select private.create_calendar_connection(:'household_f', :'membership_q', 'google', 'Quinn', 'refresh-q') as conn_q \gset
select public.svc_add_calendar_selection(:'conn_f2', 'f2-quinn', 'For Quinn', true, :'membership_q', null) as sel_f_quinn \gset
select vault_secret_id as secret_q from public.calendar_connections where id = :'conn_q' \gset
delete from auth.users where id = '00000000-0000-0000-0000-000000000014';
select pg_temp.expect('deleting an account removes its connections and Vault secrets',
  not exists (select 1 from public.calendar_connections where id = :'conn_q')
  and not exists (select 1 from vault.secrets where id = :'secret_q'));
select pg_temp.expect('a calendar assigned to a deleted membership is hidden and unassigned', (
  select not visible and assigned_membership_id is null from public.calendar_selections where id = :'sel_f_quinn'));

\echo '[91] Household deletion disconnects calendars at once, and the purge removes any remaining Vault secrets'
select vault_secret_id as secret_a2 from public.calendar_connections where id = :'conn_a2' \gset
set local role authenticated;
select set_config('request.jwt.claims', :'A', true);
select public.delete_household(:'household_a2', 'A2');
reset role;
select pg_temp.expect('delete_household removes the household''s connections, selections and Vault secrets at once',
  not exists (select 1 from public.calendar_connections where household_id = pg_temp.v('household_a2'))
  and not exists (select 1 from public.calendar_selections where household_id = pg_temp.v('household_a2'))
  and not exists (select 1 from vault.secrets where id = :'secret_a2'));
select pg_temp.expect('F''s calendars untouched by A2''s deletion', exists (select 1 from public.calendar_connections where id = :'conn_f2')
  and pg_temp.vault_secret_exists(:'conn_f2'));
-- A connection left in a deleted household (e.g. written by an Edge Function mid-deletion) is caught by the purge.
insert into public.calendar_connections (household_id, membership_id, provider, label, vault_secret_id)
values (:'household_a2', :'membership_a2', 'ics', 'Late', private.store_calendar_secret('https://calendar.test/late.ics', 'roost_calendar_ics'))
returning id as conn_late, vault_secret_id as secret_late \gset
select pg_temp.expect('the secret of a deleted household''s connection is not handed out', public.svc_calendar_secret(:'conn_late') is null);
update public.households set deleted_at = now() - interval '31 days' where id = :'household_a2';
select private.purge_deleted_households() as purged \gset
select pg_temp.expect('the purge removes the household', :purged >= 1
  and not exists (select 1 from public.households where id = pg_temp.v('household_a2')));
select pg_temp.expect('the purge removes the household''s calendar Vault secrets',
  not exists (select 1 from public.calendar_connections where id = :'conn_late')
  and not exists (select 1 from vault.secrets where id = :'secret_late'));
select pg_temp.expect('no calendar Vault secret is left without a connection', not exists (
  select 1 from vault.secrets s where s.name like 'roost_calendar_%'
    and not exists (select 1 from public.calendar_connections c where c.vault_secret_id = s.id)));

\echo '[92] Calendar tables: RLS on, select policies only, realtime published with full replica identity'
select pg_temp.expect('RLS on and one SELECT policy each', (
  select bool_and(relrowsecurity) from pg_class where oid in ('public.calendar_connections'::regclass, 'public.calendar_selections'::regclass))
  and (select array_agg(cmd) from pg_policies where schemaname = 'public' and tablename = 'calendar_connections') = array['SELECT']
  and (select array_agg(cmd) from pg_policies where schemaname = 'public' and tablename = 'calendar_selections') = array['SELECT']);
select pg_temp.expect('both published to realtime with full replica identity', (
  select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('calendar_connections', 'calendar_selections')) = 2
  and (select bool_and(relreplident = 'f') from pg_class where oid in ('public.calendar_connections'::regclass, 'public.calendar_selections'::regclass)));
select pg_temp.expect('composite household foreign keys on every reference', (
  select count(*) from pg_constraint c
  where c.contype = 'f' and array_length(c.conkey, 1) = 2
    and c.conrelid in ('public.calendar_connections'::regclass, 'public.calendar_selections'::regclass)) = 4);


-- ─── Calendar access hardening (migration 9) ─────────────────────────────
\echo '[93] Calendar labels never contain URLs'
set local role service_role;
select pg_temp.expect_error('a label containing an https URL',
  $q$select public.svc_create_calendar_connection(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'ics', 'Feed https://calendar.test/x.ics', 'https://calendar.test/x.ics')$q$, '23514');
select pg_temp.expect_error('a label containing a webcal URL, in any case',
  $q$select public.svc_create_calendar_connection(pg_temp.v('household_f'), pg_temp.v('membership_f'), 'ics', 'WEBCAL://calendar.test/x.ics', 'https://calendar.test/x.ics')$q$, '23514');
reset role;
select pg_temp.expect('the label check constraint exists', exists (
  select 1 from pg_constraint where conrelid = 'public.calendar_connections'::regclass and conname = 'calendar_connections_label_no_url'));

\echo '[94] Calendars belong to active owners and adults of live households only'
-- Rows written directly (as postgres) stand in for connections that slipped past the checks: a caregiver's, a former
-- member's, and one in a deleted household.
insert into public.calendar_connections (household_id, membership_id, provider, label, vault_secret_id)
values (:'household_f', :'membership_g', 'google', 'Gale', private.store_calendar_secret('refresh-g', 'roost_calendar_google'))
returning id as conn_g \gset
insert into public.calendar_selections (household_id, connection_id, external_calendar_id, name)
values (:'household_f', :'conn_g', 'g-cal-1', 'Gale') returning id as sel_g \gset
insert into public.calendar_connections (household_id, membership_id, provider, label, vault_secret_id)
values (:'household_f', :'membership_h', 'google', 'Former', private.store_calendar_secret('refresh-h', 'roost_calendar_google'))
returning id as conn_h \gset
select h.id as household_a3, m.id as membership_a3 from public.households h join public.memberships m on m.household_id = h.id
where h.name = 'A3' \gset
select public.svc_create_calendar_connection(:'household_a3', :'membership_a3', 'ics', 'A3 family', 'https://calendar.test/a3.ics') as conn_a \gset
select set_config('smoke.conn_g', :'conn_g', true), set_config('smoke.sel_g', :'sel_g', true),
       set_config('smoke.conn_h', :'conn_h', true), set_config('smoke.conn_a', :'conn_a', true);
set local role service_role;
select pg_temp.expect('no secret is handed out for a caregiver''s or a former member''s connection',
  public.svc_calendar_secret(:'conn_g') is null and public.svc_calendar_secret(:'conn_h') is null);
select pg_temp.expect_error('rotate a caregiver''s secret', $q$select public.svc_update_calendar_secret(pg_temp.v('conn_g'), 'x')$q$, '42501');
select pg_temp.expect_error('rotate a former member''s secret', $q$select public.svc_update_calendar_secret(pg_temp.v('conn_h'), 'x')$q$, '42501');
select pg_temp.expect_error('add a calendar to a caregiver''s connection',
  $q$select public.svc_add_calendar_selection(pg_temp.v('conn_g'), 'g-cal-2', 'X', null, null, null)$q$, '42501');
select pg_temp.expect_error('add a calendar to a former member''s connection',
  $q$select public.svc_add_calendar_selection(pg_temp.v('conn_h'), 'h-cal-1', 'X', null, null, null)$q$, '42501');
reset role;
update public.households set deleted_at = now() where id = :'household_a3';
set local role service_role;
select pg_temp.expect_error('add a calendar in a deleted household',
  $q$select public.svc_add_calendar_selection(pg_temp.v('conn_a'), 'a-cal-1', 'X', null, null, null)$q$, '42501');
select pg_temp.expect_error('rotate a secret in a deleted household', $q$select public.svc_update_calendar_secret(pg_temp.v('conn_a'), 'x')$q$, '42501');
reset role;
update public.households set deleted_at = null where id = :'household_a3';
set local role authenticated;
select set_config('request.jwt.claims', :'G', true);
select pg_temp.expect_error('a caregiver sets a selection of their own connection',
  $q$select public.set_calendar_selection(pg_temp.v('sel_g'), false, null, null)$q$, '42501');
reset role;

\echo '[95] A role change away from owner or adult disconnects the member''s calendars and deletes their secrets'
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, is_anonymous, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'r@roost.test', '{}', '{}', false, now(), now());
insert into public.memberships (user_id, household_id, role, display_name, color)
values ('00000000-0000-0000-0000-000000000015', :'household_f', 'adult', 'Robin', '#2F86A6') returning id as membership_r \gset
set local role service_role;
select public.svc_create_calendar_connection(:'household_f', :'membership_r', 'microsoft', 'Robin', 'refresh-r') as conn_r \gset
select public.svc_add_calendar_selection(:'conn_r', 'r-cal-1', 'Robin', false, null, null) as sel_r \gset
reset role;
select vault_secret_id as secret_r from public.calendar_connections where id = :'conn_r' \gset
update public.memberships set role = role where id in (:'membership_r', :'membership_f');
select pg_temp.expect('an unchanged owner or adult role keeps the connections', exists (select 1 from public.calendar_connections where id = :'conn_r')
  and exists (select 1 from public.calendar_connections where id = :'conn_f2'));
update public.memberships set role = 'caregiver' where id = :'membership_r';
select pg_temp.expect('becoming a caregiver removes the connection, its selections and its Vault secret',
  not exists (select 1 from public.calendar_connections where membership_id = :'membership_r')
  and not exists (select 1 from public.calendar_selections where id = :'sel_r')
  and not exists (select 1 from vault.secrets where id = :'secret_r'));
select pg_temp.expect('other members'' calendars untouched', exists (select 1 from public.calendar_connections where id = :'conn_f2'));

\echo '[96] Membership checks lock the membership row, so a concurrent removal or role change waits and then cleans up'
select pg_temp.expect('create_calendar_connection and require_calendar_assignee take a share lock on the membership', (
  select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname in ('create_calendar_connection', 'require_calendar_assignee')
    and p.prosrc ~* 'for share of m') = 2
  and (select provolatile from pg_proc where oid = 'private.require_calendar_assignee(uuid, uuid, uuid, boolean)'::regprocedure) = 'v');

\echo '[97] calendar_selections.external_calendar_id is server-only'
set local role authenticated;
select set_config('request.jwt.claims', :'F', true);
select pg_temp.expect_error('member cannot select * from calendar_selections (it includes external_calendar_id)',
  $q$select * from public.calendar_selections$q$, '42501');
select pg_temp.expect_error('member cannot select external_calendar_id',
  $q$select external_calendar_id from public.calendar_selections$q$, '42501');
select pg_temp.expect('member selects an explicit column list', (
  select count(*) from (select id, connection_id, name, visible, gone, assigned_membership_id, assigned_child_id from public.calendar_selections) s) >= 1);
select set_config('request.jwt.claims', :'J', true);
select pg_temp.expect_error('display cannot select external_calendar_id',
  $q$select external_calendar_id from public.calendar_selections$q$, '42501');
reset role;
select pg_temp.expect('column privileges: authenticated selects every selection column but external_calendar_id', (
  select bool_and(has_column_privilege('authenticated', 'public.calendar_selections', a.attname, 'select') = (a.attname <> 'external_calendar_id'))
  from pg_attribute a where a.attrelid = 'public.calendar_selections'::regclass and a.attnum > 0 and not a.attisdropped)
  and has_table_privilege('service_role', 'public.calendar_selections', 'select'));

\echo '[98] Calendar Edge Function callers: my_calendar_caller (member or display) and my_calendar_membership (full sign-in adult)'
-- Privilege checks for anon (see the note above [26]); calls for everyone else.
select pg_temp.expect('only authenticated can execute my_calendar_caller and my_calendar_membership',
  has_function_privilege('authenticated', 'public.my_calendar_caller(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.my_calendar_membership(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.my_calendar_caller(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.my_calendar_membership(uuid)', 'execute'));
set local role authenticated;
select set_config('request.jwt.claims', :'F', true);
select pg_temp.expect('the owner is a member caller', (
  select kind = 'member' and membership_id = pg_temp.v('membership_f') and user_id = '00000000-0000-0000-0000-00000000000f'
  from public.my_calendar_caller(pg_temp.v('household_f'))));
select pg_temp.expect('the owner''s full sign-in returns their membership',
  public.my_calendar_membership(:'household_f') = :'membership_f'::uuid);
select pg_temp.expect_error('the owner, for a household they are not in',
  $q$select public.my_calendar_membership(pg_temp.v('household_b'))$q$, '42501');
select pg_temp.expect('no caller row for a household they are not in', not exists (select 1 from public.my_calendar_caller(pg_temp.v('household_b'))));
select set_config('request.jwt.claims', :'J', true);
select pg_temp.expect('a display is a display caller without a membership', (
  select kind = 'display' and membership_id is null from public.my_calendar_caller(pg_temp.v('household_f'))));
select pg_temp.expect_error('a display JWT is not a full sign-in', $q$select public.my_calendar_membership(pg_temp.v('household_f'))$q$, '42501');
select set_config('request.jwt.claims', :'G', true);
select pg_temp.expect('a caregiver is a member caller', (
  select kind = 'member' from public.my_calendar_caller(pg_temp.v('household_f'))));
select pg_temp.expect_error('a caregiver cannot connect calendars', $q$select public.my_calendar_membership(pg_temp.v('household_f'))$q$, '42501');
select set_config('request.jwt.claims', :'H', true);
select pg_temp.expect('a former member is no caller', not exists (select 1 from public.my_calendar_caller(pg_temp.v('household_f'))));
select pg_temp.expect_error('a former member cannot connect calendars', $q$select public.my_calendar_membership(pg_temp.v('household_f'))$q$, '42501');
reset role;

\echo '[99] Calendar OAuth states: service role only, hashed, single use, 10-minute expiry, purged'
select pg_temp.expect('calendar_oauth_states: RLS on, no policies, no client or direct service-role privileges', (
  select relrowsecurity from pg_class where oid = 'public.calendar_oauth_states'::regclass)
  and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'calendar_oauth_states')
  and not has_table_privilege('anon', 'public.calendar_oauth_states', 'select, insert, update, delete, truncate, references, trigger')
  and not has_table_privilege('authenticated', 'public.calendar_oauth_states', 'select, insert, update, delete, truncate, references, trigger')
  and not has_table_privilege('service_role', 'public.calendar_oauth_states', 'select, insert, update, delete, truncate, references, trigger')
  and not has_any_column_privilege('authenticated', 'public.calendar_oauth_states', 'select'));
select pg_temp.expect('only service_role can execute the OAuth state wrappers; nobody can execute the private helpers',
  has_function_privilege('service_role', 'public.svc_create_calendar_oauth_state(text, text, uuid, uuid, text, text)', 'execute')
  and has_function_privilege('service_role', 'public.svc_consume_calendar_oauth_state(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.svc_create_calendar_oauth_state(text, text, uuid, uuid, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.svc_consume_calendar_oauth_state(text)', 'execute')
  and not has_function_privilege('anon', 'public.svc_consume_calendar_oauth_state(text)', 'execute')
  and not has_function_privilege('anon', 'public.svc_create_calendar_oauth_state(text, text, uuid, uuid, text, text)', 'execute')
  and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('create_calendar_oauth_state', 'consume_calendar_oauth_state', 'purge_calendar_oauth_states')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
           or has_function_privilege('service_role', p.oid, 'execute'))));
select encode(extensions.digest('state-one', 'sha256'), 'hex') as state_one, encode(extensions.digest('state-two', 'sha256'), 'hex') as state_two,
       encode(extensions.digest('state-old', 'sha256'), 'hex') as state_old \gset
select set_config('smoke.state_one', :'state_one', true);
\set VERIFIER 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
set local role service_role;
select public.svc_create_calendar_oauth_state(:'state_one', :'VERIFIER', :'household_f', :'membership_f', 'google', 'settings') as oauth_one \gset
select public.svc_create_calendar_oauth_state(:'state_two', :'VERIFIER', :'household_f', :'membership_f', 'microsoft', 'manage') as oauth_two \gset
select pg_temp.expect_error('a state for a caregiver',
  format('select public.svc_create_calendar_oauth_state(%L, %L, %L, %L, %L, %L)', repeat('a', 64), :'VERIFIER', :'household_f', :'membership_g', 'google', 'settings'), '42501');
select pg_temp.expect_error('a state for a former member',
  format('select public.svc_create_calendar_oauth_state(%L, %L, %L, %L, %L, %L)', repeat('a', 64), :'VERIFIER', :'household_f', :'membership_h', 'google', 'settings'), '42501');
select pg_temp.expect_error('a state for another household''s member',
  format('select public.svc_create_calendar_oauth_state(%L, %L, %L, %L, %L, %L)', repeat('a', 64), :'VERIFIER', :'household_f', :'membership_b', 'google', 'settings'), '42501');
select pg_temp.expect_error('an unknown provider',
  format('select public.svc_create_calendar_oauth_state(%L, %L, %L, %L, %L, %L)', repeat('a', 64), :'VERIFIER', :'household_f', :'membership_f', 'ics', 'settings'), '22023');
select pg_temp.expect_error('an arbitrary return page (no open redirects)',
  format('select public.svc_create_calendar_oauth_state(%L, %L, %L, %L, %L, %L)', repeat('a', 64), :'VERIFIER', :'household_f', :'membership_f', 'google', 'https://evil.test'), '22023');
select pg_temp.expect_error('a raw (unhashed) state',
  format('select public.svc_create_calendar_oauth_state(%L, %L, %L, %L, %L, %L)', 'raw-state', :'VERIFIER', :'household_f', :'membership_f', 'google', 'settings'), '22023');
select pg_temp.expect_error('a short code verifier',
  format('select public.svc_create_calendar_oauth_state(%L, %L, %L, %L, %L, %L)', repeat('a', 64), 'short', :'household_f', :'membership_f', 'google', 'settings'), '22023');
select pg_temp.expect_error('the same state twice',
  format('select public.svc_create_calendar_oauth_state(%L, %L, %L, %L, %L, %L)', :'state_one', :'VERIFIER', :'household_f', :'membership_f', 'google', 'settings'), '23505');
select pg_temp.expect('consuming returns the attempt once', (
  select household_id = pg_temp.v('household_f') and membership_id = pg_temp.v('membership_f') and provider = 'google'
    and code_verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk' and redirect_to = 'settings' and not expired
  from public.svc_consume_calendar_oauth_state(pg_temp.v_text('state_one'))));
select pg_temp.expect('a used state is gone', not exists (select 1 from public.svc_consume_calendar_oauth_state(pg_temp.v_text('state_one'))));
select pg_temp.expect('an unknown state returns nothing', not exists (select 1 from public.svc_consume_calendar_oauth_state(repeat('0', 64))));
reset role;
insert into public.calendar_oauth_states (state_hash, code_verifier, household_id, membership_id, provider, redirect_to, created_at, expires_at)
values (:'state_old', :'VERIFIER', :'household_f', :'membership_f', 'google', 'manage', now() - interval '11 minutes', now() - interval '1 minute');
select pg_temp.expect('only hashes are stored', not exists (select 1 from public.calendar_oauth_states where state_hash in ('state-one', 'state-two')));
set local role service_role;
select set_config('smoke.state_old', :'state_old', true);
select pg_temp.expect('an expired state is consumed but reported expired', (
  select expired and redirect_to = 'manage' from public.svc_consume_calendar_oauth_state(pg_temp.v_text('state_old'))));
reset role;
insert into public.calendar_oauth_states (state_hash, code_verifier, household_id, membership_id, provider, redirect_to, expires_at)
values (repeat('b', 64), :'VERIFIER', :'household_f', :'membership_f', 'google', 'manage', now() - interval '1 minute');
select private.purge_deleted_households();
select pg_temp.expect('the daily purge removes expired states and keeps live ones',
  not exists (select 1 from public.calendar_oauth_states where state_hash = repeat('b', 64))
  and exists (select 1 from public.calendar_oauth_states where id = :'oauth_two'));
insert into public.calendar_oauth_states (state_hash, code_verifier, household_id, membership_id, provider, redirect_to, expires_at)
values (repeat('c', 64), :'VERIFIER', :'household_f', :'membership_f', 'google', 'manage', now() - interval '1 minute');
set local role service_role;
select public.svc_create_calendar_oauth_state(repeat('d', 64), :'VERIFIER', :'household_f', :'membership_f', 'google', 'settings');
reset role;
select pg_temp.expect('creating a state also removes expired ones', not exists (select 1 from public.calendar_oauth_states where state_hash = repeat('c', 64)));
select pg_temp.expect('states are deleted with their household and their membership', (
  select confdeltype = 'c' from pg_constraint where conrelid = 'public.calendar_oauth_states'::regclass and contype = 'f' and array_length(conkey, 1) = 1)
  and (select confdeltype = 'c' from pg_constraint where conrelid = 'public.calendar_oauth_states'::regclass and contype = 'f' and array_length(conkey, 1) = 2));

-- ─── Household export (spec §6.3, §11.3) ─────────────────────────────────
-- Fresh fixtures: household X with owner X, second owner X2, adult Y, caregiver Z and display W; household V with
-- owner V.
\set X '{"sub":"00000000-0000-0000-0000-000000000020","role":"authenticated","is_anonymous":false}'
\set X2 '{"sub":"00000000-0000-0000-0000-000000000024","role":"authenticated","is_anonymous":false}'
\set Y '{"sub":"00000000-0000-0000-0000-000000000021","role":"authenticated","is_anonymous":false}'
\set Z '{"sub":"00000000-0000-0000-0000-000000000022","role":"authenticated","is_anonymous":false}'
\set W '{"sub":"00000000-0000-0000-0000-000000000023","role":"authenticated","is_anonymous":true}'
\set V '{"sub":"00000000-0000-0000-0000-000000000025","role":"authenticated","is_anonymous":false}'
reset role;
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, is_anonymous, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x@roost.test', '{}', '{}', false, now(), now()),
  ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'y@roost.test', '{}', '{}', false, now(), now()),
  ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'z@roost.test', '{}', '{}', false, now(), now()),
  ('00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, '{}', '{}', true, now(), now()),
  ('00000000-0000-0000-0000-000000000024', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x2@roost.test', '{}', '{}', false, now(), now()),
  ('00000000-0000-0000-0000-000000000025', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'v@roost.test', '{}', '{}', false, now(), now());
insert into public.households (name, time_zone) values ('X family', 'America/New_York') returning id as household_x \gset
insert into public.households (name, time_zone) values ('V family', 'America/Denver') returning id as household_v \gset
insert into public.memberships (user_id, household_id, role, display_name, color) values
  ('00000000-0000-0000-0000-000000000020', :'household_x', 'owner', 'Xan', '#2F86A6') returning id as membership_x \gset
insert into public.memberships (user_id, household_id, role, display_name, color) values
  ('00000000-0000-0000-0000-000000000024', :'household_x', 'owner', 'Xia', '#2F86A6') returning id as membership_x2 \gset
insert into public.memberships (user_id, household_id, role, display_name, color) values
  ('00000000-0000-0000-0000-000000000021', :'household_x', 'adult', 'Yael', '#2F86A6'),
  ('00000000-0000-0000-0000-000000000022', :'household_x', 'caregiver', 'Zed', '#2F86A6');
insert into public.memberships (user_id, household_id, role, display_name, color) values
  ('00000000-0000-0000-0000-000000000025', :'household_v', 'owner', 'Val', '#2F86A6') returning id as membership_v \gset
insert into public.displays (household_id, name, auth_user_id) values (:'household_x', 'X kitchen', '00000000-0000-0000-0000-000000000023');
select set_config('smoke.household_x', :'household_x', true), set_config('smoke.household_v', :'household_v', true),
       set_config('smoke.membership_x', :'membership_x', true);

\echo '[100] household_exports: RLS on, owners of the household read, nobody writes; exports bucket is private'
select pg_temp.expect('table: RLS on, one SELECT policy, clients read only, anon nothing', (
  select relrowsecurity from pg_class where oid = 'public.household_exports'::regclass)
  and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'household_exports') = 1
  and (select cmd from pg_policies where schemaname = 'public' and tablename = 'household_exports') = 'SELECT'
  and has_table_privilege('authenticated', 'public.household_exports', 'select')
  and not has_table_privilege('authenticated', 'public.household_exports', 'insert, update, delete, truncate, references, trigger')
  and not has_table_privilege('anon', 'public.household_exports', 'select, insert, update, delete, truncate, references, trigger')
  and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'household_exports'));
select pg_temp.expect('exports bucket exists, private, ZIP only', exists (
  select 1 from storage.buckets where id = 'exports' and not public and allowed_mime_types = array['application/zip']));
select pg_temp.expect('no storage policy mentions the exports bucket', not exists (
  select 1 from pg_policies where schemaname = 'storage' and (coalesce(qual, '') || coalesce(with_check, '')) ilike '%exports%'));

\echo '[101] request_household_export: full sign-in owner of a live household only'
select pg_temp.expect('only authenticated can execute request_household_export and my_household_export',
  has_function_privilege('authenticated', 'public.request_household_export(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.my_household_export(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.request_household_export(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.my_household_export(uuid)', 'execute'));
set local role authenticated;
select set_config('request.jwt.claims', :'Y', true);
select pg_temp.expect_error('an adult cannot request', $q$select public.request_household_export(pg_temp.v('household_x'))$q$, '42501');
select set_config('request.jwt.claims', :'Z', true);
select pg_temp.expect_error('a caregiver cannot request', $q$select public.request_household_export(pg_temp.v('household_x'))$q$, '42501');
select set_config('request.jwt.claims', :'W', true);
select pg_temp.expect_error('a display cannot request', $q$select public.request_household_export(pg_temp.v('household_x'))$q$, '42501');
select set_config('request.jwt.claims', :'V', true);
select pg_temp.expect_error('another household''s owner cannot request', $q$select public.request_household_export(pg_temp.v('household_x'))$q$, '42501');
select pg_temp.expect_error('a null household', $q$select public.request_household_export(null)$q$, '42501');
select set_config('request.jwt.claims', :'X', true);
select public.request_household_export(:'household_x') as export_x \gset
select set_config('smoke.export_x', :'export_x', true);
select pg_temp.expect('the owner''s request is pending, for their membership, expiring in a day', (
  select status = 'pending' and requested_by = pg_temp.v('membership_x') and storage_path is null and error is null
    and ready_at is null and expires_at > now() + interval '23 hours'
  from public.household_exports where id = pg_temp.v('export_x')));
select pg_temp.expect('the request is audited', exists (
  select 1 from public.settings_audit where household_id = pg_temp.v('household_x') and membership_id = pg_temp.v('membership_x')
    and change ->> 'section' = 'export' and change ->> 'action' = 'request' and change ->> 'target_id' = pg_temp.v('export_x')::text));

\echo '[102] One export per household per hour: a distinct error with the minutes to wait'
select pg_temp.expect_error('a second request within the hour', $q$select public.request_household_export(pg_temp.v('household_x'))$q$, 'RL001');
select set_config('request.jwt.claims', :'X2', true);
select pg_temp.expect_error('another owner of the same household is limited too', $q$select public.request_household_export(pg_temp.v('household_x'))$q$, 'RL001');
do $$
declare v_detail text;
begin
  perform public.request_household_export(current_setting('smoke.household_x')::uuid);
  raise exception 'FAIL: rate limit did not raise';
exception when sqlstate 'RL001' then
  get stacked diagnostics v_detail = pg_exception_detail;
  if v_detail !~ '^retry_after_minutes=(60|59)$' then
    raise exception 'FAIL: rate limit detail was %', v_detail;
  end if;
end $$;
select set_config('request.jwt.claims', :'V', true);
select public.request_household_export(:'household_v') as export_v \gset
select pg_temp.expect('another household is not limited', :'export_v'::uuid is not null);
reset role;
update public.household_exports set status = 'failed', error = 'internal', started_at = now() where id = :'export_x';
set local role authenticated;
select set_config('request.jwt.claims', :'X', true);
select public.request_household_export(:'household_x') as export_x2 \gset
select pg_temp.expect('a failed export does not count toward the limit', :'export_x2'::uuid is not null);
reset role;
update public.household_exports set created_at = now() - interval '61 minutes', expires_at = now() + interval '1 hour' where id = :'export_x2';
set local role authenticated;
select public.request_household_export(:'household_x') as export_x3 \gset
select pg_temp.expect('after an hour the owner can request again, and the stale pending export is marked failed (timeout)', (
  select status = 'failed' and error = 'timeout' from public.household_exports where id = :'export_x2')
  and :'export_x3'::uuid is not null);
reset role;
select set_config('smoke.export_x3', :'export_x3', true), set_config('smoke.export_v', :'export_v', true);

\echo '[103] Owners of the household see its exports; nobody else does'
set local role authenticated;
select set_config('request.jwt.claims', :'X2', true);
select pg_temp.expect('a second owner sees the household''s exports', (
  select count(*) from public.household_exports where household_id = pg_temp.v('household_x')) = 3);
select pg_temp.expect('my_household_export returns the row to an owner', (
  select status = 'pending' and household_id = pg_temp.v('household_x') and not expired
  from public.my_household_export(pg_temp.v('export_x3'))));
select pg_temp.expect('owners never see another household''s exports', not exists (
  select 1 from public.household_exports where household_id = pg_temp.v('household_v')));
select pg_temp.expect_error('my_household_export: another household''s export reads as not found',
  $q$select * from public.my_household_export(pg_temp.v('export_v'))$q$, '42501');
select pg_temp.expect_error('my_household_export: an unknown id', $q$select * from public.my_household_export(gen_random_uuid())$q$, '42501');
select set_config('request.jwt.claims', :'Y', true);
select pg_temp.expect('an adult sees no exports', not exists (select 1 from public.household_exports));
select pg_temp.expect_error('an adult cannot read an export through my_household_export',
  $q$select * from public.my_household_export(pg_temp.v('export_x3'))$q$, '42501');
select set_config('request.jwt.claims', :'Z', true);
select pg_temp.expect('a caregiver sees no exports', not exists (select 1 from public.household_exports));
select set_config('request.jwt.claims', :'W', true);
select pg_temp.expect('a display sees no exports', not exists (select 1 from public.household_exports));
select pg_temp.expect_error('a display cannot read an export through my_household_export',
  $q$select * from public.my_household_export(pg_temp.v('export_x3'))$q$, '42501');
select set_config('request.jwt.claims', :'X', true);
select pg_temp.expect_error('an owner cannot insert', $q$insert into public.household_exports (household_id, requested_by) values (pg_temp.v('household_x'), pg_temp.v('membership_x'))$q$, '42501');
select pg_temp.expect_error('an owner cannot mark an export ready', $q$update public.household_exports set status = 'ready' where id = pg_temp.v('export_x3')$q$, '42501');
select pg_temp.expect_error('an owner cannot delete an export', $q$delete from public.household_exports where id = pg_temp.v('export_x3')$q$, '42501');
reset role;

\echo '[104] Export service wrappers: service role only'
-- Privilege checks only: calling an unprivileged function from a pg_temp helper crashes this image (see the note above [26]).
select pg_temp.expect('only service_role can execute the export wrappers; nobody can execute the private helpers',
  has_function_privilege('service_role', 'public.svc_claim_household_export(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.svc_mark_export_ready(uuid, text)', 'execute')
  and has_function_privilege('service_role', 'public.svc_mark_export_failed(uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.svc_claim_household_export(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.svc_mark_export_ready(uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.svc_mark_export_failed(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.svc_claim_household_export(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.svc_mark_export_ready(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.svc_mark_export_failed(uuid, text)', 'execute')
  and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('purge_old_exports', 'delete_exports_of_deleted_household')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
           or has_function_privilege('service_role', p.oid, 'execute'))));

\echo '[105] Claim, ready and failed: once each, the right path, short error codes'
set local role service_role;
select pg_temp.expect('claiming returns the household and the requesting owner''s email', (
  select household_id = pg_temp.v('household_x') and household_name = 'X family' and time_zone = 'America/New_York'
    and requester_email = 'x@roost.test'
  from public.svc_claim_household_export(pg_temp.v('export_x3'))));
select pg_temp.expect('an export is claimed once', not exists (select 1 from public.svc_claim_household_export(pg_temp.v('export_x3'))));
select pg_temp.expect('a failed export cannot be claimed', not exists (select 1 from public.svc_claim_household_export(pg_temp.v_text('export_x')::uuid)));
select pg_temp.expect_error('ready with another path',
  $q$select public.svc_mark_export_ready(pg_temp.v('export_x3'), pg_temp.v('household_v')::text || '/' || pg_temp.v('export_x3')::text || '.zip')$q$, '22023');
select public.svc_mark_export_ready(:'export_x3', :'household_x' || '/' || :'export_x3' || '.zip');
select pg_temp.expect('ready: path, ready_at and a fresh 24-hour expiry', (
  select status = 'ready' and storage_path = pg_temp.v('household_x')::text || '/' || pg_temp.v('export_x3')::text || '.zip'
    and ready_at is not null and expires_at > now() + interval '23 hours'
  from public.household_exports where id = pg_temp.v('export_x3')));
select pg_temp.expect_error('ready twice', $q$select public.svc_mark_export_ready(pg_temp.v('export_x3'), pg_temp.v('household_x')::text || '/' || pg_temp.v('export_x3')::text || '.zip')$q$, '22023');
select pg_temp.expect_error('failed after ready', $q$select public.svc_mark_export_failed(pg_temp.v('export_x3'), 'internal')$q$, '22023');
select public.svc_mark_export_failed(:'export_v', 'Error: stack trace at line 1');
select pg_temp.expect('failed: an error that is not a short code is stored as "internal"', (
  select status = 'failed' and error = 'internal' from public.household_exports where id = pg_temp.v('export_v')));
reset role;
update public.household_exports set status = 'pending', error = null where id = :'export_v';
set local role service_role;
select public.svc_mark_export_failed(:'export_v', 'too_large');
select pg_temp.expect('failed: a short code is kept', (select error = 'too_large' from public.household_exports where id = pg_temp.v('export_v')));
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'X', true);
select pg_temp.expect('the owner sees the ready export', (
  select status = 'ready' and not expired from public.my_household_export(pg_temp.v('export_x3'))));
reset role;

\echo '[106] No client access to objects in the exports bucket'
insert into storage.objects (bucket_id, name) values ('exports', :'household_x' || '/' || :'export_x3' || '.zip');
set local role authenticated;
select set_config('request.jwt.claims', :'X', true);
select pg_temp.expect('the owner cannot read export objects', not exists (select 1 from storage.objects where bucket_id = 'exports'));
select pg_temp.expect_error('the owner cannot upload into exports',
  $q$insert into storage.objects (bucket_id, name) values ('exports', pg_temp.v('household_x')::text || '/' || gen_random_uuid()::text || '.zip')$q$, '42501');
select set_config('request.jwt.claims', :'W', true);
select pg_temp.expect('a display cannot read export objects', not exists (select 1 from storage.objects where bucket_id = 'exports'));
select pg_temp.expect_error('a display cannot upload into exports',
  $q$insert into storage.objects (bucket_id, name) values ('exports', pg_temp.v('household_x')::text || '/' || gen_random_uuid()::text || '.zip')$q$, '42501');
set local role anon;
select set_config('request.jwt.claims', :'NO_CLAIMS', true);
select pg_temp.expect('anon cannot read export objects', not exists (select 1 from storage.objects where bucket_id = 'exports'));
reset role;

\echo '[107] Expiry and purge: expired reads as expired; the purge fails stale pending exports and deletes week-old rows'
update public.household_exports set expires_at = now() - interval '1 minute' where id = :'export_x3';
set local role authenticated;
select set_config('request.jwt.claims', :'X', true);
select pg_temp.expect('an expired export reads as expired', (select expired from public.my_household_export(pg_temp.v('export_x3'))));
reset role;
insert into public.household_exports (household_id, requested_by, created_at, expires_at)
values (:'household_v', :'membership_v', now() - interval '20 minutes', now() + interval '1 hour') returning id as export_stale \gset
insert into public.household_exports (household_id, requested_by, status, error, created_at, expires_at)
values (:'household_v', :'membership_v', 'failed', 'internal', now() - interval '8 days', now() - interval '7 days') returning id as export_old \gset
select private.purge_deleted_households();
select pg_temp.expect('the daily purge marks a pending export older than 15 minutes failed (timeout)', (
  select status = 'failed' and error = 'timeout' from public.household_exports where id = :'export_stale'));
select pg_temp.expect('the daily purge deletes exports older than 7 days and keeps newer ones',
  not exists (select 1 from public.household_exports where id = :'export_old')
  and exists (select 1 from public.household_exports where id = :'export_x3'));

\echo '[108] Deleting a household removes its exports at once; a member leaving removes nothing'
update public.memberships set left_at = now() where id = :'membership_x2';
select pg_temp.expect('a former owner''s membership leaving keeps the household''s exports', (
  select count(*) from public.household_exports where household_id = :'household_x') = 3);
set local role authenticated;
select set_config('request.jwt.claims', :'X2', true);
select pg_temp.expect('a former owner sees no exports', not exists (select 1 from public.household_exports));
select set_config('request.jwt.claims', :'X', true);
select public.delete_household(:'household_x', 'X family');
reset role;
select pg_temp.expect('a deleted household has no exports rows (the storage sweep erases the files)', not exists (
  select 1 from public.household_exports where household_id = :'household_x'));
select pg_temp.expect('other households keep theirs', exists (select 1 from public.household_exports where household_id = :'household_v'));

-- ─── Calendar OAuth attempts, fingerprints and rate limits (migration 11) ──
\echo '[109] Calendar attempts and connect-attempt counters: no client access; new svc wrappers service role only; fingerprints server-only and unique'
select pg_temp.expect('calendar_oauth_attempts and calendar_connect_attempts: RLS on, no policies, no privileges for anon, authenticated or service_role', (
  select bool_and(relrowsecurity) from pg_class where oid in ('public.calendar_oauth_attempts'::regclass, 'public.calendar_connect_attempts'::regclass))
  and not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('calendar_oauth_attempts', 'calendar_connect_attempts'))
  and not exists (
    select 1 from unnest(array['anon', 'authenticated', 'service_role']) as r (role_name),
      unnest(array['public.calendar_oauth_attempts', 'public.calendar_connect_attempts']) as t (table_name)
    where has_table_privilege(r.role_name, t.table_name, 'select, insert, update, delete, truncate, references, trigger')
       or has_any_column_privilege(r.role_name, t.table_name, 'select')));
select pg_temp.expect('the migration 11 svc_ wrappers are executable by service_role only; their private helpers by nobody', (
  select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('svc_create_calendar_connection_with_selections', 'svc_record_calendar_connect_attempt',
      'svc_create_calendar_oauth_attempt', 'svc_peek_calendar_oauth_attempt', 'svc_finish_calendar_oauth_attempt')
    and has_function_privilege('service_role', p.oid, 'execute')
    and not has_function_privilege('authenticated', p.oid, 'execute')
    and not has_function_privilege('anon', p.oid, 'execute')) = 5
  and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('create_calendar_connection_with_selections', 'record_calendar_connect_attempt',
        'create_calendar_oauth_attempt', 'peek_calendar_oauth_attempt', 'finish_calendar_oauth_attempt', 'normalize_calendar_list',
        'delete_calendar_attempt_vault_secret')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
           or has_function_privilege('service_role', p.oid, 'execute'))));
select pg_temp.expect('secret_fingerprint is not selectable by clients; unique per member and provider', (
  not has_column_privilege('authenticated', 'public.calendar_connections', 'secret_fingerprint', 'select')
  and not has_column_privilege('anon', 'public.calendar_connections', 'secret_fingerprint', 'select')
  and exists (select 1 from pg_constraint where conrelid = 'public.calendar_connections'::regclass and contype = 'u'
    and conname = 'calendar_connections_membership_provider_fingerprint_key')));
set local role authenticated;
select set_config('request.jwt.claims', :'F', true);
select pg_temp.expect_error('member cannot select secret_fingerprint', $q$select secret_fingerprint from public.calendar_connections$q$, '42501');
reset role;
set local role service_role;
select connection_id as conn_fp, already_connected as fp_again, selection_ids[1] as sel_fp
from public.svc_create_calendar_connection_with_selections(:'household_f', :'membership_f', 'ics', 'Soccer club', 'https://calendar.test/soccer.ics',
  null, repeat('e', 64), '[{"id": "ics", "name": "Soccer club"}]') \gset
select pg_temp.expect('a new ICS connection is created with its selection, hidden and unassigned', not :'fp_again'::boolean
  and (select count(*) from public.calendar_selections s where s.connection_id = :'conn_fp' and s.id = :'sel_fp' and not s.visible
       and s.assigned_membership_id is null and s.assigned_child_id is null) = 1);
select pg_temp.expect('the same link again returns the existing connection, unchanged', (
  select connection_id = :'conn_fp'::uuid and already_connected and label = 'Soccer club' and selection_ids = array[:'sel_fp'::uuid]
  from public.svc_create_calendar_connection_with_selections(:'household_f', :'membership_f', 'ics', 'Other name', 'https://calendar.test/soccer.ics',
    null, repeat('e', 64), '[{"id": "ics", "name": "Other name"}]'))
  and (select count(*) from public.calendar_connections where secret_fingerprint = repeat('e', 64)) = 1);
select pg_temp.expect_error('connect with a URL in the label',
  format('select * from public.svc_create_calendar_connection_with_selections(%L, %L, %L, %L, %L, null, %L, %L)',
    :'household_f', :'membership_f', 'ics', 'https://calendar.test/x.ics', 'https://calendar.test/x.ics', repeat('f', 64), '[]'), '23514');
select pg_temp.expect_error('connect for a caregiver',
  format('select * from public.svc_create_calendar_connection_with_selections(%L, %L, %L, %L, %L, null, %L, %L)',
    :'household_f', :'membership_g', 'ics', 'X', 'https://calendar.test/x.ics', repeat('f', 64), '[]'), '42501');
select pg_temp.expect_error('connect with both a secret and a Vault secret id',
  format('select * from public.svc_create_calendar_connection_with_selections(%L, %L, %L, %L, %L, %L, %L, %L)',
    :'household_f', :'membership_f', 'ics', 'X', 'https://calendar.test/x.ics', gen_random_uuid(), repeat('f', 64), '[]'), '22023');
select pg_temp.expect_error('connect with malformed calendars',
  format('select * from public.svc_create_calendar_connection_with_selections(%L, %L, %L, %L, %L, null, %L, %L)',
    :'household_f', :'membership_f', 'ics', 'X', 'https://calendar.test/x.ics', repeat('f', 64), '[{"name": "no id"}]'), '22023');
reset role;

\echo '[110] OAuth attempts: only the adult who started one can finish it; single use; expiry; the Vault secret moves to the connection'
select count(*) as vault_before_attempts from vault.secrets \gset
set local role service_role;
select public.svc_create_calendar_oauth_attempt(repeat('1', 64), :'household_f', :'membership_f', 'google', 'refresh-attempt-1', 'frankie@example.com',
  repeat('9', 64), '[{"id": "frankie@example.com", "name": "Frankie", "summary": "dropped"}, {"id": "kids", "name": "  "}]') as attempt_one \gset
reset role;
select vault_secret_id as attempt_secret from public.calendar_oauth_attempts where id = :'attempt_one' \gset
select pg_temp.expect('an attempt stores only the hash, the id+name calendar list and a Vault secret', (
  select calendars = '[{"id": "frankie@example.com", "name": "Frankie"}, {"id": "kids", "name": "Calendar"}]'::jsonb
    and expires_at - created_at = interval '15 minutes'
  from public.calendar_oauth_attempts where id = :'attempt_one')
  and (select decrypted_secret = 'refresh-attempt-1' from vault.decrypted_secrets where id = :'attempt_secret'));
set local role service_role;
select pg_temp.expect('peek returns the household without consuming', public.svc_peek_calendar_oauth_attempt(repeat('1', 64)) = :'household_f'::uuid);
select pg_temp.expect('another member (a caregiver of the household) finishing it is forbidden', (
  select outcome = 'forbidden' and connection_id is null from public.svc_finish_calendar_oauth_attempt(repeat('1', 64), pg_temp.v('membership_g'))));
select pg_temp.expect('another household''s member finishing it is forbidden', (
  select outcome = 'forbidden' from public.svc_finish_calendar_oauth_attempt(repeat('1', 64), pg_temp.v('membership_b'))));
reset role;
select pg_temp.expect('a forbidden finish leaves the attempt in place', exists (select 1 from public.calendar_oauth_attempts where id = :'attempt_one'));
set local role service_role;
select connection_id as conn_oauth, calendar_count as oauth_calendars, label as oauth_label
from public.svc_finish_calendar_oauth_attempt(repeat('1', 64), :'membership_f') where outcome = 'ok' \gset
select pg_temp.expect('a replayed attempt is invalid', (
  select outcome = 'invalid_attempt' from public.svc_finish_calendar_oauth_attempt(repeat('1', 64), pg_temp.v('membership_f'))));
reset role;
select pg_temp.expect('finishing creates the connection with all calendars and moves the attempt''s Vault secret to it', :'oauth_calendars'::int = 2
  and :'oauth_label' = 'frankie@example.com'
  and (select vault_secret_id = :'attempt_secret'::uuid and secret_fingerprint = repeat('9', 64) and status = 'ok'
       from public.calendar_connections where id = :'conn_oauth')
  and (select decrypted_secret = 'refresh-attempt-1' and name like 'roost_calendar_google_%' from vault.decrypted_secrets where id = :'attempt_secret')
  and not exists (select 1 from public.calendar_oauth_attempts where id = :'attempt_one')
  and (select count(*) from public.calendar_selections where connection_id = :'conn_oauth' and not visible) = 2);
select vault_secret_id as oauth_secret from public.calendar_connections where id = :'conn_oauth' \gset
update public.calendar_connections set status = 'auth_expired' where id = :'conn_oauth';
set local role service_role;
select public.svc_create_calendar_oauth_attempt(repeat('2', 64), :'household_f', :'membership_f', 'google', 'refresh-attempt-2', null,
  repeat('9', 64), '[{"id": "frankie@example.com", "name": "Frankie"}, {"id": "new-cal", "name": "New"}]') as attempt_two \gset
reset role;
select vault_secret_id as attempt_two_secret from public.calendar_oauth_attempts where id = :'attempt_two' \gset
set local role service_role;
select pg_temp.expect('reconnecting the same account updates the existing connection', (
  select outcome = 'ok' and connection_id = :'conn_oauth'::uuid and label = 'frankie@example.com' and calendar_count = 3
  from public.svc_finish_calendar_oauth_attempt(repeat('2', 64), :'membership_f')));
reset role;
select pg_temp.expect('the new token replaced the old in place, status is ok again, and the attempt''s secret is gone', (
  select decrypted_secret = 'refresh-attempt-2' from vault.decrypted_secrets where id = :'oauth_secret')
  and (select status = 'ok' from public.calendar_connections where id = :'conn_oauth')
  and (select count(*) from public.calendar_connections where secret_fingerprint = repeat('9', 64)) = 1
  and not exists (select 1 from vault.secrets where id = :'attempt_two_secret'));
insert into public.calendar_oauth_attempts (attempt_hash, household_id, membership_id, provider, vault_secret_id, secret_fingerprint, expires_at)
values (repeat('3', 64), :'household_f', :'membership_f', 'google', private.store_calendar_secret('refresh-expired', 'roost_calendar_attempt_google'),
  repeat('8', 64), now() - interval '1 minute')
returning vault_secret_id as expired_secret \gset
set local role service_role;
select pg_temp.expect('an expired attempt is reported expired', (
  select outcome = 'expired' from public.svc_finish_calendar_oauth_attempt(repeat('3', 64), pg_temp.v('membership_f'))));
reset role;
select pg_temp.expect('and deleted with its Vault secret, without creating a connection',
  not exists (select 1 from public.calendar_oauth_attempts where attempt_hash = repeat('3', 64))
  and not exists (select 1 from vault.secrets where id = :'expired_secret')
  and not exists (select 1 from public.calendar_connections where secret_fingerprint = repeat('8', 64)));
insert into public.calendar_oauth_attempts (attempt_hash, household_id, membership_id, provider, vault_secret_id, secret_fingerprint, expires_at)
values (repeat('4', 64), :'household_f', :'membership_f', 'microsoft', private.store_calendar_secret('refresh-stale', 'roost_calendar_attempt_microsoft'),
  repeat('7', 64), now() - interval '1 minute')
returning vault_secret_id as stale_secret \gset
select private.purge_deleted_households();
select pg_temp.expect('the purge removes expired attempts and their Vault secrets',
  not exists (select 1 from public.calendar_oauth_attempts where attempt_hash = repeat('4', 64))
  and not exists (select 1 from vault.secrets where id = :'stale_secret'));
select pg_temp.expect('no attempt secrets are left behind', (select count(*) from vault.secrets) = :vault_before_attempts + 1);

\echo '[111] Rate limits and lock order: 5 open OAuth states per member, 10 ICS connect attempts per hour; set_calendar_selection locks memberships first'
insert into public.calendar_oauth_states (state_hash, code_verifier, household_id, membership_id, provider, redirect_to)
select encode(extensions.digest('limit-' || g::text, 'sha256'), 'hex'), :'VERIFIER', :'household_f', :'membership_f', 'google', 'manage'
from generate_series(1, greatest(0, 5 - (select count(*) from public.calendar_oauth_states where membership_id = :'membership_f' and expires_at > now()))) as g;
set local role service_role;
select pg_temp.expect_error('a sixth open OAuth state',
  format('select public.svc_create_calendar_oauth_state(%L, %L, %L, %L, %L, %L)', repeat('e', 64), :'VERIFIER', :'household_f', :'membership_f', 'google', 'manage'), 'PT429');
select pg_temp.expect('10 connect attempts an hour are allowed, the 11th is refused', (
  select array_agg(public.svc_record_calendar_connect_attempt(pg_temp.v('membership_g')) order by g) from generate_series(1, 11) as g)
  = array[true, true, true, true, true, true, true, true, true, true, false]);
reset role;
select pg_temp.expect('a refused attempt is not recorded', (select count(*) from public.calendar_connect_attempts where membership_id = :'membership_g') = 10);
update public.calendar_connect_attempts set created_at = now() - interval '61 minutes' where membership_id = :'membership_g';
set local role service_role;
select pg_temp.expect('attempts older than an hour no longer count', public.svc_record_calendar_connect_attempt(:'membership_g'));
reset role;
select pg_temp.expect('set_calendar_selection share-locks memberships before locking the selection row', (
  select position('for share of m' in p.prosrc) between 1 and position('for update of s' in p.prosrc)
  from pg_proc p where p.oid = 'public.set_calendar_selection(uuid, boolean, uuid, uuid)'::regprocedure));
\o
\echo 'ALL RLS SMOKE CHECKS PASSED'
rollback;
