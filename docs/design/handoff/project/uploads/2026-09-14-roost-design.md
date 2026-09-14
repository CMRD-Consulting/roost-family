# Roost — Design Spec

**Date:** 2026-09-14
**Status:** Approved feature set, ready for visual design (Claude Design)

## Table of Contents

1. [Summary](#1-summary)
2. [Household & Context](#2-household--context)
3. [Design Principles](#3-design-principles)
4. [Device & Platform Constraints](#4-device--platform-constraints)
5. [Priority 1 — Core (v1)](#5-priority-1--core-v1)
   - 5.1 [Main Screen](#51-main-screen)
   - 5.2 [Toddler Guard](#52-toddler-guard)
   - 5.3 [Logs](#53-logs)
   - 5.4 [Leona's Corner](#54-leonas-corner)
   - 5.5 [Sitter Mode](#55-sitter-mode)
   - 5.6 [Phone Page](#56-phone-page)
   - 5.7 [Night & Nap Mode](#57-night--nap-mode)
   - 5.8 [Settings](#58-settings)
6. [Priority 2 — Soon After (v1.1)](#6-priority-2--soon-after-v11)
7. [Priority 3 — Later](#7-priority-3--later)
8. [Out of Scope](#8-out-of-scope)
9. [Data Model](#9-data-model)
10. [Offline & Error States](#10-offline--error-states)
11. [Screen List for Claude Design](#11-screen-list-for-claude-design)
12. [Testing](#12-testing)

---

## 1. Summary

**Roost** is a fullscreen web app for an older iPad Pro mounted in the kitchen. It organizes a solo parent's household with two toddlers: it shows the day at a glance, lets the parent log naps, feedings and medicine with one tap, gives the 3-year-old a picture-based routine space, and hands off cleanly to a caregiver. A small phone page covers the three things needed away from the kitchen: medicine, groceries and quick notes.

## 2. Household & Context

| Person | Details | What the app does for them |
|---|---|---|
| **Parent** (primary user) | Only regular adult user | Calendar, logs, planning, settings |
| **Leona** | Born May 23, 2023 (age 3) | Picture schedule, visual timer, sticker chart |
| **Mara** | Born May 24, 2025 (age 1) | Wake window, nap and feeding logs |
| **Caregiver** (nanny or family member, some days) | No account | Uses Sitter Mode |

- **Typical weekday:** home with the parent most days; a caregiver watches the girls on some days.
- **Calendar:** Google Calendar, read-only.

## 3. Design Principles

1. **Glanceable first.** The main screen must be readable in about 2 seconds from about 3 m (10 ft). Primary numbers (clock, wake window, last dose) are large; secondary information is visibly secondary.
2. **One tap to log.** The most common actions (sleep, feeding, medicine, sticker, jot) start from the main screen, never from a menu. The parent is often holding a child.
3. **Big targets, messy hands.** Minimum touch target 60×60 pt; primary log buttons at least 88 pt tall.
4. **Toddler-proof.** Nothing that changes data can happen from a single accidental tap (see [5.2](#52-toddler-guard)).
5. **Calm, warm, high-contrast.** It lives in a home, not an office. Each child has a consistent color used everywhere. Playfulness is reserved for Leona's Corner.
6. **Lightweight.** Minimal animation outside Leona's Corner; the hardware is old.

## 4. Device & Platform Constraints

- **Device:** older iPad Pro (exact model to be confirmed), landscape, wall- or counter-mounted out of Mara's reach.
- **Layout sizes:** design primarily at **1112×834 pt** (10.5"); layouts must also work at **1024×768 pt** (9.7") and **1366×1024 pt** (12.9").
- **OS ceiling:** iPadOS 16 or 17, depending on model. Target Safari 16.0 features; don't rely on web push or the Screen Wake Lock API.
- **Fullscreen:** installed via "Add to Home Screen" (standalone web app), locked to the app with Guided Access; iPad Auto-Lock set to Never.
- **Audio:** Safari requires a user gesture before playing sound. The app unlocks audio on the first tap after launch so timer chimes and sticker sounds work.
- **Sync:** the iPad and phone page share data through a small backend. Choosing the stack is left to the implementation plan.
- **Calendar:** Google Calendar OAuth, read-only scope.

## 5. Priority 1 — Core (v1)

### 5.1 Main Screen

The default, always-on view. Zones, in order of visual weight:

| Zone | Content | Behavior |
|---|---|---|
| **Header** | Clock (largest element), date, weather (current temp, high/low, chance of rain) | Weather refreshes every 30 min |
| **Kids status** | One card per child in her color. **Mara:** "Awake 2h 40m" or "Sleeping 45m", plus last feeding ("Milk 1h 10m ago"). **Leona:** Now → Next picture card; also awake/sleeping if she has a sleep entry today | Updates every minute |
| **Medicine** | Shown only when a dose was logged in the last 24 h: "Mara · Ibuprofen · given 3:10 PM · next after 9:10 PM" | Next-dose time turns green when that time has passed. Hidden when there are no recent doses |
| **Today** | Google Calendar events from now through end of day, color-coded by calendar. Events with a location in the next 2 h show "Leave in 25 min" | Leave-by = event start − buffer (default 20 min, set in Settings). Refreshes every 5 min |
| **Tonight's dinner** | Free-text line, e.g. "Tacos" | Long-press to edit. Replaced by the meal plan in v1.1 |
| **Log row** | Buttons: **Sleep** · **Feeding** · **Medicine** · **Sticker** · **Jot it** · **Grocery** | Each opens its log sheet (see [5.3](#53-logs)) |
| **Mode controls** (small, corner) | Nap Mode (moon), Leona's Corner, Sitter Mode, Settings (gear) | See the sections for each mode |

> **Scope note:** a minimal **Grocery** add button was added to the v1 iPad log row. It writes to the same list as the phone page, since the kitchen is where you notice you're out of something. The full grocery and meal-plan screen stays in v1.1.

### 5.2 Toddler Guard

| Action | Protection |
|---|---|
| Open a log sheet from the main screen | **Long-press, 0.6 s**, with a fill-ring progress indicator |
| Save a log entry inside a sheet | Normal tap (the sheet is already guarded) |
| Undo the last log | Normal tap on an "Undo" toast, visible for 10 s after any save |
| Edit or delete a past entry | Long-press on the entry, then confirm |
| Open Settings, exit Sitter Mode, exit Leona's Corner | **4-digit PIN** (exiting Leona's Corner: long-press 2 s, then PIN) |

### 5.3 Logs

All log sheets are modal overlays on the main screen with a large child picker (Leona / Mara, in their colors) and a time field that defaults to now and can be adjusted in 5-minute steps.

**Sleep** (both girls)
- One button toggles: "Start sleep" → "End sleep" per child.
- Type is automatic: a sleep starting between **6:00 PM and 5:00 AM** is *Night*, otherwise *Nap* (boundaries set in Settings). The type can be changed manually in the sheet.
- **Wake window** = time since the most recent sleep ended. With no sleep logged today, the card shows "Log wake-up" instead of a number.

**Feeding** (Mara; available for Leona but not on her card)
- Type: Milk / Meal / Snack.
- Optional amount (oz for milk; "a little / some / all" for meals).
- Optional note.

**Medicine** (both girls)
- Pick the medicine from a list managed in Settings. Each medicine has a name and a **minimum hours between doses** entered by the parent from the label or pediatrician.
- Records child, medicine, time given, optional note (e.g., "5 ml").
- **Next dose after** = time given + minimum interval.
- If a dose is logged before the next-dose time, the sheet shows a warning: "Last dose was 3h 20m ago. Minimum is 6h." The parent can still save.
- The app gives no dosing guidance and has no dose calculator.

**Sticker** (Leona)
- Pick a category (defaults: Potty, Teeth, Tried a new food; editable in Settings).
- Saving plays the sticker celebration (animation + sound, suppressed in Nap Mode) and adds the sticker to this week's chart.

**Jot it**
- A single text field with a large keyboard-ready input. Saves to the Inbox.
- v1 Inbox is a simple list (in Settings → Inbox, and on the phone page): check off or delete. Sorting into categories arrives in v1.1.

**Grocery**
- A single text field; saves to the shared grocery list.

**Diaper** (optional, off by default in Settings)
- Wet / Dirty / Both. Shown in the log row only when enabled.

### 5.4 Leona's Corner

A full-screen, toddler-friendly mode. No text-only controls; everything is a picture, an icon or a color. Exit: long-press 2 s in a corner, then PIN.

**Picture Schedule**
- A horizontal strip of step cards (photo or illustration + short label read aloud when tapped), with the current step enlarged.
- Leona taps a big checkmark to finish the current step: a small celebration, then the next step becomes current.
- **Routines** are defined in Settings as ordered lists of steps (icon/photo, label, optional time). Several routines can exist (e.g., "Home day", "Caregiver day", "Weekend"); each weekday is assigned a default routine, and the parent can switch today's routine in Settings.
- Steps with a time become current automatically at that time if not already completed.

**Visual Timer**
- Preset buttons: 1, 2, 5, 10 minutes.
- A large colored disc shrinks as time passes; a gentle chime plays at zero (silent in Nap Mode).
- Starting a timer is a normal tap (low risk); cancelling is a long-press.

**Sticker Chart**
- Grid for the current week (Mon–Sun) with a row per sticker category.
- Stickers are awarded only through the guarded Sticker log (5.3), not by Leona tapping the chart.
- The chart resets each Monday; past weeks are kept in history.

### 5.5 Sitter Mode

For days a caregiver is in charge. Entered from the main screen's mode controls with a long-press; exited with the PIN.

**While active, the main screen shows:**
- Clock, weather, kids status cards, medicine status and the log row (Sleep, Feeding, Medicine, Sticker). All entries are tagged **"caregiver"**.
- A **Care Info** panel in place of the calendar:
  - Today's routine for each child
  - Nap and bedtime instructions
  - Food rules and allergies (from the child profiles)
  - Emergency contacts, pediatrician, home address
  - "Where things are" notes (e.g., "Spare diapers: hall closet")
- **Hidden:** Google Calendar, Jot it, Grocery, Inbox, Settings.

**On exit — "While You Were Out" summary** (a full-screen card, dismissed with a tap):
- Time range of Sitter Mode
- Per child: sleeps (start–end, duration), feedings, medicine doses, stickers, notes
- Caregiver entries flagged so the parent can review them

### 5.6 Phone Page

A separate, small mobile web page designed for a phone. It is not a shrunken iPad layout. Protected by the same PIN, remembered on the device for 30 days.

Three sections, stacked:

1. **Medicine**
   - Top of screen: last dose per child with "next after" time, same format as the iPad.
   - **Log dose** button → same flow and warning as 5.3.
2. **Grocery list**
   - Add item; tap to check off; checked items move to the bottom and clear after 24 h.
3. **Jot it**
   - Add a note; list of open jots with check off / delete.

A "Last synced" time is always visible in the header (see [10](#10-offline--error-states)).

### 5.7 Night & Nap Mode

**Night Mode**
- Scheduled (default 8:00 PM–6:00 AM, set in Settings).
- Shows a slow photo slideshow (one photo every 60 s) with a small, dim clock. Brightness is lowered as far as the web platform allows, using a dark overlay.
- Photos are chosen in Settings from the iPad photo library and stored by the app.
- Tapping the screen shows a dimmed main screen for 60 s, then returns to the slideshow.
- Timer chimes and sticker sounds are silent.

**Nap Mode**
- Toggled with the moon button on the main screen.
- Dims the screen (dark overlay) and silences all sounds.
- Ends automatically when every sleep entry that was open when Nap Mode started has been ended, or after 3 hours, whichever comes first. If no sleep entry was open, it ends only by tapping the moon again or after 3 hours.

### 5.8 Settings

PIN-protected. Sections:

- **Children:** name, birthday, color, photo, allergies, food rules
- **Calendar:** connect Google account; choose which calendars to show and each one's color; leave-by buffer (default 20 min)
- **Weather:** location
- **Routines:** create and edit routines and steps; assign default routine per weekday; switch today's routine
- **Medicines:** name, minimum hours between doses
- **Stickers:** categories
- **Sitter info:** nap and bedtime instructions, emergency contacts, pediatrician, address, "where things are" notes
- **Sleep:** night-sleep time boundaries
- **Night Mode:** schedule, photos
- **Logs:** view history per child and type; edit or delete entries; enable Diaper log
- **Inbox:** v1 list of jots
- **Security:** change PIN

## 6. Priority 2 — Soon After (v1.1)

- **Kitchen screen:** weekly meal plan (feeds "Tonight's dinner"), full grocery list on the iPad, **Cook mode** (big-text recipe view, screen kept awake, several named timers such as "Pasta 8:00" and "Oven 22:00")
- **Inbox triage:** sort jots into Task / Grocery / Done
- **Recurring household tasks:** trash day, HVAC filter, bills, car registration; each appears on the main screen when due and is checked off there
- **Sleeps-until countdown** in Leona's Corner: moons for each night until an event (e.g., "Grandma's visit")
- **Health card** per child: current weight, pediatrician, upcoming checkups and vaccines (extends the child profile)

## 7. Priority 3 — Later

- **Milestones & firsts:** one-tap capture with date and optional photo
- **Sizes tracker:** clothes and shoe sizes per child, with hand-me-down notes
- **Recipe library** for Cook mode
- **Guest Wi-Fi QR code**

## 8. Out of Scope

Multiple user accounts · chores and allowance · school features · voice control · budgeting · messaging · two-way calendar editing · dose calculators or medical advice

## 9. Data Model

| Entity | Key fields |
|---|---|
| **Child** | id, name, birthday, color, photo, allergies, foodRules |
| **SleepEntry** | id, childId, start, end (nullable while sleeping), type (nap/night), source (parent/caregiver) |
| **FeedingEntry** | id, childId, time, type (milk/meal/snack), amount, note, source |
| **Medicine** | id, name, minIntervalHours |
| **DoseEntry** | id, childId, medicineId, time, note, source |
| **StickerEntry** | id, childId, categoryId, time, source |
| **StickerCategory** | id, name, icon |
| **DiaperEntry** | id, childId, time, kind (wet/dirty/both), source |
| **Routine** | id, name, steps[] (icon/photo, label, optional time), weekdays[] |
| **RoutineProgress** | date, childId, routineId, completedStepIndexes[] |
| **Jot** | id, text, createdAt, done |
| **GroceryItem** | id, text, createdAt, checkedAt |
| **SitterSession** | id, start, end |
| **Settings** | pinHash, calendars[] (id, color, visible), leaveByBufferMin, weatherLocation, nightSleepStart/End, nightModeStart/End, diaperLogEnabled, dinnerTonight, sitterInfo |
| **Photo** | id, blob, addedAt |

Every entry type has a `source` field so Sitter Mode entries can be flagged and summarized.

## 10. Offline & Error States

| Situation | iPad behavior | Phone behavior |
|---|---|---|
| Network lost | Keep working from local data; logs queue locally and sync when back online. Small "Offline" badge in the header | Banner: "Offline — last synced 8:42 PM". **Log dose is disabled** so a dose isn't logged against stale data; the grocery list and jots queue locally |
| Calendar not refreshed in >30 min | "Calendar updated 45 min ago" under the Today zone | — |
| Google auth expired | Today zone shows "Reconnect calendar in Settings" | — |
| Weather unavailable | Hide the weather; the clock and date remain | — |
| Sync conflict (same entry edited on two devices) | Last write wins; doses are append-only, so they never conflict | Same |
| Empty states | Wake window: "Log wake-up". Medicine zone hidden. Calendar: "Nothing else today". Sticker chart: empty grid with a friendly illustration | Medicine: "No doses in the last 24 h" |

## 11. Screen List for Claude Design

1. **iPad main screen** (landscape) — normal state, plus a medicine-active state
2. **Log sheets** — Sleep, Feeding, Medicine (including the early-dose warning), Sticker (with celebration), Jot it, Grocery
3. **Toddler guard** — long-press fill ring, PIN pad, Undo toast
4. **Leona's Corner** — Picture Schedule, Visual Timer (running), Sticker Chart
5. **Sitter Mode main screen** with Care Info panel
6. **"While You Were Out" summary**
7. **Night Mode** photo slideshow, and **Nap Mode** dimmed main screen
8. **Phone page** — medicine, grocery, jots; plus the offline banner
9. **Settings** — section list plus Routines editor and Medicines editor

## 12. Testing

**Logic to cover with automated tests**
- Wake window calculation (no sleep today, sleeping now, multiple naps)
- Night vs. nap classification at the time boundaries
- Next-dose-after calculation and the early-dose warning
- Routine selection by weekday, manual override, and timed auto-advance
- Weekly sticker chart reset on Monday
- Leave-by countdown (only events with a location, within 2 h)
- Sitter summary aggregation (only entries within the session, caregiver flagging)
- Offline queue replay and phone dose-logging disabled while offline

**Manual checks on the real iPad**
- Readability of the main screen from about 3 m
- Long-press guard resists quick taps and swipes
- Sound plays after the first tap; silent in Nap and Night Mode
- Performance: scrolling and animations stay smooth on the device
- Standalone fullscreen launch and Guided Access
