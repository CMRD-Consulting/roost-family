# Roost Phase 3a: Offline Boot, Night & Nap Mode, Kids' Corner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A registered tablet boots straight to its last-known main screen even with no network; the screen dims and silences for naps and at night; and preschoolers get Kids' Corner — a picture schedule they can check off, a visual timer, and their sticker chart.

**Architecture:** A device cache (IndexedDB) stores the last household snapshot and the display identity; the display store and household store read it before the network. A `useModes` store owns Nap/Night state and drives `setMuted` plus overlays on the main screen. Kids' Corner is a new route (`/corner`) built from pure view-model helpers (`routineForDay`, `currentStepIndex`, `stickerWeek`) and one new log command, `routine.complete`, that flows through the Phase 2b log store (optimistic, queued offline, undoable).

**Tech Stack:** Vue 3.5, Pinia, IndexedDB, Web Speech API (`speechSynthesis`), WebAudio chime from `src/ui/sound.ts`, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-14-roost-design.md` §7.3 (exit guard), §7.5 (Kids' Corner), §7.7 (Night & Nap), §13 (offline).
**Design reference:** `docs/design/handoff/project/Roost Family App v2.dc.html` lines ~169–173 (Nap overlay), ~344–405 (Kids' Corner picker, schedule, timer, sticker chart), ~589–596 (Night Mode). Spec wins over the mockup (Nap Mode stays usable; no text-only controls in Kids' Corner).

**Later phases:** 3b Sitter Mode + summary; 3c Settings (PIN-checked RPCs), photos for the Night Mode slideshow.

## Contents

- [Ground truth](#ground-truth)
- [File structure](#file-structure)
- Tasks 1–7

## Ground truth

- Local Supabase on OrbStack (`supabase start`; DB `postgresql://postgres:postgres@127.0.0.1:55322/postgres`; mail http://127.0.0.1:55324). Security checks: `rls_smoke.sql`. Seeded household "Rivera": Ivy (3 y, Kids' Corner on, Home day routine Mon–Fri with 9 steps, Weekend routine) and Theo (15 mo).
- `routine_progress` (member-writable): `id`, `household_id`, `child_id`, `routine_id`, `day date`, `completed_step_indexes int[]`, `unique (child_id, routine_id, day)`, FK `(routine_id, child_id)` → `routines`. Realtime-published, replica identity full.
- Phase 2b log pipeline: `src/data/logCommands.ts`, `applyCommand.ts`, `inverseCommand.ts`, `supabaseLogWriter.ts`, `demo/demoLogWriter.ts`, `src/stores/logStore.ts` (`submit`, `undo`, offline queue), `src/stores/householdStore.ts` (`view`, overlay, `online`, `realtime`), `src/data/offlineQueue.ts` (IndexedDB database `roost`, store `pending`).
- Display: `src/session/displayStore.ts` (`state`, `lastKnown`, `identity`, `refresh`, `ensure`, `watch`), `src/router.ts` (`resolveDisplayRoute` keeps a last-known-registered tablet on registered routes while offline — but `lastKnown` is memory-only today).
- UI: `RSheet`, `RChips`, `RPinPad` (`members`, `verify`), `RLongPress` (`duration`), `RoutineIcon` (`iconKey`, 12 keys), `RAvatar` (`decorative`), `src/ui/sound.ts` (`playChime`, `setMuted`, `isMuted`), `src/composables/useNow.ts`.
- Domain: `routineForDay(routines, childId, weekday, overrideId)`, `currentStepIndex(routine, completed, nowMinutes)`, `nextStepIndex`, `stickerWeek(entries, childId, categoryIds, now, tz)`, `isFeatureEnabled`, `householdDate`, `householdWeekday`, `minutesOfDay`, `isInWindow`.

## File structure

```
src/
  data/
    deviceCache.ts            IndexedDB cache: snapshot per household + display identity (+ test)
  session/
    displayStore.ts           (modify) seed lastKnown from the cache; persist on success; clear on reset
  stores/
    householdStore.ts         (modify) show cached snapshot immediately; save each fresh snapshot
    modesStore.ts             Nap/Night state machine + mute (+ test)
  features/
    modes/
      NightScreen.vue         dim clock (slideshow when photos exist — Phase 3c)
      NapOverlay.vue          dimming layer that lets touches through + moon control
    corner/
      cornerModel.ts          pure: eligible children, schedule model, sticker grid model (+ test)
      KidsCorner.vue          route shell: picker → child view with tabs, exit guard
      CornerChildPicker.vue
      PictureSchedule.vue
      VisualTimer.vue
      StickerChart.vue
      speech.ts               speak(label) respecting mute (+ test)
      corner.test.ts
  data/
    logCommands.ts / applyCommand.ts / inverseCommand.ts / supabaseLogWriter.ts / demo/demoLogWriter.ts
                              (modify) routine.complete command
  App.vue                     (modify) boot splash while the first navigation resolves
  router.ts                   (modify) /corner route
```

---

### Task 1: Device cache

**Files:** Create `src/data/deviceCache.ts`, `src/data/deviceCache.test.ts` (uses `fake-indexeddb/auto`).

- `createDeviceCache(dbName = 'roost-cache')` → `{ saveSnapshot(snapshot), loadSnapshot(householdId): Promise<HouseholdSnapshot | null>, saveIdentity(identity: DisplayIdentity), loadIdentity(): Promise<DisplayIdentity | null>, clear(): Promise<void> }`. One object store `kv` keyed by strings `snapshot:<householdId>` and `identity`. Store plain JSON (deep copy through `JSON.parse(JSON.stringify(toRaw(x)))`). Resolve on transaction `oncomplete`. Separate database from the offline queue so clearing one never touches the other.
- If IndexedDB can't open (private mode), every method resolves to a no-op / null and logs one `console.warn`.
- A snapshot older than 7 days (`loadedAt`) is treated as absent (`null`) — stale medicine timing is worse than none.
- Tests: round-trip, per-household isolation, `clear`, 7-day expiry, failing `indexedDB.open` degrades to null.
- Commit — `feat(data): device cache for last snapshot and display identity`

---

### Task 2: Offline boot

**Files:** Modify `src/session/displayStore.ts` (+ test), `src/stores/householdStore.ts` (+ test), `src/App.vue`, `src/features/display/DisplayRemoved.vue`, `src/features/main/MainScreen.vue`.

- **Display store:** on the first `ensure()`, read `deviceCache.loadIdentity()` and seed `lastKnown` with `{ kind: 'registered', identity }` before calling the network. Every successful `refresh()` that yields `registered` saves the identity; `revoked` or `unregistered` clears the cache (identity and snapshots). `resolveDisplayRoute` then keeps a cached-registered tablet on `/home` while offline (already implemented). Demo mode never touches the cache.
- **Household store:** `start(householdId, source)` loads `deviceCache.loadSnapshot(householdId)` first; if present, set `snapshot` and `status: 'ready'` with a new flag `fromCache: true`, then load from the source as today. Every successful load saves the snapshot (fire-and-forget) and clears `fromCache`.
- **Main screen:** when `store.fromCache` is true show a 16 px badge "Showing saved info from 9:42 AM" (time of `snapshot.loadedAt`) next to the Offline badge. The medicine zone keeps working from cached doses; the dose-logging offline confirmation (Phase 2b) already applies.
- **Boot splash:** `App.vue` shows a centered `RLogo` (64 px, `text-ink-3`) until the router's first navigation resolves (`router.isReady()`), so there is never a blank screen.
- **Start over / revoked:** `DisplayRemoved` start-over clears the device cache and the offline queue (`createOfflineQueue().clear()`).
- Tests: cached identity + network failure → route `/home` and snapshot shown from cache; fresh load replaces cache flag; revoke clears cache.
- Commit — `feat(offline): boot to the last saved screen without a network`

---

### Task 3: Nap & Night modes store

**Files:** Create `src/stores/modesStore.ts`, `src/stores/modesStore.test.ts`.

`useModesStore` (setup store), pure logic separated into exported functions for testing:
- **Night:** `isNight(now, household)` = `isInWindow(now, household.nightMode, household.timeZone)`. `nightPeekUntil: number | null` — `peek()` sets it to now + 60 s; `nightActive` = `isNight && !(nightPeekUntil > now)`.
- **Nap:** `nap: { startedAt: string; openSleepIds: string[] } | null`, persisted in `localStorage` key `roost-nap` (try/catch). `startNap(snapshot, now)` records the ids of currently open sleep entries (`endAt === null`) for any child. `napShouldEnd(nap, snapshot, now)` → true when (openSleepIds non-empty and every one of those entries now has `endAt` or no longer exists) or now − startedAt ≥ 3 h. `toggleNap()`. The main screen evaluates `napShouldEnd` whenever the view or clock changes and calls `endNap()`.
- **Mute:** a watcher calls `setMuted(napActive || nightActive)`.
- Tests: night window crossing midnight with the household zone; peek expiry; nap ends when its sleeps end, not when an unrelated sleep ends; nap with no open sleeps ends only by toggle or 3 h; nap persists across store re-creation; mute follows modes.
- Commit — `feat(modes): nap and night mode state`

---

### Task 4: Night screen and Nap overlay

**Files:** Create `src/features/modes/NightScreen.vue`, `src/features/modes/NapOverlay.vue`; modify `src/features/main/MainScreen.vue`, `MainScreen.test.ts`.

- **NightScreen** (rendered by MainScreen when `nightActive`): full-screen `bg-night`, a slow radial gradient like the design, centered clock 64 px in `rgba(233,223,209,.55)` (≥ 3:1 on the night background — verify with `src/ui/contrast.ts`), date 18 px. A tap anywhere calls `modes.peek()`. With photos (Phase 3c) it will crossfade them; for now no slideshow. Any open sheet closes when night begins.
- **Dimmed peek:** while peeking at night, the main screen renders with a dark overlay at 55 % that **passes pointer events through** (`pointer-events: none`), and a 16 px chip "Night Mode · back in 0:42" (live countdown).
- **NapOverlay** (when `napActive`): same pass-through dark overlay at 45 %, plus a pill at the top center "Nap Mode · sounds off" (18 px) with the moon button remaining clickable above the overlay (60 px). The header moon button toggles nap (`aria-pressed`). The main screen stays fully usable (spec §7.7).
- **Sticker celebration** still shows during nap/night peek but silently (sound already muted by the store).
- Tests: night renders NightScreen and hides log row; tap → peek shows main screen with countdown; nap overlay doesn't block a log button long-press; moon toggles `aria-pressed`; nap auto-ends when the open sleep ends via a feeding/sleep command in demo mode.
- Commit — `feat(modes): night screen and nap overlay`

---

### Task 5: `routine.complete` log command

**Files:** Modify `src/data/logCommands.ts`, `applyCommand.ts` (+ test), `inverseCommand.ts` (+ test), `supabaseLogWriter.ts` (+ test), `src/data/demo/demoLogWriter.ts`.

- Command: `{ kind: 'routine.complete'; householdId: string; childId: string; routineId: string; day: HouseholdDate; completed: number[]; previous: number[] }` — `completed` is the full new array (sorted, unique).
- `applyCommand`: upsert the `routineProgress` row for (childId, routineId, day) with `completed`.
- `inverseCommand`: swap `completed` and `previous`.
- Supabase writer: `routine_progress.upsert({ household_id, child_id, routine_id, day, completed_step_indexes: completed }, { onConflict: 'child_id,routine_id,day' })` (not `ignoreDuplicates` — it must update). Verify against local Supabase with a throwaway script (sign in as `sam@roost.test` via Mailpit code; clean up the row).
- Commit — `feat(corner): routine progress command`

---

### Task 6: Kids' Corner model and screens

**Files:** Create `src/features/corner/cornerModel.ts` (+ test), `speech.ts` (+ test), `KidsCorner.vue`, `CornerChildPicker.vue`, `PictureSchedule.vue`, `VisualTimer.vue`, `StickerChart.vue`, `corner.test.ts`; modify `src/router.ts`, `src/features/main/MainScreen.vue` (Kids' Corner button → `/corner`).

**Model (pure, test first):**
- `cornerChildren(snapshot, now)` → children with `kidsCorner` enabled, by `sortOrder`.
- `scheduleModel(snapshot, childId, now)` → `null` when no routine today, else `{ routineId, day, steps: { index, label, iconKey, time: string | null, done: boolean }[], currentIndex: number | null, nextIndex: number | null, completed: number[] }` using the day override, weekday, `currentStepIndex`/`nextStepIndex`.
- `completeCurrent(model)` → the `routine.complete` command payload (adds `currentIndex`), or null when nothing is current.
- `stickerGridModel(snapshot, childId, now)` → `{ weekStart, days: ['Mon'…'Sun'], todayIndex, rows: { categoryId, name, iconKey, counts: number[] }[] }` from `stickerWeek`.

**`speech.ts`:** `speak(text)` uses `speechSynthesis` with a friendly rate (0.9) when available and not `isMuted()`; cancels any current utterance first. Test with a stubbed `speechSynthesis`.

**Screens** (spec §7.5; no text-only controls — every control has an icon or picture; labels are secondary; targets ≥ 88 px for kid-facing buttons; background `bg-corner`):
- **Route `/corner`** (requires `registered`). Loads the same household view as the main screen (reuse `householdStore` — if not started, start it like MainScreen does; extract a small `useHouseholdSession()` composable from MainScreen for both routes).
- **CornerChildPicker:** "Who's playing?" with 160 px avatars + name (32 px). Skipped when exactly one child is eligible. Zero eligible → friendly empty state with a picture and a PIN-guarded "Back" (see exit).
- **Child view:** a bottom tab bar (`bg-corner-bar`) with three large icon tabs — schedule (list icon), timer (hourglass), stickers (star) — each 88 px, icon + small label (18 px). Top-left: the child's avatar (72 px) → back to picker (tap; no guard needed, stays inside the Corner). Top-right corner: the exit control.
- **PictureSchedule:** horizontal strip of step cards; current step enlarged (240 px card: `RoutineIcon` 120 px + label 32 px), others 140 px (`RoutineIcon` 64 px + label 22 px), done steps show a green check badge and reduced opacity. Tapping any step card speaks its label. A giant check button (160 px circle, check icon, `aria-label="Done with <step>"`) completes the current step → `logStore.submit(routine.complete)` → small celebration (`roost-pop` on the card, `playChime()`), then the next step becomes current. When all done: a "All done!" picture card. No routine today: friendly empty state.
- **VisualTimer:** preset buttons 1, 2, 5, 10 min as big pie-shaped icons with the number (≥ 88 px). Running: a large disc (min(60vh, 60vw)) drawn with `conic-gradient` that shrinks clockwise, updated every 250 ms with `requestAnimationFrame` only while running; remaining time also shown as big digits for adults (40 px). At zero: `playChime()` and a gentle pulse; the disc resets after 5 s. Cancel = `RLongPress` (600 ms) on a round stop button. Timer state survives tab switches within the Corner (lives in the component above the tabs).
- **StickerChart:** grid Mon–Sun columns, one row per category (icon + name 22 px), star stickers per count (up to 5 shown, then "+N"), today's column highlighted. Read-only.
- **Exit (spec §7.3):** a lock button in the top-right; `RLongPress` with `duration=2000`, then `RPinPad` (adults only, `logStore.verifyPin`) → `router.push('/home')`. While offline, `verifyPin` can't run: allow exit after the 2 s hold plus a second 2 s hold on a confirm button labeled "Adults: hold again to exit" (documented fallback so a Wi-Fi drop never traps the tablet in the Corner).
- Night Mode and Nap Mode apply in the Corner too (reuse NightScreen/NapOverlay).
- **Tests:** model (eligibility Ivy yes/Theo no; schedule current/next with progress; completeCurrent; sticker grid counts and today index); screens (picker skipped with one child; done button submits the command and advances; step tap speaks; timer start/zero chime/long-press cancel with fake timers; exit requires hold + PIN, offline fallback path).
- Commit — `feat(corner): Kids' Corner with picture schedule, visual timer and sticker chart`

---

### Task 7: Verify

- `pnpm test`, `pnpm typecheck`, `pnpm build` green.
- **Controller (not a subagent):** on local Supabase as the seeded household: pause the gateway container and reload → main screen from cache with the saved-info badge; resume → live. Force Night Mode by temporarily setting the household's `night_mode_start/end` via psql → Night screen, tap → peek countdown. Nap toggle while Theo sleeps → overlay, logs still work, ending the sleep ends Nap Mode. Kids' Corner as Ivy: complete a step (row in `routine_progress`), speak, timer 1 min, sticker chart shows Ivy's potty sticker, exit via hold + PIN 1234. Check layouts at 1024×768.
