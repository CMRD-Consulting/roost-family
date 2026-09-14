begin;

-- Two adult users
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@roost.test', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@roost.test', '{}', '{}', now(), now());
insert into public.invite_codes (code) values ('SMOKE1'), ('SMOKE2');

-- As adult A: consent + household + child
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","is_anonymous":false}', true);
select public.record_consent('2026-09-14', true);
select public.create_household('A family', 'America/New_York', '28202', null, null, 'SMOKE1', 'Alex', '#5B6ACF') as household_a \gset
select public.add_child(:'household_a', 'Kid A', '2024-01-01', '#C2477A');

-- As adult B: own household
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated","is_anonymous":false}', true);
select public.record_consent('2026-09-14', true);
select public.create_household('B family', 'America/Chicago', '60601', null, null, 'SMOKE2', 'Blair', '#2F86A6') as household_b \gset

-- B must not see A's household or children
select count(*) as b_sees_a_households from public.households where id = :'household_a';   -- expect 0
select count(*) as b_sees_children from public.children;                                     -- expect 0

-- ─── Display claim, revoke, PIN verify, dose-entry delete checks ─────────
-- These continue inside the same rolled-back transaction. Inserting into auth.users must
-- happen as postgres (RLS/role restrictions do not apply to that table, but we still need
-- to drop back out of the `authenticated` role we set above to do it cleanly).
reset role;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, is_anonymous, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, '{}', '{}', true, now(), now());

-- (a) Adult A registers a display, then the display (anonymous user D) claims it.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","is_anonymous":false}', true);
select out_display_id, out_claim_token from public.register_display(:'household_a', 'Kitchen tablet') \gset

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated","is_anonymous":true}', true);
select public.claim_display(:'out_claim_token');

-- The display (as auth user D) should see A's children (1) and not B's (0).
select count(*) as display_sees_a_children from public.children;              -- expect 1
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated","is_anonymous":false}', true);
select count(*) as display_sees_b_children_check from public.children where id != (
  select ch.child_id from public.child_households ch where ch.household_id = :'household_b'
);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated","is_anonymous":true}', true);
select count(*) as b_children_visible_to_display from public.children c
  join public.child_households ch on ch.child_id = c.id
  where ch.household_id = :'household_b';                                     -- expect 0

-- (b) After revoke_display, the display sees 0 children and my_display() reports revoked = true.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","is_anonymous":false}', true);
select public.revoke_display(:'out_display_id');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated","is_anonymous":true}', true);
select count(*) as display_sees_a_children_after_revoke from public.children;  -- expect 0
select out_revoked as my_display_revoked from public.my_display();            -- expect true

-- (c) verify_pin true/false.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","is_anonymous":false}', true);
select m.id as membership_a from public.memberships m where m.user_id = '00000000-0000-0000-0000-00000000000a' \gset
select public.set_my_pin(:'household_a', '4242');
select public.verify_pin(:'membership_a', '4242') as verify_pin_correct;      -- expect true
select public.verify_pin(:'membership_a', '0000') as verify_pin_wrong;        -- expect false

-- (d) Members cannot delete dose_entries (no delete policy): the delete affects 0 rows.
select public.add_child(:'household_a', 'Kid A2', '2023-06-01', '#5FA88C') as kid_a2_raw \gset
reset role;
insert into public.medicines (id, household_id, child_id, name, min_interval_hours, max_doses_per_24h)
values ('00000000-0000-0000-0000-0000000000e1', :'household_a', :'kid_a2_raw', 'Test medicine', 6, 4);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","is_anonymous":false}', true);
insert into public.dose_entries (household_id, child_id, medicine_id, at, logged_by_membership_id)
values (:'household_a', :'kid_a2_raw', '00000000-0000-0000-0000-0000000000e1', now(), :'membership_a');

with deleted as (delete from public.dose_entries where household_id = :'household_a' returning 1)
select count(*) as dose_entries_deleted_by_member from deleted;               -- expect 0

rollback;
