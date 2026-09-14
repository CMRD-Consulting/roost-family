<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useNow } from '@/composables/useNow'
import { DEMO_DISPLAY, isDemo, selectSource, selectWriter, type HouseholdSource } from '@/data/householdSource'
import { createOfflineQueue } from '@/data/offlineQueue'
import DiaperSheet from '@/features/logs/DiaperSheet.vue'
import DinnerSheet from '@/features/logs/DinnerSheet.vue'
import DosePinDialog from '@/features/logs/DosePinDialog.vue'
import FeedingSheet from '@/features/logs/FeedingSheet.vue'
import GrocerySheet from '@/features/logs/GrocerySheet.vue'
import JotSheet from '@/features/logs/JotSheet.vue'
import MedicineSheet from '@/features/logs/MedicineSheet.vue'
import SleepSheet from '@/features/logs/SleepSheet.vue'
import StaleSleepSheet from '@/features/logs/StaleSleepSheet.vue'
import StickerSheet from '@/features/logs/StickerSheet.vue'
import UndoToast from '@/features/logs/UndoToast.vue'
import { checkStillRegistered } from '@/session/displaySession'
import { useDisplayStore } from '@/session/displayStore'
import { useHouseholdStore } from '@/stores/householdStore'
import { STUCK_COMMAND_MESSAGE, useLogStore } from '@/stores/logStore'
import RLogo from '@/ui/RLogo.vue'
import ConflictBanner from './ConflictBanner.vue'
import DinnerLine from './DinnerLine.vue'
import KidCard from './KidCard.vue'
import KidCardCompact from './KidCardCompact.vue'
import LogRow from './LogRow.vue'
import MedicineZone from './MedicineZone.vue'
import { buildMainScreenModel, type LogKind } from './mainScreenModel'

const RETRY_MS = 30_000
const HEARTBEAT_MS = 5 * 60_000
const STALE_AFTER_MIN = 5

const router = useRouter()
const store = useHouseholdStore()
const displayStore = useDisplayStore()
const logStore = useLogStore()
const now = useNow(15_000)

// The view has locally-applied (not yet confirmed) logs on top of the loaded snapshot. The model is rebuilt
// on every tick and whenever the view changes; reading the time then (not the last tick's) keeps an entry
// logged "now" from being treated as in the future until the next tick.
const model = computed(() => {
  const tick = now.value.getTime()
  return store.view ? buildMainScreenModel(store.view, new Date(Math.max(tick, Date.now()))) : null
})

/** "3:00 PM" → big "3:00" + small "PM". */
const clock = computed(() => {
  const text = model.value?.clock ?? ''
  const i = text.search(/\s[^\s]*$/)
  return i === -1 ? { time: text, suffix: '' } : { time: text.slice(0, i), suffix: text.slice(i + 1) }
})
/** "Monday, September 14" → "Monday" over "September 14". */
const date = computed(() => {
  const [weekday = '', ...rest] = (model.value?.dateLabel ?? '').split(', ')
  return { weekday, rest: rest.join(', ') }
})

const offline = computed(() => !store.online || displayStore.state?.kind === 'offline')
const staleMinutes = computed(() => store.staleMinutes(now.value))

const bootFailed = ref(false)
const unreachable = computed(() => bootFailed.value || (store.status === 'error' && !store.snapshot))

/** The log sheet opened from the log row. */
const openLog = ref<LogKind | null>(null)
/** The child whose forgotten open sleep is being fixed ("Still sleeping?"). */
const fixingSleepChildId = ref<string | null>(null)
const editingDinner = ref(false)
/** The dose whose conflict alert an adult is acknowledging with their PIN (spec §7.3). */
const acknowledgingDoseId = ref<string | null>(null)
/** The just-logged dose an adult is undoing with their PIN. */
const undoingDoseId = ref<string | null>(null)

/** Replay failures, worded for the banner. */
const failureMessages = computed(() =>
  logStore.failures.map((m) => (m === STUCK_COMMAND_MESSAGE ? m : `A log couldn't be saved: ${m}`)),
)
function dismissFailure(index: number): void {
  logStore.failures = logStore.failures.filter((_, i) => i !== index)
}

let source: HouseholdSource | null = null
let disposed = false
/** Set once logging has been started for this mount (the log store runs while the main screen is shown). */
let loggingStarted = false

async function startLogging(): Promise<void> {
  if (loggingStarted) return
  loggingStarted = true
  try {
    const writer = await selectWriter()
    if (disposed) return
    await logStore.init(writer, createOfflineQueue())
  } catch (e) {
    console.warn('Could not start logging; retrying', e)
    loggingStarted = false
  }
}

async function boot(): Promise<void> {
  const identity = isDemo ? DEMO_DISPLAY : displayStore.identity
  if (!identity) {
    await router.replace('/')
    return
  }
  try {
    source ??= await selectSource()
  } catch {
    bootFailed.value = true
    return
  }
  if (disposed) return
  bootFailed.value = false
  const starting = store.start(identity.householdId, source)
  // After start() has claimed the household, so the overlay of restored queued commands isn't cleared.
  void startLogging()
  await starting
}

function retry(): void {
  if (bootFailed.value) void boot()
  else if (store.status === 'error' && !store.snapshot) void store.reload()
  if (source !== null && !bootFailed.value) void startLogging()
}

async function heartbeat(): Promise<void> {
  try {
    const { displayClient } = await import('@/data/supabase')
    if ((await checkStillRegistered(displayClient)) !== 'revoked' || disposed) return
    await displayStore.refresh()
    await router.replace('/removed')
  } catch {
    // Offline or a server error: the next heartbeat tries again.
  }
}

// A background display refresh (displayStore.watch) can also discover that this tablet was removed.
watch(
  () => displayStore.state?.kind,
  (kind) => {
    if (disposed) return
    if (kind === 'revoked') void router.replace('/removed')
    else if (kind === 'unregistered') void router.replace('/')
  },
)

let retryTimer: ReturnType<typeof setInterval> | undefined
let heartbeatTimer: ReturnType<typeof setInterval> | undefined
let stopDisplayWatch: (() => void) | undefined

onMounted(() => {
  void boot()
  retryTimer = setInterval(retry, RETRY_MS)
  if (!isDemo) {
    stopDisplayWatch = displayStore.watch()
    void heartbeat()
    heartbeatTimer = setInterval(() => void heartbeat(), HEARTBEAT_MS)
  }
})

onBeforeUnmount(() => {
  disposed = true
  clearInterval(retryTimer)
  clearInterval(heartbeatTimer)
  stopDisplayWatch?.()
  logStore.stop()
  store.stop()
})

const MODE_BUTTONS = [
  { label: 'Nap Mode', paths: ['M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z'] },
  { label: "Kids' Corner", paths: ['M12 3l9 8h-3v9h-4v-6H10v6H6v-9H3z'] },
  { label: 'Sitter Mode', paths: ['M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0z', 'M4 21c0-4 3.6-7 8-7s8 3 8 7'] },
  {
    label: 'Settings',
    paths: [
      'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
      'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    ],
  },
] as const
</script>

<template>
  <main class="relative h-dvh overflow-hidden bg-app text-ink">
    <!-- Rows: header, zones, the undo toast's own fixed-height row (so it never covers the medicine zone
         or a dose alert), and the log row. -->
    <div v-if="model" class="main-grid grid h-full grid-rows-[auto_minmax(0,1fr)_60px_auto] gap-4 px-10 pb-8 pt-9">
      <header class="flex min-w-0 items-start justify-between gap-6">
        <div class="flex min-w-0 items-baseline gap-6">
          <p class="whitespace-nowrap font-semibold leading-none tracking-[-0.03em] tabular-nums">
            <span class="clock-time text-[132px]">{{ clock.time }}</span>{{ clock.suffix ? ' ' : '' }}<span v-if="clock.suffix" class="clock-suffix text-[36px] tracking-normal text-ink-2">{{ clock.suffix }}</span>
          </p>
          <div class="flex min-w-0 flex-col gap-1">
            <span class="clock-date-weekday text-[30px] font-medium leading-tight">{{ date.weekday }}</span>
            <span class="clock-date-rest text-[22px] text-ink-2">{{ date.rest }}</span>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <span
            v-if="offline"
            role="status"
            class="mr-2 rounded-lg bg-orange-tint px-3 py-1.5 text-[16px] font-semibold uppercase tracking-[0.08em] text-warn-ink"
          >
            Offline
          </span>
          <span
            v-if="logStore.pendingCount > 0"
            role="status"
            data-testid="syncing"
            class="mr-2 rounded-lg bg-surface-2 px-3 py-1.5 text-[16px] font-semibold uppercase tracking-[0.08em] text-ink-2"
          >
            Syncing {{ logStore.pendingCount }}…
          </span>
          <button
            v-for="b in MODE_BUTTONS"
            :key="b.label"
            type="button"
            :aria-label="b.label"
            aria-disabled="true"
            class="flex h-[60px] w-[60px] cursor-default items-center justify-center rounded-2xl bg-surface-2 text-ink"
          >
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path v-for="d in b.paths" :key="d" :d="d" />
            </svg>
          </button>
        </div>
      </header>

      <div class="grid min-h-0 grid-cols-[minmax(0,1fr)_300px] gap-6 min-[1100px]:grid-cols-[minmax(0,1fr)_340px]">
        <div class="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto">
          <!-- Safety-critical zones (dose conflict alert, medicine) come first in every layout, so they are
               visible without scrolling even on a 1024x768 tablet; the kid cards below scroll if needed. -->
          <ConflictBanner :conflicts="model.conflicts" @acknowledge="acknowledgingDoseId = $event" />
          <MedicineZone :lines="model.medicine" />
          <!-- 3 columns only when wide enough for a 24 px status line without truncation. -->
          <div v-if="model.layout === 'compact'" class="grid shrink-0 grid-cols-2 gap-2.5 min-[1300px]:grid-cols-3">
            <KidCardCompact v-for="card in model.kidCards" :key="card.childId" :card="card" @fix-sleep="fixingSleepChildId = $event" />
          </div>
          <div v-else class="grid shrink-0 grid-cols-2 gap-3">
            <KidCard v-for="card in model.kidCards" :key="card.childId" :card="card" @fix-sleep="fixingSleepChildId = $event" />
          </div>
        </div>

        <div class="flex min-h-0 flex-col gap-3">
          <DinnerLine :dinner="model.dinner" @edit="editingDinner = true" />
          <section
            v-for="(message, i) in failureMessages"
            :key="i"
            role="alert"
            data-testid="log-failure"
            class="flex shrink-0 items-center gap-3 rounded-[18px] bg-orange-tint py-2 pl-5 pr-2 text-warn-ink"
          >
            <p class="min-w-0 flex-1 text-[18px] leading-snug">{{ message }}</p>
            <button
              type="button"
              aria-label="Dismiss"
              class="flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[24px] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-warn-ink"
              @click="dismissFailure(i)"
            >
              ✕
            </button>
          </section>
          <section class="flex min-h-0 flex-1 flex-col gap-3 rounded-[var(--radius-card)] bg-surface px-[26px] py-[22px]">
            <h2 class="text-[16px] font-semibold uppercase tracking-[0.1em] text-ink-3">Today</h2>
            <p class="text-[18px] text-ink-3">Calendar arrives in Phase 4</p>
            <div class="flex-1" />
            <p v-if="staleMinutes > STALE_AFTER_MIN" class="text-[16px] text-ink-3">Updated {{ staleMinutes }} min ago</p>
          </section>
        </div>
      </div>

      <UndoToast @needs-pin="undoingDoseId = $event" />

      <LogRow :buttons="model.logButtons" @open="openLog = $event" />
    </div>

    <div v-else-if="unreachable" class="flex h-full flex-col items-center justify-center gap-6 px-10 text-center">
      <span class="text-orange"><RLogo :size="64" /></span>
      <p class="text-[24px] text-ink-2" role="status" aria-live="polite">Can’t reach Roost Family. Retrying…</p>
    </div>

    <div v-else class="flex h-full items-center justify-center text-orange" aria-label="Loading" role="status">
      <RLogo :size="64" />
    </div>

    <SleepSheet :open="openLog === 'sleep'" @close="openLog = null" />
    <FeedingSheet :open="openLog === 'feeding'" @close="openLog = null" />
    <MedicineSheet :open="openLog === 'medicine'" @close="openLog = null" />
    <StickerSheet :open="openLog === 'sticker'" @close="openLog = null" />
    <JotSheet :open="openLog === 'jot'" @close="openLog = null" />
    <GrocerySheet :open="openLog === 'grocery'" @close="openLog = null" />
    <DiaperSheet :open="openLog === 'diaper'" @close="openLog = null" />
    <StaleSleepSheet
      v-if="fixingSleepChildId !== null"
      open
      :child-id="fixingSleepChildId"
      @close="fixingSleepChildId = null"
    />
    <DinnerSheet :open="editingDinner" @close="editingDinner = false" />

    <DosePinDialog
      action="acknowledge"
      :open="acknowledgingDoseId !== null"
      :dose-id="acknowledgingDoseId"
      @close="acknowledgingDoseId = null"
    />
    <DosePinDialog
      action="undo"
      :open="undoingDoseId !== null"
      :dose-id="undoingDoseId"
      @close="undoingDoseId = null"
    />
  </main>
</template>

<style scoped>
/* Short tablets (e.g. 1024x768 in landscape): shrink the clock so the header leaves more
   room for the medicine zone below, per docs/superpowers/specs/2026-09-14-roost-design.md §7.2.
   Sizes stay within spec minimums: date line stays >= 18px (secondary text floor). */
@media (max-height: 800px) {
  /* Tighter frame so the undo toast's reserved row doesn't push the medicine zone out of view. */
  .main-grid {
    row-gap: 12px;
    padding-top: 20px;
    padding-bottom: 16px;
  }
  /* Spec §4 floor for primary log buttons. */
  .main-grid :deep([data-log-kind]) {
    height: 88px;
  }
  .clock-time {
    font-size: 104px;
  }
  .clock-suffix {
    font-size: 28px;
  }
  .clock-date-weekday {
    font-size: 24px;
  }
  .clock-date-rest {
    font-size: 18px;
  }
}
</style>
