# Roost — Design Spec

**Date:** 2026-09-14
**Revision:** 3. Revision 2 added the product, account, privacy and platform decisions; Revision 3 reconciles the spec with the Claude Design handoff (v2). See [16. Revision History](#16-revision-history).
**Design source:** `docs/design/handoff/project/Roost Family App v2.dc.html`
**Status:** Approved, ready for visual design (Claude Design) and implementation planning

## Table of Contents

1. [Summary](#1-summary)
2. [Product Decisions](#2-product-decisions)
3. [Household #1 — Context](#3-household-1--context)
4. [Design Principles](#4-design-principles)
5. [Platform & Architecture](#5-platform--architecture)
6. [Accounts, Roles & Access](#6-accounts-roles--access)
7. [Priority 1 — Core (v1)](#7-priority-1--core-v1)
   - 7.1 [Setup Wizard](#71-setup-wizard)
   - 7.2 [Main Screen](#72-main-screen)
   - 7.3 [Toddler Guard & PINs](#73-toddler-guard--pins)
   - 7.4 [Logs](#74-logs)
   - 7.5 [Kids' Corner](#75-kids-corner)
   - 7.6 [Sitter Mode](#76-sitter-mode)
   - 7.7 [Night & Nap Mode](#77-night--nap-mode)
   - 7.8 [Take List (Grocery QR)](#78-take-list-grocery-qr)
   - 7.9 [Settings](#79-settings)
   - 7.10 [Manage Household (any browser)](#710-manage-household-any-browser)
8. [Priority 2 — Soon After (v1.1)](#8-priority-2--soon-after-v11)
9. [Priority 3 — Later](#9-priority-3--later)
10. [Out of Scope](#10-out-of-scope)
11. [Privacy, Safety & Compliance](#11-privacy-safety--compliance)
12. [Data Model](#12-data-model)
13. [Offline & Error States](#13-offline--error-states)
14. [Testing](#14-testing)
15. [Launch Gate — Before the First Outside Family](#15-launch-gate--before-the-first-outside-family)
16. [Revision History](#16-revision-history)
17. [Screen List for Claude Design](#17-screen-list-for-claude-design)

---

## 1. Summary

**Roost Family** is a free, fullscreen web app for a kitchen tablet, made for families with young kids (about 0–6). It shows the day at a glance, lets adults log naps, feedings and medicine with one tap, gives each preschooler a picture-based routine space, and hands off cleanly to a sitter.

It starts as one family's app (household #1, the author's) but is built as a multi-household product from day one: real accounts, per-household data isolation, and a launch gate before any outside family is invited.

## 2. Product Decisions

| Topic | Decision |
|---|---|
| **Name** | Public brand **Roost Family**; project and repo name **Roost**. A trademark clearance search happens before public launch |
| **Brand** | Logo **1A "Gable"** (line-drawn birdhouse) with lowercase **"roost family"** wordmark; accent `#E2703A`; typeface **Outfit** (400/500/600/700) |
| **Domain** | **roost.cmrd.dev** (CMRD subdomain) |
| **Audience** | Families with kids about 0–6, with features that grow with the kids (age-based defaults, [7.2](#72-main-screen)) |
| **Build order** | Household #1 first, built product-ready (accounts, household scoping) from the first commit. No billing or marketing site in v1 |
| **Business model** | Free hosted service, closed source. Payment may be added later; the household record carries a `plan` field (always `free` for now) |
| **Surface** | **Tablet web app only** in v1. No phone or laptop app, with two exceptions: the Take List grocery page ([7.8](#78-take-list-grocery-qr)) and Manage Household ([7.10](#710-manage-household-any-browser)) |
| **Region** | US-only launch. English, US units (oz, °F), 12-hour time |
| **Launch** | Invite-only (an invite code is required to create a household), then open sign-up |
| **Operator** | CMRD Consulting, with a lawyer-reviewed privacy policy and terms before the first outside family |
| **Per-household limits** | 10 adults/caregivers · 8 children · 3 displays · 200 slideshow photos |

## 3. Household #1 — Context

| Person | Details | Role |
|---|---|---|
| **Parent** | Primary user | Owner |
| **Leona** | Born May 23, 2023 (age 3) | Child |
| **Mara** | Born May 24, 2025 (age 1) | Child |
| **Caregiver** (nanny or family member, some days) | No account | Uses Sitter Mode |

- **Typical weekday:** home with the parent most days; a caregiver watches the girls on some days.
- **Calendar:** Google Calendar.

## 4. Design Principles

1. **Glanceable first.** The main screen must be readable in about 2 seconds from about 3 m (10 ft). Primary numbers (clock, wake window, last dose) are large; secondary information is visibly secondary.
2. **One tap to log.** The most common actions (sleep, feeding, medicine, sticker, jot, grocery) start from the main screen, never from a menu. The adult is often holding a child.
3. **Big targets, messy hands.** Two tiers:
   - **In-the-moment surfaces** (main screen, log sheets, PIN pad, Kids' Corner, Sitter Mode, Undo toast): minimum touch target **60×60 pt**; primary log buttons at least 88 pt tall.
   - **Deliberate surfaces** (Settings, setup wizard, Join a household, Manage household): minimum **44×44 pt**.
4. **Toddler-proof.** Nothing that changes data can happen from a single accidental tap ([7.3](#73-toddler-guard--pins)).
5. **Readable across the room.** Main-screen text is tiered:
   - **Glanceable figures ≥ 24 pt:** clock, wake window / sleeping time, next dose, event titles, tonight's dinner.
   - **Secondary text ≥ 18 pt:** date, weather details, feeding line, event times and locations, log button labels, Now/Next content.
   - **Nothing on the main screen below 16 pt** (including badges, hints and section labels).
6. **Never color alone; always legible.**
   - Every person's color is always paired with their avatar or initial.
   - **Person colors** come from a dedicated 10-color palette that shares no color with the log-button colors; past 10 people, colors repeat.
   - All text meets **WCAG AA contrast** (4.5:1 normal, 3:1 for text ≥ 24 pt, or ≥ 18.5 pt bold). Bright accent colors are used for icons and fills; text on or in them uses the deep variants (e.g., `#B8542A`, `#2F6B57`). The faint neutral (`#B3A092`) is never used for text.
   - Palette checked for color-blind safety in day and Night Mode.
   - Respects the OS "Reduce Motion" setting.
7. **Calm, warm, high-contrast.** It lives in a home, not an office. Playfulness is reserved for Kids' Corner.
8. **Lightweight.** Minimal animation outside Kids' Corner; the oldest supported hardware is a 2015–2017 iPad Pro.

## 5. Platform & Architecture

### 5.1 Devices

| Device | Support |
|---|---|
| **iPad** (iPadOS 16+), Safari, added to the Home Screen | Primary. The oldest iPad Pro models are the performance floor |
| **Android tablets**, Chrome (latest 2 versions), installed web app | Supported |
| **Amazon Fire tablets** | Supported through Fully Kiosk Browser (Silk's installable web app support is unreliable) |

- **Orientation:** landscape only.
- **Layout sizes:** design primarily at **1112×834 pt**; must also work at **1024×768 pt** and **1366×1024 pt**.
- **Keeping the screen on:** the Screen Wake Lock API is broken for Home Screen web apps before iPadOS 18.4, so the app does not rely on it. A setup guide tells families to set Auto-Lock to Never and use Guided Access (iPad), or use Fully Kiosk Browser's screen settings (Fire).
- **Audio:** browsers require a user gesture before playing sound. The app unlocks audio on the first tap after launch.

### 5.2 Stack

- **Frontend:** Vue 3 + Vite + Tailwind, installable web app (manifest + service worker), hosted on Netlify.
- **Backend:** Supabase: Postgres with row-level security for household isolation, Auth, Realtime, Storage, Edge Functions, Vault, scheduled jobs.
- **Plan:** Supabase Pro from day one (daily backups, no inactivity pausing). Point-in-time recovery is added before the first outside family.

### 5.3 Environments

- **dev** and **prod** Supabase projects.
- Household #1 lives in **prod** from day one.
- **dev** uses seed data: a fictional household with two toddlers, a second adult, medicines, routines and a week of logs.

### 5.4 Realtime & Sync

- Displays subscribe to their household's changes through Supabase Realtime, so a log saved on one display appears on the others within seconds.
- Offline behavior: [13. Offline & Error States](#13-offline--error-states).

### 5.5 Calendar Integration

- Each adult connects their own calendar account (Google in v1; Microsoft 365/Outlook and ICS subscription links before launch, [15](#15-launch-gate--before-the-first-outside-family)).
- OAuth tokens are stored encrypted in Supabase Vault and **never reach any device**.
- An Edge Function fetches events on request for the household's displays, caches them **in memory for up to 5 minutes**, and returns only: title, start, end, all-day flag, location, and the person the calendar is assigned to. Descriptions, attendees and links are stripped. **Event data is never written to the database.**
- Displays request events every 5 minutes.
- Google OAuth app must be **published to Production** (Testing-status refresh tokens expire after 7 days) and **verified** before more than 100 users ([15](#15-launch-gate--before-the-first-outside-family)).

### 5.6 Weather

- Source: **National Weather Service API** (api.weather.gov), behind a small provider interface so another provider can replace it for international expansion.
- Fetched server-side per household location every 30 minutes; displays read the cached result.
- Household location is stored as latitude/longitude, set from a ZIP code during setup.

### 5.7 Time Zones

- Each household has one time zone, set during setup.
- All timestamps are stored in UTC.
- Wake windows, night-sleep boundaries, Night Mode, routine times, the weekly sticker reset and "today" are all evaluated in the household time zone.

### 5.8 App Updates on Always-On Displays

- The display checks for a new app version every 30 minutes.
- When a new version exists, it reloads at the next safe moment: Night Mode is active, **or** 5 minutes pass without a touch while no visual timer is running and Kids' Corner is closed.
- A deploy can set a **reload-now** flag for critical fixes; the display then reloads at the next moment no visual timer is running.
- The same check reconnects Realtime if the connection dropped.
- Settings shows the current app version.

### 5.9 Error Tracking & Analytics

- **Sentry** for errors, with scrubbing: no request or response bodies, no names, notes or medicine fields, household ID hashed.
- **No product analytics** inside the app.

## 6. Accounts, Roles & Access

### 6.1 Identities

| Identity | What it is |
|---|---|
| **User** | An adult's account. Sign in with **Apple**, **Google**, or a **6-digit email code** (no passwords, no magic links) |
| **Membership** | A user's role in one household. One user can have memberships in several households |
| **Display** | A registered tablet. Holds its own revocable device credential, never an adult's session |
| **Child** | Belongs to exactly one household (linked through a separate child–household table so shared children stay possible later) |
| **Sitter** | No account. A name typed when Sitter Mode starts |

### 6.2 Roles

| Role | Can do |
|---|---|
| **Owner** | Everything, including managing members, displays, export and deleting the household. A household can have several Owners and can never lose its last Owner |
| **Adult** | Everything except managing members, displays, export and deletion |
| **Caregiver** | Reserved in the data model; the invite flow and caregiver accounts come later ([8](#8-priority-2--soon-after-v11)) |

- When a member leaves or is removed, past entries keep their name, shown as "Sam (former member)".
- Calendars they connected disconnect immediately and disappear from all displays.

### 6.3 Adult Sessions on a Display

- The display normally runs on its device credential. No adult is signed in.
- A **full sign-in** on the display starts a temporary adult session. It ends after **5 minutes without a touch** or when the adult leaves the screen that required it, whichever comes first.
- Actions that need a **full sign-in**: connecting or disconnecting a calendar, adding or removing members, adding or revoking displays, export, deleting the household, and resetting a forgotten PIN.
- Everything else that's protected uses the adult's **PIN** ([7.3](#73-toddler-guard--pins)).

### 6.4 Adding Adults and Displays

**Add an adult** (on a display):
1. An Owner enters their PIN → Settings → Members → **Add adult**.
2. The Owner picks the role (Owner or Adult).
3. The new adult signs in on the display with their own account and accepts the terms and health-data consent.
4. They choose a color and set a 4-digit PIN.
5. Optionally, they connect their calendar and pick which calendars to show.
6. They're signed out; the display returns to the main screen.

**Add a display:**
1. Open Roost Family on the new tablet → **Join a household**.
2. An Owner signs in there and picks the household.
3. The Owner names the display (e.g., "Kitchen", "Playroom").
4. The display is registered and the Owner is signed out.

### 6.5 Attribution

Every entry records:
- `deviceId`: which display it was logged on.
- `loggedBy`: the adult chosen in the log sheet's **"Who?"** row (avatars of the household's adults). The row appears only on **kid logs** (Sleep, Feeding, Medicine, Sticker, Diaper). It's optional except on **Medicine**, where it's required. Left empty, the entry shows as "Kitchen" (the display name). Jots and grocery items are attributed to the display only.
- In Sitter Mode, `loggedBy` is replaced by the sitter's name automatically.
- Settings changes are attributed to the adult whose PIN unlocked Settings.

## 7. Priority 1 — Core (v1)

### 7.1 Setup Wizard

Runs on the tablet the first time Roost Family opens. Each step is one screen with large touch targets.

1. **Welcome:** "Set up a household" or "Join a household" (the latter goes to [6.4](#64-adding-adults-and-displays)).
2. **Invite code** (while invite-only is active), entered in 6 character boxes.
3. **Sign in:** Apple, Google or email code.
4. **Consent:** terms, privacy policy, and explicit consent to store children's health information (medicine, sleep, feeding logs). Consent is recorded with its version and time.
5. **Household:** name, ZIP code (weather location), time zone (pre-filled from the ZIP code).
6. **Kids:** name, birthday, color, optional photo. Add up to 8.
7. **You:** display name, color, 4-digit PIN.
8. **Calendar** (skippable): connect Google, pick calendars, assign each to a person.
9. **Another adult** (skippable): runs the Add adult flow ([6.4](#64-adding-adults-and-displays)).
10. **This display:** name it ("Kitchen"). The tablet is registered, the adult is signed out, and a one-screen tip explains Auto-Lock, Guided Access and Fully Kiosk Browser.
11. **Main screen.**

Routines, medicines, stickers and sitter info are set up later in Settings; age-based defaults make the main screen useful immediately.

### 7.2 Main Screen

The default, always-on view. Zones, in order of visual weight:

| Zone | Content | Behavior |
|---|---|---|
| **Header** | Clock (largest element), date, weather (current temp, high/low, chance of rain) | Weather updates every 30 min |
| **Kids status** | One card per child, with avatar + color. Card content follows **age-based defaults** (below): e.g., "Awake 2h 40m" or "Sleeping 45m", last feeding ("Milk 1h 10m ago"), Now → Next picture card | Updates every minute. **Up to 4 full cards**; with 5–8 children, cards switch to a compact layout (avatar, name, one status line) |
| **Medicine** | Shown only when a dose was logged in the last 24 h: "Mara · Ibuprofen · given 3:10 PM by Sam · next after 9:10 PM" | Next-dose time turns green once passed. Hidden when there are no recent doses |
| **Today** | Calendar events from now through end of day, each with the assigned person's avatar + color. Events with a location in the next 2 h show "Leave in 25 min" | Leave-by = event start − buffer (default 20 min). Refreshes every 5 min |
| **Tonight's dinner** | Free-text line, e.g., "Tacos" | Long-press to edit. Replaced by the meal plan in v1.1 |
| **Log row** | **Sleep** · **Feeding** · **Medicine** · **Sticker** · **Jot it** · **Grocery** (+ **Diaper** if enabled) | Each opens its log sheet ([7.4](#74-logs)) |
| **Mode controls** (small, corner) | Nap Mode (moon), Kids' Corner, Sitter Mode, Settings (gear) | See the sections for each mode |

**Age-based defaults** (evaluated in household time; each can be overridden per child in Settings; an override sticks until the parent clears it):

| Feature | On by default when the child is… |
|---|---|
| Wake window on card; Sleep log | Under 3 years |
| Last feeding on card; Feeding log | Under 3 years |
| Now → Next card; Picture Schedule; Sticker chart; Kids' Corner | 2 to 7 years |
| Diaper log | Off for everyone; enabled per household in Settings |

Defaults are re-evaluated daily, so a feature turns on the day a child reaches its age.

### 7.3 Toddler Guard & PINs

| Action | Protection |
|---|---|
| Open a log sheet | **Long-press 0.6 s** with a fill-ring indicator |
| Save a log inside a sheet | Normal tap |
| Undo the last log | Tap "Undo" on the toast shown for 10 s after any save |
| Edit or delete a past entry (non-medicine) | Long-press the entry, then confirm |
| Void a medicine entry | Adult PIN + reason ("logged by mistake"); voided doses stay visible in history, struck through |
| Acknowledge a dose-conflict alert | Adult PIN |
| Open Settings; start or exit Sitter Mode | **Adult PIN** (any adult's own 4-digit PIN) |
| Exit Kids' Corner | Long-press 2 s in a corner, then adult PIN |
| Sensitive actions ([6.3](#63-adult-sessions-on-a-display)) | Full sign-in |

- **PIN pad** shows adult avatars first; the adult taps theirs, then enters their PIN.
- **No lockout** after wrong attempts.
- **Forgot PIN:** full sign-in, then set a new PIN.

### 7.4 Logs

All log sheets are modal overlays with:
- a large **child picker** (avatars + colors; only children for whom that log is enabled),
- a **time** field that defaults to now and adjusts in 5-minute steps,
- a **"Who?"** row of adult avatars on kid logs only ([6.5](#65-attribution)).

**Sleep**
- One button toggles "Start sleep" → "End sleep" per child.
- A sleep starting inside **that child's night-sleep window** is *Night*, otherwise *Nap*. Each child's window defaults to the household default (**6:00 PM–5:00 AM**, household time) and can be changed per child in Settings → Children. The type can be changed in the sheet.
- **Wake window** = time since the most recent sleep ended. With no sleep ended in the last 18 hours, the card shows "Log wake-up". (A calendar-day rule would show "Log wake-up" at 12:10 AM for a child who fell asleep at 11:50 PM.)
- **Forgotten "End sleep":** an open sleep that started more than 16 hours ago shows "Still sleeping?" with End sleep and Discard actions instead of a growing duration. An open sleep followed by a later ended sleep is ignored.

**Feeding**
- Type: Milk / Meal / Snack.
- Optional amount (oz for milk; "a little / some / all" for meals) and note.

**Medicine**
- Pick from **the selected child's medicine list** (Settings → Medicines, defined per child, so "Infant ibuprofen" for one child and "Children's ibuprofen" for another never share limits). Each medicine has:
  - **Minimum hours between doses** (required)
  - **Maximum doses in 24 hours** (optional)
  - Both entered by the parent from the label or doctor. **No built-in medicines, presets or suggested values.**
- Records child, medicine, time, **who gave it (required)**, optional note (e.g., "5 ml").
- **Next dose after** = time given + minimum interval.
- **Warnings** (confirmation required to save, never blocked):
  - Early: "Last dose was 3h 20m ago by Sam. Minimum is 6h."
  - Over daily max: "This would be dose 5 in 24 hours. Maximum is 4." Any 24-hour window containing the dose counts, so backdated doses are checked against doses logged after them too.
- **Offline:** "Can't check whether another adult gave a dose. Log anyway?" Confirming queues the dose, marked as logged offline. If it syncs and triggers an early or over-max warning, every display shows an alert until an adult acknowledges it with their PIN.
- The app gives no dosing guidance and has no dose calculator.

**Sticker**
- Pick a category (defaults: Potty, Teeth, Tried a new food; editable in Settings).
- Saving plays the sticker celebration (animation + sound; softened with Reduce Motion; silent in Nap and Night Mode) and adds the sticker to this week's chart.

**Jot it**
- A single text field. Saves to the Inbox (Settings → Inbox: check off or delete).

**Grocery**
- A single text field; adds to the grocery list. The sheet shows the current list (tap to check off, ✕ to delete) and a **Take list** button ([7.8](#78-take-list-grocery-qr)).
- Checked items clear automatically 24 hours after being checked.

**Diaper** (only when enabled)
- Wet / Dirty / Both.

### 7.5 Kids' Corner

A full-screen, toddler-friendly mode. No text-only controls; everything is a picture, an icon or a color.

- **Opening:** tap Kids' Corner → a **child picker** (large avatars) of children with Kids' Corner enabled. With only one such child, the picker is skipped.
- A small avatar in the corner switches child (tap → picker).
- **Exit:** long-press 2 s in a corner, then adult PIN.

**Picture Schedule**
- A horizontal strip of step cards, current step enlarged.
- Each step shows an icon from Roost's **built-in illustrated icon library** (breakfast, teeth, shoes, car, nap, bath, books, bed…) or an optional parent photo, plus a label that's spoken aloud when tapped.
- The child taps a big checkmark to finish the current step: a small celebration, then the next step becomes current.
- **Routines** are ordered lists of steps (icon or photo, label, optional time) defined per child in Settings. Each weekday has a default routine; an adult can switch today's routine from Settings.
- Steps with a time become current automatically at that time if not already completed. Unfinished earlier steps are skipped, not revisited: the current step is the first unfinished step at or after the latest step whose time has passed.

**Visual Timer**
- Preset buttons: 1, 2, 5, 10 minutes.
- A large colored disc shrinks as time passes; a gentle chime plays at zero (silent in Nap and Night Mode).
- Starting is a normal tap; cancelling is a long-press.

**Sticker Chart**
- Grid for the current week (Mon–Sun, household time), one row per category.
- Stickers are awarded only through the guarded Sticker log, not by tapping the chart.
- Resets each Monday; past weeks are kept in history.

### 7.6 Sitter Mode

For times a sitter is in charge.

**Start:** Sitter Mode button → adult PIN → optional **sitter name** ("Grandma", "Jess") → Sitter Mode is on.

**While active, the main screen shows:**
- Clock, weather, kids status cards, medicine status, and the log row (Sleep, Feeding, Medicine, Sticker, plus Diaper if enabled).
- Every entry is attributed to the sitter: "Jess (sitter)", or "Sitter" if no name was given. The "Who?" row is replaced by the sitter name.
- A **Care Info** panel in place of the calendar:
  - Today's routine for each child
  - Nap and bedtime instructions
  - Food rules and allergies (from child profiles)
  - Emergency contacts, pediatrician, home address
  - "Where things are" notes (e.g., "Spare diapers: hall closet")
- **Hidden:** calendar, Jot it, Grocery, Take list, Settings.
- Sitters can undo their own non-medicine logs within 10 seconds; undoing a dose needs an adult PIN.

**Exit:** Sitter Mode button → any adult PIN → **"While You Were Out" summary**.

**If Sitter Mode is still on when Night Mode starts:** it stays on. The summary appears the next time any adult enters a PIN.

**"While You Were Out" summary** (full screen, dismissed with a tap):
- Sitter name and the time range of the session.
- Per child: sleeps (start–end, duration), feedings, medicine doses (with any warnings that were confirmed), stickers, notes.

### 7.7 Night & Nap Mode

**Night Mode**
- Scheduled (default 8:00 PM–6:00 AM household time; set in Settings).
- Shows a slow photo slideshow (one photo every 60 s) with a small, dim clock, under a dark overlay.
- Tapping shows a dimmed main screen for 60 s, then returns to the slideshow.
- All sounds silent.
- With no photos uploaded, shows only the dim clock.

**Nap Mode**
- Toggled with the moon button.
- Dims the screen and silences all sounds. **The main screen stays fully usable under the dimming** (logging "End sleep" is the most common action during a nap). Taps do not end Nap Mode; only the moon button or the automatic rules below do.
- Sticker celebrations still show during Nap Mode, silently.
- Ends automatically when every sleep entry that was open when Nap Mode started has ended, or after 3 hours, whichever comes first. If no sleep entry was open, it ends only by tapping the moon again or after 3 hours.

### 7.8 Take List (Grocery QR)

Carries the grocery list out of the kitchen without a phone app.

1. Grocery sheet → **Take list**.
2. The display shows a QR code for a private link (random token of at least 128 bits) valid for **24 hours**.
3. Scanning it opens a **simple phone checklist page**: the list's items, tap to check off. Check-offs sync back to the displays in real time.
4. The link stops working after 24 hours, when **Done shopping** is tapped (on the phone page, or **"Done shopping — end link"** on the display's QR screen), or when a new Take list link is created (only one active link per household).

The page shows **groceries only**. It never includes children's names, health data or any other household information, and it can't add or delete items.

### 7.9 Settings

Opened with an adult PIN. Sections marked 🔐 require a full sign-in ([6.3](#63-adult-sessions-on-a-display)).

- **Children:** name, birthday, color, photo, allergies, food rules, night-sleep window (defaults to household), per-feature overrides of age-based defaults
- **Routines:** per child; create and edit routines and steps (icon library or photo); default routine per weekday; switch today's routine
- **Medicines:** per child; name, minimum hours between doses, optional max doses in 24 hours
- **Stickers:** categories
- **Sitter info:** nap and bedtime instructions, emergency contacts, pediatrician, address, "where things are" notes
- **Household:** name, ZIP code / time zone, leave-by buffer, default night-sleep window, Night Mode schedule, Diaper log on/off, tonight's dinner
- **Photos:** slideshow photos (up to 200)
- **Logs:** history per child and type; edit or delete entries; void doses
- **Inbox:** jots (check off or delete)
- **My account:** my color, change my PIN, 🔐 connect/disconnect my calendars and assign each to a person, leave household
- 🔐 **Members** (Owners): add adult, change role, remove member
- 🔐 **Displays** (Owners): list with last-seen time, rename, revoke, add display
- 🔐 **Export** (Owners): request export ([11.3](#113-data-export--deletion))
- 🔐 **Delete household** (Owners)
- **About:** app version, privacy policy, terms

### 7.10 Manage Household (any browser)

- **roost.cmrd.dev/manage**, opened in any browser (laptop, borrowed phone), offers **Manage household** after a full sign-in.
- Uses the tablet layout; it isn't designed for phones, but works on them.
- **Owners:** Displays (revoke), Members (remove), Export, Delete household.
- **Adults:** My account (disconnect calendars, leave household).
- Purpose: revoke a lost or stolen display when no other display is available.

## 8. Priority 2 — Soon After (v1.1)

- **Kitchen screen:** weekly meal plan (feeds "Tonight's dinner"), full-screen grocery list, **Cook mode** (big-text recipe view, several named timers such as "Pasta 8:00" and "Oven 22:00")
- **Inbox triage:** sort jots into Task / Grocery / Done
- **Recurring household tasks:** trash day, HVAC filter, bills, car registration; each appears on the main screen when due and is checked off there
- **Sleeps-until countdown** in Kids' Corner: moons for each night until an event
- **Health card** per child: current weight, pediatrician, upcoming checkups and vaccines (extends the child profile)
- **Phone & laptop adult app:** quick home screen (last dose + log dose, grocery list, jot it), all Settings, log history
- **Dose notifications** (needs the phone app): "Sam gave Mara ibuprofen, 3:10 PM" to other adults; "Next dose allowed now" to whoever logged it; each can be turned off per adult
- **Caregiver accounts:** invite a regular nanny or grandparent with the Caregiver role; a saved list of regular sitters

## 9. Priority 3 — Later

- **Milestones & firsts:** one-tap capture with date and optional photo
- **Sizes tracker:** clothes and shoe sizes per child, with hand-me-down notes
- **Recipe library** for Cook mode
- **Guest Wi-Fi QR code**
- **Shared children across households** (co-parenting)
- **Paid plan** (billing)
- **International launch** (GDPR, other units and languages)
- **Growing-up features:** chores, allowance, school schedule for kids past the toddler years

## 10. Out of Scope

Native iOS/Android apps · open source or self-hosting · voice control · budgeting · messaging · two-way calendar editing · dose calculators, medicine presets or medical advice · ads or data sales · portrait layouts · smart displays (Echo Show, Nest Hub)

## 11. Privacy, Safety & Compliance

### 11.1 Posture

- The app logs children's medicine, sleep and feeding and connects to calendars, so it's treated as covered by the **FTC Health Breach Notification Rule**, and **Washington My Health My Data, Nevada and Connecticut** consumer health data laws.
- **No advertising, analytics or tracking SDKs** in the app. Sharing health-related data with such a vendor would itself count as a breach under the FTC rule.
- **Explicit consent** to store health data, recorded per user with policy version and time.
- **Written breach-response plan** (who is notified, within 60 days, FTC notice thresholds) in place before the first outside family.
- **COPPA:** children never create accounts or type personal information. Kids' Corner collects nothing beyond step completion, and runs only on a registered household display with no third-party SDKs.
- **Children's photos:** resized on the device to a maximum of 1600 px, with location and other metadata stripped before upload; stored in a private, per-household Supabase Storage bucket; served through short-lived signed URLs.

### 11.2 Data Retention

- Household data is kept until a person deletes it. No automatic deletion of logs.
- Logs older than 2 years can be exported and bulk-deleted from Settings → Logs.
- **Calendar event data is never stored** ([5.5](#55-calendar-integration)).
- Take list links expire after 24 hours; the token is deleted when it expires.

### 11.3 Data Export & Deletion

- **Export** (Owner, full sign-in): an email goes to the Owner's account address with a download link that works for 24 hours and **requires signing in again**. Contents: one CSV per log type, plus a complete JSON export including photos.
- **Delete household** (Owner, full sign-in, typed confirmation): immediately revokes all displays and calendar connections. All data, photos and tokens are purged within **30 days, including backups**.
- **Leaving a household:** the member's calendars disconnect; their entries stay, attributed as former member.

### 11.4 Medicine Safety Rules (summary)

- Timing and counting only; parents enter all intervals and maximums, per child.
- Dose logging requires choosing who gave it.
- Early and over-max warnings require confirmation.
- Offline dose logging requires confirmation and raises an alert on sync if it conflicts.
- Doses are never deleted, only voided with a reason.

## 12. Data Model

All household-owned tables are scoped to a household, directly through `householdId` or through `childId` → ChildHousehold; row-level security limits every read and write to members and displays of that household.

| Entity | Key fields |
|---|---|
| **Household** | id, name, timeZone, lat, lon, zip, plan (`free`), createdAt, deletedAt |
| **InviteCode** | code, usedByHouseholdId, usedAt |
| **User** | id (Supabase Auth), email, displayName |
| **Membership** | id, userId, householdId, role (owner/adult/caregiver), color, pinHash, joinedAt, leftAt |
| **ConsentRecord** | id, userId, policyVersion, healthDataConsent, acceptedAt |
| **Display** | id, householdId, name, credentialHash, lastSeenAt, revokedAt |
| **Child** | id, name, birthday, color, photoId, allergies, foodRules, nightSleepStart, nightSleepEnd (both nullable → household default) |
| **ChildHousehold** | childId, householdId |
| **FeatureOverride** | childId, feature, enabled |
| **CalendarConnection** | id, membershipId, provider (google/microsoft/ics), vaultSecretId, status |
| **CalendarSelection** | id, connectionId, externalCalendarId, assignedMembershipId or assignedChildId, visible |
| **SleepEntry** | id, childId, start, end (nullable), type (nap/night), attribution* |
| **FeedingEntry** | id, childId, time, type (milk/meal/snack), amount, note, attribution* |
| **Medicine** | id, childId, name, minIntervalHours, maxDosesPer24h (nullable) |
| **DoseEntry** | id, childId, medicineId, time, note, loggedOffline, warningsConfirmed[], conflictAcknowledgedAt, conflictAcknowledgedBy, voidedAt, voidedBy, voidReason, attribution* |
| **StickerCategory** | id, householdId, name, iconKey |
| **StickerEntry** | id, childId, categoryId, time, attribution* |
| **DiaperEntry** | id, childId, time, kind (wet/dirty/both), attribution* |
| **Routine** | id, childId, name, weekdays[], steps[] (iconKey or photoId, label, optional time) |
| **RoutineProgress** | date, childId, routineId, completedStepIndexes[] |
| **Jot** | id, householdId, text, createdAt, doneAt, attribution* |
| **GroceryItem** | id, householdId, text, createdAt, checkedAt, attribution* |
| **TakeListLink** | id, householdId, tokenHash, expiresAt, revokedAt |
| **SitterSession** | id, householdId, displayId, sitterName, start, end, summaryShownAt |
| **HouseholdSettings** | householdId, leaveByBufferMin, defaultNightSleepStart/End, nightModeStart/End, diaperLogEnabled, dinnerTonight, sitterInfo |
| **Photo** | id, householdId, storagePath, kind (avatar/step/slideshow), addedAt |
| **SettingsAudit** | id, householdId, membershipId, change, at |

\* **attribution** = `id` generated on the device (makes offline replay idempotent), `displayId`, `loggedByMembershipId` (nullable), `sitterSessionId` (nullable).

## 13. Offline & Error States

| Situation | Behavior |
|---|---|
| **Network lost** | Keep working from local data. Sleep, feeding, sticker, diaper, jot and grocery entries queue locally (IndexedDB) and sync when back online. Small "Offline" badge in the header |
| **Medicine while offline** | "Can't check whether another adult gave a dose. Log anyway?" Confirmed doses queue with `loggedOffline`; conflicts found on sync raise an alert on all displays until an adult acknowledges it with their PIN |
| **Realtime disconnected** | Reconnect on the 30-min version check or on the next touch; show "Updated 2 min ago" only when data is more than 5 min old |
| **Calendar not refreshed in >30 min** | "Calendar updated 45 min ago" under the Today zone |
| **Calendar auth expired** | That adult's events are hidden; Today zone shows "Sam's calendar needs reconnecting" |
| **Weather unavailable** | Hide weather; the clock and date remain |
| **Display revoked** | The display shows "This display was removed from the household" and the Welcome screen |
| **Take list link expired** | The phone page shows "This list has expired. Ask for a new one at home." |
| **Sync conflict** (same entry edited on two displays) | Last write wins; doses are append-only (void instead of edit), so they never conflict |
| **Empty states** | Wake window: "Log wake-up". Medicine zone hidden. Calendar: "Nothing else today". Sticker chart: empty grid with a friendly illustration. Night Mode with no photos: dim clock only |

## 14. Testing

**v1 (household #1)**
- **Vitest** unit tests for pure logic:
  - Wake window (no sleep today, sleeping now, multiple naps)
  - Night vs. nap classification at boundaries, in household time
  - Next-dose-after, early warning, over-daily-max warning, offline dose conflict detection
  - Age-based defaults (birthday boundary days, overrides)
  - Routine selection by weekday, manual override, timed auto-advance
  - Weekly sticker reset, DST changes
  - Leave-by countdown (location required, within 2 h)
  - Sitter summary aggregation (session range, Night Mode carry-over)
  - Offline queue replay (idempotent device-generated IDs)
  - Take list link expiry and revocation
- **Manual checklist** on the real iPad:
  - Readability from about 3 m
  - Long-press guard resists quick taps and swipes
  - Sound after first tap; silent in Nap and Night Mode
  - Smooth performance on the device
  - Standalone fullscreen launch, Guided Access
  - Version-check reload happens only when idle

**Before the first outside family** ([15](#15-launch-gate--before-the-first-outside-family)):
- SQL tests for row-level security: one household can never read or write another's data; a revoked display can't read anything; a Take list token can read only groceries.
- Playwright end-to-end tests at 1024×768, 1112×834 and 1366×1024: setup → log → medicine warning → Sitter Mode → summary → Take list.
- Device check on a Fire tablet with Fully Kiosk Browser.

## 15. Launch Gate — Before the First Outside Family

1. Google OAuth app published to Production and **verified**
2. Microsoft 365/Outlook and ICS calendar support
3. Row-level security SQL tests, Playwright suite, Fire tablet check ([14](#14-testing))
4. Point-in-time recovery enabled and **one test restore** completed
5. Lawyer-reviewed privacy policy and terms; written breach-response plan
6. Trademark clearance search for "Roost Family"
7. Invite codes enabled; per-household limits enforced

## 16. Revision History

### Revision 3: reconciled with Claude Design v2

| Revision 2 | Revision 3 |
|---|---|
| One household medicine list | Medicines defined **per child** |
| One household night-sleep boundary | **Per-child** night-sleep window, defaulting to a household window |
| Brand and domain unspecified | Logo 1A "Gable", accent `#E2703A`, Outfit typeface; domain **roost.cmrd.dev** (originally roost.family) |
| All main-screen text ≥ 24 pt | Tiered: glanceable ≥ 24 pt, secondary ≥ 18 pt, nothing < 16 pt |
| All touch targets ≥ 60 pt | Tiered: 60 pt on in-the-moment surfaces, 44 pt on Settings, wizard, Join, Manage household |
| Person colors unspecified | Dedicated 10-color person palette, separate from log-button colors |
| "High-contrast" | WCAG AA contrast; deep accent variants for text |
| "Who?" row on every log | Kid logs only; jots and groceries attributed to the display |
| Nap Mode behavior under taps unspecified | Dim but fully usable; only the moon or automatic rules end it; sticker celebrations shown silently |
| — | Added from the design: grocery ✕ delete and 24-hour auto-clear of checked items, "Done shopping — end link" on the display, PIN to acknowledge a dose-conflict alert, 6-box invite code |

**Design gaps:** screens and states the v2 design doesn't show (email-code entry, Diaper sheet body, empty/error/stale states, Add-adult flow, Manage household Members and My account panes, per-child routines and age overrides in Settings, voided doses, Night Mode tap-to-peek) are built from this spec using the v2 design system. Claude Design is asked only for final routine icon artwork (`docs/design/2026-09-14-claude-design-update-2.md`).

### Revision 2: multi-household product

| Revision 1 | Revision 2 |
|---|---|
| Single household, no accounts, one PIN | Multi-household product: users, memberships, Owner/Adult/Caregiver roles, per-adult PINs, device-registered displays |
| Older iPad Pro only | Any modern tablet; older iPad Pro is the performance floor |
| Small phone page (medicine, groceries, jots) | Removed for v1. Replaced by Take list QR; phone app moved to v1.1 |
| Leona's Corner | Kids' Corner with child picker |
| Features hard-wired to Leona and Mara | Age-based defaults with per-child overrides; up to 4 full kid cards |
| Entries tagged "caregiver" | "Who?" attribution (required for medicine); named sitter |
| Medicine: minimum interval; phone blocked offline dose logging | Adds optional max doses per 24 h; offline dose logging on any display requires confirmation; doses voided, never deleted |
| Photos chosen from the iPad library | Resized, metadata stripped, private storage, 200-photo cap; built-in routine icon library |
| Settings on the iPad | Settings on the display with adult PIN; sensitive actions need full sign-in; Manage household from any browser |
| Stack left to the plan | Supabase + Vue 3 installable web app on Netlify; dev/prod; Supabase Pro |
| Calendar: Google, connection unspecified | Per-adult connections, server-side proxy, events never stored |
| Testing: broad automated list | Unit tests + manual now; RLS, Playwright and Fire checks before launch |

## 17. Screen List for Claude Design

**Display (tablet, landscape)**
1. **Setup wizard:** welcome, invite code, sign in (Apple / Google / email code entry), consent, household, kids, you (color + PIN), calendar, another adult, name this display + screen-on tip
2. **Main screen:** 2 kids (normal), medicine-active state, 5+ kids compact cards, offline badge
3. **Log sheets:** Sleep, Feeding, Medicine (with "Who?" row, early warning, over-max warning, offline confirmation), Sticker (with celebration), Jot it, Grocery (with list + Take list button), Diaper
4. **Toddler guard:** long-press fill ring, adult avatar + PIN pad, Undo toast, dose conflict alert
5. **Kids' Corner:** child picker, Picture Schedule, Visual Timer (running), Sticker Chart
6. **Routine icon library:** illustrated icon set for routine steps (design deliverable)
7. **Sitter Mode:** start (PIN + sitter name), main screen with Care Info panel, "While You Were Out" summary
8. **Night Mode** slideshow and **Nap Mode** dimmed main screen
9. **Settings:** section list, Routines editor, Medicines editor (with max per 24 h), Members (add adult flow), Displays, My account (calendar assignment), Export, Delete household
10. **Join a household** flow for an additional display; **display revoked** screen

**Phone**
11. **Take list page:** checklist, Done shopping, expired state

**Any browser**
12. **Manage household:** sign-in, displays, members, my account

**Design rules to apply everywhere:** avatar always paired with color · tiered text sizes and touch targets ([4](#4-design-principles)) · WCAG AA contrast · separate person palette · Reduce Motion variants for celebrations · color-blind-safe palette in day and Night Mode

**Status:** Screens 1–12 are designed in `docs/design/handoff/project/Roost Family App v2.dc.html`, with the gaps listed in [16](#16-revision-history). Final illustrated routine icons are pending from Claude Design.
