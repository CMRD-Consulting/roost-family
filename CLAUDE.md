# Roost — agent notes

- Spec (source of truth): `docs/superpowers/specs/2026-09-14-roost-design.md`. The v2 design HTML is a visual reference; where it conflicts with the spec's rules (text sizes, touch targets, contrast), follow the spec.
- Plans: `docs/superpowers/plans/`.
- Node 22 (`source ~/.nvm/nvm.sh && nvm use 22`), pnpm.

## Architecture
- `src/domain/` — pure business rules, no Vue or Supabase imports; every file has a colocated `*.test.ts`.
- `src/data/supabase.ts` — `displayClient` (persisted anonymous device identity) and `createAdultClient()` (in-memory, temporary). Never persist an adult session.
- `src/session/` — display state, adult email-code sign-in, idle timer.
- `src/features/<feature>/` — screens and feature logic; `src/ui/` — shared components (`R*` prefix).

## Database
- Migrations in `supabase/migrations/`; regenerate types with `pnpm db:types` after schema changes.
- Every household-owned table has RLS through `public.is_household_member(household_id)`. New tables: enable RLS, add policies, and re-run `revoke all on <table> from anon` (default privileges grant anon).
- Entry ids are client-generated UUIDs (offline replay). Doses are never deleted — void them.
- Status: local Supabase requires Docker; migrations can be validated without Docker via `supabase/manual-checks/validate-local.sh` (plain Postgres + `local_shim.sql`).

## UI rules (spec §4)
- In-the-moment surfaces: 60 pt touch targets; deliberate surfaces (Settings, wizard): 44 pt.
- Main screen text: glanceable ≥ 24 pt, secondary ≥ 18 pt, nothing < 16 pt.
- Person color always with avatar/initial (`RAvatar`); person colors from `src/ui/personPalette.ts`, never log-button colors.
- Text uses `ink`, `ink-2`, `ink-3` or deep accent tokens; `faint` is decoration only.
