# Roost Phase 4b: Calendar, Manage Household, Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adults connect their calendars (ICS subscription links now; Google and Microsoft OAuth code paths ready for credentials) and assign each calendar to a person; the main screen's Today panel shows today's events with leave-by countdowns without ever storing event data; owners can manage the household from any browser; owners can export all household data.

**Architecture:** Calendar secrets (ICS URLs, OAuth refresh tokens) live in Supabase Vault referenced from `calendar_connections`. An Edge Function `calendar-events` authenticates the caller (display or member), loads the household's visible selections, fetches and parses events per provider with an in-memory 5-minute cache, and returns only minimal fields. OAuth connect/callback functions exist for Google and Microsoft but report "not configured" without env credentials. Manage household is a responsive route usable on phones/laptops with the temporary adult client. Export is an Edge Function that builds a ZIP (JSON + CSV per log type + photos), stores it in a private bucket, and emails a sign-in-protected link (local SMTP = Mailpit).

**Spec:** `docs/superpowers/specs/2026-09-14-roost-design.md` §5.5 (calendar), §6.3 (sensitive actions), §7.2 (Today, leave-by), §7.9 (My account calendars), §7.10 (Manage household), §11.2–§11.3 (never store events, export, deletion), §13 (calendar error states), §15 (Google verification, Microsoft + ICS before launch).

## Contents
- [Decisions](#decisions)
- [File structure](#file-structure)
- Tasks 1–6

## Decisions

| Topic | Decision |
|---|---|
| Providers in this phase | ICS (fully working), Google + Microsoft (implemented behind env: `GOOGLE_CLIENT_ID/SECRET`, `MS_CLIENT_ID/SECRET`, redirect `…/functions/v1/calendar-oauth-callback`) |
| Secret storage | `vault.create_secret(secret, name)`; `calendar_connections.vault_secret_id`; decrypted only inside Edge Functions using the service role via a `private.calendar_secret(p_connection_id)` security-definer function not exposed to clients |
| Who connects | An adult with a full sign-in (spec §6.3) from Settings → My account or from Manage household |
| Event window | "Today" in the household zone (00:00–24:00) plus events already in progress; all-day events listed first |
| Recurring events | ICS parsed with `ical.js` (npm) including RRULE/EXDATE/RECURRENCE-ID expansion for the day window |
| Caching | Edge Function module-level `Map` keyed by connection id with 5-minute TTL; never written to the database |
| Returned fields | `title`, `startAt`, `endAt`, `allDay`, `location`, `personId` (member or child), `calendarColor` (from assignment) |
| Errors | Per connection: `ok` / `auth_expired` / `unreachable`; the Today panel shows "Sam's calendar needs reconnecting" for `auth_expired` |
| Manage household URL | `/manage` (router exempt from display registration), responsive, email-code sign-in |
| Export | Owner full sign-in; Edge Function `export-household` builds ZIP → `exports` bucket `<household>/<uuid>.zip` → emails the owner a link to `/manage/export/<uuid>`; the page requires sign-in, then creates a 10-minute signed URL; exports deleted after 24 h by `private.purge_old_exports()` |
| Email sending | SMTP settings via env (`SMTP_HOST/PORT/USER/PASS/FROM`); locally Mailpit SMTP on port 55325 (enable `smtp_port` in `config.toml` `[inbucket]`) |

## File structure

```
supabase/migrations/20260914000005_calendar_export.sql   calendar tables, vault helpers, RPCs, exports bucket, purge functions
supabase/functions/_shared/ics.ts (+ vitest)             ICS fetch/parse/expand (pure over text)
supabase/functions/_shared/events.ts (+ vitest)          provider-neutral day filtering + minimal event shape
supabase/functions/_shared/auth.ts                      caller verification (display or member) helpers
supabase/functions/calendar-events/index.ts
supabase/functions/calendar-connect-ics/index.ts         validate URL, store in Vault, create connection + discover calendar name
supabase/functions/calendar-oauth-start/index.ts
supabase/functions/calendar-oauth-callback/index.ts
supabase/functions/_shared/google.ts, microsoft.ts      token refresh + event list (not exercised without credentials)
supabase/functions/export-household/index.ts
supabase/functions/_shared/exportBuilder.ts (+ vitest)   JSON + CSV builders
src/data/calendarApi.ts (+test)
src/features/main/TodayPanel.vue (+test)                 replaces the placeholder
src/features/settings/sections/CalendarsSection.vue      within My account
src/features/manage/ManageHousehold.vue (+test)          /manage
src/features/manage/ExportDownload.vue                   /manage/export/:id
```

---

### Task 1: Calendar schema and Vault helpers
Tables `calendar_connections (id, household_id, membership_id, provider 'ics'|'google'|'microsoft', label text, vault_secret_id uuid, status 'ok'|'auth_expired'|'unreachable', created_at)` and `calendar_selections (id, connection_id, external_calendar_id text, name text, assigned_membership_id uuid null, assigned_child_id uuid null, visible bool, check exactly one assignee)` with composite household FKs, member SELECT policies (no secrets exposed), no client writes. RPCs (full sign-in adult, own connections only): `set_calendar_selection(p_selection_id, p_visible, p_assigned_membership_id, p_assigned_child_id)`, `disconnect_calendar(p_connection_id)` (deletes Vault secret + rows). Private (service role only): `private.store_calendar_secret(p_secret text, p_name text) returns uuid`, `private.calendar_secret(p_connection_id) returns text`, `private.create_calendar_connection(...)`. Removing a member (Phase 3c `remove_member`/`leave_household`) disconnects their calendars — update those RPCs. Smoke checks: members see connections without secrets; other household can't; clients can't call private helpers; disconnect removes the secret. Commit — `feat(db): calendar connections with Vault-held secrets`.

### Task 2: ICS parsing and the events function
`_shared/ics.ts`: `parseIcsForDay(text, dayStartUtc, dayEndUtc, timeZone)` using `ical.js` → events with recurrence expansion, all-day handling (DATE values in the household zone), cancellation/EXDATE, location, summary; tolerate bad VEVENTs. Vitest fixtures: single event, all-day, weekly RRULE with EXDATE, overridden instance, DST-crossing recurrence, invalid lines. `_shared/events.ts`: merge per selection, attach person/color, sort (all-day first, then start), clamp to today, drop descriptions/attendees. `calendar-connect-ics`: adult JWT → validate `https://` or `webcal://` URL (convert webcal→https), fetch with 10 s timeout, must parse; store Vault secret; create connection + one selection with the calendar's `X-WR-CALNAME`. `calendar-events`: caller JWT (display or member) → household → visible selections → fetch per connection (5-min in-memory cache, 10 s timeout, max 1 MB) → events → `{ events, connections: [{ id, ownerName, status }] }`. Local verification: serve a fixture `.ics` from a tiny static server reachable from the edge runtime container (`host.docker.internal`), connect it as Sam, and call `calendar-events` with the display's JWT. Commit — `feat(calendar): ICS subscriptions with server-side parsing and a no-storage events proxy`.

### Task 3: Google and Microsoft OAuth paths
`calendar-oauth-start` (adult JWT, provider) → returns the provider authorization URL with PKCE + state (state row in `calendar_oauth_states` table with 10-minute expiry) or `{ error: 'not_configured' }`. `calendar-oauth-callback` exchanges the code, stores the refresh token in Vault, lists calendars and creates selections (hidden by default), then redirects to `/manage?calendar=connected`. `google.ts`/`microsoft.ts`: refresh access tokens, list calendars, list today's events (Google `events.list` with `singleEvents=true`; Microsoft `calendarView`), map to the shared shape; mark `auth_expired` on `invalid_grant`/401. Unit-test mapping functions with recorded-shape fixtures; the network paths can't be exercised locally without credentials — document that in README. Commit — `feat(calendar): Google and Microsoft OAuth connection paths (credential-gated)`.

### Task 4: Today panel and calendar settings
`calendarApi.ts`: `todayEvents()` calls the function every 5 min and on visibility; keeps last good result with `updatedAt`. **TodayPanel.vue**: header "Today" 16 px uppercase; events with person avatar (decorative) + colored bar, time range 18 px, title ≥ 24 px, location 18 px, "Leave in 25 min" (orange-deep, 22 px) via `leaveInMinutes`; "Nothing else today"; stale note "Calendar updated 45 min ago" when > 30 min; per-connection `auth_expired` line. Sitter Mode still replaces it with Care Info. **CalendarsSection.vue** (Settings → My account, needs full sign-in): connect ICS (paste URL), connect Google/Microsoft buttons (disabled with "Not set up yet" when not configured), list my connections with calendars: visible toggle, assign to a person (members + children), disconnect. Tests. Commit — `feat(calendar): Today panel and calendar settings`.

### Task 5: Manage household (any browser)
`/manage`: responsive (phone to laptop); email-code sign-in (temporary adult client, idle 5 min); if the adult belongs to several households, pick one; **Owners:** Displays (revoke), Members (remove), Export, Delete household (reuse Phase 3c section components with props for the adult client; make them layout-agnostic); **Adults:** My account (calendars: disconnect; leave household). Handles `?calendar=connected` after OAuth. Tests. Commit — `feat(manage): Manage household page for any browser`.

### Task 6: Export
Migration: private `exports` bucket; table `household_exports (id, household_id, requested_by, status 'pending'|'ready'|'failed', storage_path, created_at, expires_at)` with owner SELECT; `request_household_export(p_household_id) returns uuid` (owner full sign-in; one per hour). Edge Function `export-household` (invoked by the RPC's caller right after, with the export id): service role reads all household rows (households, members without PIN hashes, children, overrides, routines, progress, medicines, doses, sleeps, feedings, stickers, diapers, jots, groceries, sitter sessions, settings audit, photos metadata) → `exportBuilder.ts` creates `household.json` + one CSV per log type (RFC 4180 quoting, ISO timestamps + household-zone local time column) → ZIP (`fflate` npm) including photo files → upload → status ready → email link via SMTP (`denomailer` or raw SMTP client) to the owner's address: "Your Roost Family export is ready" with link `https://<app>/manage/export/<id>` (24 h). **ExportDownload.vue**: sign-in → if owner of that household and export ready and unexpired → button that fetches a 10-minute signed URL and starts the download (a normal link in the page context — the app is not an artifact). `private.purge_old_exports()` deletes files and rows older than 24 h. Local verification with Mailpit SMTP. Tests for builders (CSV escaping, JSON shape, PIN hashes excluded). Commit — `feat(export): owner-requested household export with emailed sign-in link`.

### Verify (controller)
Connect a local ICS fixture as Sam → Today panel shows today's events with leave-by; `calendar-events` response contains no descriptions; no event rows in the database. `/manage` on a phone-size viewport: sign in as Sam, revoke a display, request export → Mailpit email → download ZIP → inspect CSV/JSON. Smoke checks pass.
