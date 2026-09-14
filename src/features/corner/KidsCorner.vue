<script setup lang="ts">
/**
 * Kids' Corner (spec §7.5): child picker → the child's picture schedule, visual timer and sticker chart, in a
 * full-screen, picture-first layout. Leaving needs a 2 s hold in the corner and then an adult PIN (§7.3); when
 * the PIN can't be checked (no connection) a second 2 s hold on an adults-only confirm lets the tablet out.
 * Night and Nap Mode apply here as on the main screen (§7.7).
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAppUpdatesStore } from '@/app/appUpdates'
import { useNow } from '@/composables/useNow'
import { LogWriteError } from '@/data/logWriter'
import { formatClock } from '@/domain/time'
import { formatDateLabel } from '@/features/main/mainScreenModel'
import { useHouseholdSession } from '@/features/main/useHouseholdSession'
import NapOverlay from '@/features/modes/NapOverlay.vue'
import NightPeek from '@/features/modes/NightPeek.vue'
import NightScreen from '@/features/modes/NightScreen.vue'
import { useNightPeekTaps } from '@/features/modes/useNightPeekTaps'
import { useHouseholdStore } from '@/stores/householdStore'
import { useLogStore } from '@/stores/logStore'
import { useModesStore } from '@/stores/modesStore'
import RAvatar from '@/ui/RAvatar.vue'
import RLogo from '@/ui/RLogo.vue'
import RLongPress from '@/ui/RLongPress.vue'
import RPinPad from '@/ui/RPinPad.vue'
import RSheet from '@/ui/RSheet.vue'
import CornerChildPicker from './CornerChildPicker.vue'
import { completeCurrent, cornerChildren, scheduleModel, stickerGridModel } from './cornerModel'
import PictureSchedule from './PictureSchedule.vue'
import StickerChart from './StickerChart.vue'
import { useVisualTimer } from './useVisualTimer'
import VisualTimer from './VisualTimer.vue'

type Tab = 'schedule' | 'timer' | 'stickers'

const EXIT_HOLD_MS = 2_000

const router = useRouter()
const store = useHouseholdStore()
const logStore = useLogStore()
const modes = useModesStore()
const tick = useNow(15_000)
const { unreachable } = useHouseholdSession()
const timer = useVisualTimer()

// A waiting app update must never reload the tablet mid-countdown (spec §5.8).
const appUpdates = useAppUpdatesStore()
watch(() => timer.phase.value === 'running', (running) => appUpdates.setTimerRunning(running), { immediate: true })
onBeforeUnmount(() => appUpdates.setTimerRunning(false))

/** Like the main screen: read the clock when the view changes too, so a step finished "now" counts now. */
const now = computed(() => new Date(Math.max(tick.value.getTime(), Date.now())))
const view = computed(() => store.view)

const children = computed(() => (view.value ? cornerChildren(view.value, now.value) : []))
const pickedChildId = ref<string | null>(null)
/** The child playing: the one picked, or the only eligible child (the picker is skipped then). */
const child = computed(() => {
  const list = children.value
  if (list.length === 1) return list[0]!
  return list.find((c) => c.id === pickedChildId.value) ?? null
})

const tab = ref<Tab>('schedule')
const schedule = computed(() => (view.value && child.value ? scheduleModel(view.value, child.value.id, now.value) : null))
const stickerGrid = computed(() => (view.value && child.value ? stickerGridModel(view.value, child.value.id, now.value) : null))

function pick(childId: string): void {
  pickedChildId.value = childId
  tab.value = 'schedule'
}

async function completeStep(): Promise<void> {
  const model = schedule.value
  const cmd = model ? completeCurrent(model) : null
  if (cmd === null) return
  try {
    // Optimistic: the view moves on to the next step at once; offline it's queued and synced later.
    await logStore.submit(cmd)
  } catch (e) {
    console.warn("Couldn't save the finished step", e)
  }
}

const TABS: { id: Tab; label: string; paths: string[] }[] = [
  { id: 'schedule', label: 'Schedule', paths: ['M9 6h11M9 12h11M9 18h11', 'M4 6h.01M4 12h.01M4 18h.01'] },
  { id: 'timer', label: 'Timer', paths: ['M6 2h12M6 22h12', 'M7 2v4l5 6-5 6v4M17 2v4l-5 6 5 6v4'] },
  { id: 'stickers', label: 'Stickers', paths: ['M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z'] },
]

// Night and Nap Mode (spec §7.7), as on the main screen.
const nightClock = computed(() => (view.value ? formatClock(now.value, view.value.household.timeZone) : ''))
const nightDate = computed(() => (view.value ? formatDateLabel(now.value, view.value.household.timeZone) : ''))

// Exit (spec §7.3): hold 2 s, then an adult PIN — or, when PINs can't be checked, a second 2 s hold.
const exiting = ref(false)
/** Set when a PIN check failed for lack of a connection, so the sheet offers the second hold instead. */
const pinUnavailable = ref(false)
const offline = computed(() => !store.online || (typeof navigator !== 'undefined' && navigator.onLine === false))
const holdToExit = computed(() => offline.value || pinUnavailable.value)
const adults = computed(() => view.value?.members ?? [])

function openExit(): void {
  pinUnavailable.value = false
  exiting.value = true
}

async function verify(membershipId: string, pin: string): Promise<boolean> {
  try {
    return await logStore.verifyPin(membershipId, pin)
  } catch (e) {
    if (e instanceof LogWriteError && e.network) pinUnavailable.value = true
    throw e
  }
}

function leave(): void {
  exiting.value = false
  void router.push('/home')
}

// Night Mode never interrupts an adult leaving the Corner: the exit sheet holds it off while open (spec §7.7).
const NIGHT_HOLD = 'corner-exit'
watch(exiting, (open) => (open ? modes.holdNight(NIGHT_HOLD) : modes.releaseNight(NIGHT_HOLD)), { flush: 'sync' })
onBeforeUnmount(() => modes.releaseNight(NIGHT_HOLD))
useNightPeekTaps()
</script>

<template>
  <main tabindex="-1" class="relative h-dvh overflow-hidden bg-corner text-ink-2 outline-none">
    <NightScreen v-if="view && modes.nightActive" :clock="nightClock" :date="nightDate" @peek="modes.peek()" />

    <template v-else-if="view">
      <section
        v-if="children.length === 0"
        data-testid="corner-empty"
        class="flex h-full flex-col items-center justify-center gap-8 px-10 text-center"
      >
        <span class="flex size-[200px] items-center justify-center rounded-full bg-corner-tile">
          <svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3l9 8h-3v9h-4v-6H10v6H6v-9H3z" />
          </svg>
        </span>
        <p class="text-[32px] font-semibold">Kids' Corner isn't set up for anyone yet</p>
        <p class="text-[22px] text-ink-3">An adult can turn it on for a child in Settings.</p>
      </section>

      <CornerChildPicker v-else-if="child === null" :children="children" @pick="pick" />

      <div v-else class="grid h-full grid-rows-[minmax(0,1fr)_120px]">
        <div class="min-h-0">
          <PictureSchedule v-if="tab === 'schedule'" :model="schedule" @complete="completeStep" />
          <VisualTimer v-else-if="tab === 'timer'" :timer="timer" />
          <StickerChart v-else-if="stickerGrid" :grid="stickerGrid" />
        </div>

        <nav role="tablist" aria-label="Kids' Corner" class="flex items-center justify-center gap-5 bg-corner-bar">
          <button
            v-for="t in TABS"
            :key="t.id"
            type="button"
            role="tab"
            :aria-label="t.label"
            :aria-selected="tab === t.id"
            class="flex size-[88px] flex-col items-center justify-center gap-0.5 rounded-[24px] text-ink-2 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink-2"
            :class="tab === t.id ? 'bg-corner-tile' : 'bg-transparent'"
            @click="tab = t.id"
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path v-for="d in t.paths" :key="d" :d="d" />
            </svg>
            <span class="text-[18px] font-medium leading-none" aria-hidden="true">{{ t.label }}</span>
          </button>
        </nav>

        <button
          v-if="children.length > 1"
          type="button"
          aria-label="Switch child"
          class="absolute left-5 top-5 z-[5] rounded-full focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-ink-2"
          @click="pickedChildId = null"
        >
          <RAvatar :name="child.name" :color="child.color" :size="72" decorative />
        </button>
        <span v-else class="absolute left-5 top-5 z-[5]">
          <RAvatar :name="child.name" :color="child.color" :size="72" />
        </span>
      </div>

      <!-- Adults only: hold 2 s, then PIN. Small and quiet in the corner so it doesn't invite a toddler.
           (Positioned by a wrapper: RLongPress is position: relative itself, for its fill ring.) -->
      <div class="absolute right-5 top-5 z-[5]">
        <RLongPress
          :duration="EXIT_HOLD_MS"
          aria-label="Exit Kids' Corner (adults: hold)"
          class="flex size-[72px] items-center justify-center rounded-full text-ink-2 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink-2"
          style="background: rgba(90, 70, 54, 0.12)"
          @complete="openExit"
        >
          <span class="r-longpress-ring absolute inset-0" aria-hidden="true" />
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="opacity-70" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </RLongPress>
      </div>
    </template>

    <div v-else-if="unreachable" class="flex h-full flex-col items-center justify-center gap-6 px-10 text-center">
      <span class="text-orange"><RLogo :size="64" /></span>
      <p class="text-[24px] text-ink-2" role="status" aria-live="polite">Can’t reach Roost Family. Retrying…</p>
    </div>

    <div v-else class="flex h-full items-center justify-center text-orange" aria-label="Loading" role="status">
      <RLogo :size="64" />
    </div>

    <NightPeek v-if="view && modes.peeking" :until="modes.nightPeekUntil" :now="tick" />
    <NapOverlay v-if="view && modes.napActive" />

    <RSheet title="Exit Kids' Corner" :open="exiting" @close="exiting = false">
      <div v-if="holdToExit" class="flex flex-col items-center gap-6 pb-2">
        <p class="text-center text-[22px] text-ink">No connection, so PINs can't be checked right now.</p>
        <RLongPress
          :duration="EXIT_HOLD_MS"
          aria-label="Adults: hold again to exit"
          class="flex min-h-[88px] w-full items-center justify-center gap-3 rounded-[var(--radius-control)] bg-ink px-6 text-[22px] font-semibold text-surface"
          @complete="leave"
        >
          <span class="r-longpress-ring absolute right-4 size-[48px]" aria-hidden="true" />
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          Adults: hold again to exit
        </RLongPress>
        <button
          type="button"
          class="min-h-[60px] w-full rounded-[var(--radius-control)] bg-surface-2 text-[19px] font-medium text-ink"
          @click="exiting = false"
        >
          Cancel
        </button>
      </div>
      <RPinPad v-else :members="adults" :verify="verify" title="Adults: enter your PIN" @verified="leave" @cancel="exiting = false" />
    </RSheet>
  </main>
</template>
