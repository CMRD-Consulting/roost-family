# Roost Phase 1: Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A locally running Roost Family app where an adult can sign in with an email code, create a household with kids, register the tablet as a display, and land on a placeholder home screen. All core domain rules (sleep, medicine, age defaults, routines, stickers, leave-by, sitter summary) are implemented as unit-tested pure functions.

**Architecture:** Vue 3 + Vite + TypeScript single-page app, installable later as a web app. Supabase (run locally with the CLI and Docker) provides Postgres with row-level security, Auth, and Realtime. The display signs in as a Supabase **anonymous user** that is bound to a `displays` row; adults sign in on a **second, in-memory Supabase client** that is discarded after use, so no adult session is ever persisted on the tablet. Business rules live in `src/domain/` as framework-free functions.

**Tech Stack:** Node 22, pnpm, Vue 3.5, vue-router 4, Pinia, Vite, Tailwind CSS 4 (`@tailwindcss/vite`), Vitest, `@supabase/supabase-js` 2, `date-fns` 4 + `@date-fns/tz`, `@fontsource/outfit`, Supabase CLI 2.x.

**Spec:** `docs/superpowers/specs/2026-09-14-roost-design.md` (Revision 3)
**Design reference:** `docs/design/handoff/project/Roost Family App v2.dc.html`

## Phases (this plan is Phase 1)

1. **Foundation** (this plan): scaffold, design tokens, domain logic, database schema + RLS, sessions, setup wizard, display registration
2. **Main screen & logs:** main screen, log sheets, toddler guard, PIN pad, realtime, offline queue
3. **Kids' Corner, Sitter Mode, Night & Nap Mode, Settings**
4. **Take list, calendar, weather, Manage household, installable app + update checks, error tracking**
5. **Launch gate** (external accounts required)

## Decisions made while planning (not in the spec)

| Topic | Decision | Why |
|---|---|---|
| Display identity | Supabase anonymous user bound to `displays.auth_user_id` via one-time claim token | Uses Supabase Auth and RLS natively; revocation = `revoked_at` |
| Adult session on a display | Second Supabase client with `persistSession: false` | Adult tokens live only in memory and vanish on reload |
| Household location | ZIP stored as text; lat/lon from the tablet's geolocation during setup (optional) | Avoids bundling a ZIP-centroid dataset; weather arrives in Phase 4 |
| Household settings | Columns on `households` instead of a separate table | One row per household either way; fewer joins |
| `household_id` on every entry table | Denormalized, validated by trigger | Realtime filters need a column; RLS stays one simple check |
| Add-adult authorization | Owner full sign-in (spec §6.3) rather than PIN (spec §6.4 step 1) | Stricter of two conflicting spec statements; built in Phase 3 |

## File Structure (Phase 1)

```
roost/
  .nvmrc                         Node version (22)
  package.json                   scripts + deps
  vite.config.ts                 Vue + Tailwind plugins, Vitest config
  tsconfig.json                  TS config (app + tests)
  index.html                     app shell
  env.d.ts                       Vite env typing
  .env.example                   VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
  CLAUDE.md                      conventions for agents
  README.md                      local dev instructions
  src/
    main.ts                      app bootstrap
    App.vue                      root: <RouterView/>
    router.ts                    routes + boot guard
    styles/app.css               Tailwind import + @theme tokens
    domain/                      pure business rules, each with a colocated *.test.ts
      types.ts                   shared domain types
      time.ts                    household time zone helpers, formatting
      sleep.ts                   nap/night classification, wake window
      medicine.ts                next dose, early/over-max warnings, recent doses
      ageDefaults.ts             age-based feature defaults
      routines.ts                routine selection, current/next step
      stickers.ts                week grid
      leaveBy.ts                 leave-by countdown
      sitterSummary.ts           "While You Were Out" aggregation
    data/
      supabase.ts                display client + adult client factory
      database.types.ts          generated from local schema
    session/
      displaySession.ts          anonymous sign-in, claim, current display
      adultSession.ts            email OTP sign-in on in-memory client
    ui/
      RButton.vue                primary/secondary/ghost button (tiered sizes)
      RAvatar.vue                person initial + color (never color alone)
      RInput.vue                 labeled text input
    features/
      setup/
        SetupWizard.vue          step machine
        steps/WelcomeStep.vue
        steps/InviteStep.vue
        steps/SignInStep.vue
        steps/ConsentStep.vue
        steps/HouseholdStep.vue
        steps/KidsStep.vue
        steps/YouStep.vue
        steps/DisplayStep.vue
        wizardState.ts           reactive wizard data
      home/
        HomePlaceholder.vue      proves registration: household + kids
  supabase/
    config.toml
    migrations/
      20260914000001_schema.sql
      20260914000002_rls_and_rpcs.sql
    seed.sql
```

---

### Task 1: Scaffold the app

**Files:**
- Create: `.nvmrc`, `.gitignore`, `package.json`, `vite.config.ts`, `tsconfig.json`, `env.d.ts`, `index.html`, `.env.example`, `src/main.ts`, `src/App.vue`, `src/router.ts`, `src/styles/app.css`, `src/domain/smoke.test.ts`

- [ ] **Step 1: Pin Node and create package.json**

```bash
cd /Users/cmitchell/www/cmrd/apps/roost
echo "22" > .nvmrc
source ~/.nvm/nvm.sh && nvm use 22
```

Create `package.json`:

```json
{
  "name": "roost",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "vue-tsc --noEmit",
    "db:start": "supabase start",
    "db:stop": "supabase stop",
    "db:reset": "supabase db reset",
    "db:types": "supabase gen types typescript --local > src/data/database.types.ts"
  }
}
```

Create `.gitignore`:

```
node_modules
dist
.env
.env.local
*.log
.DS_Store
supabase/.branches
supabase/.temp
coverage
```

- [ ] **Step 2: Install dependencies**

```bash
pnpm add vue vue-router pinia @supabase/supabase-js date-fns @date-fns/tz @fontsource/outfit
pnpm add -D vite @vitejs/plugin-vue typescript vue-tsc tailwindcss @tailwindcss/vite vitest @vue/test-utils jsdom @types/node
```

Expected: installs without errors; `pnpm-lock.yaml` created.

- [ ] **Step 3: Vite, TypeScript and env config**

`vite.config.ts`:

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { target: 'safari16' },
  server: { host: true, port: 5173 },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "jsx": "preserve",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client", "node"],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src/**/*.ts", "src/**/*.vue", "env.d.ts", "vite.config.ts"]
}
```

`env.d.ts`:

```ts
/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
```

`.env.example`:

```
# From `supabase status` after `pnpm db:start`
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=replace-with-local-anon-key
```

- [ ] **Step 4: App shell**

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="theme-color" content="#F5EEE3" />
    <title>roost family</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/styles/app.css` (tokens are filled in Task 2):

```css
@import 'tailwindcss';
```

`src/main.ts`:

```ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@fontsource/outfit/400.css'
import '@fontsource/outfit/500.css'
import '@fontsource/outfit/600.css'
import '@fontsource/outfit/700.css'
import './styles/app.css'
import App from './App.vue'
import { router } from './router'

createApp(App).use(createPinia()).use(router).mount('#app')
```

`src/App.vue`:

```vue
<template>
  <RouterView />
</template>
```

`src/router.ts` (real routes arrive in Task 16):

```ts
import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: '/', component: { template: '<p class="p-10 text-2xl">roost family</p>' } }],
})
```

- [ ] **Step 5: Smoke test**

`src/domain/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

describe('toolchain', () => {
  it('runs tests', () => {
    expect(1 + 1).toBe(2)
  })
})
```

Run: `pnpm test`
Expected: `1 passed`.

Run: `pnpm build`
Expected: build succeeds (the inline template route compiles at runtime; a warning about runtime compilation is acceptable and goes away in Task 16).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vue 3 + Vite + Tailwind 4 + Vitest app"
```

---

### Task 2: Design tokens and base UI components

**Files:**
- Modify: `src/styles/app.css`
- Create: `src/ui/RButton.vue`, `src/ui/RAvatar.vue`, `src/ui/RInput.vue`, `src/ui/personPalette.ts`, `src/ui/personPalette.test.ts`

Token values come from the v2 design (`Roost Family App v2.dc.html`) with the Revision 3 rules: deep accent variants for text, faint neutral never for text, and a separate 10-color person palette.

- [ ] **Step 1: Theme tokens**

Replace `src/styles/app.css`:

```css
@import 'tailwindcss';

@theme {
  --font-sans: 'Outfit', system-ui, -apple-system, sans-serif;

  /* Neutrals */
  --color-page: #e9dfd1;
  --color-app: #f5eee3;
  --color-surface: #fbf6ee;
  --color-surface-2: #efe4d3;
  --color-line: #d9cbb8;
  --color-ink: #2b211c;
  --color-ink-2: #5a4636;
  --color-ink-3: #75604f; /* muted text; darker than the design's #8A7468 to pass AA on surface */
  --color-faint: #b3a092; /* decoration only, never text */

  /* Accents: bright = icon/fill, deep = text */
  --color-orange: #e2703a;
  --color-orange-deep: #b8542a;
  --color-orange-tint: #f6ddd0;
  --color-warn-ink: #7a3418;
  --color-amber: #d9a441;
  --color-amber-deep: #8a5e0f;
  --color-amber-tint: #f5e6c4;
  --color-green: #5fa88c;
  --color-green-deep: #2f6b57;
  --color-green-tint: #ddede5;

  /* Kids' Corner */
  --color-corner: #f5e6c4;
  --color-corner-bar: #eed9a8;
  --color-corner-tile: #fbf3e0;

  /* Night */
  --color-night: #0e0b0a;

  --radius-sheet: 28px;
  --radius-card: 22px;
  --radius-button: 20px;
  --radius-control: 14px;
}

html,
body {
  background: var(--color-app);
  color: var(--color-ink);
  font-family: var(--font-sans);
  -webkit-tap-highlight-color: transparent;
  overscroll-behavior: none;
}

@keyframes roost-pop {
  0% { transform: scale(0.6); opacity: 0; }
  60% { transform: scale(1.08); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

- [ ] **Step 2: Write the failing person-palette test**

`src/ui/personPalette.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { PERSON_COLORS, LOG_BUTTON_COLORS, personColor } from './personPalette'

describe('person palette', () => {
  it('has 10 colors', () => {
    expect(PERSON_COLORS).toHaveLength(10)
  })

  it('shares no color with log buttons', () => {
    const logs = new Set(Object.values(LOG_BUTTON_COLORS).map((c) => c.toLowerCase()))
    for (const c of PERSON_COLORS) expect(logs.has(c.toLowerCase())).toBe(false)
  })

  it('repeats after 10 people', () => {
    expect(personColor(0)).toBe(PERSON_COLORS[0])
    expect(personColor(10)).toBe(PERSON_COLORS[0])
    expect(personColor(13)).toBe(PERSON_COLORS[3])
  })
})
```

Run: `pnpm test src/ui/personPalette.test.ts`
Expected: FAIL, cannot resolve `./personPalette`.

- [ ] **Step 3: Implement the palette**

`src/ui/personPalette.ts`:

```ts
/** Colors reserved for log buttons; person colors must never reuse these. */
export const LOG_BUTTON_COLORS = {
  medicine: '#E2703A',
  sticker: '#D9A441',
  feeding: '#5FA88C',
} as const

/**
 * Ten person colors. White initials on these meet 3:1 at >= 24pt bold (large text).
 * Colors repeat past 10 people; the avatar initial always disambiguates.
 */
export const PERSON_COLORS = [
  '#5B6ACF', // indigo
  '#C2477A', // raspberry
  '#2F86A6', // ocean
  '#8A56AC', // plum
  '#5C6B7C', // slate
  '#7A5236', // cocoa
  '#2F7FB8', // sky
  '#7F68C4', // lilac
  '#C45A7C', // rose
  '#34507A', // navy
] as const

export function personColor(index: number): string {
  return PERSON_COLORS[((index % PERSON_COLORS.length) + PERSON_COLORS.length) % PERSON_COLORS.length]!
}
```

Run: `pnpm test src/ui/personPalette.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 4: Base components**

`src/ui/RButton.vue` (`tier="moment"` = 60pt minimum, `tier="deliberate"` = 44pt minimum):

```vue
<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    tier?: 'moment' | 'deliberate'
    disabled?: boolean
    type?: 'button' | 'submit'
  }>(),
  { variant: 'primary', tier: 'deliberate', disabled: false, type: 'button' },
)
</script>

<template>
  <button
    :type="type"
    :disabled="disabled"
    class="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] px-6 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
    :class="[
      tier === 'moment' ? 'min-h-[60px] min-w-[60px] text-[22px]' : 'min-h-[44px] min-w-[44px] text-[18px]',
      variant === 'primary' && 'bg-orange-deep text-surface',
      variant === 'secondary' && 'bg-surface-2 text-ink',
      variant === 'ghost' && 'bg-transparent text-ink-2',
      variant === 'danger' && 'bg-warn-ink text-surface',
    ]"
  >
    <slot />
  </button>
</template>
```

`src/ui/RAvatar.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ name: string; color: string; size?: number }>(), { size: 48 })
const initial = computed(() => props.name.trim().charAt(0).toUpperCase() || '?')
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
    :style="{ background: color, width: `${size}px`, height: `${size}px`, fontSize: `${Math.max(16, Math.round(size * 0.5))}px` }"
    :aria-label="name"
    role="img"
  >
    {{ initial }}
  </span>
</template>
```

`src/ui/RInput.vue`:

```vue
<script setup lang="ts">
defineProps<{ label: string; type?: string; placeholder?: string; autocomplete?: string; inputmode?: 'text' | 'numeric' | 'email' }>()
const model = defineModel<string>({ required: true })
</script>

<template>
  <label class="flex flex-col gap-2">
    <span class="text-[18px] font-medium text-ink-2">{{ label }}</span>
    <input
      v-model="model"
      :type="type ?? 'text'"
      :placeholder="placeholder"
      :autocomplete="autocomplete"
      :inputmode="inputmode"
      class="min-h-[56px] rounded-[var(--radius-control)] border border-line bg-surface px-4 text-[22px] text-ink outline-none focus:border-orange"
    />
  </label>
</template>
```

- [ ] **Step 5: Verify and commit**

Run: `pnpm test && pnpm typecheck`
Expected: all tests pass; no type errors.

```bash
git add -A
git commit -m "feat(ui): design tokens, person palette, base button/avatar/input"
```

---

### Task 3: Domain types and household time helpers

**Files:**
- Create: `src/domain/types.ts`, `src/domain/time.ts`, `src/domain/time.test.ts`
- Delete: `src/domain/smoke.test.ts`

All tests use `America/New_York`. 2026 dates: Sept 14, 2026 is a Monday; US DST ends Nov 1, 2026.

- [ ] **Step 1: Shared types**

`src/domain/types.ts`:

```ts
/** ISO 8601 timestamp in UTC, e.g. "2026-09-14T19:10:00.000Z" */
export type IsoTimestamp = string
/** Calendar date in the household time zone, "YYYY-MM-DD" */
export type HouseholdDate = string
/** Wall-clock time in the household time zone, "HH:mm" (24h) */
export type HourMinute = string

export interface TimeWindow {
  start: HourMinute
  end: HourMinute
}

export interface Child {
  id: string
  name: string
  birthday: HouseholdDate
  color: string
  /** null = use the household default window */
  nightSleep: TimeWindow | null
}

export interface SleepEntry {
  id: string
  childId: string
  startAt: IsoTimestamp
  endAt: IsoTimestamp | null
  type: 'nap' | 'night'
}

export interface FeedingEntry {
  id: string
  childId: string
  at: IsoTimestamp
  type: 'milk' | 'meal' | 'snack'
  amount: string | null
  note: string | null
}

export interface DiaperEntry {
  id: string
  childId: string
  at: IsoTimestamp
  kind: 'wet' | 'dirty' | 'both'
}

export interface Medicine {
  id: string
  childId: string
  name: string
  minIntervalHours: number
  maxDosesPer24h: number | null
}

export interface DoseEntry {
  id: string
  childId: string
  medicineId: string
  at: IsoTimestamp
  loggedByName: string | null
  loggedOffline: boolean
  voidedAt: IsoTimestamp | null
  conflictAcknowledgedAt: IsoTimestamp | null
}

export interface StickerEntry {
  id: string
  childId: string
  categoryId: string
  at: IsoTimestamp
}

export interface RoutineStep {
  iconKey: string | null
  photoId: string | null
  label: string
  time: HourMinute | null
}

export interface Routine {
  id: string
  childId: string
  name: string
  /** 0 = Sunday … 6 = Saturday */
  weekdays: number[]
  steps: RoutineStep[]
}

export interface CalendarEvent {
  title: string
  startAt: IsoTimestamp
  endAt: IsoTimestamp
  allDay: boolean
  location: string | null
}

export type Feature = 'wakeWindow' | 'feeding' | 'kidsCorner' | 'diaper'
```

- [ ] **Step 2: Write the failing time tests**

Delete `src/domain/smoke.test.ts`. Create `src/domain/time.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  parseHourMinute,
  minutesOfDay,
  isInWindow,
  householdDate,
  startOfHouseholdDay,
  householdWeekday,
  formatDuration,
  formatClock,
} from './time'

const NY = 'America/New_York'

describe('parseHourMinute', () => {
  it('parses HH:mm to minutes', () => {
    expect(parseHourMinute('18:00')).toBe(1080)
    expect(parseHourMinute('05:30')).toBe(330)
  })
  it('rejects invalid times', () => {
    expect(() => parseHourMinute('24:00')).toThrow()
    expect(() => parseHourMinute('7:00')).toThrow()
  })
})

describe('minutesOfDay', () => {
  it('uses the household time zone', () => {
    // 22:10Z = 18:10 EDT
    expect(minutesOfDay(new Date('2026-09-14T22:10:00Z'), NY)).toBe(18 * 60 + 10)
  })
})

describe('isInWindow', () => {
  const night = { start: '18:00', end: '05:00' }
  it('handles windows that cross midnight', () => {
    expect(isInWindow(new Date('2026-09-14T22:10:00Z'), night, NY)).toBe(true) // 18:10
    expect(isInWindow(new Date('2026-09-15T08:30:00Z'), night, NY)).toBe(true) // 04:30
    expect(isInWindow(new Date('2026-09-14T13:00:00Z'), night, NY)).toBe(false) // 09:00
  })
  it('treats the end as exclusive and the start as inclusive', () => {
    expect(isInWindow(new Date('2026-09-15T09:00:00Z'), night, NY)).toBe(false) // 05:00
    expect(isInWindow(new Date('2026-09-14T22:00:00Z'), night, NY)).toBe(true) // 18:00
  })
  it('handles same-day windows', () => {
    expect(isInWindow(new Date('2026-09-14T16:00:00Z'), { start: '09:00', end: '17:00' }, NY)).toBe(true)
  })
})

describe('householdDate and startOfHouseholdDay', () => {
  it('returns the local calendar date', () => {
    // 02:30Z on the 15th is 22:30 on the 14th in New York
    expect(householdDate(new Date('2026-09-15T02:30:00Z'), NY)).toBe('2026-09-14')
  })
  it('returns local midnight as a UTC instant', () => {
    expect(startOfHouseholdDay(new Date('2026-09-15T02:30:00Z'), NY).toISOString()).toBe('2026-09-14T04:00:00.000Z')
  })
  it('handles the DST change day', () => {
    // Nov 1 2026, 10:00 EST; midnight that day was still EDT (UTC-4)
    expect(startOfHouseholdDay(new Date('2026-11-01T15:00:00Z'), NY).toISOString()).toBe('2026-11-01T04:00:00.000Z')
  })
})

describe('householdWeekday', () => {
  it('returns 0-6 in the household zone', () => {
    expect(householdWeekday(new Date('2026-09-14T16:00:00Z'), NY)).toBe(1) // Monday
    expect(householdWeekday(new Date('2026-09-14T03:00:00Z'), NY)).toBe(0) // still Sunday 23:00
  })
})

describe('formatDuration', () => {
  it('formats hours and minutes', () => {
    expect(formatDuration(160 * 60_000)).toBe('2h 40m')
    expect(formatDuration(45 * 60_000)).toBe('45m')
    expect(formatDuration(-5000)).toBe('0m')
  })
})

describe('formatClock', () => {
  it('formats 12-hour time in the household zone', () => {
    expect(formatClock(new Date('2026-09-14T19:10:00Z'), NY)).toBe('3:10 PM')
  })
})
```

Run: `pnpm test src/domain/time.test.ts`
Expected: FAIL, cannot resolve `./time`.

- [ ] **Step 3: Implement time helpers**

`src/domain/time.ts`:

```ts
import { TZDate } from '@date-fns/tz'
import type { HouseholdDate, HourMinute, TimeWindow } from './types'

const pad = (n: number) => String(n).padStart(2, '0')

export function parseHourMinute(hm: HourMinute): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hm)
  if (!match) throw new Error(`Invalid time "${hm}"`)
  return Number(match[1]) * 60 + Number(match[2])
}

export function minutesOfDay(at: Date, timeZone: string): number {
  const d = new TZDate(at.getTime(), timeZone)
  return d.getHours() * 60 + d.getMinutes()
}

/** Start inclusive, end exclusive. A window whose end is before its start crosses midnight. */
export function isInWindow(at: Date, window: TimeWindow, timeZone: string): boolean {
  const m = minutesOfDay(at, timeZone)
  const start = parseHourMinute(window.start)
  const end = parseHourMinute(window.end)
  return start <= end ? m >= start && m < end : m >= start || m < end
}

export function householdDate(at: Date, timeZone: string): HouseholdDate {
  const d = new TZDate(at.getTime(), timeZone)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function startOfHouseholdDay(at: Date, timeZone: string): Date {
  const d = new TZDate(at.getTime(), timeZone)
  d.setHours(0, 0, 0, 0)
  return new Date(d.getTime())
}

export function householdWeekday(at: Date, timeZone: string): number {
  return new TZDate(at.getTime(), timeZone).getDay()
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

export function formatClock(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone })
    .format(at)
    .replace(/ /g, ' ')
}
```

Run: `pnpm test src/domain/time.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(domain): shared types and household time-zone helpers"
```

---

### Task 4: Sleep classification and wake window

**Files:**
- Create: `src/domain/sleep.ts`, `src/domain/sleep.test.ts`

Spec §7.4 Sleep: a sleep starting inside the child's night-sleep window is Night, otherwise Nap; the child's window defaults to the household window. Wake window = time since the most recent sleep ended; with no sleep ended today, status is unknown ("Log wake-up").

- [ ] **Step 1: Write the failing tests**

`src/domain/sleep.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { classifySleep, nightWindowFor, sleepStatus } from './sleep'
import type { SleepEntry } from './types'

const NY = 'America/New_York'
const householdDefault = { start: '18:00', end: '05:00' }

const entry = (over: Partial<SleepEntry>): SleepEntry => ({
  id: crypto.randomUUID(),
  childId: 'mara',
  startAt: '2026-09-14T17:00:00Z',
  endAt: null,
  type: 'nap',
  ...over,
})

describe('nightWindowFor', () => {
  it('uses the child window when set, else the household default', () => {
    expect(nightWindowFor({ nightSleep: null }, householdDefault)).toEqual(householdDefault)
    expect(nightWindowFor({ nightSleep: { start: '19:00', end: '06:00' } }, householdDefault)).toEqual({
      start: '19:00',
      end: '06:00',
    })
  })
})

describe('classifySleep', () => {
  it('is night inside the window and nap outside', () => {
    expect(classifySleep(new Date('2026-09-14T22:15:00Z'), householdDefault, NY)).toBe('night') // 18:15
    expect(classifySleep(new Date('2026-09-14T17:00:00Z'), householdDefault, NY)).toBe('nap') // 13:00
  })
  it('respects a later per-child bedtime', () => {
    expect(classifySleep(new Date('2026-09-14T22:30:00Z'), { start: '19:00', end: '06:00' }, NY)).toBe('nap') // 18:30
  })
})

describe('sleepStatus', () => {
  const now = new Date('2026-09-14T20:00:00Z') // 16:00 EDT

  it('is sleeping when an entry is open', () => {
    const s = sleepStatus([entry({ startAt: '2026-09-14T19:15:00Z' })], 'mara', now, NY)
    expect(s).toEqual({ kind: 'sleeping', since: new Date('2026-09-14T19:15:00Z'), durationMs: 45 * 60_000 })
  })

  it('is awake since the latest sleep that ended today', () => {
    const s = sleepStatus(
      [
        entry({ startAt: '2026-09-14T13:00:00Z', endAt: '2026-09-14T14:00:00Z' }),
        entry({ startAt: '2026-09-14T16:30:00Z', endAt: '2026-09-14T17:20:00Z' }),
      ],
      'mara',
      now,
      NY,
    )
    expect(s).toEqual({ kind: 'awake', since: new Date('2026-09-14T17:20:00Z'), durationMs: 160 * 60_000 })
  })

  it('counts a night sleep that ended this morning', () => {
    const s = sleepStatus(
      [entry({ startAt: '2026-09-13T23:00:00Z', endAt: '2026-09-14T10:30:00Z', type: 'night' })],
      'mara',
      now,
      NY,
    )
    expect(s.kind).toBe('awake')
  })

  it('is unknown when nothing ended today', () => {
    const s = sleepStatus([entry({ startAt: '2026-09-13T17:00:00Z', endAt: '2026-09-13T18:00:00Z' })], 'mara', now, NY)
    expect(s).toEqual({ kind: 'unknown' })
  })

  it('ignores other children', () => {
    const s = sleepStatus([entry({ childId: 'leona', startAt: '2026-09-14T19:00:00Z' })], 'mara', now, NY)
    expect(s).toEqual({ kind: 'unknown' })
  })
})
```

Run: `pnpm test src/domain/sleep.test.ts`
Expected: FAIL, cannot resolve `./sleep`.

- [ ] **Step 2: Implement**

`src/domain/sleep.ts`:

```ts
import { isInWindow, startOfHouseholdDay } from './time'
import type { Child, SleepEntry, TimeWindow } from './types'

export type SleepStatus =
  | { kind: 'sleeping'; since: Date; durationMs: number }
  | { kind: 'awake'; since: Date; durationMs: number }
  | { kind: 'unknown' }

export function nightWindowFor(child: Pick<Child, 'nightSleep'>, householdDefault: TimeWindow): TimeWindow {
  return child.nightSleep ?? householdDefault
}

export function classifySleep(startAt: Date, window: TimeWindow, timeZone: string): 'nap' | 'night' {
  return isInWindow(startAt, window, timeZone) ? 'night' : 'nap'
}

export function sleepStatus(entries: SleepEntry[], childId: string, now: Date, timeZone: string): SleepStatus {
  const mine = entries.filter((e) => e.childId === childId)

  const open = mine
    .filter((e) => e.endAt === null)
    .sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt))[0]
  if (open) {
    const since = new Date(open.startAt)
    return { kind: 'sleeping', since, durationMs: now.getTime() - since.getTime() }
  }

  const dayStart = startOfHouseholdDay(now, timeZone).getTime()
  const latestEnd = mine
    .map((e) => (e.endAt ? Date.parse(e.endAt) : NaN))
    .filter((t) => !Number.isNaN(t) && t >= dayStart && t <= now.getTime())
    .sort((a, b) => b - a)[0]
  if (latestEnd === undefined) return { kind: 'unknown' }

  return { kind: 'awake', since: new Date(latestEnd), durationMs: now.getTime() - latestEnd }
}
```

Run: `pnpm test src/domain/sleep.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(domain): sleep classification and wake window"
```

---

### Task 5: Medicine rules

**Files:**
- Create: `src/domain/medicine.ts`, `src/domain/medicine.test.ts`

Spec §7.4 Medicine and §11.4: next dose after = given + minimum interval. Early warning when a dose is logged within the minimum interval of another active dose; over-max warning when the dose would exceed the daily maximum in the trailing 24 hours. Voided doses never count. Offline-logged doses that turn out to conflict raise an alert until acknowledged.

- [ ] **Step 1: Write the failing tests**

`src/domain/medicine.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { checkDose, nextDoseAfter, recentDoses, unacknowledgedConflicts } from './medicine'
import type { DoseEntry, Medicine } from './types'

const H = 3_600_000
const ibuprofen: Medicine = { id: 'ibu', childId: 'mara', name: 'Infant ibuprofen', minIntervalHours: 6, maxDosesPer24h: 4 }
const tylenol: Medicine = { id: 'tyl', childId: 'mara', name: 'Infant acetaminophen', minIntervalHours: 4, maxDosesPer24h: null }

const dose = (over: Partial<DoseEntry>): DoseEntry => ({
  id: crypto.randomUUID(),
  childId: 'mara',
  medicineId: 'ibu',
  at: '2026-09-14T12:00:00Z',
  loggedByName: 'Sam',
  loggedOffline: false,
  voidedAt: null,
  conflictAcknowledgedAt: null,
  ...over,
})

describe('nextDoseAfter', () => {
  it('adds the minimum interval', () => {
    expect(nextDoseAfter(dose({ at: '2026-09-14T19:10:00Z' }), ibuprofen).toISOString()).toBe('2026-09-15T01:10:00.000Z')
  })
})

describe('checkDose', () => {
  it('warns when too early, naming who gave the nearest dose', () => {
    const at = new Date('2026-09-14T15:20:00Z')
    expect(checkDose(ibuprofen, [dose({ at: '2026-09-14T12:00:00Z' })], at)).toEqual([
      {
        kind: 'early',
        nearestDoseAt: new Date('2026-09-14T12:00:00Z'),
        nearestDoseBy: 'Sam',
        elapsedMs: 200 * 60_000,
        minIntervalHours: 6,
      },
    ])
  })

  it('does not warn at exactly the interval', () => {
    expect(checkDose(ibuprofen, [dose({ at: '2026-09-14T12:00:00Z' })], new Date('2026-09-14T18:00:00Z'))).toEqual([])
  })

  it('warns for a backdated dose close to a later one', () => {
    const warnings = checkDose(ibuprofen, [dose({ at: '2026-09-14T12:00:00Z' })], new Date('2026-09-14T10:00:00Z'))
    expect(warnings.map((w) => w.kind)).toEqual(['early'])
  })

  it('warns when over the daily maximum', () => {
    const doses = ['T00:00', 'T06:00', 'T12:00', 'T18:00'].map((t) => dose({ at: `2026-09-14${t}:00Z` }))
    expect(checkDose(ibuprofen, doses, new Date('2026-09-14T23:30:00Z'))).toContainEqual({
      kind: 'overMax',
      doseNumber: 5,
      max: 4,
    })
  })

  it('ignores voided doses, other medicines, and the dose being checked', () => {
    const own = dose({ id: 'self', at: '2026-09-14T12:00:00Z' })
    const doses = [
      own,
      dose({ at: '2026-09-14T11:00:00Z', voidedAt: '2026-09-14T11:05:00Z' }),
      dose({ medicineId: 'tyl', at: '2026-09-14T11:30:00Z' }),
    ]
    expect(checkDose(ibuprofen, doses, new Date('2026-09-14T12:00:00Z'), 'self')).toEqual([])
  })

  it('skips the max check when no maximum is set', () => {
    const doses = ['T00:00', 'T04:00', 'T08:00', 'T12:00', 'T16:00'].map((t) =>
      dose({ medicineId: 'tyl', at: `2026-09-14${t}:00Z` }),
    )
    expect(checkDose(tylenol, doses, new Date('2026-09-14T20:00:00Z'))).toEqual([])
  })
})

describe('recentDoses', () => {
  it('returns the latest active dose per medicine in the last 24h', () => {
    const now = new Date('2026-09-14T21:00:00Z')
    const summaries = recentDoses(
      [ibuprofen, tylenol],
      [
        dose({ at: '2026-09-14T13:00:00Z' }),
        dose({ at: '2026-09-14T19:10:00Z', loggedByName: 'Jess (sitter)' }),
        dose({ medicineId: 'tyl', at: '2026-09-13T18:00:00Z' }),
      ],
      now,
    )
    expect(summaries).toEqual([
      {
        childId: 'mara',
        medicineId: 'ibu',
        medicineName: 'Infant ibuprofen',
        givenAt: new Date('2026-09-14T19:10:00Z'),
        givenBy: 'Jess (sitter)',
        nextAfter: new Date('2026-09-15T01:10:00Z'),
        nextAllowed: false,
      },
    ])
  })

  it('marks the next dose allowed once the time has passed', () => {
    const [s] = recentDoses([ibuprofen], [dose({ at: '2026-09-14T12:00:00Z' })], new Date('2026-09-14T18:00:00Z'))
    expect(s?.nextAllowed).toBe(true)
  })
})

describe('unacknowledgedConflicts', () => {
  it('returns offline doses that conflict and are not acknowledged', () => {
    const offline = dose({ id: 'off', at: '2026-09-14T13:00:00Z', loggedOffline: true })
    const acked = dose({ id: 'ack', at: '2026-09-14T13:30:00Z', loggedOffline: true, conflictAcknowledgedAt: '2026-09-14T14:00:00Z' })
    const online = dose({ id: 'on', at: '2026-09-14T12:00:00Z' })
    expect(unacknowledgedConflicts([ibuprofen], [online, offline, acked]).map((d) => d.id)).toEqual(['off'])
  })
})
```

Run: `pnpm test src/domain/medicine.test.ts`
Expected: FAIL, cannot resolve `./medicine`.

- [ ] **Step 2: Implement**

`src/domain/medicine.ts`:

```ts
import type { DoseEntry, Medicine } from './types'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

export type DoseWarning =
  | { kind: 'early'; nearestDoseAt: Date; nearestDoseBy: string | null; elapsedMs: number; minIntervalHours: number }
  | { kind: 'overMax'; doseNumber: number; max: number }

export interface DoseSummary {
  childId: string
  medicineId: string
  medicineName: string
  givenAt: Date
  givenBy: string | null
  nextAfter: Date
  nextAllowed: boolean
}

const isActive = (d: DoseEntry) => d.voidedAt === null

export function nextDoseAfter(dose: DoseEntry, medicine: Medicine): Date {
  return new Date(Date.parse(dose.at) + medicine.minIntervalHours * HOUR_MS)
}

export function checkDose(medicine: Medicine, doses: DoseEntry[], at: Date, excludeDoseId?: string): DoseWarning[] {
  const others = doses.filter((d) => isActive(d) && d.medicineId === medicine.id && d.id !== excludeDoseId)
  const t = at.getTime()
  const intervalMs = medicine.minIntervalHours * HOUR_MS
  const warnings: DoseWarning[] = []

  const nearest = others
    .map((d) => ({ d, gap: Math.abs(t - Date.parse(d.at)) }))
    .filter((x) => x.gap < intervalMs)
    .sort((a, b) => a.gap - b.gap)[0]
  if (nearest) {
    warnings.push({
      kind: 'early',
      nearestDoseAt: new Date(nearest.d.at),
      nearestDoseBy: nearest.d.loggedByName,
      elapsedMs: nearest.gap,
      minIntervalHours: medicine.minIntervalHours,
    })
  }

  if (medicine.maxDosesPer24h !== null) {
    const inWindow = others.filter((d) => {
      const dt = Date.parse(d.at)
      return dt > t - DAY_MS && dt <= t
    }).length
    const doseNumber = inWindow + 1
    if (doseNumber > medicine.maxDosesPer24h) {
      warnings.push({ kind: 'overMax', doseNumber, max: medicine.maxDosesPer24h })
    }
  }

  return warnings
}

export function recentDoses(medicines: Medicine[], doses: DoseEntry[], now: Date): DoseSummary[] {
  const t = now.getTime()
  const summaries: DoseSummary[] = []
  for (const medicine of medicines) {
    const latest = doses
      .filter((d) => isActive(d) && d.medicineId === medicine.id)
      .filter((d) => {
        const dt = Date.parse(d.at)
        return dt > t - DAY_MS && dt <= t
      })
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]
    if (!latest) continue
    const nextAfter = nextDoseAfter(latest, medicine)
    summaries.push({
      childId: medicine.childId,
      medicineId: medicine.id,
      medicineName: medicine.name,
      givenAt: new Date(latest.at),
      givenBy: latest.loggedByName,
      nextAfter,
      nextAllowed: t >= nextAfter.getTime(),
    })
  }
  return summaries.sort((a, b) => b.givenAt.getTime() - a.givenAt.getTime())
}

export function unacknowledgedConflicts(medicines: Medicine[], doses: DoseEntry[]): DoseEntry[] {
  const byId = new Map(medicines.map((m) => [m.id, m]))
  return doses.filter((d) => {
    if (!isActive(d) || !d.loggedOffline || d.conflictAcknowledgedAt !== null) return false
    const medicine = byId.get(d.medicineId)
    return medicine ? checkDose(medicine, doses, new Date(d.at), d.id).length > 0 : false
  })
}
```

Run: `pnpm test src/domain/medicine.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(domain): medicine next-dose, warnings, recent doses, offline conflicts"
```

---

### Task 6: Age-based feature defaults

**Files:**
- Create: `src/domain/ageDefaults.ts`, `src/domain/ageDefaults.test.ts`

Spec §7.2: wake window and feeding default on under 3 years; Kids' Corner (picture schedule, stickers, Now → Next) on from 2 through 7 years; Diaper off unless the household enables it. A per-child override wins until cleared. Diaper: household toggle must be on, and a child override of `false` turns it off for that child.

- [ ] **Step 1: Write the failing tests**

`src/domain/ageDefaults.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ageInMonths, isFeatureEnabled } from './ageDefaults'

const today = '2026-09-14'
const ctx = (birthday: string, over: Partial<Parameters<typeof isFeatureEnabled>[1]> = {}) => ({
  birthday,
  today,
  overrides: {},
  diaperLogEnabled: false,
  ...over,
})

describe('ageInMonths', () => {
  it('counts whole months', () => {
    expect(ageInMonths('2025-05-24', today)).toBe(15) // Mara
    expect(ageInMonths('2023-05-23', today)).toBe(39) // Leona
  })
  it('does not count a month until the day is reached', () => {
    expect(ageInMonths('2023-09-14', '2026-09-14')).toBe(36)
    expect(ageInMonths('2023-09-14', '2026-09-13')).toBe(35)
  })
})

describe('isFeatureEnabled', () => {
  it('gives a 1-year-old the wake window and feeding but not Kids Corner', () => {
    expect(isFeatureEnabled('wakeWindow', ctx('2025-05-24'))).toBe(true)
    expect(isFeatureEnabled('feeding', ctx('2025-05-24'))).toBe(true)
    expect(isFeatureEnabled('kidsCorner', ctx('2025-05-24'))).toBe(false)
  })

  it('gives a 3-year-old Kids Corner but not the wake window', () => {
    expect(isFeatureEnabled('wakeWindow', ctx('2023-05-23'))).toBe(false)
    expect(isFeatureEnabled('kidsCorner', ctx('2023-05-23'))).toBe(true)
  })

  it('switches on the birthday', () => {
    expect(isFeatureEnabled('wakeWindow', ctx('2023-09-14'))).toBe(false)
    expect(isFeatureEnabled('wakeWindow', { ...ctx('2023-09-14'), today: '2026-09-13' })).toBe(true)
  })

  it('keeps Kids Corner through age 7 and drops it at 8', () => {
    expect(isFeatureEnabled('kidsCorner', ctx('2019-09-14'))).toBe(true)
    expect(isFeatureEnabled('kidsCorner', ctx('2018-09-14'))).toBe(false)
  })

  it('lets an override win', () => {
    expect(isFeatureEnabled('wakeWindow', ctx('2023-05-23', { overrides: { wakeWindow: true } }))).toBe(true)
    expect(isFeatureEnabled('kidsCorner', ctx('2023-05-23', { overrides: { kidsCorner: false } }))).toBe(false)
  })

  it('requires the household diaper toggle', () => {
    expect(isFeatureEnabled('diaper', ctx('2025-05-24', { overrides: { diaper: true } }))).toBe(false)
    expect(isFeatureEnabled('diaper', ctx('2025-05-24', { diaperLogEnabled: true }))).toBe(true)
    expect(isFeatureEnabled('diaper', ctx('2025-05-24', { diaperLogEnabled: true, overrides: { diaper: false } }))).toBe(false)
  })
})
```

Run: `pnpm test src/domain/ageDefaults.test.ts`
Expected: FAIL, cannot resolve `./ageDefaults`.

- [ ] **Step 2: Implement**

`src/domain/ageDefaults.ts`:

```ts
import type { Feature, HouseholdDate } from './types'

export interface FeatureContext {
  birthday: HouseholdDate
  today: HouseholdDate
  overrides: Partial<Record<Feature, boolean>>
  diaperLogEnabled: boolean
}

function parseDate(d: HouseholdDate): [number, number, number] {
  const [y, m, day] = d.split('-').map(Number)
  if (!y || !m || !day) throw new Error(`Invalid date "${d}"`)
  return [y, m, day]
}

export function ageInMonths(birthday: HouseholdDate, today: HouseholdDate): number {
  const [by, bm, bd] = parseDate(birthday)
  const [ty, tm, td] = parseDate(today)
  let months = (ty - by) * 12 + (tm - bm)
  if (td < bd) months -= 1
  return months
}

export function isFeatureEnabled(feature: Feature, ctx: FeatureContext): boolean {
  if (feature === 'diaper') return ctx.diaperLogEnabled && ctx.overrides.diaper !== false

  const override = ctx.overrides[feature]
  if (override !== undefined) return override

  const months = ageInMonths(ctx.birthday, ctx.today)
  switch (feature) {
    case 'wakeWindow':
    case 'feeding':
      return months < 36
    case 'kidsCorner':
      return months >= 24 && months < 96
  }
}
```

Run: `pnpm test src/domain/ageDefaults.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(domain): age-based feature defaults with overrides"
```

---

### Task 7: Routine selection and current step

**Files:**
- Create: `src/domain/routines.ts`, `src/domain/routines.test.ts`

Spec §7.5: each weekday has a default routine per child; an adult can switch today's routine. The child finishes the current step to advance; steps with a time become current at that time if not already completed (skipping earlier unfinished untimed steps).

- [ ] **Step 1: Write the failing tests**

`src/domain/routines.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { routineForDay, currentStepIndex, nextStepIndex } from './routines'
import type { Routine } from './types'

const step = (label: string, time: string | null = null) => ({ iconKey: label.toLowerCase(), photoId: null, label, time })

const homeDay: Routine = {
  id: 'home',
  childId: 'leona',
  name: 'Home day',
  weekdays: [1, 2, 3, 4, 5],
  steps: [step('Breakfast', '07:00'), step('Teeth'), step('Shoes'), step('Nap', '12:30'), step('Bath', '18:30')],
}
const weekend: Routine = { ...homeDay, id: 'weekend', name: 'Weekend', weekdays: [0, 6] }
const maraRoutine: Routine = { ...homeDay, id: 'mara-home', childId: 'mara' }

describe('routineForDay', () => {
  const all = [maraRoutine, homeDay, weekend]
  it('picks the routine assigned to the weekday', () => {
    expect(routineForDay(all, 'leona', 1, null)?.id).toBe('home')
    expect(routineForDay(all, 'leona', 6, null)?.id).toBe('weekend')
  })
  it('uses the override for today when it belongs to the child', () => {
    expect(routineForDay(all, 'leona', 1, 'weekend')?.id).toBe('weekend')
    expect(routineForDay(all, 'leona', 1, 'mara-home')?.id).toBe('home')
  })
  it('returns null when nothing is assigned', () => {
    expect(routineForDay([homeDay], 'leona', 0, null)).toBeNull()
  })
})

describe('currentStepIndex', () => {
  const at = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3))

  it('starts at the first unfinished step', () => {
    expect(currentStepIndex(homeDay, [], at('08:00'))).toBe(0)
    expect(currentStepIndex(homeDay, [0], at('08:00'))).toBe(1)
  })
  it('jumps to a timed step once its time arrives', () => {
    expect(currentStepIndex(homeDay, [0], at('12:45'))).toBe(3)
  })
  it('does not jump back to a completed timed step', () => {
    expect(currentStepIndex(homeDay, [0, 3], at('12:45'))).toBe(1)
  })
  it('returns null when every step is done', () => {
    expect(currentStepIndex(homeDay, [0, 1, 2, 3, 4], at('20:00'))).toBeNull()
  })
})

describe('nextStepIndex', () => {
  it('returns the next unfinished step after the current one', () => {
    expect(nextStepIndex(homeDay, [0], 1)).toBe(2)
    expect(nextStepIndex(homeDay, [0, 1, 2], 3)).toBe(4)
  })
  it('returns null after the last step', () => {
    expect(nextStepIndex(homeDay, [0, 1, 2, 3], 4)).toBeNull()
  })
})
```

Run: `pnpm test src/domain/routines.test.ts`
Expected: FAIL, cannot resolve `./routines`.

- [ ] **Step 2: Implement**

`src/domain/routines.ts`:

```ts
import { parseHourMinute } from './time'
import type { Routine } from './types'

export function routineForDay(
  routines: Routine[],
  childId: string,
  weekday: number,
  overrideRoutineId: string | null,
): Routine | null {
  const mine = routines.filter((r) => r.childId === childId)
  if (overrideRoutineId) {
    const override = mine.find((r) => r.id === overrideRoutineId)
    if (override) return override
  }
  return mine.find((r) => r.weekdays.includes(weekday)) ?? null
}

export function currentStepIndex(routine: Routine, completed: number[], nowMinutes: number): number | null {
  const done = new Set(completed)
  const firstOpen = routine.steps.findIndex((_, i) => !done.has(i))
  if (firstOpen === -1) return null

  let latestDue = -1
  routine.steps.forEach((s, i) => {
    if (s.time !== null && !done.has(i) && parseHourMinute(s.time) <= nowMinutes) latestDue = i
  })
  return Math.max(firstOpen, latestDue)
}

export function nextStepIndex(routine: Routine, completed: number[], current: number): number | null {
  const done = new Set(completed)
  for (let i = current + 1; i < routine.steps.length; i++) {
    if (!done.has(i)) return i
  }
  return null
}
```

Run: `pnpm test src/domain/routines.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(domain): routine selection and current/next step"
```

---

### Task 8: Sticker week and leave-by countdown

**Files:**
- Create: `src/domain/stickers.ts`, `src/domain/stickers.test.ts`, `src/domain/leaveBy.ts`, `src/domain/leaveBy.test.ts`

Spec §7.5 Sticker Chart: current week Mon–Sun in household time, one row per category, resets Monday. Spec §7.2 Today: events with a location starting within the next 2 hours show "Leave in N min"; leave-by = start − buffer.

- [ ] **Step 1: Write the failing sticker tests**

`src/domain/stickers.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { weekStartDate, stickerWeek } from './stickers'
import type { StickerEntry } from './types'

const NY = 'America/New_York'
const s = (at: string, categoryId = 'potty', childId = 'leona'): StickerEntry => ({ id: crypto.randomUUID(), childId, categoryId, at })

describe('weekStartDate', () => {
  it('returns the Monday of the household week', () => {
    expect(weekStartDate(new Date('2026-09-16T15:00:00Z'), NY)).toBe('2026-09-14') // Wednesday
    expect(weekStartDate(new Date('2026-09-21T02:00:00Z'), NY)).toBe('2026-09-14') // Sunday 22:00 local
    expect(weekStartDate(new Date('2026-09-14T13:00:00Z'), NY)).toBe('2026-09-14') // Monday
  })
})

describe('stickerWeek', () => {
  it('counts stickers per category per weekday (Mon=0 … Sun=6)', () => {
    const now = new Date('2026-09-20T20:00:00Z') // Sunday afternoon
    const week = stickerWeek(
      [
        s('2026-09-14T13:00:00Z'), // Mon
        s('2026-09-14T15:00:00Z'), // Mon
        s('2026-09-16T15:00:00Z', 'teeth'), // Wed
        s('2026-09-21T03:30:00Z'), // Sun 23:30 local
        s('2026-09-13T15:00:00Z'), // previous Sunday — excluded
        s('2026-09-15T15:00:00Z', 'potty', 'mara'), // other child — excluded
        s('2026-09-15T15:00:00Z', 'unknown'), // unknown category — excluded
      ],
      'leona',
      ['potty', 'teeth'],
      now,
      NY,
    )
    expect(week).toEqual({
      weekStart: '2026-09-14',
      counts: { potty: [2, 0, 0, 0, 0, 0, 1], teeth: [0, 0, 1, 0, 0, 0, 0] },
    })
  })
})
```

Run: `pnpm test src/domain/stickers.test.ts`
Expected: FAIL, cannot resolve `./stickers`.

- [ ] **Step 2: Implement stickers**

`src/domain/stickers.ts`:

```ts
import { TZDate } from '@date-fns/tz'
import { householdDate, householdWeekday } from './time'
import type { HouseholdDate, StickerEntry } from './types'

export interface StickerWeek {
  weekStart: HouseholdDate
  /** categoryId → 7 counts, Monday first */
  counts: Record<string, number[]>
}

function mondayMidnight(at: Date, timeZone: string): TZDate {
  const d = new TZDate(at.getTime(), timeZone)
  const daysSinceMonday = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - daysSinceMonday)
  d.setHours(0, 0, 0, 0)
  return d
}

export function weekStartDate(at: Date, timeZone: string): HouseholdDate {
  return householdDate(new Date(mondayMidnight(at, timeZone).getTime()), timeZone)
}

export function stickerWeek(
  entries: StickerEntry[],
  childId: string,
  categoryIds: string[],
  now: Date,
  timeZone: string,
): StickerWeek {
  const start = mondayMidnight(now, timeZone)
  const end = new TZDate(start.getTime(), timeZone)
  end.setDate(end.getDate() + 7)

  const counts: Record<string, number[]> = {}
  for (const id of categoryIds) counts[id] = [0, 0, 0, 0, 0, 0, 0]

  for (const e of entries) {
    if (e.childId !== childId) continue
    const row = counts[e.categoryId]
    if (!row) continue
    const t = Date.parse(e.at)
    if (t < start.getTime() || t >= end.getTime()) continue
    const index = (householdWeekday(new Date(t), timeZone) + 6) % 7
    row[index] = (row[index] ?? 0) + 1
  }

  return { weekStart: householdDate(new Date(start.getTime()), timeZone), counts }
}
```

Run: `pnpm test src/domain/stickers.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing leave-by tests**

`src/domain/leaveBy.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { leaveInMinutes } from './leaveBy'
import type { CalendarEvent } from './types'

const now = new Date('2026-09-14T20:00:00Z')
const event = (over: Partial<CalendarEvent>): CalendarEvent => ({
  title: 'Soccer',
  startAt: '2026-09-14T21:00:00Z',
  endAt: '2026-09-14T22:00:00Z',
  allDay: false,
  location: 'Riverside Park',
  ...over,
})

describe('leaveInMinutes', () => {
  it('subtracts the buffer from the time until start', () => {
    expect(leaveInMinutes(event({}), now, 20)).toBe(40)
  })
  it('returns 0 when it is already time to leave', () => {
    expect(leaveInMinutes(event({ startAt: '2026-09-14T20:10:00Z' }), now, 20)).toBe(0)
  })
  it('ignores events without a location, all-day events, started events, and events over 2h away', () => {
    expect(leaveInMinutes(event({ location: null }), now, 20)).toBeNull()
    expect(leaveInMinutes(event({ allDay: true }), now, 20)).toBeNull()
    expect(leaveInMinutes(event({ startAt: '2026-09-14T19:59:00Z' }), now, 20)).toBeNull()
    expect(leaveInMinutes(event({ startAt: '2026-09-14T22:01:00Z' }), now, 20)).toBeNull()
  })
})
```

Run: `pnpm test src/domain/leaveBy.test.ts`
Expected: FAIL, cannot resolve `./leaveBy`.

- [ ] **Step 4: Implement leave-by**

`src/domain/leaveBy.ts`:

```ts
import type { CalendarEvent } from './types'

const HORIZON_MS = 2 * 3_600_000

export function leaveInMinutes(event: CalendarEvent, now: Date, bufferMinutes: number): number | null {
  if (!event.location || event.allDay) return null
  const start = Date.parse(event.startAt)
  const t = now.getTime()
  if (start <= t || start - t > HORIZON_MS) return null
  return Math.max(0, Math.floor((start - bufferMinutes * 60_000 - t) / 60_000))
}
```

Run: `pnpm test src/domain/leaveBy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(domain): sticker week grid and leave-by countdown"
```

---

### Task 9: Sitter summary aggregation

**Files:**
- Create: `src/domain/sitterSummary.ts`, `src/domain/sitterSummary.test.ts`

Spec §7.6: the "While You Were Out" summary lists, per child, sleeps, feedings, medicine doses, stickers (and diapers) during the session. An open session (still active) uses `now` as its end.

- [ ] **Step 1: Write the failing tests**

`src/domain/sitterSummary.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { sitterSummary } from './sitterSummary'
import type { DoseEntry, FeedingEntry, SleepEntry } from './types'

const session = { startAt: '2026-09-14T22:00:00Z', endAt: '2026-09-15T02:00:00Z' }
const children = [{ id: 'leona' }, { id: 'mara' }]

const sleep = (childId: string, startAt: string, endAt: string | null): SleepEntry => ({
  id: crypto.randomUUID(), childId, startAt, endAt, type: 'night',
})
const feeding = (childId: string, at: string): FeedingEntry => ({
  id: crypto.randomUUID(), childId, at, type: 'milk', amount: '6 oz', note: null,
})
const dose = (childId: string, at: string): DoseEntry => ({
  id: crypto.randomUUID(), childId, medicineId: 'ibu', at, loggedByName: 'Jess (sitter)', loggedOffline: false, voidedAt: null, conflictAcknowledgedAt: null,
})

describe('sitterSummary', () => {
  it('groups entries inside the session by child, oldest first', () => {
    const [leona, mara] = sitterSummary(
      session,
      children,
      {
        sleeps: [sleep('mara', '2026-09-14T23:30:00Z', null), sleep('leona', '2026-09-14T20:00:00Z', '2026-09-14T21:00:00Z')],
        feedings: [feeding('mara', '2026-09-14T23:00:00Z'), feeding('mara', '2026-09-14T22:15:00Z'), feeding('mara', '2026-09-15T03:00:00Z')],
        doses: [dose('leona', '2026-09-14T23:40:00Z')],
        stickers: [],
        diapers: [],
      },
      new Date('2026-09-15T03:00:00Z'),
    )
    expect(leona?.childId).toBe('leona')
    expect(leona?.sleeps).toHaveLength(0) // ended before the session
    expect(leona?.doses).toHaveLength(1)
    expect(mara?.sleeps).toHaveLength(1) // still open, overlaps the session
    expect(mara?.feedings.map((f) => f.at)).toEqual(['2026-09-14T22:15:00Z', '2026-09-14T23:00:00Z'])
  })

  it('uses now as the end of an open session', () => {
    const [, mara] = sitterSummary(
      { startAt: session.startAt, endAt: null },
      children,
      { sleeps: [], feedings: [feeding('mara', '2026-09-15T03:00:00Z')], doses: [], stickers: [], diapers: [] },
      new Date('2026-09-15T04:00:00Z'),
    )
    expect(mara?.feedings).toHaveLength(1)
  })
})
```

Run: `pnpm test src/domain/sitterSummary.test.ts`
Expected: FAIL, cannot resolve `./sitterSummary`.

- [ ] **Step 2: Implement**

`src/domain/sitterSummary.ts`:

```ts
import type { DiaperEntry, DoseEntry, FeedingEntry, IsoTimestamp, SleepEntry, StickerEntry } from './types'

export interface SessionRange {
  startAt: IsoTimestamp
  endAt: IsoTimestamp | null
}

export interface SummaryData {
  sleeps: SleepEntry[]
  feedings: FeedingEntry[]
  doses: DoseEntry[]
  stickers: StickerEntry[]
  diapers: DiaperEntry[]
}

export interface ChildSummary extends SummaryData {
  childId: string
}

export function sitterSummary(
  session: SessionRange,
  children: { id: string }[],
  data: SummaryData,
  now: Date,
): ChildSummary[] {
  const start = Date.parse(session.startAt)
  const end = session.endAt ? Date.parse(session.endAt) : now.getTime()
  const inRange = (at: string) => {
    const t = Date.parse(at)
    return t >= start && t <= end
  }
  const byTime = <T extends { at: string }>(a: T, b: T) => Date.parse(a.at) - Date.parse(b.at)

  return children.map(({ id }) => ({
    childId: id,
    sleeps: data.sleeps
      .filter((s) => s.childId === id && Date.parse(s.startAt) <= end && (s.endAt ? Date.parse(s.endAt) : end) >= start)
      .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)),
    feedings: data.feedings.filter((f) => f.childId === id && inRange(f.at)).sort(byTime),
    doses: data.doses.filter((d) => d.childId === id && inRange(d.at)).sort(byTime),
    stickers: data.stickers.filter((s) => s.childId === id && inRange(s.at)).sort(byTime),
    diapers: data.diapers.filter((d) => d.childId === id && inRange(d.at)).sort(byTime),
  }))
}
```

Run: `pnpm test src/domain/sitterSummary.test.ts`
Expected: PASS.

- [ ] **Step 3: Run the whole suite and commit**

Run: `pnpm test && pnpm typecheck`
Expected: all domain tests pass; no type errors.

```bash
git add -A
git commit -m "feat(domain): sitter session summary"
```

---

### Task 10: Local Supabase project

**Files:**
- Create: `supabase/config.toml` (generated, then edited), `supabase/templates/code.html`

Requires Docker Desktop running. Ports are moved from 543xx to 553xx so Roost can run alongside other local Supabase projects (e.g., Totem).

- [ ] **Step 1: Initialize**

```bash
cd /Users/cmitchell/www/cmrd/apps/roost
supabase init --with-vscode-settings=false --with-intellij-settings=false < /dev/null
sed -i '' 's/port = 543/port = 553/' supabase/config.toml
```

Expected: `supabase/config.toml` exists; `grep -n "port = 55" supabase/config.toml` lists api 55321, db 55322, studio 55323, inbucket 55324 and others.

- [ ] **Step 2: Configure auth**

Edit `supabase/config.toml`:

1. `project_id = "roost"`
2. Under `[auth]`: `site_url = "http://localhost:5173"`, `additional_redirect_urls = ["http://localhost:5173", "http://127.0.0.1:5173"]`, `enable_anonymous_sign_ins = true`
3. Under `[auth.email]`: `enable_signup = true`, `enable_confirmations = false`, `otp_length = 6`, `otp_expiry = 600`, `max_frequency = "1s"`
4. Add (or uncomment and set) these template blocks after `[auth.email]`:

```toml
[auth.email.template.magic_link]
subject = "Your Roost Family code"
content_path = "./supabase/templates/code.html"

[auth.email.template.confirmation]
subject = "Your Roost Family code"
content_path = "./supabase/templates/code.html"
```

Create `supabase/templates/code.html`:

```html
<h2>Your Roost Family sign-in code</h2>
<p style="font-size:32px;font-weight:700;letter-spacing:6px">{{ .Token }}</p>
<p>Enter this code on your tablet. It expires in 10 minutes.</p>
```

- [ ] **Step 3: Start and capture keys**

```bash
supabase start
supabase status
```

Expected: services start; status prints `API URL: http://127.0.0.1:55321` and an `anon key` (may be labeled "Publishable key").

Create `.env.local` (gitignored) with the printed values:

```
VITE_SUPABASE_URL=http://127.0.0.1:55321
VITE_SUPABASE_ANON_KEY=<anon or publishable key from supabase status>
```

Update `.env.example` to use port `55321`.

- [ ] **Step 4: Commit**

```bash
git add supabase/config.toml supabase/templates/code.html .env.example
git commit -m "chore(db): local Supabase project with email code and anonymous sign-in"
```

---

### Task 11: Database schema

**Files:**
- Create: `supabase/migrations/20260914000001_schema.sql`

Spec §12, with Revision 3 changes (medicines and night-sleep windows per child) and the planning decisions above (household settings as columns; `household_id` on every entry table, validated by trigger).

- [ ] **Step 1: Write the migration**

`supabase/migrations/20260914000001_schema.sql`:

```sql
create extension if not exists pgcrypto with schema extensions;

-- ─── Config ──────────────────────────────────────────────────────────────
create table public.app_config (
  key text primary key,
  value jsonb not null
);
insert into public.app_config (key, value) values ('invites_required', 'true');

-- ─── Households, people, displays ────────────────────────────────────────
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  time_zone text not null,
  zip text check (zip ~ '^\d{5}$'),
  lat double precision,
  lon double precision,
  plan text not null default 'free',
  default_night_sleep_start time not null default '18:00',
  default_night_sleep_end time not null default '05:00',
  night_mode_start time not null default '20:00',
  night_mode_end time not null default '06:00',
  leave_by_buffer_min int not null default 20 check (leave_by_buffer_min between 0 and 120),
  diaper_log_enabled boolean not null default false,
  dinner_tonight text check (char_length(dinner_tonight) <= 80),
  sitter_info jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.invite_codes (
  code text primary key check (code ~ '^[A-Z0-9]{6}$'),
  used_by_household_id uuid references public.households (id) on delete set null,
  used_at timestamptz
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  role text not null check (role in ('owner', 'adult', 'caregiver')),
  display_name text not null check (char_length(display_name) between 1 and 40),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  unique (user_id, household_id)
);

-- PIN hashes live apart from memberships so no client query can ever select them.
create table public.member_pins (
  membership_id uuid primary key references public.memberships (id) on delete cascade,
  pin_hash text not null,
  updated_at timestamptz not null default now()
);

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  policy_version text not null,
  health_data_consent boolean not null,
  accepted_at timestamptz not null default now()
);

create table public.displays (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- One-time claim tokens (hashed), readable only through security-definer functions.
create table public.display_claims (
  display_id uuid primary key references public.displays (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null
);

create table public.children (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  birthday date not null,
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  photo_id uuid,
  allergies text not null default '',
  food_rules text not null default '',
  night_sleep_start time,
  night_sleep_end time,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  check ((night_sleep_start is null) = (night_sleep_end is null))
);

create table public.child_households (
  child_id uuid primary key references public.children (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade
);

create table public.feature_overrides (
  child_id uuid not null references public.children (id) on delete cascade,
  feature text not null check (feature in ('wakeWindow', 'feeding', 'kidsCorner', 'diaper')),
  enabled boolean not null,
  primary key (child_id, feature)
);

create table public.sitter_sessions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  display_id uuid references public.displays (id) on delete set null,
  sitter_name text check (char_length(sitter_name) <= 40),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  summary_shown_at timestamptz
);

-- ─── Logs ────────────────────────────────────────────────────────────────
-- Entry ids are generated on the device so offline replay is idempotent.
create table public.sleep_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz,
  type text not null check (type in ('nap', 'night')),
  display_id uuid references public.displays (id) on delete set null,
  logged_by_membership_id uuid references public.memberships (id) on delete set null,
  sitter_session_id uuid references public.sitter_sessions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at is null or end_at >= start_at)
);

create table public.feeding_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  at timestamptz not null,
  type text not null check (type in ('milk', 'meal', 'snack')),
  amount text check (char_length(amount) <= 20),
  note text check (char_length(note) <= 200),
  display_id uuid references public.displays (id) on delete set null,
  logged_by_membership_id uuid references public.memberships (id) on delete set null,
  sitter_session_id uuid references public.sitter_sessions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.medicines (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  min_interval_hours numeric(4, 1) not null check (min_interval_hours > 0 and min_interval_hours <= 72),
  max_doses_per_24h int check (max_doses_per_24h between 1 and 24),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.dose_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  medicine_id uuid not null references public.medicines (id) on delete cascade,
  at timestamptz not null,
  note text check (char_length(note) <= 200),
  logged_offline boolean not null default false,
  warnings_confirmed text[] not null default '{}',
  conflict_acknowledged_at timestamptz,
  conflict_acknowledged_by uuid references public.memberships (id) on delete set null,
  voided_at timestamptz,
  voided_by uuid references public.memberships (id) on delete set null,
  void_reason text check (char_length(void_reason) <= 200),
  display_id uuid references public.displays (id) on delete set null,
  logged_by_membership_id uuid references public.memberships (id) on delete set null,
  sitter_session_id uuid references public.sitter_sessions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((voided_at is null) = (void_reason is null)),
  -- medicine doses must name who gave them: an adult or a sitter session
  check (logged_by_membership_id is not null or sitter_session_id is not null)
);

create table public.sticker_categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  icon_key text not null,
  sort_order int not null default 0,
  archived_at timestamptz
);

create table public.sticker_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  category_id uuid not null references public.sticker_categories (id) on delete cascade,
  at timestamptz not null,
  display_id uuid references public.displays (id) on delete set null,
  logged_by_membership_id uuid references public.memberships (id) on delete set null,
  sitter_session_id uuid references public.sitter_sessions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.diaper_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  at timestamptz not null,
  kind text not null check (kind in ('wet', 'dirty', 'both')),
  display_id uuid references public.displays (id) on delete set null,
  logged_by_membership_id uuid references public.memberships (id) on delete set null,
  sitter_session_id uuid references public.sitter_sessions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Routines ────────────────────────────────────────────────────────────
create table public.routines (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  weekdays smallint[] not null default '{}' check (weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.routine_progress (
  household_id uuid not null references public.households (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  routine_id uuid not null references public.routines (id) on delete cascade,
  day date not null,
  completed_step_indexes int[] not null default '{}',
  primary key (child_id, routine_id, day)
);

create table public.routine_day_overrides (
  household_id uuid not null references public.households (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  day date not null,
  routine_id uuid not null references public.routines (id) on delete cascade,
  primary key (child_id, day)
);

-- ─── Household lists ─────────────────────────────────────────────────────
create table public.jots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 500),
  display_id uuid references public.displays (id) on delete set null,
  created_at timestamptz not null default now(),
  done_at timestamptz
);

create table public.grocery_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 100),
  display_id uuid references public.displays (id) on delete set null,
  created_at timestamptz not null default now(),
  checked_at timestamptz
);

create table public.take_list_links (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  storage_path text not null,
  kind text not null check (kind in ('avatar', 'step', 'slideshow')),
  added_at timestamptz not null default now()
);

create table public.settings_audit (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  membership_id uuid references public.memberships (id) on delete set null,
  change jsonb not null,
  at timestamptz not null default now()
);

-- ─── Integrity triggers ──────────────────────────────────────────────────
create function public.enforce_child_household() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.child_households ch
    where ch.child_id = new.child_id and ch.household_id = new.household_id
  ) then
    raise exception 'child % does not belong to household %', new.child_id, new.household_id
      using errcode = '23514';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'sleep_entries', 'feeding_entries', 'medicines', 'dose_entries', 'sticker_entries',
    'diaper_entries', 'routines', 'routine_progress', 'routine_day_overrides'
  ] loop
    execute format(
      'create trigger enforce_child_household before insert or update of child_id, household_id on public.%I
       for each row execute function public.enforce_child_household()', t);
  end loop;
end $$;

create function public.enforce_dose_medicine_child() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.medicines m where m.id = new.medicine_id and m.child_id = new.child_id) then
    raise exception 'medicine % is not defined for child %', new.medicine_id, new.child_id using errcode = '23514';
  end if;
  return new;
end $$;

create trigger enforce_dose_medicine_child before insert or update of medicine_id, child_id on public.dose_entries
  for each row execute function public.enforce_dose_medicine_child();

create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['sleep_entries', 'feeding_entries', 'dose_entries', 'sticker_entries', 'diaper_entries'] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ─── Indexes ─────────────────────────────────────────────────────────────
create index on public.memberships (household_id);
create index on public.displays (household_id);
create index on public.child_households (household_id);
create index on public.sleep_entries (household_id, start_at desc);
create index on public.feeding_entries (household_id, at desc);
create index on public.dose_entries (household_id, at desc);
create index on public.sticker_entries (household_id, at desc);
create index on public.diaper_entries (household_id, at desc);
create index on public.medicines (household_id);
create index on public.routines (household_id);
create index on public.jots (household_id);
create index on public.grocery_items (household_id);

-- ─── Realtime ────────────────────────────────────────────────────────────
alter publication supabase_realtime add table
  public.households, public.memberships, public.displays, public.children, public.child_households,
  public.feature_overrides, public.sitter_sessions, public.sleep_entries, public.feeding_entries,
  public.medicines, public.dose_entries, public.sticker_categories, public.sticker_entries,
  public.diaper_entries, public.routines, public.routine_progress, public.routine_day_overrides,
  public.jots, public.grocery_items;
```

- [ ] **Step 2: Apply**

Run: `supabase db reset`
Expected: `Finished supabase db reset` with no SQL errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260914000001_schema.sql
git commit -m "feat(db): core schema for households, people, displays, logs, routines, lists"
```

---

### Task 12: Row-level security and RPC functions

**Files:**
- Create: `supabase/migrations/20260914000002_rls_and_rpcs.sql`
- Create: `supabase/manual-checks/rls_smoke.sql`

Identity model (spec §6): **adults** are non-anonymous Supabase users with a `memberships` row; **displays** are anonymous Supabase users bound through `displays.auth_user_id`. Both are Postgres role `authenticated`. A revoked display loses access immediately because every policy goes through `is_household_member`.

- [ ] **Step 1: Write the migration**

`supabase/migrations/20260914000002_rls_and_rpcs.sql`:

```sql
-- ─── Grants: nothing for anon; column-limited updates on households ─────
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon, public;

revoke insert, update, delete on public.households from authenticated;
grant update (
  name, time_zone, zip, lat, lon, default_night_sleep_start, default_night_sleep_end,
  night_mode_start, night_mode_end, leave_by_buffer_min, diaper_log_enabled, dinner_tonight, sitter_info
) on public.households to authenticated;

-- ─── Helper functions ────────────────────────────────────────────────────
create function public.my_household_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.household_id from public.memberships m
  where m.user_id = auth.uid() and m.left_at is null
  union
  select d.household_id from public.displays d
  where d.auth_user_id = auth.uid() and d.revoked_at is null
$$;

create function public.is_household_member(p_household_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.my_household_ids() as h (household_id) where h.household_id = p_household_id)
$$;

create function public.is_household_owner(p_household_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.household_id = p_household_id and m.role = 'owner' and m.left_at is null
  )
$$;

create function public.child_in_my_household(p_child_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.child_households ch
    where ch.child_id = p_child_id and public.is_household_member(ch.household_id)
  )
$$;

create function public.require_adult() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'adult sign-in required' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

-- ─── Enable RLS everywhere ───────────────────────────────────────────────
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
-- Tables with RLS on and no policies (app_config, invite_codes, member_pins, display_claims)
-- are reachable only through the security-definer functions below.

-- ─── Policies ────────────────────────────────────────────────────────────
create policy households_select on public.households for select to authenticated
  using (public.is_household_member(id));
create policy households_update on public.households for update to authenticated
  using (public.is_household_member(id)) with check (public.is_household_member(id));

create policy memberships_select on public.memberships for select to authenticated
  using (public.is_household_member(household_id));

create policy consent_select_own on public.consent_records for select to authenticated
  using (user_id = auth.uid());

create policy displays_select on public.displays for select to authenticated
  using (public.is_household_member(household_id));

create policy children_select on public.children for select to authenticated
  using (public.child_in_my_household(id));
create policy children_update on public.children for update to authenticated
  using (public.child_in_my_household(id)) with check (public.child_in_my_household(id));

create policy child_households_select on public.child_households for select to authenticated
  using (public.is_household_member(household_id));

create policy feature_overrides_all on public.feature_overrides for all to authenticated
  using (public.child_in_my_household(child_id)) with check (public.child_in_my_household(child_id));

-- Household-scoped tables: members (adults and displays) can read and write.
do $$
declare t text;
begin
  foreach t in array array[
    'sitter_sessions', 'sleep_entries', 'feeding_entries', 'medicines', 'sticker_categories',
    'sticker_entries', 'diaper_entries', 'routines', 'routine_progress', 'routine_day_overrides',
    'jots', 'grocery_items', 'take_list_links', 'photos'
  ] loop
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.is_household_member(household_id))
         with check (public.is_household_member(household_id))',
      t || '_member_all', t);
  end loop;
end $$;

-- Doses are never deleted (spec §11.4): select, insert, update only.
create policy dose_entries_select on public.dose_entries for select to authenticated
  using (public.is_household_member(household_id));
create policy dose_entries_insert on public.dose_entries for insert to authenticated
  with check (public.is_household_member(household_id));
create policy dose_entries_update on public.dose_entries for update to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

create policy settings_audit_select on public.settings_audit for select to authenticated
  using (public.is_household_member(household_id));
create policy settings_audit_insert on public.settings_audit for insert to authenticated
  with check (public.is_household_member(household_id));

-- ─── RPC: consent and household creation ─────────────────────────────────
create function public.record_consent(p_policy_version text, p_health_data_consent boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := public.require_adult();
begin
  if not p_health_data_consent then
    raise exception 'health data consent is required' using errcode = '22023';
  end if;
  insert into public.consent_records (user_id, policy_version, health_data_consent)
  values (v_user, p_policy_version, true);
end $$;

create function public.create_household(
  p_name text, p_time_zone text, p_zip text, p_lat double precision, p_lon double precision,
  p_invite_code text, p_display_name text, p_color text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := public.require_adult();
  v_household uuid;
  v_invites_required boolean;
begin
  if not exists (select 1 from public.consent_records c where c.user_id = v_user and c.health_data_consent) then
    raise exception 'consent required' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = p_time_zone) then
    raise exception 'unknown time zone %', p_time_zone using errcode = '22023';
  end if;

  select coalesce((c.value #>> '{}')::boolean, true) into v_invites_required
  from public.app_config c where c.key = 'invites_required';
  v_invites_required := coalesce(v_invites_required, true);

  if v_invites_required then
    perform 1 from public.invite_codes i
    where i.code = upper(p_invite_code) and i.used_at is null
    for update;
    if not found then
      raise exception 'invalid invite code' using errcode = '22023';
    end if;
  end if;

  insert into public.households (name, time_zone, zip, lat, lon)
  values (p_name, p_time_zone, nullif(p_zip, ''), p_lat, p_lon)
  returning id into v_household;

  if v_invites_required then
    update public.invite_codes set used_by_household_id = v_household, used_at = now()
    where code = upper(p_invite_code);
  end if;

  insert into public.memberships (user_id, household_id, role, display_name, color)
  values (v_user, v_household, 'owner', p_display_name, p_color);

  insert into public.sticker_categories (household_id, name, icon_key, sort_order) values
    (v_household, 'Potty', 'potty', 0),
    (v_household, 'Teeth', 'teeth', 1),
    (v_household, 'Tried a new food', 'new-food', 2);

  return v_household;
end $$;

create function public.add_child(p_household_id uuid, p_name text, p_birthday date, p_color text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_child uuid;
begin
  if not public.is_household_member(p_household_id) then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  if (select count(*) from public.child_households ch where ch.household_id = p_household_id) >= 8 then
    raise exception 'a household can have at most 8 children' using errcode = '22023';
  end if;
  insert into public.children (name, birthday, color) values (p_name, p_birthday, p_color) returning id into v_child;
  insert into public.child_households (child_id, household_id) values (v_child, p_household_id);
  return v_child;
end $$;

-- ─── RPC: PINs ───────────────────────────────────────────────────────────
create function public.set_my_pin(p_household_id uuid, p_pin text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := public.require_adult();
begin
  if p_pin !~ '^\d{4}$' then
    raise exception 'PIN must be 4 digits' using errcode = '22023';
  end if;
  insert into public.member_pins (membership_id, pin_hash)
  select m.id, extensions.crypt(p_pin, extensions.gen_salt('bf', 8))
  from public.memberships m
  where m.user_id = v_user and m.household_id = p_household_id and m.left_at is null
  on conflict (membership_id) do update set pin_hash = excluded.pin_hash, updated_at = now();
  if not found then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
end $$;

create function public.verify_pin(p_membership_id uuid, p_pin text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_household uuid;
begin
  select m.household_id into v_household from public.memberships m
  where m.id = p_membership_id and m.left_at is null;
  if v_household is null or not public.is_household_member(v_household) then
    return false;
  end if;
  return exists (
    select 1 from public.member_pins p
    where p.membership_id = p_membership_id and p.pin_hash = extensions.crypt(p_pin, p.pin_hash)
  );
end $$;

-- ─── RPC: displays ───────────────────────────────────────────────────────
create function public.register_display(p_household_id uuid, p_name text)
returns table (out_display_id uuid, out_claim_token text)
language plpgsql security definer set search_path = '' as $$
declare
  v_display uuid;
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  perform public.require_adult();
  if not public.is_household_owner(p_household_id) then
    raise exception 'only an owner can add a display' using errcode = '42501';
  end if;
  if (
    select count(*) from public.displays d
    where d.household_id = p_household_id and d.revoked_at is null
      and (d.auth_user_id is not null
           or exists (select 1 from public.display_claims c where c.display_id = d.id and c.expires_at > now()))
  ) >= 3 then
    raise exception 'a household can have at most 3 displays' using errcode = '22023';
  end if;

  insert into public.displays (household_id, name) values (p_household_id, p_name) returning id into v_display;
  insert into public.display_claims (display_id, token_hash, expires_at)
  values (v_display, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '10 minutes');

  return query select v_display, v_token;
end $$;

create function public.claim_display(p_token text)
returns table (out_display_id uuid, out_household_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_display uuid;
  v_household uuid;
begin
  if auth.uid() is null or not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'a display must claim with a device session' using errcode = '42501';
  end if;

  select c.display_id into v_display
  from public.display_claims c
  join public.displays d on d.id = c.display_id
  where c.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and c.expires_at > now() and d.revoked_at is null and d.auth_user_id is null
  for update of c;
  if v_display is null then
    raise exception 'invalid or expired display claim' using errcode = '22023';
  end if;

  update public.displays set auth_user_id = auth.uid(), last_seen_at = now()
  where id = v_display returning household_id into v_household;
  delete from public.display_claims where display_id = v_display;

  return query select v_display, v_household;
end $$;

create function public.my_display()
returns table (out_display_id uuid, out_household_id uuid, out_name text, out_revoked boolean)
language sql stable security definer set search_path = '' as $$
  select d.id, d.household_id, d.name, d.revoked_at is not null
  from public.displays d where d.auth_user_id = auth.uid()
$$;

create function public.display_heartbeat() returns void
language sql security definer set search_path = '' as $$
  update public.displays set last_seen_at = now()
  where auth_user_id = auth.uid() and revoked_at is null
$$;

create function public.revoke_display(p_display_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_household uuid;
begin
  perform public.require_adult();
  select d.household_id into v_household from public.displays d where d.id = p_display_id;
  if v_household is null or not public.is_household_owner(v_household) then
    raise exception 'only an owner can remove a display' using errcode = '42501';
  end if;
  update public.displays set revoked_at = now() where id = p_display_id and revoked_at is null;
  delete from public.display_claims where display_id = p_display_id;
end $$;

-- ─── Execute grants ──────────────────────────────────────────────────────
grant execute on function
  public.my_household_ids(), public.is_household_member(uuid), public.is_household_owner(uuid),
  public.child_in_my_household(uuid), public.require_adult(),
  public.record_consent(text, boolean),
  public.create_household(text, text, text, double precision, double precision, text, text, text),
  public.add_child(uuid, text, date, text),
  public.set_my_pin(uuid, text), public.verify_pin(uuid, text),
  public.register_display(uuid, text), public.claim_display(text), public.my_display(),
  public.display_heartbeat(), public.revoke_display(uuid)
to authenticated;
```

- [ ] **Step 2: Apply**

Run: `supabase db reset`
Expected: both migrations apply with no errors.

- [ ] **Step 3: Manual RLS smoke check**

`supabase/manual-checks/rls_smoke.sql` simulates two households and a revoked display using `set local role` and JWT claims (run inside a transaction that rolls back):

```sql
begin;

-- Two adult users
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@roost.test', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@roost.test', '{}', '{}', now(), now());
insert into public.invite_codes (code) values ('SMOKE1'), ('SMOKE2');

-- As adult A: consent + household + child
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","is_anonymous":false}', true);
select public.record_consent('2026-09-14', true);
select public.create_household('A family', 'America/New_York', '28202', null, null, 'SMOKE1', 'Alex', '#5B6ACF') as household_a \gset
select public.add_child(:'household_a', 'Kid A', '2024-01-01', '#C2477A');

-- As adult B: own household
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated","is_anonymous":false}', true);
select public.record_consent('2026-09-14', true);
select public.create_household('B family', 'America/Chicago', '60601', null, null, 'SMOKE2', 'Blair', '#2F86A6') as household_b \gset

-- B must not see A's household or children
select count(*) as b_sees_a_households from public.households where id = :'household_a';   -- expect 0
select count(*) as b_sees_children from public.children;                                     -- expect 0

rollback;
```

Run: `psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -f supabase/manual-checks/rls_smoke.sql`
Expected: `b_sees_a_households` = 0 and `b_sees_children` = 0; no errors before `ROLLBACK`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260914000002_rls_and_rpcs.sql supabase/manual-checks/rls_smoke.sql
git commit -m "feat(db): row-level security, household/child/PIN/display RPCs"
```

---

### Task 13: Dev seed data and generated types

**Files:**
- Create: `supabase/seed.sql`, `src/data/database.types.ts` (generated)

A fictional "Rivera" household for development: owner Sam (`sam@roost.test`, PIN `1234`), adult Alex (`alex@roost.test`, PIN `5678`), Ivy (born 2023-04-10) and Theo (born 2025-06-02), per-child medicines, routines, and logs relative to `now()`. Invite codes `ROOST1`–`ROOST3` stay unused for the setup wizard. Seed runs as `postgres`, bypassing RLS.

- [ ] **Step 1: Write the seed**

`supabase/seed.sql`:

```sql
insert into public.invite_codes (code) values ('ROOST1'), ('ROOST2'), ('ROOST3'), ('RIVERA');

-- Adults (email sign-in works through the local mail viewer)
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sam@roost.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'alex@roost.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at) values
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   '{"sub":"11111111-1111-1111-1111-111111111111","email":"sam@roost.test","email_verified":true}', 'email', now(), now(), now()),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222',
   '{"sub":"22222222-2222-2222-2222-222222222222","email":"alex@roost.test","email_verified":true}', 'email', now(), now(), now());

insert into public.consent_records (user_id, policy_version, health_data_consent) values
  ('11111111-1111-1111-1111-111111111111', '2026-09-14', true),
  ('22222222-2222-2222-2222-222222222222', '2026-09-14', true);

-- Household
insert into public.households (id, name, time_zone, zip, dinner_tonight, sitter_info) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Rivera', 'America/New_York', '28202', 'Tacos',
   '{"napInstructions":"Theo naps in the crib with the sound machine on.","bedtime":"Ivy 7:00 PM, Theo 6:30 PM","emergencyContacts":"Sam 704-555-0101 · Alex 704-555-0102","pediatrician":"Dr. Patel 704-555-0199","address":"12 Maple St","whereThings":"Spare diapers: hall closet"}');
update public.invite_codes set used_by_household_id = 'aaaaaaaa-0000-0000-0000-000000000001', used_at = now() where code = 'RIVERA';

insert into public.memberships (id, user_id, household_id, role, display_name, color) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner', 'Sam', '#5B6ACF'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000001', 'adult', 'Alex', '#2F86A6');

insert into public.member_pins (membership_id, pin_hash) values
  ('bbbbbbbb-0000-0000-0000-000000000001', extensions.crypt('1234', extensions.gen_salt('bf', 8))),
  ('bbbbbbbb-0000-0000-0000-000000000002', extensions.crypt('5678', extensions.gen_salt('bf', 8)));

-- Children
insert into public.children (id, name, birthday, color, allergies, food_rules, night_sleep_start, night_sleep_end, sort_order) values
  ('cccccccc-0000-0000-0000-000000000001', 'Ivy', '2023-04-10', '#C2477A', 'None', 'No juice after 4 PM', '19:00', '06:00', 0),
  ('cccccccc-0000-0000-0000-000000000002', 'Theo', '2025-06-02', '#8A56AC', 'Peanuts', 'Whole milk only', null, null, 1);
insert into public.child_households (child_id, household_id) values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001');

-- Sticker categories
insert into public.sticker_categories (id, household_id, name, icon_key, sort_order) values
  ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Potty', 'potty', 0),
  ('dddddddd-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Teeth', 'teeth', 1),
  ('dddddddd-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'Tried a new food', 'new-food', 2);

-- Medicines (per child)
insert into public.medicines (id, household_id, child_id, name, min_interval_hours, max_doses_per_24h) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', 'Infant ibuprofen', 6, 4),
  ('eeeeeeee-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', 'Infant acetaminophen', 4, 5),
  ('eeeeeeee-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'Children''s ibuprofen', 6, 4);

-- Routines
insert into public.routines (household_id, child_id, name, weekdays, steps, sort_order) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'Home day', '{1,2,3,4,5}',
   '[{"iconKey":"breakfast","photoId":null,"label":"Breakfast","time":"07:00"},
     {"iconKey":"teeth","photoId":null,"label":"Brush teeth","time":null},
     {"iconKey":"getting-dressed","photoId":null,"label":"Get dressed","time":null},
     {"iconKey":"park","photoId":null,"label":"Park","time":"09:30"},
     {"iconKey":"snack","photoId":null,"label":"Snack","time":null},
     {"iconKey":"nap","photoId":null,"label":"Nap","time":"12:30"},
     {"iconKey":"books","photoId":null,"label":"Books","time":null},
     {"iconKey":"bath","photoId":null,"label":"Bath","time":"18:15"},
     {"iconKey":"bed","photoId":null,"label":"Bed","time":"19:00"}]', 0),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'Weekend', '{0,6}',
   '[{"iconKey":"breakfast","photoId":null,"label":"Breakfast","time":null},
     {"iconKey":"park","photoId":null,"label":"Park","time":null},
     {"iconKey":"bath","photoId":null,"label":"Bath","time":"18:15"},
     {"iconKey":"bed","photoId":null,"label":"Bed","time":"19:00"}]', 1);

-- Logs relative to now
insert into public.sleep_entries (household_id, child_id, start_at, end_at, type, logged_by_membership_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', now() - interval '20 hours', now() - interval '9 hours', 'night', 'bbbbbbbb-0000-0000-0000-000000000001'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', now() - interval '4 hours', now() - interval '2 hours 40 minutes', 'nap', 'bbbbbbbb-0000-0000-0000-000000000002');

insert into public.feeding_entries (household_id, child_id, at, type, amount, logged_by_membership_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', now() - interval '70 minutes', 'milk', '6 oz', 'bbbbbbbb-0000-0000-0000-000000000001'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', now() - interval '5 hours', 'meal', 'some', null);

insert into public.dose_entries (household_id, child_id, medicine_id, at, note, logged_by_membership_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000001', now() - interval '2 hours', '2.5 ml', 'bbbbbbbb-0000-0000-0000-000000000001');

insert into public.sticker_entries (household_id, child_id, category_id, at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', now() - interval '1 hour'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002', now() - interval '26 hours');

insert into public.grocery_items (household_id, text) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Whole milk'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Bananas');
insert into public.jots (household_id, text) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Call pediatrician about Theo''s rash');
```

- [ ] **Step 2: Apply and generate types**

```bash
supabase db reset
mkdir -p src/data
pnpm db:types
```

Expected: reset finishes with `Seeding data from supabase/seed.sql`; `src/data/database.types.ts` exports `Database` with `public.Tables.households`, `public.Functions.claim_display`, etc.

Verify: `grep -c "claim_display" src/data/database.types.ts` prints at least `1`.

- [ ] **Step 3: Commit**

```bash
git add supabase/seed.sql src/data/database.types.ts
git commit -m "feat(db): dev seed household and generated types"
```

---

### Task 14: Supabase clients, display session, adult session

**Files:**
- Create: `src/data/supabase.ts`, `src/session/displaySession.ts`, `src/session/displaySession.test.ts`, `src/session/adultSession.ts`, `src/session/idleTimer.ts`, `src/session/idleTimer.test.ts`

Spec §6.3: the display runs on its own credential; adult sign-ins are temporary and end after 5 minutes without a touch.

- [ ] **Step 1: Clients**

`src/data/supabase.ts`:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

export type RoostClient = SupabaseClient<Database>

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** The tablet's own identity (anonymous user bound to a display). Persisted. */
export const displayClient: RoostClient = createClient<Database>(url, anonKey, {
  auth: { storageKey: 'roost-display', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
})

/** A throwaway client for a temporary adult sign-in. Never persisted. */
export function createAdultClient(): RoostClient {
  return createClient<Database>(url, anonKey, {
    auth: {
      storageKey: `roost-adult-${crypto.randomUUID()}`,
      persistSession: false,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  })
}
```

- [ ] **Step 2: Write the failing display-session test**

`src/session/displaySession.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { loadDisplayState, type DisplaySessionClient } from './displaySession'

function fakeClient(opts: { session: boolean; rows: unknown[] }): DisplaySessionClient {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: opts.session ? { user: { id: 'u' } } : null } }),
      signInAnonymously: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    rpc: vi.fn().mockResolvedValue({ data: opts.rows, error: null }),
  } as unknown as DisplaySessionClient
}

describe('loadDisplayState', () => {
  it('is unregistered without a session', async () => {
    expect(await loadDisplayState(fakeClient({ session: false, rows: [] }))).toEqual({ kind: 'unregistered' })
  })

  it('is unregistered when the session has no display', async () => {
    expect(await loadDisplayState(fakeClient({ session: true, rows: [] }))).toEqual({ kind: 'unregistered' })
  })

  it('is registered with identity', async () => {
    const client = fakeClient({
      session: true,
      rows: [{ out_display_id: 'd1', out_household_id: 'h1', out_name: 'Kitchen', out_revoked: false }],
    })
    expect(await loadDisplayState(client)).toEqual({
      kind: 'registered',
      identity: { displayId: 'd1', householdId: 'h1', name: 'Kitchen' },
    })
  })

  it('is revoked when the display was removed', async () => {
    const client = fakeClient({
      session: true,
      rows: [{ out_display_id: 'd1', out_household_id: 'h1', out_name: 'Kitchen', out_revoked: true }],
    })
    expect(await loadDisplayState(client)).toEqual({ kind: 'revoked' })
  })
})
```

Run: `pnpm test src/session/displaySession.test.ts`
Expected: FAIL, cannot resolve `./displaySession`.

- [ ] **Step 3: Implement the display session**

`src/session/displaySession.ts`:

```ts
import type { RoostClient } from '@/data/supabase'

export type DisplaySessionClient = Pick<RoostClient, 'auth' | 'rpc'>

export interface DisplayIdentity {
  displayId: string
  householdId: string
  name: string
}

export type DisplayState =
  | { kind: 'unregistered' }
  | { kind: 'registered'; identity: DisplayIdentity }
  | { kind: 'revoked' }

export async function loadDisplayState(client: DisplaySessionClient): Promise<DisplayState> {
  const { data } = await client.auth.getSession()
  if (!data.session) return { kind: 'unregistered' }

  const { data: rows, error } = await client.rpc('my_display')
  if (error) throw error
  const row = rows?.[0]
  if (!row) return { kind: 'unregistered' }
  if (row.out_revoked) return { kind: 'revoked' }
  return {
    kind: 'registered',
    identity: { displayId: row.out_display_id, householdId: row.out_household_id, name: row.out_name },
  }
}

/** Signs in anonymously if needed, then binds this tablet to the display registered with `token`. */
export async function claimDisplay(client: DisplaySessionClient, token: string): Promise<DisplayIdentity> {
  const { data } = await client.auth.getSession()
  if (!data.session) {
    const { error } = await client.auth.signInAnonymously()
    if (error) throw error
  }
  const { error } = await client.rpc('claim_display', { p_token: token })
  if (error) throw error

  const state = await loadDisplayState(client)
  if (state.kind !== 'registered') throw new Error('Display claim did not register this tablet')
  return state.identity
}

/** Forget this tablet's identity (after revocation, or to start over). */
export async function resetDisplay(client: DisplaySessionClient): Promise<void> {
  await client.auth.signOut({ scope: 'local' })
}
```

Run: `pnpm test src/session/displaySession.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 4: Write the failing idle-timer test**

`src/session/idleTimer.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { startIdleTimer } from './idleTimer'

afterEach(() => vi.useRealTimers())

describe('startIdleTimer', () => {
  it('fires after the idle period with no touches', () => {
    vi.useFakeTimers()
    const onIdle = vi.fn()
    startIdleTimer(onIdle, 1000)
    vi.advanceTimersByTime(999)
    expect(onIdle).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onIdle).toHaveBeenCalledOnce()
  })

  it('resets on pointer activity', () => {
    vi.useFakeTimers()
    const onIdle = vi.fn()
    startIdleTimer(onIdle, 1000)
    vi.advanceTimersByTime(800)
    window.dispatchEvent(new Event('pointerdown'))
    vi.advanceTimersByTime(800)
    expect(onIdle).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(onIdle).toHaveBeenCalledOnce()
  })

  it('stops when cancelled', () => {
    vi.useFakeTimers()
    const onIdle = vi.fn()
    const stop = startIdleTimer(onIdle, 1000)
    stop()
    vi.advanceTimersByTime(5000)
    expect(onIdle).not.toHaveBeenCalled()
  })
})
```

Run: `pnpm test src/session/idleTimer.test.ts`
Expected: FAIL, cannot resolve `./idleTimer`.

- [ ] **Step 5: Implement the idle timer and adult session**

`src/session/idleTimer.ts`:

```ts
const ACTIVITY_EVENTS = ['pointerdown', 'keydown'] as const

export const ADULT_SESSION_IDLE_MS = 5 * 60_000

/** Calls `onIdle` once after `idleMs` without pointer or key activity. Returns a stop function. */
export function startIdleTimer(onIdle: () => void, idleMs = ADULT_SESSION_IDLE_MS): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const reset = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      stop()
      onIdle()
    }, idleMs)
  }
  const stop = () => {
    clearTimeout(timer)
    for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, reset)
  }
  for (const e of ACTIVITY_EVENTS) window.addEventListener(e, reset, { passive: true })
  reset()
  return stop
}
```

`src/session/adultSession.ts`:

```ts
import { createAdultClient, type RoostClient } from '@/data/supabase'

export interface AdultSession {
  client: RoostClient
  userId: string
  email: string
  end: () => Promise<void>
}

export function newAdultClient(): RoostClient {
  return createAdultClient()
}

export async function sendEmailCode(client: RoostClient, email: string): Promise<void> {
  const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })
  if (error) throw error
}

export async function verifyEmailCode(client: RoostClient, email: string, code: string): Promise<AdultSession> {
  const { data, error } = await client.auth.verifyOtp({ email, token: code, type: 'email' })
  if (error) throw error
  if (!data.user) throw new Error('Sign-in did not return a user')
  return {
    client,
    userId: data.user.id,
    email: data.user.email ?? email,
    end: async () => {
      await client.auth.signOut({ scope: 'local' })
      client.auth.stopAutoRefresh()
    },
  }
}
```

Run: `pnpm test && pnpm typecheck`
Expected: all tests pass; no type errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(session): display and temporary adult sessions with idle timeout"
```

---

### Task 15: Setup wizard logic

**Files:**
- Create: `src/features/setup/wizardState.ts`, `src/features/setup/validation.ts`, `src/features/setup/validation.test.ts`, `src/features/setup/completeSetup.ts`, `src/features/setup/completeSetup.test.ts`

Spec §7.1 steps covered in Phase 1: welcome, invite code, sign in (email code), consent, household, kids, you (color + PIN), this display. The calendar and another-adult steps arrive with their features (Phases 3–4). Consent is recorded as soon as the consent step is accepted; everything else is written at the final step in `completeSetup`.

- [ ] **Step 1: Wizard state**

`src/features/setup/wizardState.ts`:

```ts
import { reactive } from 'vue'
import type { AdultSession } from '@/session/adultSession'
import { PERSON_COLORS } from '@/ui/personPalette'

export const POLICY_VERSION = '2026-09-14'

export const SETUP_STEPS = ['welcome', 'invite', 'signIn', 'consent', 'household', 'kids', 'you', 'display'] as const
export type SetupStep = (typeof SETUP_STEPS)[number]

export interface KidDraft {
  name: string
  birthday: string
  color: string
}

export function createWizardState() {
  return reactive({
    step: 'welcome' as SetupStep,
    inviteCode: '',
    email: '',
    adult: null as AdultSession | null,
    householdName: '',
    zip: '',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    lat: null as number | null,
    lon: null as number | null,
    kids: [] as KidDraft[],
    displayName: '',
    color: PERSON_COLORS[0] as string,
    pin: '',
    displayLabel: 'Kitchen',
    busy: false,
    error: null as string | null,
  })
}

export type WizardState = ReturnType<typeof createWizardState>

export function nextStep(step: SetupStep): SetupStep {
  const i = SETUP_STEPS.indexOf(step)
  return SETUP_STEPS[Math.min(i + 1, SETUP_STEPS.length - 1)]!
}

export function previousStep(step: SetupStep): SetupStep {
  const i = SETUP_STEPS.indexOf(step)
  return SETUP_STEPS[Math.max(i - 1, 0)]!
}
```

- [ ] **Step 2: Write the failing validation tests**

`src/features/setup/validation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validateInviteCode, validateEmail, validateCode, validateHousehold, validateKids, validatePin } from './validation'

describe('setup validation', () => {
  it('accepts 6-character invite codes, case-insensitive', () => {
    expect(validateInviteCode('roost1')).toBeNull()
    expect(validateInviteCode('ROOS')).toBe('Invite codes are 6 letters or numbers.')
  })

  it('checks email and 6-digit codes', () => {
    expect(validateEmail('sam@roost.test')).toBeNull()
    expect(validateEmail('sam@')).toBe('Enter a valid email address.')
    expect(validateCode('123456')).toBeNull()
    expect(validateCode('12345')).toBe('Enter the 6-digit code from your email.')
  })

  it('requires a household name and an optional 5-digit ZIP', () => {
    expect(validateHousehold({ householdName: 'Rivera', zip: '' })).toBeNull()
    expect(validateHousehold({ householdName: ' ', zip: '' })).toBe('Give your household a name.')
    expect(validateHousehold({ householdName: 'Rivera', zip: '2820' })).toBe('ZIP codes are 5 digits.')
  })

  it('requires 1–8 kids with names and past birthdays', () => {
    const today = '2026-09-14'
    const kid = { name: 'Ivy', birthday: '2023-04-10', color: '#C2477A' }
    expect(validateKids([kid], today)).toBeNull()
    expect(validateKids([], today)).toBe('Add at least one child.')
    expect(validateKids(Array(9).fill(kid), today)).toBe('A household can have up to 8 children.')
    expect(validateKids([{ ...kid, name: '' }], today)).toBe('Every child needs a name.')
    expect(validateKids([{ ...kid, birthday: '2026-09-15' }], today)).toBe('Birthdays can’t be in the future.')
    expect(validateKids([{ ...kid, birthday: '' }], today)).toBe('Every child needs a birthday.')
  })

  it('requires matching 4-digit PINs', () => {
    expect(validatePin('1234', '1234')).toBeNull()
    expect(validatePin('123', '123')).toBe('Your PIN is 4 digits.')
    expect(validatePin('1234', '1243')).toBe('The PINs don’t match.')
  })
})
```

Run: `pnpm test src/features/setup/validation.test.ts`
Expected: FAIL, cannot resolve `./validation`.

- [ ] **Step 3: Implement validation**

`src/features/setup/validation.ts`:

```ts
import type { KidDraft } from './wizardState'

export function validateInviteCode(code: string): string | null {
  return /^[A-Za-z0-9]{6}$/.test(code.trim()) ? null : 'Invite codes are 6 letters or numbers.'
}

export function validateEmail(email: string): string | null {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? null : 'Enter a valid email address.'
}

export function validateCode(code: string): string | null {
  return /^\d{6}$/.test(code.trim()) ? null : 'Enter the 6-digit code from your email.'
}

export function validateHousehold(h: { householdName: string; zip: string }): string | null {
  if (!h.householdName.trim()) return 'Give your household a name.'
  if (h.zip && !/^\d{5}$/.test(h.zip)) return 'ZIP codes are 5 digits.'
  return null
}

export function validateKids(kids: KidDraft[], today: string): string | null {
  if (kids.length === 0) return 'Add at least one child.'
  if (kids.length > 8) return 'A household can have up to 8 children.'
  for (const kid of kids) {
    if (!kid.name.trim()) return 'Every child needs a name.'
    if (!kid.birthday) return 'Every child needs a birthday.'
    if (kid.birthday > today) return 'Birthdays can’t be in the future.'
  }
  return null
}

export function validatePin(pin: string, confirm: string): string | null {
  if (!/^\d{4}$/.test(pin)) return 'Your PIN is 4 digits.'
  if (pin !== confirm) return 'The PINs don’t match.'
  return null
}
```

Run: `pnpm test src/features/setup/validation.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the failing completeSetup test**

`src/features/setup/completeSetup.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { completeSetup } from './completeSetup'

describe('completeSetup', () => {
  it('creates the household, kids, PIN and display, claims the display, then ends the adult session', async () => {
    const calls: string[] = []
    const adultRpc = vi.fn(async (fn: string) => {
      calls.push(fn)
      if (fn === 'create_household') return { data: 'h1', error: null }
      if (fn === 'add_child') return { data: `c${calls.length}`, error: null }
      if (fn === 'register_display') return { data: [{ out_display_id: 'd1', out_claim_token: 'tok' }], error: null }
      return { data: null, error: null }
    })
    const end = vi.fn(async () => { calls.push('end') })
    const claim = vi.fn(async () => {
      calls.push('claim')
      return { displayId: 'd1', householdId: 'h1', name: 'Kitchen' }
    })

    const identity = await completeSetup(
      {
        inviteCode: 'roost1',
        householdName: 'Rivera',
        zip: '28202',
        timeZone: 'America/New_York',
        lat: null,
        lon: null,
        kids: [
          { name: 'Ivy', birthday: '2023-04-10', color: '#C2477A' },
          { name: 'Theo', birthday: '2025-06-02', color: '#8A56AC' },
        ],
        displayName: 'Sam',
        color: '#5B6ACF',
        pin: '1234',
        displayLabel: 'Kitchen',
      },
      { client: { rpc: adultRpc } as never, userId: 'u1', email: 'sam@roost.test', end },
      claim,
    )

    expect(identity).toEqual({ displayId: 'd1', householdId: 'h1', name: 'Kitchen' })
    expect(calls).toEqual(['create_household', 'add_child', 'add_child', 'set_my_pin', 'register_display', 'claim', 'end'])
    expect(adultRpc).toHaveBeenCalledWith('create_household', expect.objectContaining({ p_invite_code: 'ROOST1', p_name: 'Rivera' }))
    expect(claim).toHaveBeenCalledWith('tok')
  })

  it('surfaces RPC errors', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'invalid invite code' } }))
    await expect(
      completeSetup(
        {
          inviteCode: 'NOPE00', householdName: 'X', zip: '', timeZone: 'America/New_York', lat: null, lon: null,
          kids: [], displayName: 'Sam', color: '#5B6ACF', pin: '1234', displayLabel: 'Kitchen',
        },
        { client: { rpc } as never, userId: 'u1', email: 'x@y.z', end: vi.fn() },
        vi.fn(),
      ),
    ).rejects.toThrow('invalid invite code')
  })
})
```

Run: `pnpm test src/features/setup/completeSetup.test.ts`
Expected: FAIL, cannot resolve `./completeSetup`.

- [ ] **Step 5: Implement completeSetup**

`src/features/setup/completeSetup.ts`:

```ts
import type { AdultSession } from '@/session/adultSession'
import type { DisplayIdentity } from '@/session/displaySession'
import type { KidDraft } from './wizardState'

export interface SetupInput {
  inviteCode: string
  householdName: string
  zip: string
  timeZone: string
  lat: number | null
  lon: number | null
  kids: KidDraft[]
  displayName: string
  color: string
  pin: string
  displayLabel: string
}

type RpcResult<T> = { data: T; error: { message: string } | null }

function unwrap<T>(result: RpcResult<T>): T {
  if (result.error) throw new Error(result.error.message)
  return result.data
}

/**
 * Writes the household with the adult's temporary session, registers this tablet,
 * claims it with the display session, and ends the adult session.
 */
export async function completeSetup(
  input: SetupInput,
  adult: AdultSession,
  claim: (token: string) => Promise<DisplayIdentity>,
): Promise<DisplayIdentity> {
  const rpc = adult.client.rpc.bind(adult.client) as unknown as (fn: string, args?: object) => Promise<RpcResult<unknown>>

  const householdId = unwrap(
    await rpc('create_household', {
      p_name: input.householdName.trim(),
      p_time_zone: input.timeZone,
      p_zip: input.zip,
      p_lat: input.lat,
      p_lon: input.lon,
      p_invite_code: input.inviteCode.trim().toUpperCase(),
      p_display_name: input.displayName.trim(),
      p_color: input.color,
    }),
  ) as string

  for (const kid of input.kids) {
    unwrap(
      await rpc('add_child', {
        p_household_id: householdId,
        p_name: kid.name.trim(),
        p_birthday: kid.birthday,
        p_color: kid.color,
      }),
    )
  }

  unwrap(await rpc('set_my_pin', { p_household_id: householdId, p_pin: input.pin }))

  const rows = unwrap(
    await rpc('register_display', { p_household_id: householdId, p_name: input.displayLabel.trim() }),
  ) as { out_display_id: string; out_claim_token: string }[]
  const token = rows[0]?.out_claim_token
  if (!token) throw new Error('Display registration returned no token')

  const identity = await claim(token)
  await adult.end()
  return identity
}
```

Run: `pnpm test src/features/setup && pnpm typecheck`
Expected: PASS; no type errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(setup): wizard state, validation, and completeSetup orchestration"
```

---

### Task 16: Wizard screens, display store, routing, placeholder home

**Files:**
- Create: `src/ui/RLogo.vue`, `src/session/displayStore.ts`, `src/features/setup/SetupWizard.vue`, `src/features/setup/WizardFrame.vue`, `src/features/setup/steps/WelcomeStep.vue`, `src/features/setup/steps/InviteStep.vue`, `src/features/setup/steps/SignInStep.vue`, `src/features/setup/steps/ConsentStep.vue`, `src/features/setup/steps/HouseholdStep.vue`, `src/features/setup/steps/KidsStep.vue`, `src/features/setup/steps/YouStep.vue`, `src/features/setup/steps/DisplayStep.vue`, `src/features/setup/JoinWizard.vue`, `src/features/display/DisplayRemoved.vue`, `src/features/home/HomePlaceholder.vue`
- Modify: `src/router.ts`

Visual reference: v2 design lines 447–557 (wizard, Join, Display removed). Wizard screens are "deliberate" surfaces: 44 pt minimum targets, headings 44 px, body ≥ 18 px.

- [ ] **Step 1: Logo, display store, wizard frame**

`src/ui/RLogo.vue`:

```vue
<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 34 })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 200 200" aria-hidden="true">
    <g fill="none" stroke="currentColor" stroke-width="11" stroke-linecap="round" stroke-linejoin="round">
      <path d="M30 84 L100 26 L170 84" />
      <path d="M30 84 L170 84" />
      <path d="M52 84 L52 160 L148 160 L148 84" />
      <circle cx="100" cy="114" r="15" />
      <path d="M100 129 L92 146 L108 146 Z" />
    </g>
  </svg>
</template>
```

`src/session/displayStore.ts`:

```ts
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { displayClient } from '@/data/supabase'
import { loadDisplayState, type DisplayState } from './displaySession'

export const useDisplayStore = defineStore('display', () => {
  const state = ref<DisplayState | null>(null)

  async function refresh(): Promise<DisplayState> {
    state.value = await loadDisplayState(displayClient)
    return state.value
  }

  async function ensure(): Promise<DisplayState> {
    return state.value ?? refresh()
  }

  return { state, refresh, ensure }
})
```

`src/features/setup/WizardFrame.vue`:

```vue
<script setup lang="ts">
import RLogo from '@/ui/RLogo.vue'
import RButton from '@/ui/RButton.vue'

defineProps<{ title: string; subtitle?: string; error?: string | null; canGoBack?: boolean }>()
defineEmits<{ back: [] }>()
</script>

<template>
  <main class="flex min-h-dvh flex-col bg-app px-10 py-8">
    <header class="flex items-center justify-between">
      <div class="flex items-center gap-3 text-ink">
        <RLogo :size="34" />
        <span class="text-[24px] font-medium">roost family</span>
      </div>
      <RButton v-if="canGoBack" variant="ghost" @click="$emit('back')">← Back</RButton>
    </header>
    <section class="mx-auto mt-10 flex w-full max-w-[720px] flex-1 flex-col gap-6">
      <h1 class="text-[44px] leading-tight font-semibold">{{ title }}</h1>
      <p v-if="subtitle" class="text-[20px] text-ink-2">{{ subtitle }}</p>
      <p v-if="error" role="alert" class="rounded-[18px] bg-orange-tint px-5 py-4 text-[18px] text-warn-ink">{{ error }}</p>
      <slot />
    </section>
  </main>
</template>
```

- [ ] **Step 2: Steps**

`src/features/setup/steps/WelcomeStep.vue`:

```vue
<script setup lang="ts">
import { useRouter } from 'vue-router'
import RLogo from '@/ui/RLogo.vue'
import RButton from '@/ui/RButton.vue'

defineEmits<{ next: [] }>()
const router = useRouter()
</script>

<template>
  <main class="flex min-h-dvh flex-col items-center justify-center gap-8 bg-app px-10 text-center">
    <span class="text-orange"><RLogo :size="120" /></span>
    <h1 class="text-[56px] font-semibold">roost family</h1>
    <p class="max-w-[520px] text-[22px] text-ink-2">The kitchen screen for the baby and toddler years.</p>
    <div class="flex flex-col gap-4">
      <RButton tier="moment" @click="$emit('next')">Set up a household</RButton>
      <RButton tier="moment" variant="secondary" @click="router.push('/join')">Join a household</RButton>
    </div>
  </main>
</template>
```

`src/features/setup/steps/InviteStep.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import WizardFrame from '../WizardFrame.vue'
import RButton from '@/ui/RButton.vue'
import { validateInviteCode } from '../validation'
import type { WizardState } from '../wizardState'

const props = defineProps<{ state: WizardState }>()
const emit = defineEmits<{ next: []; back: [] }>()
const error = ref<string | null>(null)
const boxes = ref<HTMLInputElement[]>([])

function onInput(i: number, e: Event) {
  const value = (e.target as HTMLInputElement).value.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const chars = props.state.inviteCode.padEnd(6, ' ').split('')
  chars[i] = value.slice(-1) || ' '
  props.state.inviteCode = chars.join('').trimEnd()
  if (value && i < 5) boxes.value[i + 1]?.focus()
}

function submit() {
  error.value = validateInviteCode(props.state.inviteCode)
  if (!error.value) emit('next')
}
</script>

<template>
  <WizardFrame title="Enter your invite code" subtitle="Roost Family is invite-only for now." :error="error" can-go-back @back="emit('back')">
    <div class="flex gap-3">
      <input
        v-for="i in 6"
        :key="i"
        :ref="(el) => { if (el) boxes[i - 1] = el as HTMLInputElement }"
        :value="state.inviteCode[i - 1] ?? ''"
        maxlength="1"
        autocapitalize="characters"
        :aria-label="`Invite code character ${i}`"
        class="h-[88px] w-[72px] rounded-[var(--radius-control)] border border-line bg-surface text-center text-[40px] font-semibold uppercase outline-none focus:border-orange"
        @input="onInput(i - 1, $event)"
      />
    </div>
    <RButton @click="submit">Continue</RButton>
  </WizardFrame>
</template>
```

`src/features/setup/steps/SignInStep.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import WizardFrame from '../WizardFrame.vue'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import { newAdultClient, sendEmailCode, verifyEmailCode } from '@/session/adultSession'
import { validateCode, validateEmail } from '../validation'
import type { WizardState } from '../wizardState'

const props = withDefaults(defineProps<{ state: WizardState; title?: string; canGoBack?: boolean }>(), {
  title: 'Sign in',
  canGoBack: true,
})
const emit = defineEmits<{ next: []; back: [] }>()

const client = newAdultClient()
const phase = ref<'email' | 'code'>('email')
const code = ref('')
const isDev = import.meta.env.DEV

async function sendCode() {
  props.state.error = validateEmail(props.state.email)
  if (props.state.error) return
  props.state.busy = true
  try {
    await sendEmailCode(client, props.state.email.trim())
    phase.value = 'code'
  } catch (e) {
    props.state.error = (e as Error).message
  } finally {
    props.state.busy = false
  }
}

async function verify() {
  props.state.error = validateCode(code.value)
  if (props.state.error) return
  props.state.busy = true
  try {
    props.state.adult = await verifyEmailCode(client, props.state.email.trim(), code.value.trim())
    emit('next')
  } catch (e) {
    props.state.error = (e as Error).message
  } finally {
    props.state.busy = false
  }
}
</script>

<template>
  <WizardFrame :title="title" :error="state.error" :can-go-back="canGoBack" @back="emit('back')">
    <template v-if="phase === 'email'">
      <div class="flex flex-col gap-3">
        <RButton variant="secondary" disabled>Continue with Apple</RButton>
        <RButton variant="secondary" disabled>Continue with Google</RButton>
        <p class="text-[16px] text-ink-3">Apple and Google sign-in turn on before launch.</p>
      </div>
      <RInput v-model="state.email" label="Email" type="email" inputmode="email" autocomplete="email" />
      <RButton :disabled="state.busy" @click="sendCode">Email me a 6-digit code</RButton>
    </template>
    <template v-else>
      <p class="text-[20px] text-ink-2">We sent a code to <strong>{{ state.email }}</strong>.</p>
      <RInput v-model="code" label="6-digit code" inputmode="numeric" autocomplete="one-time-code" />
      <p v-if="isDev" class="text-[16px] text-ink-3">Local dev: read the code at http://127.0.0.1:55324</p>
      <div class="flex gap-3">
        <RButton :disabled="state.busy" @click="verify">Sign in</RButton>
        <RButton variant="ghost" @click="phase = 'email'">Use a different email</RButton>
      </div>
    </template>
  </WizardFrame>
</template>
```

`src/features/setup/steps/ConsentStep.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import WizardFrame from '../WizardFrame.vue'
import RButton from '@/ui/RButton.vue'
import { POLICY_VERSION, type WizardState } from '../wizardState'

const props = defineProps<{ state: WizardState }>()
const emit = defineEmits<{ next: []; back: [] }>()
const terms = ref(false)
const health = ref(false)

async function accept() {
  if (!props.state.adult) return
  props.state.busy = true
  props.state.error = null
  try {
    const { error } = await props.state.adult.client.rpc('record_consent', {
      p_policy_version: POLICY_VERSION,
      p_health_data_consent: health.value,
    })
    if (error) throw new Error(error.message)
    emit('next')
  } catch (e) {
    props.state.error = (e as Error).message
  } finally {
    props.state.busy = false
  }
}
</script>

<template>
  <WizardFrame title="Your family’s information" :error="state.error" can-go-back @back="emit('back')">
    <p class="text-[20px] text-ink-2">
      Roost Family stores your children’s sleep, feeding and medicine logs so everyone caring for them sees the same
      thing. We never show ads, never sell data, and never share it with analytics companies. You can export or delete
      everything at any time.
    </p>
    <label class="flex min-h-[44px] items-center gap-4 text-[20px]">
      <input v-model="terms" type="checkbox" class="size-7 accent-[var(--color-orange-deep)]" />
      I agree to the Terms and Privacy Policy.
    </label>
    <label class="flex min-h-[44px] items-center gap-4 text-[20px]">
      <input v-model="health" type="checkbox" class="size-7 accent-[var(--color-orange-deep)]" />
      I consent to Roost Family storing my children’s health information (medicine, sleep and feeding logs).
    </label>
    <RButton :disabled="!terms || !health || state.busy" @click="accept">Agree and continue</RButton>
  </WizardFrame>
</template>
```

`src/features/setup/steps/HouseholdStep.vue`:

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import WizardFrame from '../WizardFrame.vue'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import { validateHousehold } from '../validation'
import type { WizardState } from '../wizardState'

const props = defineProps<{ state: WizardState }>()
const emit = defineEmits<{ next: []; back: [] }>()
const error = ref<string | null>(null)
const locating = ref(false)
const zones = computed(() => Intl.supportedValuesOf('timeZone').filter((z) => z.startsWith('America/') || z.startsWith('Pacific/Honolulu')))

function useLocation() {
  if (!navigator.geolocation) return
  locating.value = true
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      props.state.lat = Math.round(pos.coords.latitude * 1000) / 1000
      props.state.lon = Math.round(pos.coords.longitude * 1000) / 1000
      locating.value = false
    },
    () => {
      error.value = 'Couldn’t get this tablet’s location. Weather can be set up later.'
      locating.value = false
    },
  )
}

function submit() {
  error.value = validateHousehold(props.state)
  if (!error.value) emit('next')
}
</script>

<template>
  <WizardFrame title="Your household" :error="error" can-go-back @back="emit('back')">
    <RInput v-model="state.householdName" label="Household name" placeholder="The Riveras" />
    <RInput v-model="state.zip" label="ZIP code" inputmode="numeric" placeholder="28202" />
    <label class="flex flex-col gap-2">
      <span class="text-[18px] font-medium text-ink-2">Time zone</span>
      <select v-model="state.timeZone" class="min-h-[56px] rounded-[var(--radius-control)] border border-line bg-surface px-4 text-[22px]">
        <option v-for="z in zones" :key="z" :value="z">{{ z.replace('_', ' ') }}</option>
      </select>
    </label>
    <div class="flex items-center gap-4">
      <RButton variant="secondary" :disabled="locating" @click="useLocation">Use this tablet’s location for weather</RButton>
      <span v-if="state.lat !== null" class="text-[18px] text-green-deep">Location saved</span>
    </div>
    <RButton @click="submit">Continue</RButton>
  </WizardFrame>
</template>
```

`src/features/setup/steps/KidsStep.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import WizardFrame from '../WizardFrame.vue'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import RAvatar from '@/ui/RAvatar.vue'
import { PERSON_COLORS } from '@/ui/personPalette'
import { householdDate } from '@/domain/time'
import { validateKids } from '../validation'
import type { WizardState } from '../wizardState'

const props = defineProps<{ state: WizardState }>()
const emit = defineEmits<{ next: []; back: [] }>()
const error = ref<string | null>(null)

function addKid() {
  const used = new Set(props.state.kids.map((k) => k.color))
  const color = PERSON_COLORS.find((c) => !used.has(c) && c !== props.state.color) ?? PERSON_COLORS[0]
  props.state.kids.push({ name: '', birthday: '', color })
}

if (props.state.kids.length === 0) addKid()

function submit() {
  error.value = validateKids(props.state.kids, householdDate(new Date(), props.state.timeZone))
  if (!error.value) emit('next')
}
</script>

<template>
  <WizardFrame title="Your kids" subtitle="Features turn on by age, so birthdays matter." :error="error" can-go-back @back="emit('back')">
    <div v-for="(kid, i) in state.kids" :key="i" class="flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface p-6">
      <div class="flex items-center gap-4">
        <RAvatar :name="kid.name || '?'" :color="kid.color" :size="56" />
        <div class="flex-1"><RInput v-model="kid.name" label="Name" /></div>
        <RButton v-if="state.kids.length > 1" variant="ghost" :aria-label="`Remove ${kid.name || 'child'}`" @click="state.kids.splice(i, 1)">✕</RButton>
      </div>
      <RInput v-model="kid.birthday" label="Birthday" type="date" />
      <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Color">
        <button
          v-for="c in PERSON_COLORS"
          :key="c"
          type="button"
          role="radio"
          :aria-checked="kid.color === c"
          :aria-label="`Color ${c}`"
          class="size-11 rounded-full border-4"
          :class="kid.color === c ? 'border-ink' : 'border-transparent'"
          :style="{ background: c }"
          @click="kid.color = c"
        />
      </div>
    </div>
    <RButton v-if="state.kids.length < 8" variant="secondary" @click="addKid">+ Add another child</RButton>
    <RButton @click="submit">Continue</RButton>
  </WizardFrame>
</template>
```

`src/features/setup/steps/YouStep.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import WizardFrame from '../WizardFrame.vue'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import RAvatar from '@/ui/RAvatar.vue'
import { PERSON_COLORS } from '@/ui/personPalette'
import { validatePin } from '../validation'
import type { WizardState } from '../wizardState'

const props = defineProps<{ state: WizardState }>()
const emit = defineEmits<{ next: []; back: [] }>()
const confirm = ref('')
const error = ref<string | null>(null)

function submit() {
  if (!props.state.displayName.trim()) {
    error.value = 'Tell us what to call you.'
    return
  }
  error.value = validatePin(props.state.pin, confirm.value)
  if (!error.value) emit('next')
}
</script>

<template>
  <WizardFrame title="About you" subtitle="Your PIN unlocks Settings and confirms medicine doses on the tablet." :error="error" can-go-back @back="emit('back')">
    <div class="flex items-center gap-4">
      <RAvatar :name="state.displayName || '?'" :color="state.color" :size="56" />
      <div class="flex-1"><RInput v-model="state.displayName" label="Your name" autocomplete="given-name" /></div>
    </div>
    <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Your color">
      <button
        v-for="c in PERSON_COLORS"
        :key="c"
        type="button"
        role="radio"
        :aria-checked="state.color === c"
        :aria-label="`Color ${c}`"
        class="size-11 rounded-full border-4"
        :class="state.color === c ? 'border-ink' : 'border-transparent'"
        :style="{ background: c }"
        @click="state.color = c"
      />
    </div>
    <RInput v-model="state.pin" label="4-digit PIN" type="password" inputmode="numeric" autocomplete="new-password" />
    <RInput v-model="confirm" label="Enter it again" type="password" inputmode="numeric" autocomplete="new-password" />
    <RButton @click="submit">Continue</RButton>
  </WizardFrame>
</template>
```

`src/features/setup/steps/DisplayStep.vue`:

```vue
<script setup lang="ts">
import { useRouter } from 'vue-router'
import WizardFrame from '../WizardFrame.vue'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import { displayClient } from '@/data/supabase'
import { claimDisplay } from '@/session/displaySession'
import { useDisplayStore } from '@/session/displayStore'
import { completeSetup } from '../completeSetup'
import type { WizardState } from '../wizardState'

const props = defineProps<{ state: WizardState }>()
const emit = defineEmits<{ back: [] }>()
const router = useRouter()
const displayStore = useDisplayStore()

async function finish() {
  if (!props.state.adult) return
  if (!props.state.displayLabel.trim()) {
    props.state.error = 'Name this display.'
    return
  }
  props.state.busy = true
  props.state.error = null
  try {
    await completeSetup(props.state, props.state.adult, (token) => claimDisplay(displayClient, token))
    props.state.adult = null
    await displayStore.refresh()
    await router.replace('/home')
  } catch (e) {
    props.state.error = (e as Error).message
  } finally {
    props.state.busy = false
  }
}
</script>

<template>
  <WizardFrame title="Name this display" :error="state.error" can-go-back @back="emit('back')">
    <RInput v-model="state.displayLabel" label="Display name" placeholder="Kitchen" />
    <div class="rounded-[var(--radius-card)] bg-surface p-6 text-[18px] text-ink-2">
      <p class="font-semibold text-ink">Keep the screen on</p>
      <p><strong>iPad:</strong> Settings → Display &amp; Brightness → Auto-Lock → Never, then turn on Guided Access (Settings → Accessibility).</p>
      <p><strong>Fire tablet:</strong> open Roost Family in Fully Kiosk Browser and turn on “Keep screen on”.</p>
    </div>
    <RButton :disabled="state.busy" @click="finish">{{ state.busy ? 'Setting up…' : 'Finish setup' }}</RButton>
  </WizardFrame>
</template>
```

- [ ] **Step 3: Wizard container with idle sign-out**

`src/features/setup/SetupWizard.vue`:

```vue
<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import { createWizardState, nextStep, previousStep, type SetupStep } from './wizardState'
import { startIdleTimer } from '@/session/idleTimer'
import WelcomeStep from './steps/WelcomeStep.vue'
import InviteStep from './steps/InviteStep.vue'
import SignInStep from './steps/SignInStep.vue'
import ConsentStep from './steps/ConsentStep.vue'
import HouseholdStep from './steps/HouseholdStep.vue'
import KidsStep from './steps/KidsStep.vue'
import YouStep from './steps/YouStep.vue'
import DisplayStep from './steps/DisplayStep.vue'

const state = createWizardState()
const components: Record<SetupStep, unknown> = {
  welcome: WelcomeStep,
  invite: InviteStep,
  signIn: SignInStep,
  consent: ConsentStep,
  household: HouseholdStep,
  kids: KidsStep,
  you: YouStep,
  display: DisplayStep,
}

let stopIdle: (() => void) | null = null
watch(
  () => state.adult,
  (adult) => {
    stopIdle?.()
    stopIdle = null
    if (!adult) return
    stopIdle = startIdleTimer(async () => {
      await adult.end()
      state.adult = null
      state.step = 'signIn'
      state.error = 'You were signed out after 5 minutes without activity. Sign in again to continue.'
    })
  },
)

onBeforeUnmount(() => {
  stopIdle?.()
  void state.adult?.end()
})

function go(step: SetupStep) {
  state.error = null
  state.step = step
}
</script>

<template>
  <component
    :is="components[state.step]"
    :state="state"
    @next="go(nextStep(state.step))"
    @back="go(previousStep(state.step))"
  />
</template>
```

- [ ] **Step 4: Join a household, display removed, placeholder home**

`src/features/setup/JoinWizard.vue`:

```vue
<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import WizardFrame from './WizardFrame.vue'
import SignInStep from './steps/SignInStep.vue'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import { createWizardState } from './wizardState'
import { displayClient } from '@/data/supabase'
import { claimDisplay } from '@/session/displaySession'
import { useDisplayStore } from '@/session/displayStore'

const router = useRouter()
const displayStore = useDisplayStore()
const state = createWizardState()
const phase = ref<'signIn' | 'pick' | 'name'>('signIn')
const households = ref<{ id: string; name: string }[]>([])
const chosen = ref<string | null>(null)

async function loadHouseholds() {
  const adult = state.adult
  if (!adult) return
  const { data, error } = await adult.client
    .from('memberships')
    .select('household_id, households(name)')
    .eq('user_id', adult.userId)
    .eq('role', 'owner')
    .is('left_at', null)
  if (error) {
    state.error = error.message
    return
  }
  households.value = (data ?? []).map((m) => ({
    id: m.household_id,
    name: (m.households as { name: string } | null)?.name ?? 'Household',
  }))
  if (households.value.length === 0) state.error = 'This account isn’t an owner of any household.'
  phase.value = 'pick'
}

async function register() {
  const adult = state.adult
  if (!adult || !chosen.value) return
  state.busy = true
  state.error = null
  try {
    const { data, error } = await adult.client.rpc('register_display', {
      p_household_id: chosen.value,
      p_name: state.displayLabel.trim(),
    })
    if (error) throw new Error(error.message)
    const token = data?.[0]?.out_claim_token
    if (!token) throw new Error('Display registration returned no token')
    await claimDisplay(displayClient, token)
    await adult.end()
    state.adult = null
    await displayStore.refresh()
    await router.replace('/home')
  } catch (e) {
    state.error = (e as Error).message
  } finally {
    state.busy = false
  }
}

onBeforeUnmount(() => void state.adult?.end())
</script>

<template>
  <SignInStep
    v-if="phase === 'signIn'"
    :state="state"
    title="Owner sign-in"
    @next="loadHouseholds"
    @back="router.replace('/setup')"
  />
  <WizardFrame v-else-if="phase === 'pick'" title="Which household?" :error="state.error">
    <RButton
      v-for="h in households"
      :key="h.id"
      :variant="chosen === h.id ? 'primary' : 'secondary'"
      @click="chosen = h.id; phase = 'name'"
    >
      {{ h.name }}
    </RButton>
  </WizardFrame>
  <WizardFrame v-else title="Name this display" :error="state.error" can-go-back @back="phase = 'pick'">
    <RInput v-model="state.displayLabel" label="Display name" placeholder="Playroom" />
    <RButton :disabled="state.busy" @click="register">Add this display</RButton>
  </WizardFrame>
</template>
```

`src/features/display/DisplayRemoved.vue`:

```vue
<script setup lang="ts">
import { useRouter } from 'vue-router'
import RButton from '@/ui/RButton.vue'
import { displayClient } from '@/data/supabase'
import { resetDisplay } from '@/session/displaySession'
import { useDisplayStore } from '@/session/displayStore'

const router = useRouter()
const displayStore = useDisplayStore()

async function startOver() {
  await resetDisplay(displayClient)
  await displayStore.refresh()
  await router.replace('/setup')
}
</script>

<template>
  <main class="flex min-h-dvh flex-col items-center justify-center gap-6 bg-ink px-10 text-center text-surface">
    <h1 class="text-[44px] font-semibold">This display was removed from the household</h1>
    <p class="max-w-[560px] text-[22px] text-surface/80">An owner removed it. You can set it up again.</p>
    <RButton tier="moment" @click="startOver">Start over</RButton>
  </main>
</template>
```

`src/features/home/HomePlaceholder.vue`:

```vue
<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import RAvatar from '@/ui/RAvatar.vue'
import RLogo from '@/ui/RLogo.vue'
import { displayClient } from '@/data/supabase'
import { useDisplayStore } from '@/session/displayStore'
import { formatClock } from '@/domain/time'

const displayStore = useDisplayStore()
const householdName = ref('')
const timeZone = ref('UTC')
const kids = ref<{ id: string; name: string; color: string }[]>([])
const now = ref(new Date())
let tick: ReturnType<typeof setInterval> | undefined

onMounted(async () => {
  tick = setInterval(() => (now.value = new Date()), 15_000)
  const state = displayStore.state
  if (state?.kind !== 'registered') return
  const [{ data: household }, { data: children }] = await Promise.all([
    displayClient.from('households').select('name, time_zone').eq('id', state.identity.householdId).single(),
    displayClient.from('children').select('id, name, color').order('sort_order'),
  ])
  householdName.value = household?.name ?? ''
  timeZone.value = household?.time_zone ?? 'UTC'
  kids.value = children ?? []
  await displayClient.rpc('display_heartbeat')
})

onBeforeUnmount(() => clearInterval(tick))
</script>

<template>
  <main class="flex min-h-dvh flex-col gap-10 bg-app px-10 py-9">
    <header class="flex items-center justify-between">
      <div class="flex items-center gap-3"><RLogo /><span class="text-[24px] font-medium">roost family</span></div>
      <span class="text-[18px] text-ink-3">{{ displayStore.state?.kind === 'registered' ? displayStore.state.identity.name : '' }}</span>
    </header>
    <p class="text-[132px] leading-none font-semibold tracking-tight tabular-nums">{{ formatClock(now, timeZone) }}</p>
    <h1 class="text-[32px] font-semibold">{{ householdName }} household</h1>
    <ul class="flex flex-wrap gap-6">
      <li v-for="kid in kids" :key="kid.id" class="flex items-center gap-4 rounded-[var(--radius-card)] bg-surface px-6 py-5">
        <RAvatar :name="kid.name" :color="kid.color" :size="64" />
        <span class="text-[28px] font-medium">{{ kid.name }}</span>
      </li>
    </ul>
    <p class="text-[18px] text-ink-3">The main screen arrives in Phase 2.</p>
  </main>
</template>
```

- [ ] **Step 5: Router with boot guard**

Replace `src/router.ts`:

```ts
import { createRouter, createWebHistory } from 'vue-router'
import { useDisplayStore } from '@/session/displayStore'
import type { DisplayState } from '@/session/displaySession'

declare module 'vue-router' {
  interface RouteMeta {
    requires?: DisplayState['kind']
  }
}

const HOME_FOR: Record<DisplayState['kind'], string> = {
  unregistered: '/setup',
  registered: '/home',
  revoked: '/removed',
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/home' },
    { path: '/setup', component: () => import('@/features/setup/SetupWizard.vue'), meta: { requires: 'unregistered' } },
    { path: '/join', component: () => import('@/features/setup/JoinWizard.vue'), meta: { requires: 'unregistered' } },
    { path: '/removed', component: () => import('@/features/display/DisplayRemoved.vue'), meta: { requires: 'revoked' } },
    { path: '/home', component: () => import('@/features/home/HomePlaceholder.vue'), meta: { requires: 'registered' } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  const state = await useDisplayStore().ensure()
  if (to.meta.requires && to.meta.requires !== state.kind) return HOME_FOR[state.kind]
  return true
})
```

- [ ] **Step 6: Verify and commit**

Run: `pnpm test && pnpm build`
Expected: all tests pass; build succeeds with no type errors.

```bash
git add -A
git commit -m "feat(setup): wizard screens, join flow, display removed, placeholder home, boot routing"
```

---

### Task 17: Docs and end-to-end verification

**Files:**
- Create: `README.md`, `CLAUDE.md`

- [ ] **Step 1: README**

`README.md`:

````markdown
# Roost Family

Kitchen-tablet web app for families with young kids. Spec: `docs/superpowers/specs/2026-09-14-roost-design.md`.

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

## Commands

| Command | What it does |
|---|---|
| `pnpm test` | Vitest unit tests |
| `pnpm typecheck` | vue-tsc |
| `pnpm build` | typecheck + production build |
| `pnpm db:reset` | re-apply migrations and seed |
| `pnpm db:types` | regenerate `src/data/database.types.ts` |
````

- [ ] **Step 2: CLAUDE.md**

`CLAUDE.md`:

```markdown
# Roost — agent notes

- Spec (source of truth): `docs/superpowers/specs/2026-09-14-roost-design.md`. The v2 design HTML is a visual reference; where it conflicts with the spec's rules (text sizes, touch targets, contrast), follow the spec.
- Plans: `docs/superpowers/plans/`.
- Node 22 (`source ~/.nvm/nvm.sh && nvm use 22`), pnpm.

## Architecture
- `src/domain/` — pure business rules, no Vue or Supabase imports; every file has a colocated `*.test.ts`.
- `src/data/supabase.ts` — `displayClient` (persisted anonymous device identity) and `createAdultClient()` (in-memory, temporary). Never persist an adult session.
- `src/session/` — display state, adult email-code sign-in, idle timer.
- `src/features/<feature>/` — screens and feature logic; `src/ui/` — shared components (`R*` prefix).

## Database
- Migrations in `supabase/migrations/`; regenerate types with `pnpm db:types` after schema changes.
- Every household-owned table has RLS through `public.is_household_member(household_id)`. New tables: enable RLS, add policies, and re-run `revoke all on <table> from anon` (default privileges grant anon).
- Entry ids are client-generated UUIDs (offline replay). Doses are never deleted — void them.

## UI rules (spec §4)
- In-the-moment surfaces: 60 pt touch targets; deliberate surfaces (Settings, wizard): 44 pt.
- Main screen text: glanceable ≥ 24 pt, secondary ≥ 18 pt, nothing < 16 pt.
- Person color always with avatar/initial (`RAvatar`); person colors from `src/ui/personPalette.ts`, never log-button colors.
- Text uses `ink`, `ink-2`, `ink-3` or deep accent tokens; `faint` is decoration only.
```

- [ ] **Step 3: End-to-end check in a browser**

With `pnpm db:reset` done and `pnpm dev` running:

1. Open http://localhost:5173 → redirected to `/setup` Welcome.
2. Set up a household → invite `ROOST1` → email `new@roost.test` → Email me a code.
3. Open http://127.0.0.1:55324, read the code, enter it → Consent (check both) → Household "Test" (time zone America/New_York) → Kids: "Wren", birthday 2024-02-01 → You: "Jo", PIN 2468 twice → Display "Kitchen" → Finish setup.
4. Expected: `/home` shows the clock, "Test household", and a "Wren" card; reloading the page stays on `/home`.
5. In Studio (http://127.0.0.1:55323) → `displays`: one row for the new household with `auth_user_id` set. Set its `revoked_at` to now, reload the app → `/removed`. Start over → `/setup`.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: README and agent notes for Phase 1"
```

