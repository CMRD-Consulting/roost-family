# Roost — agent notes

- Spec (source of truth): `docs/superpowers/specs/2026-09-14-roost-design.md`. The v2 design HTML is a visual reference; where it conflicts with the spec's rules (text sizes, touch targets, contrast), follow the spec.
- Plans: `docs/superpowers/plans/`.
- Node 22 (`source ~/.nvm/nvm.sh && nvm use 22`), pnpm.

## Architecture
- `src/domain/` — pure business rules, no Vue or Supabase imports; every file has a colocated `*.test.ts`.
- `src/data/supabase.ts` — `displayClient` (persisted anonymous device identity) and `createAdultClient()` (in-memory, temporary). Never persist an adult session.
- `src/session/` — display state (`displayStore`: `unregistered | registered | revoked | offline`), adult email-code sign-in, idle expiry (`useAdultSessionIdle`). Adult sessions end after 5 min idle, on replacement and on unmount; `end()` never throws.
- `src/features/<feature>/` — screens and feature logic; `src/ui/` — shared components (`R*` prefix).
- Who authorises what (spec §6.3): **on a display the adult PIN authorises every Settings action**, including Members, Displays and Delete household — there is no second, emailed sign-in there. Those sections run on `settingsSession` through `usePinOwner`; a full sign-in is left only for connecting a calendar and resetting a forgotten PIN. **In a browser at `/manage`** there is no PIN, so the same actions run on the adult's email sign-in (`useOwnerSignIn` / `OwnerSignInPanel`, kept for that host). A `SettingsApi` method taking `SettingsAuth` is the PIN path; one taking an `AdultClient` is the browser path — most owner actions have both (`removeMember` / `removeMemberPin`).

## Database
- Migrations in `supabase/migrations/`; regenerate types with `pnpm db:types` after schema changes. Until Docker works, `src/data/database.types.ts` is hand-maintained in Supabase CLI shape: update Args/Returns for every RPC change.
- Helpers live in the `private` schema (not exposed by the API): `private.is_household_member(household_id)`, `private.is_household_owner`, `private.require_adult`, and write helpers such as `private.create_household_for` that only security-definer RPCs call (never grant those to a client role).
- Every household-owned table has RLS through `private.is_household_member(household_id)`. New tables: enable RLS, add policies, and re-run `revoke all on <table> from anon` (default privileges grant anon).
- New RPCs: `security definer set search_path = ''`, then `revoke execute on function … from public, anon` and `grant execute on function … to authenticated` (add it to the final grant list in the RLS migration).
- PIN-checked RPCs take `(p_membership_id, p_pin, …)` and start from `private.require_settings_pin` (any adult) or `private.require_settings_owner` (owners only, migration 14); both re-use `private.pin_ok`, and so its 0.75 s wrong-PIN delay. Auth failures are `42501`, invalid input `22023`, and every write appends a `settings_audit` row via `private.audit_setting`.
- Configuration tables (households, children, medicines, routines, sticker categories, …) are read directly but written only through RPCs; don't add insert/update policies for them.
- Setup is one call: `setup_household` creates the household, kids and owner PIN in a single transaction.
- Validate RLS changes with `supabase/manual-checks/rls_smoke.sql` (must print `ALL RLS SMOKE CHECKS PASSED`).
- Entry ids are client-generated UUIDs (offline replay). Doses are never deleted — void them.
- Auth email: Supabase's default email sender is rate-limited (about 2 emails per hour). Configure custom SMTP before launch.
- `[auth.email] enable_confirmations = true` in `supabase/config.toml` is unverified against real Supabase: once Docker works, confirm the email-code sign-in still works for a brand-new email address.
- Production is the hosted project `njhwxoybuxwwtdvebdou` (README "Supabase (production)"): `supabase db push` for migrations (never `--include-seed`), `supabase config push` for auth settings through `[remotes.production]` in `config.toml`, `supabase functions deploy --use-api` for functions. Its Edge Functions get the `sb_publishable_…`/`sb_secret_…` keys as `SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`, not the legacy JWTs.
- Status: local Supabase requires Docker; migrations can be validated without Docker via `supabase/manual-checks/validate-local.sh` (plain Postgres + `local_shim.sql`).

## UI rules (spec §4)
- In-the-moment surfaces: 60 pt touch targets; deliberate surfaces (Settings, wizard): 44 pt.
- Main screen text: glanceable ≥ 24 pt, secondary ≥ 18 pt, nothing < 16 pt.
- Person color always with avatar/initial (`RAvatar`); person colors from `src/ui/personPalette.ts`, never log-button colors.
- Text uses `ink`, `ink-2`, `ink-3` or deep accent tokens; `faint` is decoration only.
