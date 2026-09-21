-- ─── Invite code admin (spec §2 launch gate, §6.4 step 2) ───────────────
-- While app_config.invites_required is true, setup_household needs an unused row of public.invite_codes, and until
-- now the only way to make one was a hand-written insert. This adds the operator's two tools, both run from the
-- Supabase dashboard's SQL editor (as postgres), never from the app:
--
--   select * from private.create_invite_codes(3, 'Smith family');   -- three fresh codes, noted
--   select * from private.invite_code_status;                       -- what is unused, what was used and by whom
--
-- No client role gains anything: invite_codes keeps RLS with no policies and no table privileges, the private schema
-- is not exposed by the API, and neither object below is granted to anon or authenticated.

-- Who a code was made for, and when. Rows that already exist get this migration's time and no note.
alter table public.invite_codes
  add column note text check (char_length(note) between 1 and 120),
  add column created_at timestamptz not null default now();

-- Makes p_count (1 to 100) unused codes and returns them. Codes are 6 characters from a 31-character alphabet that
-- leaves out 0, O, 1, I and L, because they are read aloud and typed into six boxes on a tablet; all of them satisfy
-- invite_codes' own ^[A-Z0-9]{6}$ check. A code is a small secret, so the characters come from gen_random_bytes, not
-- random(). Invoker rights on purpose: postgres owns the table, and a role that was ever granted execute by mistake
-- would still be stopped by the table's privileges.
create function private.create_invite_codes(p_count int default 1, p_note text default null)
returns table (code text)
language plpgsql set search_path = '' as $$
declare
  c_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_note text := nullif(btrim(p_note), '');
  v_code text;
  v_byte int;
  v_made int := 0;
  v_inserted int;
begin
  if p_count is null or p_count not between 1 and 100 then
    raise exception 'make 1 to 100 codes at a time' using errcode = '22023';
  end if;
  if char_length(v_note) > 120 then
    raise exception 'a note is at most 120 characters' using errcode = '22023';
  end if;

  while v_made < p_count loop
    v_code := '';
    while char_length(v_code) < 6 loop
      v_byte := get_byte(extensions.gen_random_bytes(1), 0);
      -- 248 = 31 × 8. A byte above it would make the first 8 letters more likely than the rest, so it is thrown away.
      if v_byte < 248 then
        v_code := v_code || substr(c_alphabet, v_byte % 31 + 1, 1);
      end if;
    end loop;

    -- The primary key is the only thing to conflict with: a code that already exists (used or not) is skipped and
    -- another one is made.
    insert into public.invite_codes (code, note) values (v_code, v_note) on conflict do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 1 then
      v_made := v_made + 1;
      code := v_code;
      return next;
    end if;
  end loop;
end $$;

-- Unused codes first, then the newest. household_name is null for an unused code and for a household that has since
-- been purged (used_by_household_id is set null then, used_at stays).
create view private.invite_code_status with (security_invoker = true) as
select i.code, i.note, i.created_at, i.used_at, h.name as household_name
from public.invite_codes i
left join public.households h on h.id = i.used_by_household_id
order by (i.used_at is not null), i.created_at desc, i.code;

-- ─── Grants ──────────────────────────────────────────────────────────────
revoke execute on function private.create_invite_codes(int, text) from public, anon, authenticated;
revoke all on private.invite_code_status from public, anon, authenticated;
