# Roost Phase 4a: Take List, Weather, Photos, Error Tracking, Critical Updates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Groceries travel to the store through a 24-hour QR checklist; the main screen shows real weather; Night Mode shows a photo slideshow of household photos that adults manage in Settings; crashes are reported without personal data; critical fixes reload displays promptly.

**Architecture:** Take list uses anon-callable, token-scoped security-definer RPCs and a public phone route. Weather is fetched server-side by a Supabase Edge Function from the National Weather Service with a 30-minute per-household cache table that displays read. Photos live in a private Storage bucket under `<household_id>/…` with storage RLS for members, rows in `photos` written by PIN-checked RPCs, client-side resizing/metadata stripping, and short-lived signed URLs. Sentry is optional (DSN env) with aggressive scrubbing.

**Spec:** `docs/superpowers/specs/2026-09-14-roost-design.md` §5.6 (weather), §5.8 (updates, reload-now), §5.9 (error tracking), §7.7 (Night slideshow), §7.8 (Take list), §7.9 (Photos), §11.1 (photos privacy), §13 (error states).
**Design reference:** `docs/design/handoff/project/Roost Family App v2.dc.html` lines ~428–446 (Take list QR), ~831–870 (phone page), ~44–56 (weather header), ~589–596 (Night), ~740–760 (Photos settings).

## Contents
- [Decisions](#decisions)
- [File structure](#file-structure)
- Tasks 1–6

## Decisions

| Topic | Decision |
|---|---|
| Take list auth | Token (32 random bytes, base64url) shown only in the QR/URL; server stores SHA-256 hash; anon RPCs require the token; only groceries are ever returned |
| Take list lifetime | 24 h, one active link per household (creating one revokes the previous); "Done shopping" revokes |
| Phone page updates | Poll every 10 s while visible (no realtime for anon) |
| Weather provider | `api.weather.gov` (US only), behind a `WeatherProvider` interface; Edge Function `weather` refreshes when the cached row is older than 30 min; `User-Agent: RoostFamily (roost.cmrd.dev)` header as NWS requires |
| Weather location | `households.lat/lon`; missing → no weather shown (and Settings → Household offers "Use this tablet's location") |
| Photo storage | Bucket `household-photos` (private). Object path `<household_id>/<photo_id>.jpg`. Uploads ≤ 1600 px long edge, JPEG q 0.85, EXIF stripped by canvas re-encode. Limit 200 slideshow photos |
| Photo rows | `add_photo(M, P, p_photo_id, p_kind)` after upload; `delete_photo(M, P, p_photo_id)` removes row and object (server deletes storage object via `storage` schema delete in the RPC) |
| Slideshow | Night Mode crossfades photos every 60 s in a random-but-stable order; signed URLs 1 h, refreshed before expiry; with no photos, dim clock only (current behavior) |
| Error tracking | `@sentry/vue` only when `VITE_SENTRY_DSN` is set; `sendDefaultPii: false`; `beforeSend`/`beforeBreadcrumb` strip request bodies, URLs' query strings, user, and any string field containing a known child/member name from the current snapshot; household id hashed (SHA-256, first 12 hex) as a tag |
| Reload-now | A tiny `public/version.json` (`{ version, critical: boolean }`) written at build; the update checker fetches it every 30 min (and on `online`); `critical: true` + newer version → reload at the next moment no visual timer runs, even outside Night/idle |

## File structure

```
supabase/migrations/20260914000004_phase4a.sql      take list RPCs, household_weather table, photos RPCs, storage bucket + policies
supabase/functions/weather/index.ts                 Edge Function (Deno)
supabase/functions/_shared/nws.ts                   pure NWS response parsing (importable by Vitest)
supabase/manual-checks/rls_smoke.sql                take list, weather, photos checks
src/data/takeListApi.ts (+test)                     create/revoke (display client) and anon page calls
src/features/takelist/TakeListQr.vue                QR sheet (from Grocery sheet)
src/features/takelist/TakeListPage.vue (+test)      public phone page at /list/:token
src/data/weatherApi.ts (+test)                      read cache + trigger refresh
src/features/main/WeatherLine.vue                   header weather
src/data/photosApi.ts (+test)                       upload (resize/strip), add/delete RPCs, signed URLs
src/features/settings/sections/PhotosSection.vue    Settings → Photos
src/features/modes/NightSlideshow.vue               crossfade slideshow inside NightScreen
src/app/errorTracking.ts (+test)                    Sentry init + scrubbers
src/app/appUpdates.ts                               (modify) version.json + critical reload
vite.config.ts                                      (modify) write version.json at build
```

---

### Task 1: Take list (database + API + UI)

- Migration: `create_take_list_link(p_household_id uuid) returns table(out_token text, out_expires_at timestamptz)` (caller member; revokes other active links; stores hash), `revoke_take_list_link(p_household_id uuid)` (member), anon-granted `take_list_items(p_token text) returns table(out_id uuid, out_text text, out_checked boolean)` (unchecked + checked within 24 h, sorted unchecked first), `take_list_set_checked(p_token text, p_item_id uuid, p_checked boolean)`, `take_list_done(p_token text)`. All anon RPCs: look up by hash, require `expires_at > now()` and `revoked_at is null`, rate-limit is out of scope. Revoke direct client writes on `take_list_links` (keep none). Smoke: anon can list only with a valid token; expired/revoked rejected (`42501`); items limited to that household's groceries; check toggles; done revokes; creating a second link revokes the first.
- `takeListApi.ts`: display-side `createLink(householdId)`, `revoke(householdId)`; page-side (separate anon client without session: `createClient(url, anonKey, { auth: { persistSession: false } })` + timeout fetch) `items(token)`, `setChecked`, `done`.
- **TakeListQr.vue** (opened from the Grocery sheet's "Take list" button, now enabled): generates the link, renders a QR (`qrcode` npm package → SVG string, error correction M) at 320 px, "Scan with your phone's camera", "Expires in 24 hours" (18 px), secondary "Done shopping — end link" (44 px). Offline → "Connect to share the list."
- **TakeListPage.vue** at `/list/:token` (no display registration required; router guard exempt): mobile layout (max-width 480 px): header "roost family" + "Grocery list"; items as 56 px rows with checkbox; checked items move to the bottom struck through; "Done shopping" button; states: loading, expired/revoked ("This list has expired. Ask for a new one at home."), empty ("Nothing on the list"), offline banner. Polls every 10 s while visible. The service worker must not cache `/list/*` API responses (it doesn't cache Supabase), and the page works when installed or not.
- Tests: API arg mapping; page states; QR sheet lifecycle.
- Commit — `feat(takelist): 24-hour grocery checklist via QR`

### Task 2: Weather

- Migration: `household_weather (household_id pk fk, fetched_at timestamptz, current_temp_f int, high_f int, low_f int, precip_chance int, summary text, icon text, error text)` with member SELECT policy, no client writes, realtime published. RPC `request_weather_refresh(p_household_id)` (member) is not needed if the Edge Function authenticates the caller: the function verifies the caller's JWT with the anon key client, checks membership via `rpc('my_household_ids')`-equivalent query (use a `private` helper exposed as `public.is_my_household(p_household_id) returns boolean` granted to authenticated), then uses the service role to upsert.
- `_shared/nws.ts` (pure): `parsePoints(json) → { forecastUrl, forecastHourlyUrl }`, `summarize(dailyJson, hourlyJson, now, timeZone) → { currentTempF, highF, lowF, precipChance, summary, icon }` choosing today's daytime high and tonight's low, current hour temp, max precip chance in the next 12 h; icon mapping from NWS `shortForecast` keywords → `sun | partly | cloud | rain | snow | storm | fog | wind`. Vitest tests with recorded fixture JSON (write small hand-made fixtures matching NWS shapes).
- `functions/weather/index.ts`: POST `{ householdId }`; if cached row younger than 30 min → return it; else fetch points (cache the forecast URLs in `household_weather.summary`? no — store in a `points_url` column) → forecasts → upsert → return. Errors: store `error` text, keep last good values, return 200 with `stale: true`. CORS for the app origin.
- `weatherApi.ts`: read row from the snapshot? Add `weather` to the household snapshot (supabaseSource loads the row; realtime updates it); the display calls the function when `fetched_at` is older than 30 min (at most once per 10 min per display).
- **WeatherLine.vue** in the header: icon (inline SVG set of 8), current temp 40 px, "H 78° · L 61° · 20% rain" 18 px; hidden when no data; "Weather unavailable" never shown (spec: hide).
- Verify locally: `supabase functions serve` is part of `supabase start` (edge runtime); set Rivera's lat/lon to Charlotte (35.23, -80.84) via psql and call the function with a display or adult JWT; confirm a row is written (requires internet).
- Commit — `feat(weather): National Weather Service forecast via Edge Function with 30-minute cache`

### Task 3: Photos storage and API

- Migration: create bucket `household-photos` (`insert into storage.buckets (id, name, public) values ('household-photos','household-photos', false) on conflict do nothing`); storage policies on `storage.objects` for `bucket_id = 'household-photos'`: SELECT and INSERT allowed to authenticated when `(storage.foldername(name))[1]::uuid` is in `my_household_ids()` (use a security-definer helper `public.is_my_household(uuid)`); no UPDATE; DELETE only via RPC. RPCs: `add_photo(M, P, p_photo_id uuid, p_kind text)` (object must exist at `<household>/<p_photo_id>.jpg`; enforce 200 slideshow limit; kinds `slideshow|avatar|step`), `delete_photo(M, P, p_photo_id)` (deletes the `photos` row and the storage object), both audited. Update `photos` path check to match. Smoke: member can upload/select own household path, not another household's; add_photo requires existing object + PIN; limit; delete removes both.
- `photosApi.ts`: `prepareImage(file) → Blob` (createImageBitmap → canvas max 1600 px long edge → `toBlob('image/jpeg', 0.85)`; canvas re-encode drops EXIF), `upload(householdId, blob) → photoId`, `add(auth, photoId, kind)`, `remove(auth, photoId)`, `signedUrls(paths, 3600)` (batch `createSignedUrls`). Tests with mocked canvas/storage.
- Snapshot: add `photos: { id, storagePath, kind, addedAt }[]` (source query, mapper, demo fixture with 0 photos + optional `?photos` flag using bundled sample SVG data URLs).
- Commit — `feat(photos): private photo storage with PIN-checked add and delete`

### Task 4: Photos in Settings and the Night slideshow

- **PhotosSection.vue** (Settings; depends on Phase 3c shell — if the shell isn't present yet, add the section file and register it in `settingsNav.ts` when available): grid of thumbnails (signed URLs), count "37 of 200", "Add photos" (file input `accept="image/*" multiple`; progress per file; skip files failing to decode with a message), delete with confirm. Copy: "Photos are resized and location data is removed before upload."
- **NightSlideshow.vue** inside `NightScreen`: preloads the next image; crossfade 1.5 s (no animation with Reduce Motion → instant swap); every 60 s; stable shuffled order per night; dim overlay keeps the clock readable (clock contrast still ≥ 3:1 over a dark scrim at 60 %); signed URL refresh 5 min before expiry; offline → keeps cycling already-loaded images, else clock only.
- Tests with fake timers and mocked signed URLs.
- Commit — `feat(photos): Settings photo management and Night Mode slideshow`

### Task 5: Error tracking

- `pnpm add @sentry/vue`. `errorTracking.ts`: `initErrorTracking(app, router)` no-op without `VITE_SENTRY_DSN`; `Sentry.init({ dsn, sendDefaultPii: false, tracesSampleRate: 0, replaysSessionSampleRate: 0, beforeSend: scrubEvent, beforeBreadcrumb: scrubBreadcrumb })`. `scrubEvent`: remove `request.data`, `request.cookies`, `request.headers.Authorization/apikey`, strip query strings from URLs, delete `user`, redact any string in `extra`/`contexts`/`exception.values[].value`/breadcrumb messages matching names from `getRedactionTerms()` (children and members of the current snapshot, sitter name, medicine names) → `[redacted]`; drop breadcrumbs of category `fetch`/`xhr` bodies; set tag `household` = hashed id. Pure scrubbers are unit-tested with realistic events. `.env.example` documents `VITE_SENTRY_DSN`.
- Commit — `feat(app): optional error tracking with personal data scrubbing`

### Task 6: Critical reload and realtime reconnect on version checks

- `vite.config.ts` writes `dist/version.json` (`{ version: pkg.version + '+' + gitShortSha, critical: process.env.ROOST_CRITICAL === '1' }`) via a small plugin; the SW must not precache `version.json` (exclude) and fetch it with `cache: 'no-store'`.
- `appUpdates.ts`: every 30 min and on `online`, fetch `version.json`; if `version` differs from the running `__APP_VERSION__`: trigger SW update; if `critical`, apply at the next moment with no running visual timer (ignore Night/idle rules); also on each check call `householdStore.reconnectRealtime()` (new method: if realtime status isn't `connected`, unsubscribe + resubscribe).
- Tests for the decision function and the reconnect call.
- Commit — `feat(app): critical update flag and realtime reconnect on version checks`

### Verify (controller)
Local Supabase: QR link → open `/list/<token>` in a second tab at phone size → check an item → tablet grocery list updates; Done shopping → page shows expired. Weather row appears for Rivera after setting lat/lon. Upload 3 photos in Settings → Night Mode (forced window) crossfades them. `pnpm build` produces `version.json`. Run smoke checks.
