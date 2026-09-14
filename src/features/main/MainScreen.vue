<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useNow } from '@/composables/useNow'
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
import NapOverlay from '@/features/modes/NapOverlay.vue'
import NightPeek from '@/features/modes/NightPeek.vue'
import NightScreen from '@/features/modes/NightScreen.vue'
import { useNightPeekTaps } from '@/features/modes/useNightPeekTaps'
import CareInfoPanel from '@/features/sitter/CareInfoPanel.vue'
import SitterExitDialog from '@/features/sitter/SitterExitDialog.vue'
import SitterStartSheet from '@/features/sitter/SitterStartSheet.vue'
import SitterSummary from '@/features/sitter/SitterSummary.vue'
import { careInfoModel, pendingSummary, summaryBannerLabel, summaryModel } from '@/features/sitter/sitterModel'
import { useDisplayStore } from '@/session/displayStore'
import { useHouseholdStore } from '@/stores/householdStore'
import { STUCK_COMMAND_MESSAGE, useLogStore } from '@/stores/logStore'
import { useModesStore } from '@/stores/modesStore'
import RLogo from '@/ui/RLogo.vue'
import RLongPress from '@/ui/RLongPress.vue'
import ConflictBanner from './ConflictBanner.vue'
import DinnerLine from './DinnerLine.vue'
import KidCard from './KidCard.vue'
import KidCardCompact from './KidCardCompact.vue'
import LogRow from './LogRow.vue'
import MedicineZone from './MedicineZone.vue'
import { buildMainScreenModel, savedInfoLabel, type LogKind } from './mainScreenModel'
import { useHouseholdSession } from './useHouseholdSession'

const STALE_AFTER_MIN = 5
/** Realtime down this long means another display's dose may not have reached us (spec §13). */
const MEDICINE_STALE_AFTER_MS = 5 * 60_000

const router = useRouter()
const store = useHouseholdStore()
const displayStore = useDisplayStore()
const logStore = useLogStore()
const modes = useModesStore()
const now = useNow(15_000)
// Loads the household, starts logging and watches this display while the main screen (or Kids' Corner) is shown.
const { unreachable } = useHouseholdSession()

// The view has locally-applied (not yet confirmed) logs on top of the loaded snapshot. The model is rebuilt
// on every tick and whenever the view changes; reading the time then (not the last tick's) keeps an entry
// logged "now" from being treated as in the future until the next tick.
const model = computed(() => {
  const tick = now.value.getTime()
  if (!store.view) return null
  const at = new Date(Math.max(tick, Date.now()))
  const medicineStale = store.fromCache || store.realtimeDownMs(at) > MEDICINE_STALE_AFTER_MS
  return buildMainScreenModel(store.view, at, { medicineStale })
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

/** "Showing saved info from 9:42 AM" while the view is still the device cache's last-known snapshot. */
const cacheBadge = computed(() => {
  if (!store.fromCache || !store.snapshot) return null
  return savedInfoLabel(new Date(store.snapshot.loadedAt), now.value, store.snapshot.household.timeZone)
})


/** The log sheet opened from the log row. */
const openLog = ref<LogKind | null>(null)
/** The child whose forgotten open sleep is being fixed ("Still sleeping?"). */
const fixingSleepChildId = ref<string | null>(null)
const editingDinner = ref(false)
/** The dose whose conflict alert an adult is acknowledging with their PIN (spec §7.3). */
const acknowledgingDoseId = ref<string | null>(null)
/** The just-logged dose an adult is undoing with their PIN. */
const undoingDoseId = ref<string | null>(null)

// Sitter Mode (spec §7.6).
const startingSitter = ref(false)
const endingSitter = ref(false)
/** The ended session whose summary an adult is unlocking from the "see summary" banner. */
const unlockingSummaryId = ref<string | null>(null)
/** The session whose "While You Were Out" summary is on screen. */
const summarySessionId = ref<string | null>(null)
/** The session this display ended: its summary was shown here, so no banner for it. */
const endedHereSessionId = ref<string | null>(null)

/** A short message in the toast row (e.g. "Sitter Mode is already on"). */
const NOTICE_MS = 4_000
const notice = ref<string | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | undefined
function showNotice(message: string): void {
  notice.value = message
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.value = null), NOTICE_MS)
}
onBeforeUnmount(() => clearTimeout(noticeTimer))

const activeSitter = computed(() => store.view?.activeSitterSession ?? null)
// A sitter doesn't see the household's personal lists (spec §7.6): if Sitter Mode starts (e.g. on another display)
// while one is open, close it.
watch(
  () => model.value?.sitterActive ?? false,
  (active) => {
    if (!active) return
    if (openLog.value === 'jot' || openLog.value === 'grocery') openLog.value = null
    editingDinner.value = false
  },
)
const sitterPill = computed(() => {
  const name = activeSitter.value?.sitterName?.trim()
  return name ? `Sitter Mode · ${name}` : 'Sitter Mode'
})
const careInfo = computed(() => (store.view && model.value?.sitterActive ? careInfoModel(store.view, now.value) : null))
const summary = computed(() => {
  const view = store.view
  const id = summarySessionId.value
  if (!view || id === null) return null
  const sessions = [view.recentSitterSession, view.activeSitterSession, ...(view.unseenSitterSessions ?? [])]
  const session = sessions.find((x) => x?.id === id) ?? null
  return session ? summaryModel(view, session, now.value) : null
})
const pendingBanner = computed(() => {
  const view = store.view
  if (!view || model.value?.sitterActive) return null
  // Oldest first; not the one this display ended (it showed that summary already) or the one on screen.
  const session = pendingSummary(view, now.value, [endedHereSessionId.value, summarySessionId.value])
  if (!session) return null
  return { sessionId: session.id, label: `${summaryBannerLabel(session, view.household.timeZone)} · See summary` }
})

function onSitterEnded(sessionId: string): void {
  endingSitter.value = false
  endedHereSessionId.value = sessionId
  summarySessionId.value = sessionId
}

function onSummaryUnlocked(sessionId: string): void {
  unlockingSummaryId.value = null
  summarySessionId.value = sessionId
}

async function closeSummary(): Promise<void> {
  const view = store.view
  const sessionId = summarySessionId.value
  summarySessionId.value = null
  if (!view || sessionId === null) return
  try {
    await logStore.submit({ kind: 'sitter.summaryShown', householdId: view.household.id, sessionId })
  } catch {
    // Not marked (e.g. offline): another display can still offer the summary; this one already showed it.
  }
}

// Night Mode never interrupts an adult mid-task (spec §7.7): while any sheet, dialog or PIN pad is open it
// holds Night Mode off, and it takes over once the last one closes.
const NIGHT_HOLD = 'main-screen-sheet'
const anythingOpen = computed(
  () =>
    openLog.value !== null ||
    fixingSleepChildId.value !== null ||
    editingDinner.value ||
    acknowledgingDoseId.value !== null ||
    undoingDoseId.value !== null ||
    startingSitter.value ||
    endingSitter.value ||
    unlockingSummaryId.value !== null ||
    summary.value !== null,
)
watch(
  anythingOpen,
  (open) => (open ? modes.holdNight(NIGHT_HOLD) : modes.releaseNight(NIGHT_HOLD)),
  { immediate: true, flush: 'sync' },
)
onBeforeUnmount(() => modes.releaseNight(NIGHT_HOLD))
useNightPeekTaps()

/** Replay failures, worded for the banner. */
const failureMessages = computed(() =>
  logStore.failures.map((m) => (m === STUCK_COMMAND_MESSAGE ? m : `A log couldn't be saved: ${m}`)),
)
function dismissFailure(index: number): void {
  logStore.failures = logStore.failures.filter((_, i) => i !== index)
}

/** The Settings button is still a placeholder for a later phase. */
const SETTINGS_BUTTON = {
  label: 'Settings',
  paths: [
    'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  ],
} as const
</script>

<template>
  <!-- Focusable so a closing sheet whose opener has gone can return focus here. -->
  <main tabindex="-1" class="relative h-dvh overflow-hidden bg-app text-ink outline-none">
    <NightScreen v-if="model && modes.nightActive" :clock="model.clock" :date="model.dateLabel" @peek="modes.peek()" />

    <!-- Rows: header, zones, the undo toast's own fixed-height row (so it never covers the medicine zone
         or a dose alert), and the log row. -->
    <div v-else-if="model" class="main-grid grid h-full grid-rows-[auto_minmax(0,1fr)_60px_auto] gap-4 px-10 pb-8 pt-9">
      <header class="flex min-w-0 items-start justify-between gap-6">
        <!-- Status badges get their own row under the clock line: beside the buttons they squeezed the date
             into wrapping at 1024 px ("September / 14"). The clock line itself never wraps. -->
        <div class="flex min-w-0 flex-col gap-2">
          <div data-testid="clock-line" class="flex shrink-0 items-baseline gap-6">
            <p class="whitespace-nowrap font-semibold leading-none tracking-[-0.03em] tabular-nums">
              <span class="clock-time text-[132px]">{{ clock.time }}</span>{{ clock.suffix ? ' ' : '' }}<span v-if="clock.suffix" class="clock-suffix text-[36px] tracking-normal text-ink-2">{{ clock.suffix }}</span>
            </p>
            <div data-testid="clock-date" class="flex flex-col gap-1 whitespace-nowrap">
              <span class="clock-date-weekday text-[30px] font-medium leading-tight">{{ date.weekday }}</span>
              <span class="clock-date-rest text-[22px] text-ink-2">{{ date.rest }}</span>
            </div>
          </div>
          <div
            v-if="model.sitterActive || offline || cacheBadge || logStore.pendingCount > 0"
            data-testid="status-badges"
            class="flex min-w-0 flex-nowrap items-center gap-2"
          >
            <span
              v-if="model.sitterActive"
              data-testid="sitter-pill"
              class="shrink-0 rounded-lg bg-orange-tint px-3 py-0.5 text-[22px] font-semibold whitespace-nowrap text-warn-ink"
            >
              {{ sitterPill }}
            </span>
            <span
              v-if="offline"
              role="status"
              class="shrink-0 rounded-lg bg-orange-tint px-3 py-1 text-[16px] font-semibold uppercase tracking-[0.08em] text-warn-ink"
            >
              Offline
            </span>
            <!-- The only badge that may shorten (with an ellipsis) if a row ever runs out of room. -->
            <span
              v-if="cacheBadge"
              role="status"
              class="min-w-0 truncate rounded-lg bg-surface-2 px-3 py-1 text-[16px] font-medium text-ink-2"
            >
              {{ cacheBadge }}
            </span>
            <span
              v-if="logStore.pendingCount > 0"
              role="status"
              data-testid="syncing"
              class="shrink-0 rounded-lg bg-surface-2 px-3 py-1 text-[16px] font-semibold uppercase tracking-[0.08em] text-ink-2"
            >
              Syncing {{ logStore.pendingCount }}…
            </span>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <button
            type="button"
            aria-label="Nap Mode"
            :aria-pressed="modes.napActive"
            class="flex h-[60px] w-[60px] items-center justify-center rounded-2xl focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink"
            :class="modes.napActive ? 'bg-ink text-app' : 'bg-surface-2 text-ink'"
            @click="modes.toggleNap()"
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
              <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Kids' Corner"
            class="flex h-[60px] w-[60px] items-center justify-center rounded-2xl bg-surface-2 text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink"
            @click="router.push('/corner')"
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
              <path d="M12 3l9 8h-3v9h-4v-6H10v6H6v-9H3z" />
            </svg>
          </button>
          <RLongPress
            v-if="model.sitterActive"
            class="flex h-[60px] items-center gap-3 rounded-2xl bg-ink px-5 text-[20px] font-semibold whitespace-nowrap text-app focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink"
            @complete="endingSitter = true"
          >
            <span class="r-longpress-ring h-7 w-7 shrink-0" aria-hidden="true" />
            <span>End Sitter Mode</span>
          </RLongPress>
          <template v-else>
            <RLongPress
              aria-label="Sitter Mode"
              class="flex h-[60px] w-[60px] items-center justify-center rounded-2xl bg-surface-2 text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink"
              @complete="startingSitter = true"
            >
              <span class="relative flex h-10 w-10 items-center justify-center">
                <span class="r-longpress-ring absolute -inset-1" aria-hidden="true" />
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
                  <path d="M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0z" />
                  <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
                </svg>
              </span>
            </RLongPress>
            <button
              type="button"
              :aria-label="SETTINGS_BUTTON.label"
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
                <path v-for="d in SETTINGS_BUTTON.paths" :key="d" :d="d" />
              </svg>
            </button>
          </template>
        </div>
      </header>

      <div class="grid min-h-0 grid-cols-[minmax(0,1fr)_300px] gap-6 min-[1100px]:grid-cols-[minmax(0,1fr)_340px]">
        <div class="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto">
          <!-- Safety-critical zones (dose conflict alert, medicine) come first in every layout, so they are
               visible without scrolling even on a 1024x768 tablet; the kid cards below scroll if needed. -->
          <ConflictBanner :conflicts="model.conflicts" @acknowledge="acknowledgingDoseId = $event" />
          <MedicineZone :lines="model.medicine" :stale="model.medicineStale" />
          <!-- 3 columns only when wide enough for a 24 px status line without truncation. -->
          <div v-if="model.layout === 'compact'" class="grid shrink-0 grid-cols-2 gap-2.5 min-[1300px]:grid-cols-3">
            <KidCardCompact v-for="card in model.kidCards" :key="card.childId" :card="card" @fix-sleep="fixingSleepChildId = $event" />
          </div>
          <div v-else class="grid shrink-0 grid-cols-2 gap-3">
            <KidCard v-for="card in model.kidCards" :key="card.childId" :card="card" @fix-sleep="fixingSleepChildId = $event" />
          </div>
        </div>

        <div class="flex min-h-0 flex-col gap-3">
          <button
            v-if="pendingBanner"
            type="button"
            data-testid="sitter-summary-banner"
            class="flex min-h-[60px] shrink-0 items-center rounded-[18px] bg-amber-tint px-5 py-2 text-left text-[18px] font-semibold leading-snug text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink"
            @click="unlockingSummaryId = pendingBanner.sessionId"
          >
            {{ pendingBanner.label }}
          </button>
          <DinnerLine v-if="!careInfo" :dinner="model.dinner" @edit="editingDinner = true" />
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
          <CareInfoPanel v-if="careInfo" :model="careInfo" />
          <section v-else class="flex min-h-0 flex-1 flex-col gap-3 rounded-[var(--radius-card)] bg-surface px-[26px] py-[22px]">
            <h2 class="text-[16px] font-semibold uppercase tracking-[0.1em] text-ink-3">Today</h2>
            <p class="text-[18px] text-ink-3">Calendar arrives in Phase 4</p>
            <div class="flex-1" />
            <p v-if="staleMinutes > STALE_AFTER_MIN" class="text-[16px] text-ink-3">Updated {{ staleMinutes }} min ago</p>
          </section>
        </div>
      </div>

      <div class="relative h-full">
        <UndoToast @needs-pin="undoingDoseId = $event" />
        <div v-if="notice" class="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p
            role="status"
            data-testid="notice"
            class="flex h-[60px] items-center rounded-full bg-ink px-7 text-[22px] font-medium text-surface shadow-[0_12px_30px_rgba(0,0,0,0.25)]"
          >
            {{ notice }}
          </p>
        </div>
      </div>

      <LogRow :buttons="model.logButtons" @open="openLog = $event" />
    </div>

    <div v-else-if="unreachable" class="flex h-full flex-col items-center justify-center gap-6 px-10 text-center">
      <span class="text-orange"><RLogo :size="64" /></span>
      <p class="text-[24px] text-ink-2" role="status" aria-live="polite">Can’t reach Roost Family. Retrying…</p>
    </div>

    <div v-else class="flex h-full items-center justify-center text-orange" aria-label="Loading" role="status">
      <RLogo :size="64" />
    </div>

    <!-- Dimmed peek (spec §7.7): the main screen shows through a dark, click-through overlay for 60 s. -->
    <NightPeek v-if="model && modes.peeking" :until="modes.nightPeekUntil" :now="modes.now" />

    <NapOverlay v-if="model && modes.napActive" />

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
    <SitterStartSheet :open="startingSitter" @close="startingSitter = false" @notice="showNotice" />
    <SitterExitDialog :open="endingSitter" action="end" @close="endingSitter = false" @done="onSitterEnded" />
    <SitterExitDialog
      :open="unlockingSummaryId !== null"
      action="unlockSummary"
      :session-id="unlockingSummaryId"
      @close="unlockingSummaryId = null"
      @done="onSummaryUnlocked"
    />
    <SitterSummary v-if="summary" :model="summary" @close="closeSummary" />

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
