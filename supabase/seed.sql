insert into public.invite_codes (code) values ('ROOST1'), ('ROOST2'), ('ROOST3'), ('RIVERA');

-- Adults (email sign-in works through the local mail viewer)
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sam@roost.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'alex@roost.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at) values
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   '{"sub":"11111111-1111-1111-1111-111111111111","email":"sam@roost.test","email_verified":true}', 'email', now(), now(), now()),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222',
   '{"sub":"22222222-2222-2222-2222-222222222222","email":"alex@roost.test","email_verified":true}', 'email', now(), now(), now());

insert into public.consent_records (user_id, policy_version, health_data_consent) values
  ('11111111-1111-1111-1111-111111111111', '2026-09-14', true),
  ('22222222-2222-2222-2222-222222222222', '2026-09-14', true);

-- Household
insert into public.households (id, name, time_zone, zip, dinner_tonight, sitter_info) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Rivera', 'America/New_York', '28202', 'Tacos',
   '{"napInstructions":"Theo naps in the crib with the sound machine on.","bedtime":"Ivy 7:00 PM, Theo 6:30 PM","emergencyContacts":"Sam 704-555-0101 · Alex 704-555-0102","pediatrician":"Dr. Patel 704-555-0199","address":"12 Maple St","whereThings":"Spare diapers: hall closet"}');
update public.invite_codes set used_by_household_id = 'aaaaaaaa-0000-0000-0000-000000000001', used_at = now() where code = 'RIVERA';

insert into public.memberships (id, user_id, household_id, role, display_name, color) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner', 'Sam', '#5B6ACF'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000001', 'adult', 'Alex', '#2F86A6');

insert into public.member_pins (membership_id, pin_hash) values
  ('bbbbbbbb-0000-0000-0000-000000000001', extensions.crypt('1234', extensions.gen_salt('bf', 8))),
  ('bbbbbbbb-0000-0000-0000-000000000002', extensions.crypt('5678', extensions.gen_salt('bf', 8)));

-- Children
insert into public.children (id, name, birthday, color, allergies, food_rules, night_sleep_start, night_sleep_end, sort_order) values
  ('cccccccc-0000-0000-0000-000000000001', 'Ivy', '2023-04-10', '#C2477A', 'None', 'No juice after 4 PM', '19:00', '06:00', 0),
  ('cccccccc-0000-0000-0000-000000000002', 'Theo', '2025-06-02', '#8A56AC', 'Peanuts', 'Whole milk only', null, null, 1);
insert into public.child_households (child_id, household_id) values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001');

-- Sticker categories
insert into public.sticker_categories (id, household_id, name, icon_key, sort_order) values
  ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Potty', 'potty', 0),
  ('dddddddd-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Teeth', 'teeth', 1),
  ('dddddddd-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'Tried a new food', 'new-food', 2);

-- Medicines (per child)
insert into public.medicines (id, household_id, child_id, name, min_interval_hours, max_doses_per_24h) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', 'Infant ibuprofen', 6, 4),
  ('eeeeeeee-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', 'Infant acetaminophen', 4, 5),
  ('eeeeeeee-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'Children''s ibuprofen', 6, 4);

-- Routines
insert into public.routines (household_id, child_id, name, weekdays, steps, sort_order) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'Home day', '{1,2,3,4,5}',
   '[{"iconKey":"breakfast","photoId":null,"label":"Breakfast","time":"07:00"},
     {"iconKey":"teeth","photoId":null,"label":"Brush teeth","time":null},
     {"iconKey":"getting-dressed","photoId":null,"label":"Get dressed","time":null},
     {"iconKey":"park","photoId":null,"label":"Park","time":"09:30"},
     {"iconKey":"snack","photoId":null,"label":"Snack","time":null},
     {"iconKey":"nap","photoId":null,"label":"Nap","time":"12:30"},
     {"iconKey":"books","photoId":null,"label":"Books","time":null},
     {"iconKey":"bath","photoId":null,"label":"Bath","time":"18:15"},
     {"iconKey":"bed","photoId":null,"label":"Bed","time":"19:00"}]', 0),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'Weekend', '{0,6}',
   '[{"iconKey":"breakfast","photoId":null,"label":"Breakfast","time":null},
     {"iconKey":"park","photoId":null,"label":"Park","time":null},
     {"iconKey":"bath","photoId":null,"label":"Bath","time":"18:15"},
     {"iconKey":"bed","photoId":null,"label":"Bed","time":"19:00"}]', 1);

-- Logs relative to now
insert into public.sleep_entries (household_id, child_id, start_at, end_at, type, logged_by_membership_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', now() - interval '20 hours', now() - interval '9 hours', 'night', 'bbbbbbbb-0000-0000-0000-000000000001'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', now() - interval '4 hours', now() - interval '2 hours 40 minutes', 'nap', 'bbbbbbbb-0000-0000-0000-000000000002');

insert into public.feeding_entries (household_id, child_id, at, type, amount, logged_by_membership_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', now() - interval '70 minutes', 'milk', '6 oz', 'bbbbbbbb-0000-0000-0000-000000000001'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', now() - interval '5 hours', 'meal', 'some', null);

insert into public.dose_entries (household_id, child_id, medicine_id, at, note, logged_by_membership_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000001', now() - interval '2 hours', '2.5 ml', 'bbbbbbbb-0000-0000-0000-000000000001');

insert into public.sticker_entries (household_id, child_id, category_id, at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', now() - interval '1 hour'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002', now() - interval '26 hours');

insert into public.grocery_items (household_id, text) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Whole milk'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Bananas');
insert into public.jots (household_id, text) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Call pediatrician about Theo''s rash');
