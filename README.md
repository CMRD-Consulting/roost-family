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

## Scheduled jobs (production)

Deleted households and deleted photo files are erased only by scheduled jobs (spec §11.3; launch gate §15). SQL can't
erase Storage file bytes, so `delete_photo` and the household purge leave the files (unreadable at once) for the
`storage-sweep` Edge Function, which erases them through the Storage API.

1. Enable **pg_cron** and **pg_net** (Dashboard → Database → Extensions).
2. Purge households deleted more than 30 days ago, daily (SQL editor, as `postgres`):
   ```sql
   select cron.schedule('roost-purge-deleted-households', '17 3 * * *', 'select private.purge_deleted_households()');
   ```
3. Deploy the sweep: `supabase functions deploy storage-sweep`. It accepts only the service role key (the gateway's JWT
   check is off for it in `config.toml`; the function checks the key itself).
4. Keep the project URL and service role key in Vault and run the sweep hourly:
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co', 'roost_project_url');
   select vault.create_secret('<service role key>', 'roost_service_role_key');
   select cron.schedule('roost-storage-sweep', '41 * * * *', $$
     select net.http_post(
       url := (select decrypted_secret from vault.decrypted_secrets where name = 'roost_project_url') || '/functions/v1/storage-sweep',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'roost_service_role_key')),
       body := '{}'::jsonb,
       timeout_milliseconds := 60000)
   $$);
   ```
   It erases files with no `photos` row older than 60 minutes and every file of a household that no longer exists,
   and returns counts (`scanned`, `kept`, `removedOrphans`, `removedGoneHousehold`, `skipped`, `failed`); pg_net keeps
   recent responses in `net._http_response`, and the function logs each report.
5. Monitor: `psql "$DATABASE_URL" -f supabase/manual-checks/cron_check.sql` prints a READY or NOT READY line per job
   and the jobs' recent runs.

Run the sweep by hand (or locally, with `supabase functions serve` and `SERVICE_ROLE_KEY` from `supabase status -o env`):

```bash
curl -X POST "$SUPABASE_URL/functions/v1/storage-sweep" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H 'Content-Type: application/json' -d '{"minAgeMinutes": 60}'
```

## Commands

| Command | What it does |
|---|---|
| `pnpm test` | Vitest unit tests |
| `pnpm typecheck` | vue-tsc |
| `pnpm build` | typecheck + production build (with service worker) |
| `pnpm icons` | regenerate the app icons from `public/logo.svg` |
| `pnpm db:reset` | re-apply migrations and seed |
| `pnpm db:types` | regenerate `src/data/database.types.ts` |
