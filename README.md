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
  Night Mode, or after 5 minutes without a touch outside Kids' Corner, never while a visual timer runs or photos
  upload. A critical build (`ROOST_CRITICAL=1 pnpm build` writes `critical: true` to `version.json`) skips those waits
  but still needs a minute without a touch or key press, no open sheet or dialog, no Settings PIN session and no adult
  sign-in.
- Public pages (`/list/:token`, `/manage`, `/manage/export/:id`) never register the service worker when the app is
  opened on them, so a shopper's phone doesn't precache the whole app, and never reload themselves for an update.

## Hosting (production)

The app is a static build (`dist/`). There is no hosting config in the repo; configure the host to send:

| Header | Paths | Why |
|---|---|---|
| `Referrer-Policy: strict-origin` | all | the Take list token (`/list/<token>`) and export ids live in the URL path; `index.html` also sets `<meta name="referrer" content="strict-origin">`, but the header covers responses before the page parses |
| `Cache-Control: no-store` | `/list/*` HTML (the SPA fallback served for it) | a shared or back-forward cache never keeps a page whose URL is the list's only credential |
| `Cache-Control: no-store` | `/version.json` | the update check must never see a stale copy (spec §5.8) |

Error tracking (`VITE_SENTRY_DSN`) replaces path tokens with `/list/[token]` and `/manage/export/[id]` in every event
and breadcrumb, names events by route pattern, and sends no console arguments or request bodies
(`src/app/errorTracking.ts`).

## Weather

The `weather` Edge Function (spec §5.6) refreshes a household's National Weather Service forecast when the cached row
is older than 30 minutes, and asks NWS at most once per household every 5 minutes, whether the last attempt succeeded
or failed (`household_weather.attempted_at`). Forecast URLs from NWS are used only if they are `https://api.weather.gov`.

| Variable | Notes |
|---|---|
| `NWS_CONTACT` | contact NWS can reach about this app's traffic, sent in the User-Agent as `RoostFamily/1.0 (roost.cmrd.dev; <contact>)`: set it to an operator email address or URL in production. Default `roost.cmrd.dev` |

## Scheduled jobs (production)

Deleted households, deleted photo files and expired exports are erased only by scheduled jobs (spec §11.3; launch gate
§15). SQL can't erase Storage file bytes, so `delete_photo`, the household purge and export expiry leave the files
(unreadable at once) for the `storage-sweep` Edge Function, which erases them through the Storage API. The daily purge
also fails exports stuck pending for 15 minutes, deletes export rows older than 7 days and deletes Take list links that
ended (expired or were revoked) more than 7 days ago.

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
   It erases files with no `photos` row older than 60 minutes (a Settings thumbnail, `<photo>.thumb.jpg`, goes with its
   photo) and every file of a household that no longer exists,
   then export ZIPs whose `household_exports` row is failed, expired (24 hours after it became ready) or gone, and
   returns counts (`scanned`, `kept`, `removedOrphans`, `removedGoneHousehold`, `skipped`, `failed`, and
   `exports: { scanned, kept, removedExpired, removedUnrecorded, skipped, failed }`); pg_net keeps
   recent responses in `net._http_response`, and the function logs each report.
5. Monitor: `psql "$DATABASE_URL" -f supabase/manual-checks/cron_check.sql` prints a READY or NOT READY line per job
   and the jobs' recent runs.

Run the sweep by hand (or locally, with `supabase functions serve` and `SERVICE_ROLE_KEY` from `supabase status -o env`):

```bash
curl -X POST "$SUPABASE_URL/functions/v1/storage-sweep" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H 'Content-Type: application/json' -d '{"minAgeMinutes": 60}'
```

## Calendar providers

Calendars are fetched on request by Edge Functions (spec §5.5); event data is never stored. Secrets (ICS links,
refresh tokens) live only in Supabase Vault.

| Function | Caller | Purpose |
|---|---|---|
| `calendar-connect-ics` | full sign-in adult | subscribe to an ICS link (`https://` or `webcal://`) |
| `calendar-events` | display or member | today's events, cached in memory for 5 minutes |
| `calendar-oauth-start` | full sign-in adult | Google / Microsoft consent URL |
| `calendar-oauth-callback` | the provider's redirect (no JWT; the single-use state identifies the attempt) | parks the consent as a pending attempt, returns to `/manage?calendar=pending&attempt=…` |
| `calendar-oauth-finish` | the full sign-in adult who started the attempt | creates the connection and its calendars |

Environment (Edge Function secrets: `supabase secrets set NAME=value`; locally `supabase/functions/.env`, git-ignored):

| Variable | Needed for | Notes |
|---|---|---|
| `CALENDAR_FINGERPRINT_KEY` | all connecting (**required in production**) | at least 32 random characters, e.g. `openssl rand -base64 48`. HMAC key for connection fingerprints (the ICS link or the provider account id), which stop the same calendar being connected twice. Keep it stable: changing it makes existing connections unrecognisable. A local stack uses a built-in development key when unset |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Calendar | OAuth client of type "Web application". Scopes: `openid email https://www.googleapis.com/auth/calendar.readonly`. Publish the app to Production (Testing tokens expire after 7 days) and verify it before 100 users (§15) |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | Outlook / Microsoft 365 | Entra app registration, "Accounts in any organizational directory and personal Microsoft accounts" (tenant `common`), delegated `openid email profile offline_access Calendars.Read` |
| `APP_URL` | OAuth (**required in production**) | where the browser returns (`/manage?calendar=…`); a local stack defaults to `http://localhost:5173`. Without it elsewhere the OAuth functions answer `not_configured` |
| `CALENDAR_OAUTH_REDIRECT_URI` | optional | overrides the redirect URI; default `${SUPABASE_URL}/functions/v1/calendar-oauth-callback` |
| `CALENDAR_ALLOW_PRIVATE_HOSTS` | local verification only | `1` lets ICS links reach private hosts over `http://` and any port (e.g. a fixture at `http://host.docker.internal:8123/…`). Honoured only when `SUPABASE_URL` is a local stack (localhost, 127.0.0.1, kong, host.docker.internal); ignored with a warning anywhere else, where links must be `https://` on the default port and resolve to public addresses only |

Redirect URIs to register (Google Cloud Console → Credentials → OAuth client → Authorized redirect URIs; Entra → App
registrations → Authentication → Web → Redirect URIs):

- Production: `https://<project-ref>.supabase.co/functions/v1/calendar-oauth-callback`
- Local: `http://localhost:55321/functions/v1/calendar-oauth-callback` (providers allow plain `http` only for
  `localhost`; use a separate test client). Also set `CALENDAR_OAUTH_REDIRECT_URI` to it, because `SUPABASE_URL` inside
  the local runtime is not the browser-facing URL.

Without the client id and secret (or `APP_URL` / `CALENDAR_FINGERPRINT_KEY`), `calendar-oauth-start` answers
`200 { "error": "not_configured" }` and the UI disables that provider. Consent never connects a calendar by itself:
the callback parks the result for 15 minutes and only the adult who started it can finish it (so a forwarded consent
link cannot attach someone else's calendar to another household). The Google and Microsoft network paths (token exchange, refresh, calendar list, events) are
covered by unit tests with recorded response shapes but are not exercised locally without real credentials; ICS
subscriptions can be verified end to end locally with `CALENDAR_ALLOW_PRIVATE_HOSTS=1`.

## Household export

An owner requests an export on **Manage household** (spec §11.3). `request_household_export` records it (one per
household per hour), the page invokes the `export-household` Edge Function, which builds a ZIP (`household.json`, one
CSV per log type, photos) into the private `exports` bucket and emails the requesting owner a link to
`/manage/export/<id>`. That page signs the owner in again and asks the same function (`action: 'download'`) for a
10-minute signed URL. Exports expire 24 hours after they are ready; `storage-sweep` erases expired files.

- Photos are capped at 30 MiB per export (hosted Edge Functions allow 150 MB of memory and 2 s of CPU time, and the
  upload limit is 50 MiB); photos past the cap are left out and
  README.txt in the ZIP says how many. A ZIP over 50 MiB fails as `too_large`.
- The build runs after the function's 202 response (`EdgeRuntime.waitUntil`), within the runtime's wall-clock limit.
  It is marked ready before the email goes out; an export that can't be emailed becomes failed (`email_failed`).
- Limits: one pending or ready export per household per hour, and at most 3 requests per hour including failed ones
  (purge timeouts excepted).
- Production: test an export at the photo cap on the hosted project before launch (spec §15, item 10).

| Variable | Notes |
|---|---|
| `SMTP_HOST`, `SMTP_PORT` | port 465 uses implicit TLS; others use STARTTLS when offered. Locally `inbucket` / `1025` (Mailpit, as seen from the edge runtime container; the container name with underscores does not resolve there) |
| `SMTP_USER`, `SMTP_PASS` | optional, together |
| `SMTP_FROM` | e.g. `Roost Family <no-reply@roost.cmrd.dev>` |
| `APP_URL` | origin of the emailed link; defaults to `http://localhost:5173` only on a local stack |

Without SMTP or `APP_URL` the function answers `503 { "error": "not_configured" }` and nothing is built.

## Commands

| Command | What it does |
|---|---|
| `pnpm test` | Vitest unit tests |
| `pnpm typecheck` | vue-tsc |
| `pnpm build` | typecheck + production build (with service worker) |
| `pnpm icons` | regenerate the app icons from `public/logo.svg` |
| `pnpm db:reset` | re-apply migrations and seed |
| `pnpm db:types` | regenerate `src/data/database.types.ts` |
