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

## Installable app and updates

- `vite-plugin-pwa` builds `dist/sw.js` (precaches every built asset, including the Outfit fonts; Supabase
  API responses are never cached) and `dist/manifest.webmanifest`. There is no service worker in `pnpm dev`.
- Icons in `public/` (`pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`,
  `apple-touch-icon-180x180.png`, `favicon.ico`) are generated from `public/logo.svg` with `pnpm icons`
  (config: `pwa-assets.config.ts`).
- A new version waits and is applied only at a safe moment (spec §5.8, `src/app/appUpdates.ts`): during
  Night Mode, or after 5 minutes without a touch outside Kids' Corner, never while a visual timer runs.

## Commands

| Command | What it does |
|---|---|
| `pnpm test` | Vitest unit tests |
| `pnpm typecheck` | vue-tsc |
| `pnpm build` | typecheck + production build (with service worker) |
| `pnpm icons` | regenerate the app icons from `public/logo.svg` |
| `pnpm db:reset` | re-apply migrations and seed |
| `pnpm db:types` | regenerate `src/data/database.types.ts` |
