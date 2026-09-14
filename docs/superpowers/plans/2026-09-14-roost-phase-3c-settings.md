# Roost Phase 3c: Settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adults can configure the household from the tablet: household settings, sitter info, children (with age-based feature overrides and night-sleep windows), routines (with today's override), medicines, sticker categories, log history, inbox, their own account, and — with a full sign-in — members, displays and household deletion.

**Architecture:** Every configuration write goes through a PIN-checked (or owner-sign-in-checked) security-definer RPC that also appends to `settings_audit`. The app keeps a short-lived **settings session** (verified membership + PIN in memory, ends after 5 minutes idle or on leaving Settings). A `SettingsApi` interface has Supabase and demo implementations; screens call it directly (configuration changes are online-only and not queued) and rely on realtime reloads for fresh data. Sensitive sections use the Phase 1 temporary adult client.

**Spec:** `docs/superpowers/specs/2026-09-14-roost-design.md` §4 (deliberate surfaces: 44 pt targets), §6.2–§6.4 (roles, adult sessions, adding adults/displays), §7.2 (age defaults), §7.5 (routines), §7.9 (Settings), §11.2–§11.3 (retention, deletion).
**Design reference:** `docs/design/handoff/project/Roost Family App v2.dc.html` lines ~598–826 (Settings).

**Deferred to Phase 4:** Photos (storage), Export, calendar connections in My account, Manage household page.

## Contents

- [Decisions](#decisions)
- [RPC catalogue](#rpc-catalogue)
- [File structure](#file-structure)
- Tasks 1–9

## Decisions

| Topic | Decision |
|---|---|
| Entering Settings | Header gear → adult PIN pad → `/settings`. Sitter Mode hides the gear. |
| Settings session | `{ membershipId, displayName, role, pin }` in memory; 5-minute idle (reuse `startIdleTimer`) or navigating away ends it; Night Mode starting ends it |
| PIN in RPC args | Every config RPC takes `p_membership_id, p_pin` and verifies server-side (`private.pin_ok`). Nothing trusts the UI |
| Sensitive sections | Members, Displays, Delete household: require a **full sign-in** of an **owner** on the temporary adult client (spec §6.3); PIN session alone is not enough |
| Adding an adult | Owner full sign-in → create invite (10-minute token) → owner session ends → new adult signs in on the tablet → accepts invite (name, color, PIN). Same device, two sign-ins |
| Deleting a household | Owner full sign-in + type the household name → `deleted_at` set, displays revoked immediately; `private.purge_deleted_households()` hard-deletes after 30 days (scheduled via `pg_cron` when available; documented) |
| Edits to logs | Non-dose entries: edit time/amount/type and delete via existing member-writable tables (PIN session required in UI). Doses: void only (`void_dose`) |
| Offline | Settings shows "Connect to change settings" and disables saves when offline |
| Audit | Each RPC inserts `{ section, action, target_id, fields }` JSON into `settings_audit` |

## RPC catalogue

All `security definer`, `search_path = ''`, `revoke … from public, anon`, `grant execute … to authenticated`. `(M, P)` = `p_membership_id uuid, p_pin text` verified against the target household with role owner/adult.

| RPC | Purpose |
|---|---|
| `settings_verify(M, P) returns table(out_role text, out_display_name text)` | Enter Settings (also returns role) |
| `update_household_settings(M, P, p_name, p_zip, p_time_zone, p_leave_by_buffer_min int, p_default_night_start time, p_default_night_end time, p_night_mode_start time, p_night_mode_end time, p_diaper_log_enabled bool)` | Household section |
| `update_sitter_info(M, P, p_info jsonb)` | Only known string keys, each ≤ 1000 chars |
| `add_child_pin(M, P, p_name, p_birthday date, p_color)` | Add child from Settings (8-child limit, lock household row) |
| `update_child(M, P, p_child_id, p_name, p_birthday, p_color, p_allergies, p_food_rules, p_night_start time, p_night_end time)` | Children section (both night fields null or both set) |
| `set_feature_override(M, P, p_child_id, p_feature text, p_enabled boolean /* null = clear */)` | Overrides |
| `upsert_routine(M, P, p_routine_id uuid /* null = new */, p_child_id, p_name, p_weekdays smallint[], p_steps jsonb) returns uuid` | Validate steps: array ≤ 20 items of `{iconKey: text|null, photoId: uuid|null, label: 1–40 chars, time: 'HH:MM'|null}` |
| `delete_routine(M, P, p_routine_id)` | Removes progress/overrides by cascade |
| `set_routine_day_override(M, P, p_child_id, p_day date, p_routine_id uuid /* null = clear */)` | "Switch today's routine" |
| `upsert_medicine(M, P, p_medicine_id /* null = new */, p_child_id, p_name, p_min_interval_hours numeric, p_max_doses_per_24h int) returns uuid` | Child cannot change on update |
| `archive_medicine(M, P, p_medicine_id)` | Sets `archived_at` |
| `upsert_sticker_category(M, P, p_category_id, p_name, p_icon_key, p_sort_order int) returns uuid` / `archive_sticker_category(M, P, p_category_id)` | Stickers section |
| `set_my_color(M, P, p_color)` | My account |
| `leave_household(p_household_id)` (full sign-in) | Refuses for the last owner |
| `create_member_invite(p_household_id, p_role text) returns table(out_token text, out_expires_at timestamptz)` (owner full sign-in) | Store hashed token in new table `member_invites (id, household_id, role, token_hash unique, expires_at, created_by, used_at)` (RLS on, no policies) |
| `accept_member_invite(p_token, p_display_name, p_color, p_pin) returns uuid` (new adult full sign-in; requires consent record) | Creates membership + PIN; rejects existing member, expired/used token |
| `set_member_role(p_membership_id, p_role)` / `remove_member(p_membership_id)` (owner full sign-in) | Last-owner protection; removal sets `left_at` |
| `rename_display(p_display_id, p_name)` (owner full sign-in) | |
| `delete_household(p_household_id, p_confirm_name text)` (owner full sign-in) | Soft delete + revoke displays + end memberships' access (`is_household_member` already ignores deleted) |
| `private.purge_deleted_households()` | Hard delete households with `deleted_at < now() − 30 days`; not callable by clients |

## File structure

```
supabase/migrations/20260914000003_settings.sql     all Settings RPCs + member_invites (new migration)
supabase/manual-checks/rls_smoke.sql                 settings checks
src/data/settingsApi.ts                              SettingsApi interface + error type
src/data/supabaseSettingsApi.ts                      (+ test with fake client)
src/data/demo/demoSettingsApi.ts                     mutates the demo household (+ test)
src/stores/settingsSession.ts                        PIN session with idle expiry (+ test)
src/features/settings/
  SettingsShell.vue          nav + section outlet + offline banner + exit
  settingsNav.ts             sections, owner-only flags (+ test)
  sections/HouseholdSection.vue  SitterInfoSection.vue  ChildrenSection.vue  MedicinesSection.vue
  sections/StickersSection.vue   RoutinesSection.vue    RoutineEditor.vue    LogsSection.vue
  sections/InboxSection.vue      MyAccountSection.vue   MembersSection.vue   DisplaysSection.vue
  sections/DeleteHouseholdSection.vue  AboutSection.vue
  forms/                      small reusable field components (TimeField, WeekdayPicker, ColorPicker, IconPicker, TriStateToggle)
  settings.test.ts            per-section tests
src/router.ts                /settings (requires registered + settings session, else PIN prompt on main)
src/features/main/MainScreen.vue   gear → PIN → /settings
```

---

### Task 1: Configuration RPCs (database)

New migration `supabase/migrations/20260914000003_settings.sql` with every PIN-checked RPC in the catalogue (household, sitter info, children, overrides, routines, day overrides, medicines, stickers, my color, settings_verify) and the audit writes. Reuse `private.pin_ok`, `private.child_in_my_household`, `private.is_household_member`. Validation errors use SQLSTATE `22023` with human-readable messages; auth failures `42501`. Extend `rls_smoke.sql` with a labelled check per RPC (success with right PIN, `42501` with wrong PIN, `42501` from another household, `22023` for invalid input, audit row written). `supabase db reset`, smoke passes, `pnpm db:types`.
Commit — `feat(db): PIN-checked settings RPCs with audit`

### Task 2: Membership, display and deletion RPCs (database)

Same migration: `member_invites` table, `create_member_invite`, `accept_member_invite`, `set_member_role`, `remove_member`, `leave_household`, `rename_display`, `delete_household`, `private.purge_deleted_households`. Smoke checks: invite create (owner only), accept (consent required, expiry, reuse rejected, existing member rejected), role change and last-owner protection, removal hides household from the removed user, rename by owner only, delete requires matching name and immediately revokes displays and hides the household from members, purge removes only households past 30 days (simulate by setting `deleted_at`). Regenerate types.
Commit — `feat(db): member invites, roles, display rename and household deletion`

### Task 3: Settings API, demo API, settings session

- `SettingsApi` interface mirrors the catalogue with camelCase methods taking a `SettingsAuth { membershipId, pin }` for PIN RPCs, and an `AdultClient` for full-sign-in RPCs; errors map to `SettingsError(message, code: 'auth' | 'invalid' | 'network' | 'other')`.
- Supabase implementation (fake-client tests for every method: RPC name + args mapping + error mapping). Demo implementation mutates `demoHousehold` (PINs Sam 1234 / Alex 5678; full-sign-in methods throw `SettingsError('Not available in demo', 'other')` except rename/role changes which mutate).
- `settingsSession` store: `enter(membershipId, pin)` calls `settingsVerify`; `auth` getter; `end()`; idle timer 5 min; ends on `modes.nightActive` turning true. Tests with fake timers.
- `selectSettingsApi()` in `householdSource.ts`.
Commit — `feat(settings): settings API, demo API and PIN session`

### Task 4: Settings shell, routing, Household, Sitter info, About

- Gear button (60 px) → `RLongPress` 600 ms → `RPinPad` "Open Settings" → `settingsSession.enter` → `router.push('/settings')`. `/settings` guard: requires registered display and an active settings session, else redirect `/home`.
- **Shell** (deliberate surface: 44 pt minimum targets; text ≥ 18 px): left nav (240 px) listing sections from `settingsNav.ts` (Household, Children, Routines, Medicines, Stickers, Sitter info, Logs, Inbox, My account, Members 🔐, Displays 🔐, Delete household 🔐, About); owner-only sections shown with a lock icon and "Requires owner sign-in" subtitle; top bar: "Settings" title 32 px, signed-in adult avatar + name, "Done" (44 px) returning to `/home` and ending the session; an offline banner disables all Save buttons.
- **Household:** name, ZIP, time zone (reuse the curated list), leave-by buffer (± 5 stepper 0–120), default night-sleep window (two `TimeField`s), Night Mode schedule (two `TimeField`s), Diaper log toggle; Save (primary) with inline validation errors and a success toast "Saved".
- **Sitter info:** textareas for the seven `SitterInfo` keys with labels matching the Care Info panel; Save.
- **About:** app version (inject `__APP_VERSION__` via Vite `define` from package.json version + short git sha if available at build), privacy policy and terms placeholders (links to `/privacy` and `/terms` routes rendering "Coming before launch").
- Tests: PIN gate; idle expiry returns to `/home`; household save calls API with parsed fields; validation messages; offline disables save.
Commit — `feat(settings): settings shell with household, sitter info and about`

### Task 5: Children, Medicines, Stickers

- **Children:** list with avatar + name + age; "Add child" (name, birthday, color) → `add_child_pin`; edit panel: name, birthday, color (`ColorPicker` over `PERSON_COLORS` with names), allergies, food rules, night-sleep window (toggle "Use household default" or two time fields), feature overrides as tri-state rows (Default (On/Off per age) / On / Off) for Wake window & sleep log, Feeding, Kids' Corner, Diaper (only when household diaper log is on) showing the computed default from `isFeatureEnabled` with no overrides.
- **Medicines:** per child tabs; list with "Every 6h · max 4/day"; add/edit (name, min interval hours 0.5–72 step 0.5, optional max doses 1–24), archive with confirm; banner text "Enter intervals and maximums from the label or your doctor. Roost Family doesn't give dosing advice."
- **Stickers:** list categories with icon (`IconPicker` over routine icon keys) + name, add/edit/archive, reorder with up/down buttons (updates sort order).
- Tests for each form's API calls and validation.
Commit — `feat(settings): children, medicines and sticker categories`

### Task 6: Routines editor

- Per-child list of routines with weekday chips summary; "Switch today's routine" select (routines for that child + "Use the weekday default") → `set_routine_day_override` for today (household date).
- **RoutineEditor:** name; weekday picker (Sun–Sat chips, multi-select; warn if another routine of the child already has a selected weekday: "Weekend already uses Saturday — the first routine wins"); steps list: each row = icon (`IconPicker`), label (≤ 40), optional time (`TimeField` with "No time" toggle), move up/down, remove; "Add step"; ≤ 20 steps; Save → `upsert_routine`; Delete routine with confirm. Warn (not block) when timed steps are out of chronological order.
- Tests: create/edit/delete; override set/clear; weekday conflict warning; step reorder produces the right JSON.
Commit — `feat(settings): routines editor and today's routine switch`

### Task 7: Logs history, Inbox, My account

- **Logs:** filters: child, type (Sleep, Feeding, Medicine, Sticker, Diaper), day (today, yesterday, pick date within the loaded window — load more via a paged query `householdSource`-independent: `SettingsApi.listEntries({ table, childId, before, limit: 50 })` reading directly from the table with the display client). Rows show time, details, `logged_by_name`. Non-dose: edit time (and type/amount for feeding, kind for diaper, end time for sleep) and delete with confirm. Dose: "Void" → reason (required, ≤ 200) → `void_dose` using the settings session's membership + PIN; voided doses struck through with reason. "Delete logs older than 2 years" (per type) with confirm — calls a new PIN RPC `delete_old_entries(M, P, p_table, p_before)` (add it in this task's migration edit if not in Task 1; doses excluded).
- **Inbox:** open jots (newest first) with check (done) and delete; done jots in the last 7 days collapsed.
- **My account:** my color (`set_my_color`); "Change my PIN" → full sign-in on the adult client → new PIN twice → `set_my_pin`; "Leave household" → full sign-in → `leave_household` (disabled for the last owner with explanation).
- Tests.
Commit — `feat(settings): logs history, inbox and my account`

### Task 8: Members, Displays, Delete household (owner full sign-in)

- Entering any of these sections shows "Sign in as an owner" using `SignInStep`-style email code on a temporary adult client (reuse `newAdultClient`, `sendEmailCode`, `verifyEmailCode`, `useAdultSessionIdle`); non-owners see "Only an owner can manage this."
- **Members:** list (avatar, name, role, joined date); change role (Owner/Adult) with last-owner protection message; remove with confirm; "Add adult": choose role → `create_member_invite` → owner session ends → screen "Hand the tablet to the new adult" → new adult signs in (email code) → consent step (reuse ConsentStep) → name, color, PIN twice → `accept_member_invite` → session ends → back to Members (settings session stays with the original PIN adult).
- **Displays:** list (name, last seen relative, "This display" badge); rename; revoke with confirm (revoking this display → routes to `/removed`); "Add a display" explains the Join a household flow on the new tablet.
- **Delete household:** explanation of what's deleted and the 30-day purge; type the household name; `delete_household` → device cache + queue cleared → `/removed`.
- Tests with fake adult client and API.
Commit — `feat(settings): members, displays and household deletion`

### Task 9: Verify

`pnpm test`, `pnpm typecheck`, `pnpm build`; smoke passes. **Controller:** on local Supabase: enter Settings with PIN; change Night Mode schedule (Night Mode reacts); edit Ivy's routine (add "Wash hands" step) → Kids' Corner shows it; add a medicine for Theo → Medicine sheet lists it; set Ivy's Kids' Corner override Off → Kids' Corner button shows empty state; void a dose from Logs; add adult "Pat" via invite with a new email; rename display; idle 5 min → back to main (use fake clock check via short override in dev tools or trust tests).
