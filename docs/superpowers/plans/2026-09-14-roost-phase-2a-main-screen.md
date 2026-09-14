# Roost Phase 2a: Main Screen (read path) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A registered display shows the real main screen — clock, date, kid cards (wake window, feeding, Now → Next), medicine status, dose-conflict banner, tonight's dinner, and the log-button row — driven by a household snapshot that refreshes on realtime changes. A demo data source renders the same screen with no backend.

**Architecture:** A `HouseholdSource` interface loads a `HouseholdSnapshot` (camelCase domain objects) and notifies on change. Two implementations: `supabaseSource` (queries + realtime channel → debounced reload) and `demoSource` (in-memory fixture relative to now, selected with `VITE_DATA_SOURCE=demo`). A Pinia store holds the snapshot; a pure `buildMainScreenModel(snapshot, now)` turns it into display strings; Vue components only render the model.

**Tech Stack:** Vue 3.5, Pinia, Supabase JS v2 realtime, Vitest + @vue/test-utils, existing `src/domain/*`.

**Spec:** `docs/superpowers/specs/2026-09-14-roost-design.md` §4, §7.2, §7.3 (visual guard only; writes arrive in 2b), §13 (offline badge, stale data).
**Design reference:** `docs/design/handoff/project/Roost Family App v2.dc.html` lines 37–165 (main screen), 72–81 (compact cards), 102–115 (conflict banner, medicine line), 150–160 (log row). Spec rules win over the mockup where they conflict (text tiers, 60 pt targets, contrast, person colors from `src/ui/personPalette.ts`).

**Phase 2b (next plan):** log sheets, long-press guard, PIN pad, undo toast, offline queue, dose void/acknowledge RPC calls.

## Constraints learned in Phase 1

- Docker is broken on the build machine: no `supabase start`. Database changes are validated with `supabase/manual-checks/validate-local.sh` + `rls_smoke.sql` on plain Postgres. Frontend verification uses the demo source.
- Configuration tables (`households`, `children`, `medicines`, `routines`, `sticker_categories`, `feature_overrides`, `routine_day_overrides`, `photos`, `take_list_links`) are **read-only** to clients; writes go through RPCs. Log/list tables (`sleep_entries`, `feeding_entries`, `sticker_entries`, `diaper_entries`, `routine_progress`, `jots`, `grocery_items`, `sitter_sessions`) accept member writes. `dose_entries`: insert only; void/acknowledge via `void_dose` / `acknowledge_dose_conflict`.
- Every entry row has `logged_by_name` (server-filled snapshot).
- Domain API (already implemented, see `src/domain/*.ts`): `sleepStatus(entries, childId, now)` → `sleeping | awake | stale | unknown`; `recentDoses`, `checkDose` (warnings have `gapMs`, `direction`), `unacknowledgedConflicts(medicines, doses)` using `DoseEntry.createdAt`; `isFeatureEnabled`; `routineForDay`, `currentStepIndex`, `nextStepIndex`; `householdDate`, `householdWeekday`, `minutesOfDay`, `formatClock`, `formatDuration`.

## File Structure

```
src/
  data/
    snapshot.ts            HouseholdSnapshot and related types
    mappers.ts             DB row → domain object mappers (+ mappers.test.ts)
    householdSource.ts     HouseholdSource interface + selectSource()
    supabaseSource.ts      queries + realtime subscription
    demo/
      demoFixture.ts       Rivera fixture relative to `now` (+ demoFixture.test.ts)
      demoSource.ts        HouseholdSource over the fixture
  stores/
    householdStore.ts      Pinia: snapshot, status (loading/ready/error), lastLoadedAt, offline flag
  composables/
    useNow.ts              ticking `now` ref that pauses when the page is hidden (+ test)
  features/
    main/
      mainScreenModel.ts   pure view model (+ mainScreenModel.test.ts)
      MainScreen.vue       page: header, zones, log row
      KidCard.vue          full card
      KidCardCompact.vue   compact card (5–8 kids)
      MedicineZone.vue     recent dose lines
      ConflictBanner.vue   unacknowledged offline dose conflicts
      DinnerLine.vue       tonight's dinner (read-only in 2a)
      LogRow.vue           log buttons (visual long-press ring only in 2a; emits `open`)
      MainScreen.test.ts   renders the demo snapshot
  ui/
    RoutineIcon.vue        placeholder line icons keyed by iconKey (from design L996–1008)
```

---

### Task 1: Snapshot types and row mappers

**Files:**
- Create: `src/data/snapshot.ts`, `src/data/mappers.ts`, `src/data/mappers.test.ts`

- [ ] **Step 1: Snapshot types**

`src/data/snapshot.ts`:

```ts
import type {
  Child, DiaperEntry, DoseEntry, Feature, FeedingEntry, HouseholdDate, IsoTimestamp,
  Medicine, Routine, SleepEntry, StickerEntry, TimeWindow,
} from '@/domain/types'

export interface HouseholdInfo {
  id: string
  name: string
  timeZone: string
  defaultNightSleep: TimeWindow
  nightMode: TimeWindow
  leaveByBufferMin: number
  diaperLogEnabled: boolean
  dinnerTonight: string | null
}

export interface Member {
  id: string
  displayName: string
  color: string
  role: 'owner' | 'adult' | 'caregiver'
}

export interface SnapshotChild extends Child {
  sortOrder: number
  overrides: Partial<Record<Feature, boolean>>
}

export interface StickerCategory {
  id: string
  name: string
  iconKey: string
  sortOrder: number
}

export interface RoutineProgress {
  childId: string
  routineId: string
  day: HouseholdDate
  completed: number[]
}

export interface RoutineDayOverride {
  childId: string
  day: HouseholdDate
  routineId: string
}

export interface Jot {
  id: string
  text: string
  createdAt: IsoTimestamp
  doneAt: IsoTimestamp | null
}

export interface GroceryItem {
  id: string
  text: string
  createdAt: IsoTimestamp
  checkedAt: IsoTimestamp | null
}

export interface SitterSession {
  id: string
  sitterName: string | null
  startedAt: IsoTimestamp
  endedAt: IsoTimestamp | null
}

export interface HouseholdSnapshot {
  household: HouseholdInfo
  members: Member[]
  children: SnapshotChild[]
  medicines: Medicine[]
  doses: DoseEntry[]
  sleeps: SleepEntry[]
  feedings: FeedingEntry[]
  diapers: DiaperEntry[]
  stickerCategories: StickerCategory[]
  stickers: StickerEntry[]
  routines: Routine[]
  routineProgress: RoutineProgress[]
  routineOverrides: RoutineDayOverride[]
  jots: Jot[]
  groceries: GroceryItem[]
  activeSitterSession: SitterSession | null
  loadedAt: IsoTimestamp
}
```

- [ ] **Step 2: Write the failing mapper tests**

`src/data/mappers.test.ts` must cover, with literal row objects shaped like `Tables<'…'>` from `src/data/database.types.ts`:
- `toHousehold`: `time` columns `'18:00:00'` → `'18:00'`; `dinner_tonight` null passes through.
- `toChild`: `night_sleep_start/end` null → `nightSleep: null`; both set → `{ start: '19:00', end: '06:00' }`; overrides rows `[{ feature: 'wakeWindow', enabled: true }]` → `{ wakeWindow: true }`; unknown feature strings are ignored.
- `toMedicine`: `min_interval_hours` given as the string `'6.0'` (PostgREST numeric) → `6`; `max_doses_per_24h` null → null.
- `toDose`: maps `logged_by_name`, `logged_offline`, `voided_at`, `conflict_acknowledged_at`, `created_at`, `note`, `warnings_confirmed`.
- `toRoutine`: `weekdays` passes through; `steps` JSON with a malformed step (missing `label`) throws `Error('Invalid routine step')`; valid steps map to `RoutineStep` with `iconKey`, `photoId`, `label`, `time` (null or `'HH:mm'`).
- `toSleep`, `toFeeding`, `toDiaper`, `toSticker`, `toStickerCategory`, `toRoutineProgress`, `toRoutineOverride`, `toJot`, `toGrocery`, `toSitterSession`, `toMember`: field-by-field mapping.

Run: `pnpm test src/data/mappers.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement mappers**

`src/data/mappers.ts`: one exported function per entity above, typed `(row: Tables<'table'>) => DomainType` (import `Tables` from `./database.types`). Helpers:

```ts
const hm = (t: string): string => t.slice(0, 5)

function toRoutineStep(raw: unknown): RoutineStep {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid routine step')
  const s = raw as Record<string, unknown>
  if (typeof s.label !== 'string') throw new Error('Invalid routine step')
  const time = typeof s.time === 'string' ? s.time.slice(0, 5) : null
  return {
    iconKey: typeof s.iconKey === 'string' ? s.iconKey : null,
    photoId: typeof s.photoId === 'string' ? s.photoId : null,
    label: s.label,
    time,
  }
}

const FEATURES: readonly Feature[] = ['wakeWindow', 'feeding', 'kidsCorner', 'diaper']
```

`toChild(row, overrideRows: { feature: string; enabled: boolean }[])` builds `overrides` only for known features. Member `role` is narrowed with a guard that throws on an unknown role.

Run: `pnpm test src/data/mappers.test.ts && pnpm typecheck` → PASS.

- [ ] **Step 4: Commit** — `feat(data): household snapshot types and row mappers`

---

### Task 2: Demo fixture and demo source

**Files:**
- Create: `src/data/householdSource.ts`, `src/data/demo/demoFixture.ts`, `src/data/demo/demoFixture.test.ts`, `src/data/demo/demoSource.ts`

- [ ] **Step 1: Source interface**

`src/data/householdSource.ts`:

```ts
import type { HouseholdSnapshot } from './snapshot'

export interface HouseholdSource {
  /** Load the current snapshot for a household. */
  load(householdId: string, now: Date): Promise<HouseholdSnapshot>
  /** Call `onChange` whenever household data may have changed. Returns an unsubscribe function. */
  subscribe(householdId: string, onChange: () => void): () => void
}

export const isDemo = import.meta.env.VITE_DATA_SOURCE === 'demo'

export const DEMO_DISPLAY = {
  displayId: 'demo-display',
  householdId: 'aaaaaaaa-0000-0000-0000-000000000001',
  name: 'Kitchen',
} as const
```

Add `readonly VITE_DATA_SOURCE?: 'demo' | 'supabase'` to `ImportMetaEnv` in `env.d.ts`.

- [ ] **Step 2: Write the failing fixture test**

`src/data/demo/demoFixture.test.ts` — `buildDemoSnapshot(now)` with `now = new Date('2026-09-14T19:00:00Z')` (3:00 PM EDT, Monday):
- household "Rivera", time zone `America/New_York`, dinner "Tacos", diaper log off
- members Sam (owner) and Alex (adult), colors from `PERSON_COLORS`
- children Ivy (born 2023-04-10, night sleep 19:00–06:00) and Theo (born 2025-06-02, household default window); colors from `PERSON_COLORS` distinct from members
- Theo: a night sleep ended 9 h ago and a nap that ended 2 h 40 m ago → `sleepStatus(snapshot.sleeps, theo, now)` is `awake` for 160 minutes
- Theo: milk feeding 70 minutes ago
- Theo: infant ibuprofen (6 h, max 4) dose 2 h ago by Sam; infant acetaminophen (4 h, max 5); Ivy: children's ibuprofen (6 h, max 4)
- Ivy: Home day routine (Mon–Fri, 9 steps from the seed with the same labels/icons/times), Weekend routine; routine progress for today with steps 0–2 completed
- sticker categories Potty/Teeth/Tried a new food; Ivy potty sticker 1 h ago
- grocery "Whole milk", "Bananas"; jot "Call pediatrician about Theo's rash"
- all timestamps are ISO strings derived from `now`; `loadedAt === now.toISOString()`
- `activeSitterSession` null
- An option `buildDemoSnapshot(now, { conflict: true })` adds an offline-logged Theo ibuprofen dose 1 h ago (createdAt 30 m ago, loggedByName "Alex") so `unacknowledgedConflicts` returns it; `{ manyKids: true }` adds four more children (6 total) with distinct names and birthdays spanning 8 months to 6 years.

Run → FAIL.

- [ ] **Step 3: Implement fixture and source**

`src/data/demo/demoFixture.ts` exports `buildDemoSnapshot(now: Date, options?: { conflict?: boolean; manyKids?: boolean }): HouseholdSnapshot`. Use the same UUIDs as `supabase/seed.sql` for household, members, children, medicines, sticker categories. Relative helper: `const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()`.

`src/data/demo/demoSource.ts`:

```ts
import type { HouseholdSource } from '../householdSource'
import { buildDemoSnapshot } from './demoFixture'

function optionsFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return { conflict: params.has('conflict'), manyKids: params.has('manyKids') }
}

export const demoSource: HouseholdSource = {
  async load(_householdId, now) {
    return buildDemoSnapshot(now, optionsFromUrl())
  },
  subscribe() {
    return () => {}
  },
}
```

Run: `pnpm test src/data/demo && pnpm typecheck` → PASS.

- [ ] **Step 4: Commit** — `feat(data): demo household fixture and source`

---

### Task 3: Supabase source

**Files:**
- Create: `src/data/supabaseSource.ts`, `src/data/supabaseSource.test.ts`

- [ ] **Step 1: Write the failing test** with a fake client (object with `from(table)` returning a chainable query builder recorded per table, resolving `{ data, error }`; and `channel(name)` returning `{ on, subscribe }` recording `postgres_changes` registrations; `removeChannel`). Assert:
- `load` queries each table with the windows below and maps rows through `mappers.ts` into a `HouseholdSnapshot`.
- A query error rejects `load` with that error's message.
- `subscribe(householdId, cb)` registers `postgres_changes` for every published household table with `filter: 'household_id=eq.<id>'` (for `households` use `id=eq.<id>`; `children`, `child_households`, `feature_overrides` register without a filter because they lack `household_id`), and calling the returned function removes the channel.
- Multiple change events within 300 ms call `cb` once (debounce; use fake timers).

- [ ] **Step 2: Implement** `createSupabaseSource(client: RoostClient): HouseholdSource`. Query windows relative to `now`:

| Table | Filter |
|---|---|
| `households` | `id = householdId`, single |
| `memberships` | `household_id`, `left_at is null`; select `id, display_name, color, role` |
| `children` | all visible (RLS scopes them), order `sort_order` |
| `feature_overrides` | all visible |
| `medicines` | `household_id`, `archived_at is null` |
| `dose_entries` | `household_id`, `at >= now − 48h` |
| `sleep_entries` | `household_id`, `or(start_at.gte.<now−48h>, end_at.is.null)` |
| `feeding_entries`, `diaper_entries` | `household_id`, `at >= now − 48h` |
| `sticker_categories` | `household_id`, `archived_at is null`, order `sort_order` |
| `sticker_entries` | `household_id`, `at >= now − 8 days` |
| `routines` | `household_id`, order `sort_order` |
| `routine_progress`, `routine_day_overrides` | `household_id`, `day = householdDate(now, tz)` (load `households` first to know `tz`) |
| `jots` | `household_id`, `done_at is null` |
| `grocery_items` | `household_id`, `or(checked_at.is.null, checked_at.gte.<now−24h>)` |
| `sitter_sessions` | `household_id`, `ended_at is null`, `maybeSingle` |

Run all queries after `households` in parallel (`Promise.all`). Realtime: one channel `household:<id>`; debounce reloads by 300 ms.

Run: `pnpm test src/data/supabaseSource.test.ts && pnpm typecheck` → PASS.

- [ ] **Step 3: Source selection** — add to `src/data/householdSource.ts`:

```ts
export async function selectSource(): Promise<HouseholdSource> {
  if (isDemo) return (await import('./demo/demoSource')).demoSource
  const [{ displayClient }, { createSupabaseSource }] = await Promise.all([
    import('./supabase'),
    import('./supabaseSource'),
  ])
  return createSupabaseSource(displayClient)
}
```

- [ ] **Step 4: Commit** — `feat(data): Supabase household source with realtime reloads`

---

### Task 4: Household store and ticking clock

**Files:**
- Create: `src/stores/householdStore.ts`, `src/stores/householdStore.test.ts`, `src/composables/useNow.ts`, `src/composables/useNow.test.ts`

- [ ] **Step 1: `useNow` (test first)**

Behavior: `useNow(intervalMs = 15_000)` returns a `Ref<Date>` updated every `intervalMs`; when `document.visibilityState` becomes `hidden` the interval stops, and on `visible` it updates immediately and restarts; cleans up on scope dispose (`onScopeDispose`). Test with fake timers inside `effectScope()`.

- [ ] **Step 2: Store (test first)**

`useHouseholdStore` (setup-style Pinia store) state: `snapshot: HouseholdSnapshot | null`, `status: 'idle' | 'loading' | 'ready' | 'error'`, `error: string | null`, `online: boolean` (from `navigator.onLine` + `online`/`offline` events). Actions:
- `start(householdId: string, source: HouseholdSource)`: loads, subscribes (`onChange` → `reload()`), registers `online` listener that reloads when connectivity returns. Idempotent for the same household.
- `reload()`: loads with `new Date()`; on failure keeps the previous snapshot, sets `status: 'error'` only if there was no snapshot, and records `error`.
- `stop()`: unsubscribes and removes listeners.
Getter: `staleMinutes(now: Date)` → minutes since `snapshot.loadedAt` (0 if none).

Tests use a fake `HouseholdSource` and assert: load on start, reload on change callback, previous snapshot kept on failure, stop unsubscribes, online event triggers reload.

- [ ] **Step 3: Commit** — `feat(state): household store and visibility-aware clock`

---

### Task 5: Main screen view model

**Files:**
- Create: `src/features/main/mainScreenModel.ts`, `src/features/main/mainScreenModel.test.ts`

Spec §7.2. The model is pure: all strings the screen shows come from here.

- [ ] **Step 1: Write the failing tests** using `buildDemoSnapshot` (Task 2) at `now = 2026-09-14T19:00:00Z` (3:00 PM EDT Monday):
- `clock` = `'3:00 PM'`; `dateLabel` = `'Monday, September 14'`.
- `layout` = `'full'` with 2 kids; `'compact'` with `manyKids`.
- Theo card: `ageLabel` `'1 yr'`; `sleep` = `{ kind: 'awake', label: 'Awake 2h 40m' }`; `feeding` = `'Milk · 1h 10m ago'`; `nowNext` null (kidsCorner off at 15 months).
- Ivy card: `ageLabel` `'3 yrs'`; `sleep` null (3 years old, no sleep entry in the last 18 h); `feeding` null; `nowNext.now.label` = the current Home day step at 15:00 given steps 0–2 completed (compute with `currentStepIndex`; with the seed times the anchor is Nap 12:30 → current is "Nap" if not completed); `nowNext.next.label` = following unfinished step.
- Sleep labels: sleeping → `'Sleeping 45m'`; stale → `'Still sleeping?'`; unknown (feature on, no data) → `'Log wake-up'`.
- A child over 3 with a sleep entry started in the last 18 h shows the sleep line.
- Age labels: 5 months `'5 mo'`, 15 months `'1 yr'`, 39 months `'3 yrs'`.
- `medicine`: one line `{ childName: 'Theo', childColor, medicineName: 'Infant ibuprofen', givenAt: '1:00 PM', givenBy: 'Sam', nextAfter: '7:00 PM', nextAllowed: false }`.
- `conflicts`: empty by default; with `{ conflict: true }` one entry `{ doseId, childName: 'Theo', medicineName: 'Infant ibuprofen', message: 'Theo · Infant ibuprofen logged offline at 2:00 PM by Alex conflicts with another dose.' }`.
- `dinner` = `'Tacos'`; null when `dinnerTonight` is null or blank.
- `logButtons` = `['sleep','feeding','medicine','sticker','jot','grocery']`; with `diaperLogEnabled` → `[..., 'diaper']`.
- Kid cards ordered by `sortOrder`.

- [ ] **Step 2: Implement**

```ts
import { ageInMonths, isFeatureEnabled } from '@/domain/ageDefaults'
import { recentDoses, unacknowledgedConflicts } from '@/domain/medicine'
import { currentStepIndex, nextStepIndex, routineForDay } from '@/domain/routines'
import { sleepStatus } from '@/domain/sleep'
import { formatClock, formatDuration, householdDate, householdWeekday, minutesOfDay } from '@/domain/time'
import type { Feature } from '@/domain/types'
import type { HouseholdSnapshot, SnapshotChild } from '@/data/snapshot'

export type LogKind = 'sleep' | 'feeding' | 'medicine' | 'sticker' | 'jot' | 'grocery' | 'diaper'

export interface StepModel { label: string; iconKey: string | null }

export interface KidCardModel {
  childId: string
  name: string
  color: string
  ageLabel: string
  sleep: { kind: 'awake' | 'sleeping' | 'stale' | 'unknown'; label: string } | null
  feeding: string | null
  nowNext: { now: StepModel | null; next: StepModel | null } | null
}

export interface MedicineLineModel {
  doseChildId: string
  childName: string
  childColor: string
  medicineName: string
  givenAt: string
  givenBy: string | null
  nextAfter: string
  nextAllowed: boolean
}

export interface ConflictModel { doseId: string; childName: string; medicineName: string; message: string }

export interface MainScreenModel {
  clock: string
  dateLabel: string
  layout: 'full' | 'compact'
  kidCards: KidCardModel[]
  medicine: MedicineLineModel[]
  conflicts: ConflictModel[]
  dinner: string | null
  logButtons: LogKind[]
}

const SLEEP_LINE_LOOKBACK_MS = 18 * 3_600_000
const FEEDING_LOOKBACK_MS = 24 * 3_600_000
const dateFormatters = new Map<string, Intl.DateTimeFormat>()

function formatDateLabel(now: Date, timeZone: string): string {
  let f = dateFormatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone })
    dateFormatters.set(timeZone, f)
  }
  return f.format(now)
}

export function ageLabel(months: number): string {
  if (months < 12) return `${Math.max(0, months)} mo`
  if (months < 24) return '1 yr'
  return `${Math.floor(months / 12)} yrs`
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function buildMainScreenModel(s: HouseholdSnapshot, now: Date): MainScreenModel {
  const tz = s.household.timeZone
  const today = householdDate(now, tz)
  const enabled = (child: SnapshotChild, feature: Feature) =>
    isFeatureEnabled(feature, {
      birthday: child.birthday,
      today,
      overrides: child.overrides,
      diaperLogEnabled: s.household.diaperLogEnabled,
    })
  const children = [...s.children].sort((a, b) => a.sortOrder - b.sortOrder)
  const byChild = new Map(children.map((c) => [c.id, c]))
  const t = now.getTime()

  const kidCards = children.map((child): KidCardModel => {
    const recentSleep = s.sleeps.some(
      (e) => e.childId === child.id && (e.endAt === null || t - Date.parse(e.startAt) <= SLEEP_LINE_LOOKBACK_MS),
    )
    let sleep: KidCardModel['sleep'] = null
    if (enabled(child, 'wakeWindow') || recentSleep) {
      const st = sleepStatus(s.sleeps, child.id, now)
      sleep =
        st.kind === 'awake' ? { kind: 'awake', label: `Awake ${formatDuration(st.durationMs)}` }
        : st.kind === 'sleeping' ? { kind: 'sleeping', label: `Sleeping ${formatDuration(st.durationMs)}` }
        : st.kind === 'stale' ? { kind: 'stale', label: 'Still sleeping?' }
        : { kind: 'unknown', label: 'Log wake-up' }
    }

    let feeding: string | null = null
    if (enabled(child, 'feeding')) {
      const last = s.feedings
        .filter((f) => f.childId === child.id && t - Date.parse(f.at) <= FEEDING_LOOKBACK_MS && Date.parse(f.at) <= t)
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]
      if (last) feeding = `${capitalize(last.type)} · ${formatDuration(t - Date.parse(last.at))} ago`
    }

    let nowNext: KidCardModel['nowNext'] = null
    if (enabled(child, 'kidsCorner')) {
      const override = s.routineOverrides.find((o) => o.childId === child.id && o.day === today)
      const routine = routineForDay(s.routines, child.id, householdWeekday(now, tz), override?.routineId ?? null)
      if (routine) {
        const completed = s.routineProgress.find((p) => p.childId === child.id && p.routineId === routine.id && p.day === today)?.completed ?? []
        const current = currentStepIndex(routine, completed, minutesOfDay(now, tz))
        const next = current === null ? null : nextStepIndex(routine, completed, current)
        const step = (i: number | null): StepModel | null => {
          if (i === null) return null
          const st = routine.steps[i]
          return st ? { label: st.label, iconKey: st.iconKey } : null
        }
        nowNext = { now: step(current), next: step(next) }
      }
    }

    return {
      childId: child.id,
      name: child.name,
      color: child.color,
      ageLabel: ageLabel(ageInMonths(child.birthday, today)),
      sleep,
      feeding,
      nowNext,
    }
  })

  const medicineById = new Map(s.medicines.map((m) => [m.id, m]))
  const medicine = recentDoses(s.medicines, s.doses, now).map((d): MedicineLineModel => {
    const child = byChild.get(d.childId)
    return {
      doseChildId: d.childId,
      childName: child?.name ?? '',
      childColor: child?.color ?? '#5C6B7C',
      medicineName: d.medicineName,
      givenAt: formatClock(d.givenAt, tz),
      givenBy: d.givenBy,
      nextAfter: formatClock(d.nextAfter, tz),
      nextAllowed: d.nextAllowed,
    }
  })

  const conflicts = unacknowledgedConflicts(s.medicines, s.doses).map((d): ConflictModel => {
    const childName = byChild.get(d.childId)?.name ?? ''
    const medicineName = medicineById.get(d.medicineId)?.name ?? ''
    const by = d.loggedByName ? ` by ${d.loggedByName}` : ''
    return {
      doseId: d.id,
      childName,
      medicineName,
      message: `${childName} · ${medicineName} logged offline at ${formatClock(new Date(d.at), tz)}${by} conflicts with another dose.`,
    }
  })

  const logButtons: LogKind[] = ['sleep', 'feeding', 'medicine', 'sticker', 'jot', 'grocery']
  if (s.household.diaperLogEnabled) logButtons.push('diaper')

  return {
    clock: formatClock(now, tz),
    dateLabel: formatDateLabel(now, tz),
    layout: children.length > 4 ? 'compact' : 'full',
    kidCards,
    medicine,
    conflicts,
    dinner: s.household.dinnerTonight?.trim() || null,
    logButtons,
  }
}
```

Run: `pnpm test src/features/main/mainScreenModel.test.ts && pnpm typecheck` → PASS. If a test's expected string disagrees with a domain rule, fix the test expectation and report why.

- [ ] **Step 3: Commit** — `feat(main): main screen view model`

---

### Task 6: Main screen components and routing

**Files:**
- Create: `src/ui/RoutineIcon.vue`, `src/features/main/MainScreen.vue`, `KidCard.vue`, `KidCardCompact.vue`, `MedicineZone.vue`, `ConflictBanner.vue`, `DinnerLine.vue`, `LogRow.vue`, `src/features/main/MainScreen.test.ts`
- Modify: `src/router.ts`, `src/session/displayStore.ts`
- Delete: `src/features/home/HomePlaceholder.vue`

Components render the `MainScreenModel` only (no domain calls inside components). Read the design file lines named at the top of this plan for layout, spacing, radii and hierarchy; apply the spec's rules instead of the mockup where they differ:

| Rule | Where |
|---|---|
| Glanceable ≥ 24 px: clock (132 px, tabular), kid status line (sleep, 40–46 px), next dose time, event titles, dinner | `MainScreen`, `KidCard`, `MedicineZone`, `DinnerLine` |
| Secondary ≥ 18 px: date, feeding line, Now/Next content, log labels, medicine given-by | same |
| Nothing < 16 px (badges, hints, uppercase section labels 16 px) | all |
| 60×60 minimum targets; log buttons ≥ 88 px tall | `LogRow`, header mode buttons |
| Person color always paired with `RAvatar` initial | `KidCard`, `KidCardCompact`, `MedicineZone` |
| Text colors: `ink`, `ink-2`, `ink-3`, deep accents; `faint` never for text | all |

- [ ] **Step 1: `RoutineIcon.vue`** — props `iconKey: string | null`, `size = 48`. Inline SVG paths copied from the design's routine icon library (v2 file lines ~996–1008, 48-unit viewBox, 2.4 stroke, `currentColor`) for keys: breakfast, teeth, shoes, car, nap, bath, books, bed, potty, park, snack, getting-dressed. Unknown or null key → a simple circle. Label via `aria-hidden="true"` (the text label sits next to it).

- [ ] **Step 2: Cards, zones, row**

- `KidCard.vue` (props `card: KidCardModel`): avatar 64 + name (24 px, 500) + age (18 px ink-3); sleep line (46 px, 600; `stale` shows the text in `orange-deep` with a small "tap to fix" hint 16 px — no action in 2a); feeding line 20 px; Now → Next row when present (labels "Now"/"Next" 16 px uppercase, step label 22 px with `RoutineIcon` 40 px).
- `KidCardCompact.vue`: avatar 48 + name 22 px + one status line 20 px (sleep label, else Now step, else age).
- `MedicineZone.vue` (props `lines: MedicineLineModel[]`): hidden when empty. Each line: avatar 40, "Theo · Infant ibuprofen" 22 px, "1:00 PM by Sam" 18 px ink-2, "Next after 7:00 PM" 26 px 600 — `text-green-deep` with a check icon when `nextAllowed`, else `ink`.
- `ConflictBanner.vue` (props `conflicts: ConflictModel[]`): hidden when empty; `bg-orange-tint text-warn-ink` rounded 18 px, 22 px text, one row per conflict, an "Acknowledge" button (60 px tall) that emits `acknowledge(doseId)` — wired in 2b.
- `DinnerLine.vue` (props `dinner: string | null`): "Tonight" 16 px uppercase label + dinner 30 px; "Not planned" 22 px ink-3 when null.
- `LogRow.vue` (props `buttons: LogKind[]`): equal-width buttons ≥ 88 px tall, icon above label (design `logrow4` layout), label 20 px. Colors: medicine `orange`, sticker `amber`, feeding `green`, others `surface-2` with `ink` icon; label text uses the deep variant or `ink` for contrast. Emits `open(kind)` after a 600 ms press-and-hold with a circular fill ring (CSS conic-gradient animated via `requestAnimationFrame`); releasing early cancels. Respect `prefers-reduced-motion` by showing a static progress bar instead of the ring animation.

- [ ] **Step 3: `MainScreen.vue`**

- On mount: `const source = await selectSource()`; `householdStore.start(identity.householdId, source)` where identity comes from `useDisplayStore().state` (registered) or `DEMO_DISPLAY` when `isDemo`.
- `const now = useNow(15_000)`; `const model = computed(() => store.snapshot ? buildMainScreenModel(store.snapshot, now.value) : null)`.
- Layout (landscape grid, padding 36/40/32 like the design): header row — clock + date/weather placeholder (weather arrives in Phase 4; render nothing) + Offline badge (16 px, when `!store.online`) + mode buttons (Nap, Kids' Corner, Sitter, Settings: 60 px icon buttons, disabled with `aria-disabled` and a tooltip-free look until Phase 3); left column — kid cards (grid 2 columns full / 3 columns compact), conflict banner, medicine zone, dinner; right column — "Today" panel with text "Calendar arrives in Phase 4" (18 px ink-3) and "Updated N min ago" (16 px) only when `store.staleMinutes(now) > 5`; bottom — `LogRow` (emits `open`, which in 2a shows a 16 px toast "Logging arrives in Phase 2b" for 2 s).
- Loading: centered `RLogo` 64 px. Error with no snapshot: "Can't reach Roost Family. Retrying…" 24 px and retry every 30 s.

- [ ] **Step 4: Routing and demo boot**

- `src/router.ts`: `/home` → `MainScreen.vue`.
- `src/session/displayStore.ts`: when `isDemo`, `refresh()` returns `{ kind: 'registered', identity: DEMO_DISPLAY }` without touching Supabase.
- Delete `HomePlaceholder.vue`.

- [ ] **Step 5: Component test** — `MainScreen.test.ts`: mock `@/data/householdSource` so `selectSource` resolves the demo source and `isDemo` is true; mount with Pinia + memory router at `/home`; fake timers at `2026-09-14T19:00:00Z`; after flushing promises assert the text contains "3:00 PM", "Ivy", "Theo", "Awake 2h 40m", "Infant ibuprofen", "Next after 7:00 PM", "Tacos", and there are 6 log buttons. With `?manyKids` (set `window.history.replaceState`) assert 6 compact cards render.

- [ ] **Step 6: Verify and commit**

Run: `pnpm test && pnpm typecheck && pnpm build` → all pass.

Commit — `feat(main): main screen with kid cards, medicine, conflicts, dinner and log row`

---

### Task 7: Visual verification (controller)

Run `VITE_DATA_SOURCE=demo pnpm dev`, open `http://localhost:5173/home` at 1112×834, 1024×768 and 1366×1024; check `?conflict` and `?manyKids`. Confirm: nothing overflows or scrolls at 1024×768; text tiers and 60 px targets hold; avatars accompany every person color. Fix issues in the components and commit `fix(main): layout adjustments from visual check`.

