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

\echo '[62] purge_deleted_households removes only households deleted more than 30 days ago'
update public.households set deleted_at = now() - interval '31 days' where id = :'household_b';
update public.households set deleted_at = now() - interval '29 days' where id = :'household_f';
select pg_temp.expect('one household purged', private.purge_deleted_households() = 1);
select pg_temp.expect('B household and its data gone', not exists (select 1 from public.households where id = pg_temp.v('household_b'))
  and not exists (select 1 from public.children where id = pg_temp.v('kid_b'))
  and not exists (select 1 from public.memberships where household_id = pg_temp.v('household_b'))
  and not exists (select 1 from public.displays where household_id = pg_temp.v('household_b')));
select pg_temp.expect('F (deleted 29 days ago) kept', exists (select 1 from public.households where id = pg_temp.v('household_f')));
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

\o
\echo 'ALL RLS SMOKE CHECKS PASSED'
rollback;
