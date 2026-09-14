# Roost Family

Kitchen-tablet web app for families with young kids. Spec: `docs/superpowers/specs/2026-09-14-roost-design.md`.

## Status

Local Supabase requires Docker; migrations can be validated without Docker via
`supabase/manual-checks/validate-local.sh` (plain Postgres + `local_shim.sql`).

## Local development

Requirements: Node 22 (`nvm use`), pnpm, Docker Desktop, Supabase CLI.

```bash
pnpm install
pnpm db:start          # local Supabase on ports 553xx
cp .env.example .env.local   # then paste the anon key from `supabase status`
pnpm db:reset          # migrations + seed
pnpm dev               # http://localhost:5173
```

- Local email (sign-in codes): http://127.0.0.1:55324
- Supabase Studio: http://127.0.0.1:55323
- Seed household "Rivera": owner `sam@roost.test` (PIN 1234), adult `alex@roost.test` (PIN 5678)
- Unused invite codes: `ROOST1`, `ROOST2`, `ROOST3`

## Offline and demo

- If the tablet can't read its display state at boot (no network, server down), it shows **/offline**
  ("Can't reach Roost Family", retrying every 15 s and when the browser comes back online) and then
  routes to the right screen. A tablet already known to be registered stays on its main screen.
- `VITE_DATA_SOURCE=demo` in `.env.local` selects the built-in demo household data source
  (`src/data/demo/`) instead of Supabase for household data.

## Commands

| Command | What it does |
|---|---|
| `pnpm test` | Vitest unit tests |
| `pnpm typecheck` | vue-tsc |
| `pnpm build` | typecheck + production build |
| `pnpm db:reset` | re-apply migrations and seed |
| `pnpm db:types` | regenerate `src/data/database.types.ts` |
