# Roost: build status (2026-09-14)

## Contents

1. [Where things stand](#where-things-stand)
2. [What's built](#whats-built)
3. [See it now](#see-it-now)
4. [What needs you](#what-needs-you)
5. [Decisions I made that you should check](#decisions-i-made-that-you-should-check)
6. [Verification](#verification)
7. [Open follow-ups](#open-follow-ups)

## Where things stand

- **Branch:** everything is on `phase-1-foundation`. Nothing is merged or deployed.
- **Done:** Phases 1 through 4b, the whole v1 feature set in the spec, run locally against Supabase on OrbStack.
- **Not done:** Phase 5, the launch gate (spec §15). It needs accounts and people only you can set up; see [What needs you](#what-needs-you).

## What's built

**Phase 1: Foundation**
- Vue 3 + Vite + Tailwind 4 app using the Claude Design tokens.
- Domain rules as tested pure functions: sleep and wake window, medicine rules, age defaults, routines, stickers, leave-by, sitter summary.
- Supabase schema, row-level security and RPCs. Households are isolated from each other, and doses can only be voided or acknowledged with a PIN.
- Display identity: an anonymous Supabase user bound to a display by a one-time claim.
- Adults sign in on a separate client that is never saved and ends after 5 minutes idle.
- Setup wizard, Join a household, Display removed, Offline.

**Phase 2: Main screen and logging**
- **Main screen:** clock, kid cards, dose-conflict banner and medicine status, tonight's dinner, log buttons.
- **Log sheets:** sleep, feeding, medicine (early and daily-max warnings), sticker, diaper, jot, grocery.
- **Undo:** 10-second undo; undoing a dose needs a PIN.
- **Offline:** logs queue in order; offline doses ask "Log anyway?"; requests time out after 12 s.

**Phase 3a: Offline restart, Night and Nap Mode, Kids' Corner**
- **App updates:** installable, and updates only apply at safe moments.
- **Offline restart:** starts from a saved household snapshot (kept up to 7 days).
- **Night Mode:** follows the household's night hours, with peek-to-view.
- **Nap Mode:** ends by itself when the nap ends, or after 3 hours.
- **Kids' Corner:** picture schedule, timer and sticker chart. Leaving takes a hold plus a PIN, or a tap pattern when offline.

**Phase 3b: Sitter Mode**
- **Start:** hold the Sitter button, enter an adult PIN, and optionally type the sitter's name. Every display switches at once.
- **While it's on:**
  - Care Info replaces the Today panel.
  - Jot it and Grocery are hidden, and personal sheets close.
  - Logs are credited to "Name (sitter)" and linked to the session.
- **Ending it:** hold End, enter an adult PIN, and a "While you were out" summary shows everything logged in that session. Other displays offer "See summary".
- **Server side:** the database records who started and who ended each session, and only one session can be open per household.

**Phase 3c: Settings** (hold the gear, then enter an adult PIN)
- **Sections:** Household, Sitter info, Children, Medicines, Stickers, Routines (editor and today's routine), Logs history (edit and delete entries), Inbox, My account, Members, Displays, Photos, Delete household, About.
- **How changes are saved:** every change goes through an RPC that checks the PIN and is written to the audit log.
- **Owner-only actions:** members, displays, adding an adult and deleting the household are for owners only. On the tablet the **adult PIN authorises all of them** — there is no second, emailed sign-in — and the server re-checks on every call that the PIN belongs to an owner of the household. An adult who isn't an owner sees "Only an owner can …" instead of buttons.
- **In a browser at `/manage`** there is no PIN pad, so those same actions run on the adult's email sign-in, as before.
- **Hardening after review:**
  - Wrong PINs get a server-side delay, including on the owner-only actions.
  - Adding an adult hands the tablet over full screen and ends Settings.
  - Deleting a household deletes its PINs at once and purges its display accounts. It still needs the household name typed exactly.

**Phase 4a: Take list, weather, photos, error tracking, critical updates**
- **Take list:** a QR code opens a 24-hour grocery checklist on a phone at `/list/:token`. Only a hash of the token is stored.
- **Weather:** National Weather Service forecast in the header, through an Edge Function with a 30-minute cache. The location comes from the tablet, rounded to about 1 km.
- **Photos:**
  - Stored in a private bucket; adding and deleting take a PIN.
  - The app shrinks photos and strips their metadata before upload.
  - Managed in Settings; shown as a slideshow in Night Mode.
  - Each upload also stores a 320 px thumbnail for Settings.
  - Limits: 20 unrecorded uploads an hour and 300 photos per household.
  - Signed links last 15 minutes.
  - The `storage-sweep` function erases the files of deleted and orphaned photos.
- **Error tracking:** optional Sentry that scrubs personal data.
  - Vue component props are never attached, and console arguments aren't sent.
  - Query strings are removed, and tokens in page paths such as `/list/:token` are replaced with placeholders.
- **Critical updates:** a `critical` flag in `version.json` reloads the app after 60 quiet seconds with nothing open, and version checks also reconnect realtime.
  - Public pages never register the service worker.

**Phase 4b: Calendars, Manage household, Export**
- **Calendar links (ICS):**
  - The server fetches and parses each link, handling repeats, exceptions, moved instances and time zones.
  - Protections: SSRF blocking, a 1 MB cap and a 10 s timeout.
  - Links are stored encrypted in Supabase Vault, and connecting the same link twice is detected.
- **Today panel:** today's events for each person, with "Leave in N min" for timed events that have a location, "Now · until…", a stale note, and "Sam's calendar needs reconnecting".
  - Events are never stored: not in the database, not on the device, not in Sentry.
- **Google and Microsoft:** the connection code is written, but switched off until credentials exist. Connecting only works from Manage household.
  - The connection is finished only once the same adult signs in, which blocks someone else from attaching their calendar to your household.
- **Manage household** (`/manage`, any browser, phone to laptop):
  - Email-code sign-in, and a household picker.
  - Owners: Displays, Members, Export and Delete household.
  - Adults: My account and Calendars.
- **Export:** an owner requests it and the server builds a ZIP containing:
  - `household.json`
  - one CSV per log, with local-time columns
  - photos, up to 30 MiB

  The owner is emailed a link to `/manage/export/:id`, which needs sign-in and hands out a download link that expires after 10 minutes. Exports expire after 24 hours and their files are erased by the sweep.
  - Every table uses a list of allowed columns, so PIN hashes, tokens and Vault ids can't leak.
  - Limits: 1 export per hour per household, and at most 3 attempts.

## See it now

With no backend:

```bash
cd ~/www/cmrd/apps/roost && git checkout phase-1-foundation && pnpm install
```

```bash
VITE_DATA_SOURCE=demo pnpm dev
```

With local Supabase (OrbStack running):

```bash
supabase start && supabase functions serve
```

```bash
pnpm dev
```

- **Sign in:** as `sam@roost.test` (owner, PIN 1234) or `alex@roost.test` (PIN 5678). Sign-in codes arrive in Mailpit at http://127.0.0.1:55324.
- **Local calendar and email settings:** in `supabase/functions/.env`, which git ignores. It holds the private-host allowance for calendar links, the fingerprint key and Mailpit SMTP.

## What needs you

**Launch gate (spec §15).** None of these can be done without your accounts or decisions:

1. **Supabase production project.** Enable point-in-time recovery and complete one test restore.
2. **Production secrets:**
   - `APP_URL=https://roost.cmrd.dev`
   - `CALENDAR_FINGERPRINT_KEY`: random, never rotated casually, because rotating it stops duplicate-link detection for existing connections
   - SMTP settings
   - optional Sentry DSN
3. **Google Cloud OAuth app:**
   - Redirect URI: `…/functions/v1/calendar-oauth-callback`
   - Publish it to Production and get it verified. The `calendar.readonly` scope is sensitive, so expect a review.
   - Also Apple sign-in, and Google sign-in for adults.
4. **Microsoft Entra app:** multi-tenant, with the `Calendars.Read`, `offline_access`, `openid` and `profile` permissions, and the same redirect URI.
5. **Email provider for SMTP.** Supabase's default sender only allows about 2 emails an hour.
6. **Scheduled jobs:**
   - Schedule the pg_cron purges; `supabase/manual-checks/cron_check.sql` should report READY.
   - Schedule `storage-sweep` hourly. The README's "Scheduled jobs" section has the SQL.
7. **Hosted export test at the 30 MiB photo cap.** Check it stays within the 150 MB memory and 2 s CPU limits.
8. **Before any outside family:** a Playwright suite plus a check on a Fire tablet (§14), a lawyer-reviewed privacy policy, terms and breach plan, and a trademark search for "Roost Family".
9. **Kids' Corner icon artwork** from Claude Design (prompt in `docs/design/2026-09-14-claude-design-update-2.md`).

## Decisions I made that you should check

Earlier decisions (palette, `orange-deep`, the 18 h wake window, stale sleep, routine skipping, read-only config, geolocation weather, full sign-in for adding adults, and others) are unchanged. They are recorded in the spec's revision history. New since Phase 3a:

| Decision | Why | Where |
|---|---|---|
| **Google and Microsoft calendars connect only from Manage household, not the tablet** | The tablet doesn't keep an adult signed in, so it would lose the connection when the provider sends the browser back. The tablet's buttons point to roost.cmrd.dev/manage. | `CalendarsSection.vue` |
| **An OAuth connection waits in a 15-minute pending state until the same adult signs in** | Otherwise someone could send you their consent link and connect *your* Google account to *their* household | migration 11, `calendar-oauth-finish` |
| **Blocked and unreachable calendar links return the same error** | Different errors would let someone probe which internal hostnames exist | `calendar-connect-ics` |
| **A calendar is marked "unreachable" only after 2 failures in a row; "needs reconnecting" is immediate** | One slow ICS server shouldn't reload every display through realtime | `calendar-events` |
| **Leave-by shows for timed events with a location that start within 2 hours, minus the household buffer** | Events without a location don't need travel | `leaveInMinutes` |
| **Export email is sent only after the export is marked ready; failed attempts count toward a limit of 3 an hour** | A link should always lead to a file, and a broken SMTP setup shouldn't allow endless 30 MiB builds | migration 12 |
| **Export photo cap is 30 MiB (not 200 MB)** | Supabase's 50 MiB upload limit and the Edge Function memory limit | `export-household` |
| **Public pages (`/manage`, `/list/:token`) never reload for updates, and key presses count as activity** | A laptop user typing a code never touches the screen | `appUpdates.ts` |
| **Owners can't leave a household from `/manage`** | They must hand ownership to another adult first; the page says so | `ManageHousehold.vue` |
| **Adults can see the Members and Displays lists on `/manage`; only owners can change them** | Members already see these on the tablet; the server enforces changes | settings RPCs |
| **Photos per household are capped at 300 (200 slideshow + 100 child and routine-step photos)** | The spec only limits the slideshow to 200 | migration 13 |
| **Photo deletion keeps the file record until the sweep erases the bytes; the files become unreadable at once** | SQL can't erase Storage files, so deleting the record would lose track of them | migration 7 |
| **On a display the adult PIN now authorises every Settings action, including deleting the household** | A one-owner household had to enter three separate emailed codes to visit Members, Displays and Delete household in one sitting, which pushed people to leave a browser signed in instead. **The weaker guard is real:** a 4-digit PIN, not an emailed code, now stands in front of household deletion. What still guards it: owner-only, the household name typed exactly, a 30-day soft delete that support can undo, the 0.75 s wrong-PIN delay, and an audit row. `/manage` in a browser keeps the email sign-in. | migration 14, `usePinOwner.ts` |

## Verification

- **Automated checks at HEAD:**
  - `pnpm test`: 1,885 tests in 127 files, all passing.
  - `pnpm typecheck` and `pnpm build`: clean.
  - `deno check` on every Edge Function: clean.
- **Database checks on local Supabase:**
  - `rls_smoke.sql`: `ALL RLS SMOKE CHECKS PASSED` (124 labelled sections).
  - `anon_api_check.sh`: every check OK.
- **Independent reviews** after every phase and feature: calendar parsing, calendar schema, calendar functions, Today and calendar UI, Manage household, export, Phase 3c and Phase 4a. Every finding was fixed and re-verified.
- **Browser runs on local Supabase, controlled by me:**
  - **Phase 1–3a:** setup, join, revoke, realtime, logging, undo, offline queue, offline restart, Night, Nap, Kids' Corner (details in git history of this file).
  - **Sitter Mode on two displays:**
    1. Sam's PIN started it and both displays switched through realtime.
    2. The sitter logged a snack on the second display, credited to "Grandma QA (sitter)" and linked to the session.
    3. Alex's PIN ended it on the first display, which showed "While you were out" with the snack.
    4. The second display offered "See summary".
    5. The database recorded who started it (Sam) and who ended it (Alex).
  - **Today panel:**
    - A real display showed a local ICS event as "Now · until 6:00 PM".
    - An earlier run showed an all-day event first and "Leave in 1 min" at all three iPad sizes.
  - **`/manage` at 375 px wide:**
    - Sam signed in and saw Calendars, Displays, Members, Export and Delete household.
    - No sideways scroll, and every tap target is at least 44 px.
  - **Export from the page:**
    - Requesting it showed "We'll email a link…", the export reached `ready`, and Mailpit got the email with the link.
    - The download page signed Sam in and showed "Your export is ready".
    - The ZIP's contents were checked by the export agent: no secret columns.
  - **Display limit:** a fourth display is refused with "Rivera already has 3 displays. Remove one in Settings → Displays or at roost.cmrd.dev/manage, then try again." Before this run the raw server text showed; it is now fixed.

## Open follow-ups

- **DNS rebinding for calendar links:** accepted. Links must be https on the default port, and certificate checks fail a rebind to an internal IP.
- **Kids' Corner timer and updates:** a running timer also blocks app updates during Night Mode. This is deliberate and easy to change.
- **Flaky test:** "long-pressing tonight's dinner edits it" fails when run alone and passes in the full suite.
- **"Log wake-up" with no data:** it shows for a child with no sleep data at all. Consider hiding it until the first sleep log.
- **`deno check` flags:** run it with `--no-lock --node-modules-dir=none`, otherwise it writes `deno.lock`.
