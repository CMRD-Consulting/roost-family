# Roost Phase 2b: Logging — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the main screen, adults (and later sitters) can log sleep, feeding, medicine, stickers, diapers, jots and groceries through toddler-guarded sheets, see results immediately on every display, undo within 10 seconds, keep logging through Wi-Fi drops, and resolve dose conflicts with a PIN.

**Architecture:** Every user action becomes a typed `LogCommand`. A `LogWriter` executes commands against Supabase (or the in-memory demo household). A `useLogStore` sits between the UI and the writer: it applies the command optimistically to the household snapshot, sends it (or queues it in IndexedDB when offline — except doses, which need explicit confirmation), and keeps a 10-second undo slot that maps each command to its inverse. Sheets are small Vue components built from shared primitives (sheet frame, child picker, "Who?" row, time stepper, chips, PIN pad).

**Tech Stack:** Vue 3.5, Pinia, supabase-js v2, IndexedDB (thin wrapper, `fake-indexeddb` for tests), Vitest + @vue/test-utils.

**Spec:** `docs/superpowers/specs/2026-09-14-roost-design.md` §4, §6.5 (attribution), §7.3 (toddler guard & PINs), §7.4 (logs), §11.4 (medicine rules), §13 (offline).
**Design reference:** `docs/design/handoff/project/Roost Family App v2.dc.html` lines ~176–340 (log sheets, Who row, time stepper, warnings, sticker celebration, sitter prompt, undo toast, PIN pad). Spec rules win over the mockup.

## Contents

- [Ground truth from Phases 1–2a](#ground-truth-from-phases-12a)
- [File structure](#file-structure)
- Tasks 1–9

## Ground truth from Phases 1–2a

- Local Supabase runs on OrbStack: `supabase start`, `supabase db reset`, `pnpm db:types`. Mail codes at http://127.0.0.1:55324. `.env.local` exists. Security checks: `psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -v ON_ERROR_STOP=1 -f supabase/manual-checks/rls_smoke.sql`.
- Client-writable tables (RLS "member all"): `sleep_entries`, `feeding_entries`, `sticker_entries`, `diaper_entries`, `routine_progress`, `jots`, `grocery_items`, `sitter_sessions`; `settings_audit` insert only. `dose_entries`: **insert only**; voiding and acknowledging go through `void_dose(p_dose_id, p_membership_id, p_pin, p_reason)` and `acknowledge_dose_conflict(p_dose_id, p_membership_id, p_pin)`. Other RPCs: `verify_pin(p_membership_id, p_pin)`, `set_dinner_tonight(p_household_id, p_text)`.
- Server fills `logged_by_name`; doses require `logged_by_membership_id` or `sitter_session_id`. Composite FKs require `display_id`, `logged_by_membership_id`, `sitter_session_id` to belong to the same household.
- Entry ids are client-generated UUIDs (`crypto.randomUUID()`), so replays are idempotent (`upsert(..., { onConflict: 'id', ignoreDuplicates: true })`).
- Snapshot/store: `src/data/snapshot.ts`, `src/stores/householdStore.ts` (`snapshot`, `online`, `reload()`), `src/data/householdSource.ts` (`isDemo`, `DEMO_DISPLAY`, `selectSource()`), demo fixture `src/data/demo/demoFixture.ts`, view model `src/features/main/mainScreenModel.ts` (`LogKind`), `src/features/main/MainScreen.vue` (LogRow emits `open(kind)`; currently shows a placeholder toast), `src/ui/RLongPress.vue`, `RAvatar`, `RButton`, `RInput`, `RoutineIcon`, `personPalette`.
- Domain: `classifySleep`, `nightWindowFor`, `sleepStatus`, `checkDose` (`DoseWarning` kinds `early` with `gapMs`/`direction`/`nearestDoseBy`, `overMax` with `doseNumber`/`max`), `isFeatureEnabled`, `formatDuration`, `formatClock`.

## File structure

```
src/
  data/
    logCommands.ts          LogCommand union + builders (+ test)
    logWriter.ts            LogWriter interface
    supabaseLogWriter.ts    Supabase implementation (+ test with fake client)
    demo/demoHousehold.ts   mutable in-memory demo household shared by demoSource + demoLogWriter (+ test)
    demo/demoLogWriter.ts   demo implementation
    offlineQueue.ts         IndexedDB-backed queue of pending commands (+ test with fake-indexeddb)
    applyCommand.ts         pure optimistic apply of a command to a HouseholdSnapshot (+ test)
    inverseCommand.ts       pure: command → undo command (+ test)
  stores/
    logStore.ts             submit/undo/replay orchestration (+ test)
  ui/
    RSheet.vue              modal sheet frame (focus trap, close button, scrim)
    RChips.vue              single-select chip group (radiogroup)
    RTimeStepper.vue        ±5 min time control
    RPinPad.vue             adult avatars → 4 digits (+ test)
  features/
    logs/
      ChildPicker.vue       avatars filtered by feature
      WhoRow.vue            adult avatars; required mode for medicine
      SleepSheet.vue  FeedingSheet.vue  MedicineSheet.vue  StickerSheet.vue
      DiaperSheet.vue  JotSheet.vue  GrocerySheet.vue
      StickerCelebration.vue
      StaleSleepSheet.vue   "Still sleeping?" actions
      DinnerSheet.vue       edit tonight's dinner
      UndoToast.vue
      logSheetModel.ts      pure helpers: eligible children per kind, default child, medicine warnings text (+ test)
      sheets.test.ts        component tests for the sheets
    main/                   wiring changes in MainScreen.vue, KidCard.vue, DinnerLine.vue, ConflictBanner.vue
```

---

### Task 1: Log commands, optimistic apply, and inverses (pure)

**Files:**
- Create: `src/data/logCommands.ts`, `src/data/applyCommand.ts`, `src/data/applyCommand.test.ts`, `src/data/inverseCommand.ts`, `src/data/inverseCommand.test.ts`

- [ ] **Step 1: Command types** — `src/data/logCommands.ts`:

```ts
import type { DiaperEntry, DoseEntry, FeedingEntry, IsoTimestamp, SleepEntry, StickerEntry } from '@/domain/types'
import type { GroceryItem, Jot } from './snapshot'

export interface Attribution {
  displayId: string | null
  loggedByMembershipId: string | null
  sitterSessionId: string | null
  /** Shown optimistically until the server's logged_by_name snapshot arrives. */
  loggedByName: string | null
}

export type EntryTable = 'sleep_entries' | 'feeding_entries' | 'sticker_entries' | 'diaper_entries' | 'jots'

export type LogCommand =
  | { kind: 'sleep.start'; householdId: string; entry: SleepEntry; attribution: Attribution }
  | { kind: 'sleep.end'; householdId: string; entryId: string; endAt: IsoTimestamp | null; previousEndAt: IsoTimestamp | null }
  | { kind: 'sleep.discard'; householdId: string; entry: SleepEntry; attribution: Attribution }
  | { kind: 'sleep.restore'; householdId: string; entry: SleepEntry; attribution: Attribution }
  | { kind: 'feeding.add'; householdId: string; entry: FeedingEntry; attribution: Attribution }
  | { kind: 'dose.add'; householdId: string; entry: DoseEntry; attribution: Attribution }
  | { kind: 'sticker.add'; householdId: string; entry: StickerEntry; attribution: Attribution }
  | { kind: 'diaper.add'; householdId: string; entry: DiaperEntry; attribution: Attribution }
  | { kind: 'jot.add'; householdId: string; jot: Jot; displayId: string | null }
  | { kind: 'grocery.add'; householdId: string; item: GroceryItem; displayId: string | null }
  | { kind: 'grocery.check'; householdId: string; itemId: string; checkedAt: IsoTimestamp | null; previousCheckedAt: IsoTimestamp | null }
  | { kind: 'grocery.delete'; householdId: string; item: GroceryItem; displayId: string | null }
  | { kind: 'entry.delete'; householdId: string; table: EntryTable; entryId: string }
  | { kind: 'dose.void'; householdId: string; doseId: string; membershipId: string; pin: string; reason: string }
  | { kind: 'dose.acknowledge'; householdId: string; doseId: string; membershipId: string; pin: string }
  | { kind: 'dinner.set'; householdId: string; text: string | null; previous: string | null }

/** Commands that need a live connection (PIN checks happen on the server). */
export function requiresOnline(cmd: LogCommand): boolean {
  return cmd.kind === 'dose.void' || cmd.kind === 'dose.acknowledge'
}

export function newId(): string {
  return crypto.randomUUID()
}
```

- [ ] **Step 2: Tests for `applyCommand(snapshot, cmd, now)`** (use `buildDemoSnapshot` as the base) — returns a NEW snapshot (never mutates input) where:
  - `sleep.start` appends the entry (no duplicate if an entry with that id exists).
  - `sleep.end` sets `endAt` on the matching entry (no-op if missing).
  - `sleep.discard` removes the entry; `sleep.restore` re-adds it (no duplicate).
  - `feeding.add`, `sticker.add`, `diaper.add`, `dose.add` append (idempotent by id). `dose.add` sets `createdAt` to `now` if the entry's `createdAt` is empty and `loggedByName` from attribution when null.
  - `jot.add`, `grocery.add` append (idempotent); `grocery.check` sets `checkedAt`; `grocery.delete` removes.
  - `entry.delete` removes by id from the table's collection (`jots` → `jots`, etc.).
  - `dose.void` sets `voidedAt = now` on the dose (optimistic); `dose.acknowledge` sets `conflictAcknowledgedAt = now`.
  - `dinner.set` sets `household.dinnerTonight`.
  - Applying the same command twice equals applying it once (for every kind).

Run → FAIL; implement `src/data/applyCommand.ts` with a `switch (cmd.kind)` and small `upsertById`/`removeById` helpers; run → PASS.

- [ ] **Step 3: Tests for `inverseCommand(cmd)`** — returns the undo command or `null`:
  - `sleep.start` → `entry.delete` (`sleep_entries`, same id)
  - `sleep.end` → `sleep.end` with `endAt: previousEndAt`, `previousEndAt: endAt`
  - `sleep.discard` → `sleep.restore` with the same entry; `sleep.restore` → `sleep.discard`
  - `feeding.add`/`sticker.add`/`diaper.add`/`jot.add` → `entry.delete` for the right table
  - `grocery.add` → `grocery.delete`; `grocery.delete` → `grocery.add`; `grocery.check` → `grocery.check` with values swapped
  - `dinner.set` → `dinner.set` with `text: previous`, `previous: text`
  - `dose.add` → `null` (undoing a dose requires a PIN void; the UI handles it)
  - `entry.delete`, `dose.void`, `dose.acknowledge` → `null`

Implement `src/data/inverseCommand.ts`; run → PASS; `pnpm typecheck`.

- [ ] **Step 4: Commit** — `feat(logs): log commands with optimistic apply and inverses`

---

### Task 2: LogWriter interface and Supabase writer

**Files:**
- Create: `src/data/logWriter.ts`, `src/data/supabaseLogWriter.ts`, `src/data/supabaseLogWriter.test.ts`

- [ ] **Step 1: Interface**

```ts
import type { LogCommand } from './logCommands'

export class LogWriteError extends Error {
  constructor(message: string, readonly network: boolean, readonly code: string | null) {
    super(message)
  }
}

export interface LogWriter {
  /** Execute a command. Throws LogWriteError (network=true when the request never reached the server). */
  execute(cmd: LogCommand): Promise<void>
  verifyPin(membershipId: string, pin: string): Promise<boolean>
}
```

- [ ] **Step 2: Tests with a fake client** (records `from(table).upsert/update/delete/eq` chains and `rpc(name, args)`), asserting for each command:
  - `sleep.start` → `sleep_entries.upsert({ id, household_id, child_id, start_at, end_at: null, type, display_id, logged_by_membership_id, sitter_session_id }, { onConflict: 'id', ignoreDuplicates: true })`. Same shape (snake_case columns from `src/data/database.types.ts`) for `feeding.add`, `sticker.add`, `diaper.add` (`kind` column), `dose.add` (`medicine_id`, `at`, `note`, `logged_offline`, `warnings_confirmed`), `sleep.restore`, `jot.add` (`text`, `display_id`), `grocery.add`.
  - `sleep.end` → `sleep_entries.update({ end_at }).eq('id', entryId)`.
  - `sleep.discard` and `entry.delete` → `<table>.delete().eq('id', id)`; `grocery.delete` → `grocery_items.delete().eq('id', item.id)`.
  - `grocery.check` → `grocery_items.update({ checked_at }).eq('id', itemId)`.
  - `dose.void` → `rpc('void_dose', { p_dose_id, p_membership_id, p_pin, p_reason })`; `dose.acknowledge` → `rpc('acknowledge_dose_conflict', …)`; `dinner.set` → `rpc('set_dinner_tonight', { p_household_id, p_text })` (send `''` when `text` is null — check the SQL function; if it rejects empty, send null and adjust).
  - `verifyPin` → `rpc('verify_pin', …)` returns the boolean.
  - Error mapping: a Postgrest error with a non-empty `code` → `LogWriteError(network=false, code)`; an error with empty/undefined `code` or a thrown `TypeError` (fetch failed) → `LogWriteError(network=true)`.

- [ ] **Step 3: Implement** `createSupabaseLogWriter(client: RoostClient): LogWriter`. Keep one private `toRow` mapper per entity. Run tests + typecheck.

- [ ] **Step 4: Commit** — `feat(logs): Supabase log writer`

---

### Task 3: Mutable demo household and demo writer

**Files:**
- Create: `src/data/demo/demoHousehold.ts`, `src/data/demo/demoHousehold.test.ts`, `src/data/demo/demoLogWriter.ts`
- Modify: `src/data/demo/demoSource.ts`, `src/data/householdSource.ts`

- [ ] **Step 1: Tests then implementation.** `demoHousehold.ts` keeps a single in-memory `HouseholdSnapshot` created lazily with `buildDemoSnapshot(new Date(), optionsFromUrl())`, and exposes `getDemoSnapshot(now)` (returns a structured clone with `loadedAt = now`), `mutateDemo(fn: (s) => HouseholdSnapshot)`, `onDemoChange(listener) → unsubscribe`, and `resetDemoForTests()`. `demoSource.load` uses `getDemoSnapshot`; `demoSource.subscribe` uses `onDemoChange` and reports `connected`.
- [ ] **Step 2:** `demoLogWriter.execute(cmd)` → `mutateDemo((s) => applyCommand(s, cmd, new Date()))` after a 150 ms delay (simulates the network); for `dose.void`/`dose.acknowledge` it first checks the PIN (Sam `bbbbbbbb-0000-0000-0000-000000000001` = `1234`, Alex `…0002` = `5678`) and throws `LogWriteError('Wrong PIN', false, '42501')` otherwise. `verifyPin` uses the same table. Tests: execute mutates and notifies listeners; wrong PIN rejects.
- [ ] **Step 3:** In `householdSource.ts` add `selectWriter(): Promise<LogWriter>` mirroring `selectSource()`.
- [ ] **Step 4: Commit** — `feat(logs): mutable demo household and demo log writer`

---

### Task 4: Offline queue

**Files:**
- Create: `src/data/offlineQueue.ts`, `src/data/offlineQueue.test.ts`
- Modify: `package.json` (dev dependency `fake-indexeddb`)

- [ ] **Step 1:** `pnpm add -D fake-indexeddb`. Tests import `fake-indexeddb/auto`.
- [ ] **Step 2: Tests then implementation.** `createOfflineQueue(dbName = 'roost')` returns `{ enqueue(cmd): Promise<number>, list(): Promise<{ key: number; command: LogCommand; enqueuedAt: string }[]>, remove(key): Promise<void>, count(): Promise<number>, clear(): Promise<void> }` backed by one object store `pending` with auto-increment keys; `list()` is ordered by key. Commands are stored as plain JSON. Rejects `enqueue` for commands where `requiresOnline(cmd)` is true. Tests: order preserved across reopen (new queue instance with the same name), remove, count, rejects PIN commands.
- [ ] **Step 3: Commit** — `feat(logs): IndexedDB offline queue`

---

### Task 5: Overlay in the household store and the log store

**Files:**
- Modify: `src/stores/householdStore.ts`, `src/stores/householdStore.test.ts`
- Create: `src/stores/logStore.ts`, `src/stores/logStore.test.ts`

- [ ] **Step 1: Household store overlay (test first).** Add `overlay = ref<{ command: LogCommand; savedAt: string | null }[]>([])`, `view = computed(() => snapshot ? overlay.reduce((s, o) => applyCommand(s, o.command, new Date()), snapshot) : null)`, and methods `addOverlay(cmd)`, `markSaved(cmd)`, `removeOverlay(cmd)`. After every successful `reload()`, drop overlay items whose `savedAt` is earlier than the load's start time. Tests: view includes overlay; saved items drop after a later reload; unsaved items survive reloads.

- [ ] **Step 2: Log store (test first)** — `useLogStore` with `init(writer: LogWriter, queue: OfflineQueue)`:
  - `submit(cmd, opts?: { confirmOffline?: boolean }): Promise<'saved' | 'queued'>`
    1. `requiresOnline(cmd)` and offline (`householdStore.online === false`) → throw `LogWriteError('You're offline. Try again when connected.', true, null)`.
    2. `cmd.kind === 'dose.add'` and offline and not `opts.confirmOffline` → throw `NeedsOfflineDoseConfirmation` (exported class). With `confirmOffline`, set `entry.loggedOffline = true` before continuing.
    3. `householdStore.addOverlay(cmd)`.
    4. If online, `await writer.execute(cmd)`: success → `markSaved`, set undo slot, return `'saved'`. Network error → enqueue (doses: mark `loggedOffline = true` only if `confirmOffline`; otherwise remove the overlay and rethrow `NeedsOfflineDoseConfirmation`), keep overlay, set undo slot, return `'queued'`. Non-network error → `removeOverlay`, rethrow.
    5. If offline → enqueue, set undo slot, return `'queued'`.
  - Undo slot: `lastAction = ref<{ command: LogCommand; expiresAt: number } | null>`, cleared after 10 s (timer). `undo(): Promise<'undone' | 'needsPin'>` — `dose.add` → `'needsPin'` (the UI collects a PIN, then calls `submit({ kind: 'dose.void', … reason: 'Undone within 10 seconds' })`); otherwise submits `inverseCommand` (queued commands not yet sent: remove them from the queue and overlay instead of sending an inverse) and clears the slot.
  - `replay()`: when online, for each queued item in order → `writer.execute` → on success `remove` + `markSaved`; network error → stop; other error → `remove`, `removeOverlay`, push a message to `failures` (ref<string[]>). Called on `online` events, every 30 s while `queue.count() > 0`, and once after `init`. On `init`, re-add queued commands to the overlay so they display after a reload.
  - `pendingCount` ref for the UI.
  - Tests cover: online save, offline queue, dose offline confirmation (both paths), network failure mid-save → queued, replay success/partial/permanent failure, undo for sleep/feeding/grocery/dinner, undo of an unsent queued command removes it without sending, dose undo returns `needsPin`, undo slot expiry.

- [ ] **Step 3: Commit** — `feat(logs): overlay and log store with offline replay and undo`

---

### Task 6: UI primitives

**Files:**
- Create: `src/ui/RSheet.vue`, `src/ui/RChips.vue`, `src/ui/RTimeStepper.vue`, `src/ui/RPinPad.vue`, `src/ui/primitives.test.ts`, `src/features/logs/ChildPicker.vue`, `src/features/logs/WhoRow.vue`
- Modify: `src/ui/RInput.vue` (accessible name)

All are "in-the-moment" surfaces: targets ≥ 60 px, labels ≥ 18 px, avatars with every person color.

- **`RSheet`** — props `title`, `open`; emits `close`. Full-width bottom-anchored panel (max-width 960 px, radius 28 px top, `bg-surface`), scrim `rgba(43,33,28,.45)` that closes on tap, a 60 px "Close" button (✕ with `aria-label="Close"`), `role="dialog"` `aria-modal="true"` `aria-labelledby`, focus moves into the sheet on open and returns to the opener on close, Escape closes. Slots: default (body, scrolls if needed), `footer` (sticky). Title 32 px.
- **`RChips`** — props `options: { value: string; label: string; disabled?: boolean }[]`, `modelValue: string | null`, `label` (group name); `role="radiogroup"`, each chip `role="radio"` `aria-checked`, ≥ 60 px tall, 22 px text; selected = `bg-ink text-surface`; unselected = `bg-surface-2 text-ink`. Arrow keys move selection.
- **`RTimeStepper`** — `v-model` ISO string; props `min`, `max` (ISO). Buttons "−5 min" / "+5 min" (60 px), center shows `formatClock` (26 px) plus "now" / "N min ago" (18 px, via `formatDuration`); buttons disabled at bounds. `timeZone` prop.
- **`RPinPad`** — props `members: Member[]` (from snapshot; show owners and adults), `verify: (membershipId, pin) => Promise<boolean>`, `title` (default "Enter your PIN"); emits `verified({ membershipId, pin })`, `cancel`. Step 1: grid of 96 px avatars with names. Step 2: "Not you?" link back, 4 dots, keypad 1–9, 0, backspace (72 px keys, 32 px digits). After 4 digits call `verify`; false → dots shake (CSS; static with reduced motion), "That PIN didn't match." (18 px), clear; true → emit. No lockout (spec). Test: wrong then right PIN flow with a fake `verify`.
- **`ChildPicker`** — props `children: SnapshotChild[]` (already filtered), `modelValue: string | null`; renders 72 px avatar buttons with names (22 px), `role="radiogroup"`; empty list → slot `empty`.
- **`WhoRow`** — props `members`, `modelValue: string | null`, `required: boolean`; label "Who?" (18 px uppercase) plus "(required)" when required; avatar buttons 60 px; tapping the selected one deselects when not required.
- **`RInput`** — generate an id (`useId()` from Vue 3.5) and bind `<label :for>` / `<input :id>`; keep the wrapping layout.

- [ ] Write `primitives.test.ts` covering: RChips selection + arrow keys; RTimeStepper bounds and emitted values; RPinPad wrong/right flow; RSheet Escape closes and `aria-modal`; RInput label association (`getByLabelText`-style: `input.labels[0].textContent`).
- [ ] Commit — `feat(ui): sheet, chips, time stepper, PIN pad, child picker, who row`

---

### Task 7: Log sheets

**Files:**
- Create: `src/features/logs/logSheetModel.ts`, `src/features/logs/logSheetModel.test.ts`, `SleepSheet.vue`, `FeedingSheet.vue`, `DiaperSheet.vue`, `StickerSheet.vue`, `StickerCelebration.vue`, `JotSheet.vue`, `GrocerySheet.vue`, `StaleSleepSheet.vue`, `DinnerSheet.vue`, `src/features/logs/sheets.test.ts`, `src/ui/sound.ts`
- Modify: `src/features/setup/steps/ConsentStep.vue` (checkbox names)

**`logSheetModel.ts` (pure, test first):**
- `eligibleChildren(snapshot, kind: LogKind, now)`: sleep → feature `wakeWindow` OR child has a sleep entry started in the last 18 h; feeding → `feeding`; sticker → `kidsCorner`; diaper → `diaper`; medicine → children with ≥ 1 medicine; ordered by `sortOrder`.
- `defaultChildId(children)`: the only child's id when exactly one, else null (an adult must pick — prevents wrong-child logs).
- `openSleepFor(snapshot, childId)`: the child's open sleep entry (latest `startAt`, `endAt === null`) or null.
- `doseWarningMessages(warnings, medicine)`: `early` + `direction: 'before'` → `Last dose was ${formatDuration(gapMs)} ago${by}. Minimum is ${h}h.`; `direction: 'after'` → `Another dose was logged ${formatDuration(gapMs)} after this time${by}. Minimum is ${h}h.`; `overMax` → `This would be dose ${doseNumber} in 24 hours. Maximum is ${max}.` — where `by` = ` by ${name}` when known and `h` drops a trailing `.0`.
- `attributionFor(identity, membershipId, members)`: `{ displayId, loggedByMembershipId, sitterSessionId: null, loggedByName }` (display name of the member or null).

**Sheets** (each wraps `RSheet`, takes `open`, emits `close` and `saved(result: 'saved' | 'queued')`; saving calls `logStore.submit`; errors show inline in `bg-orange-tint text-warn-ink` 18 px; Save is a 60 px primary `RButton` in the footer, disabled until required fields are set; after save the sheet closes):
- **SleepSheet** — ChildPicker (eligible sleep). For the picked child: if an open sleep exists → headline "Sleeping since 1:05 PM" (26 px), `RTimeStepper` (min = startAt, max = now), primary "End sleep" → `sleep.end`. Otherwise → "Start sleep" with `RTimeStepper` (min now−12h, max now), type chips Nap/Night pre-set by `classifySleep(at, nightWindowFor(child, household.defaultNightSleep), tz)` and re-derived when the time changes unless the adult changed the chip → `sleep.start`. WhoRow optional.
- **FeedingSheet** — ChildPicker (feeding); type chips Milk / Meal / Snack; amount chips: Milk → 2 oz, 4 oz, 6 oz, 8 oz; Meal/Snack → A little, Some, All (optional; tapping again clears); `RTimeStepper` (min now−12h); optional note `RInput` (≤ 200); WhoRow optional → `feeding.add`.
- **DiaperSheet** — ChildPicker (diaper); chips Wet / Dirty / Both (required); time; WhoRow optional → `diaper.add`.
- **StickerSheet** — ChildPicker (stickers); category chips from `snapshot.stickerCategories` (required); WhoRow optional → `sticker.add`, then shows `StickerCelebration` (full-screen overlay, star + "Sticker for Ivy!" 44 px, `roost-pop` animation, auto-dismiss after 1.8 s or tap; plays `playChime()` unless muted) before closing.
- **`sound.ts`** — `unlockAudio()` (called on first pointerdown in `main.ts`), `playChime()` using a short WebAudio two-tone (no asset files), `setMuted(boolean)` (Nap/Night Mode arrive in Phase 3; default unmuted).
- **JotSheet** — textarea (label "What do you want to remember?", 22 px, ≤ 500) → `jot.add`.
- **GrocerySheet** — `RInput` "Add an item" + Add button (Enter also adds; ≤ 100; trims; ignores empty) → `grocery.add` and the sheet stays open; list of items (unchecked first, then checked within 24 h struck through `text-ink-3`), each row: 60 px checkbox-style button toggling `grocery.check` and a 60 px ✕ `aria-label="Remove <item>"` → `grocery.delete`; footer secondary button "Take list" disabled with helper text "Coming soon" (18 px).
- **StaleSleepSheet** — props `childId`; shows "Ivy's sleep started at 8:02 PM yesterday and was never ended." (22 px); `RTimeStepper` (min = startAt, max = now, default = now) + "End sleep" → `sleep.end`; secondary danger "Discard this sleep" → confirm step ("Discard? This removes the sleep log.") → `sleep.discard`.
- **DinnerSheet** — `RInput` "Tonight's dinner" (≤ 80) prefilled; Save → `dinner.set`; "Clear" → `dinner.set` with null.
- **ConsentStep** — give each checkbox an explicit `id` and `<label for>` (or `aria-labelledby`) so its accessible name is the sentence.

- [ ] Tests (`logSheetModel.test.ts`, `sheets.test.ts` with a fake log store/writer and the demo snapshot): eligibility per kind for Ivy (3 y) and Theo (15 mo); default child; sleep start/end commands and auto type; feeding amount chips switch with type; grocery add/check/delete stays open; stale sleep end/discard; dinner set/clear; sticker celebration shows the child's name.
- [ ] Commit — `feat(logs): sleep, feeding, diaper, sticker, jot, grocery, stale-sleep and dinner sheets`

---

### Task 8: Medicine sheet, conflict acknowledgement, dose undo

**Files:**
- Create: `src/features/logs/MedicineSheet.vue`, `src/features/logs/medicine.test.ts`
- Modify: `src/features/main/ConflictBanner.vue` (already emits `acknowledge(doseId)`)

- **MedicineSheet** — ChildPicker (children with medicines, no default unless exactly one); medicine chips for the picked child (`snapshot.medicines` where `childId` matches; shows "Every 6h · max 4/day" 18 px under each name); `RTimeStepper` (min now−24h, max now); **WhoRow required** (members only; sitter support arrives in Phase 3); note `RInput` (≤ 200, placeholder "e.g. 5 ml"). Live warnings: `checkDose(medicine, view.doses, at)` → `doseWarningMessages` in a warning panel (`bg-orange-tint text-warn-ink`, 22 px, warning icon). Footer button: "Save" when no warnings; "Confirm and save" when warnings (it records `warningsConfirmed` = warning kinds); disabled until child, medicine and Who are chosen. When `logStore.submit` throws `NeedsOfflineDoseConfirmation`, show the confirmation step: "Can't check whether another adult gave a dose. Log anyway?" with "Log anyway" (→ resubmit with `confirmOffline: true`) and "Cancel". Copy under the title: "Timing only — follow the label or your doctor for amounts." (18 px `ink-3`).
- **Conflict acknowledgement** — in `MainScreen`, `ConflictBanner`'s `acknowledge(doseId)` opens `RPinPad` titled "Acknowledge dose alert"; on `verified` → `logStore.submit({ kind: 'dose.acknowledge', … })`; errors show in the pad. Offline → message "Connect to acknowledge."
- **Dose undo** — when `logStore.undo()` returns `'needsPin'`, `MainScreen` opens `RPinPad` titled "Undo dose" → `dose.void` with reason `Undone within 10 seconds`.

- [ ] Tests: warnings appear for the demo ibuprofen when logging 1 h after the seeded dose; button label switches; `warningsConfirmed` recorded; Who required; offline confirmation path; acknowledge flow calls submit with the verified membership; dose undo opens the PIN pad.
- [ ] Commit — `feat(logs): medicine sheet with warnings, offline confirmation, conflict acknowledgement and dose undo`

---

### Task 9: Wire into the main screen and verify

**Files:**
- Create: `src/features/logs/UndoToast.vue`
- Modify: `src/features/main/MainScreen.vue`, `KidCard.vue`, `DinnerLine.vue`, `src/main.ts`, `src/features/main/MainScreen.test.ts`

- **MainScreen** — on mount (after the source): `logStore.init(await selectWriter(), createOfflineQueue())`. Render from `householdStore.view` (overlay applied) instead of `snapshot`. `LogRow` `open(kind)` → the matching sheet (remove the Phase 2b placeholder toast). A "Syncing N…" 16 px badge next to Offline when `logStore.pendingCount > 0`. Failures from replay show a dismissible banner "A log couldn't be saved: <message>".
- **KidCard** — when `card.sleep.kind === 'stale'`, the card is a 60 px-tall-minimum button area ("tap to fix" → `StaleSleepSheet`); emits `fixSleep(childId)`.
- **DinnerLine** — wrap in `RLongPress` (600 ms) → `DinnerSheet`.
- **UndoToast** — bottom-center above the log row, `bg-ink text-surface`, 22 px "Saved" / "Saved offline — will sync", "Undo" button (60 px), visible while `logStore.lastAction` is set; tapping Undo → `logStore.undo()`; `'needsPin'` → PIN pad flow.
- **main.ts** — `window.addEventListener('pointerdown', unlockAudio, { once: true })`.
- **MainScreen.test.ts** — demo mode: long-press Feeding → sheet → pick Theo → Milk → 6 oz → Save → card shows "Milk · 0m ago" and the undo toast; Undo → previous feeding line returns.

- [ ] `pnpm test`, `pnpm typecheck`, `pnpm build` green. Commit — `feat(main): open log sheets, undo toast, stale sleep fix and dinner edit`.
- [ ] **Controller verification on real Supabase** (not a subagent step): `supabase db reset`, `pnpm dev`, join as `sam@roost.test`; log a feeding, a sleep start/end, a medicine dose 1 h after the seeded one (warning → confirm), a sticker, a grocery add/check/delete, a jot, dinner edit; undo a feeding; undo a dose via PIN 1234; go offline (DevTools network offline via `navigator` isn't scriptable — use `supabase stop` for the API or block the port) and log a feeding → "Saved offline"; bring it back → syncs; check rows in the database.

