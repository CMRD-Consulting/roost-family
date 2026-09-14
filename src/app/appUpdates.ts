import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Router } from 'vue-router'
import { useModesStore } from '@/stores/modesStore'

/** How often an always-on display asks the server for a new app version (spec §5.8). */
export const UPDATE_CHECK_MS = 30 * 60_000
/** How long the screen must go untouched before a waiting update may reload it. */
export const IDLE_BEFORE_RELOAD_MS = 5 * 60_000
/** How often a waiting update re-checks whether now is a safe moment. */
const SAFE_MOMENT_POLL_MS = 30_000
/** A second chunk failure within this window doesn't reload again (no reload loops). */
const CHUNK_RELOAD_COOLDOWN_MS = 60_000
const CHUNK_RELOAD_KEY = 'roost-chunk-reload-at'

export interface ReloadMomentInput {
  nightActive: boolean
  msSinceLastTouch: number
  timerRunning: boolean
  route: string
}

/**
 * Pure: may a waiting app update reload the display now? (spec §5.8) Yes while Night Mode is active, or
 * after 5 minutes without a touch outside Kids' Corner. Never while a visual timer is running: losing a
 * child's countdown is worse than running the old version a little longer.
 */
export function isSafeReloadMoment(input: ReloadMomentInput): boolean {
  if (input.timerRunning) return false
  if (input.nightActive) return true
  return input.msSinceLastTouch >= IDLE_BEFORE_RELOAD_MS && input.route !== '/corner'
}

export const useAppUpdatesStore = defineStore('appUpdates', () => {
  /** True once a new app version is installed and waiting for a safe moment to take over. */
  const waiting = ref(false)
  const timerRunning = ref(false)

  /** Screens with a visual timer report it here, so an update never reloads mid-countdown. */
  function setTimerRunning(running: boolean): void {
    timerRunning.value = running
  }

  function canReload(input: Omit<ReloadMomentInput, 'timerRunning'>): boolean {
    return isSafeReloadMoment({ ...input, timerRunning: timerRunning.value })
  }

  return { waiting, timerRunning, setTimerRunning, canReload }
})

const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i

/**
 * A lazy route's chunk failed to load (usually: a deploy replaced it and this tab still runs the old
 * build, or the network is gone). Reload to /home once so the display comes back on its main screen
 * rather than stuck mid-navigation. Returns whether it reloaded.
 */
export function recoverFromChunkError(
  error: unknown,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  reload: (url: string) => void,
  now: number = Date.now(),
): boolean {
  const message = error instanceof Error ? error.message : String(error)
  if (!CHUNK_ERROR.test(message)) return false
  try {
    const last = Number(storage.getItem(CHUNK_RELOAD_KEY) ?? 0)
    if (now - last < CHUNK_RELOAD_COOLDOWN_MS) return false
    storage.setItem(CHUNK_RELOAD_KEY, String(now))
  } catch {
    // Storage unavailable: without a loop guard, don't reload at all.
    return false
  }
  reload('/home')
  return true
}

/**
 * Registers the service worker and applies new versions at a safe moment (spec §5.8): checks for an update
 * every 30 minutes and, once one is waiting, reloads only when `isSafeReloadMoment` allows it.
 */
export async function startAppUpdates(router: Router): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const { registerSW } = await import('virtual:pwa-register')
  const store = useAppUpdatesStore()
  const modes = useModesStore()

  let lastTouchAt = Date.now()
  window.addEventListener('pointerdown', () => (lastTouchAt = Date.now()), { capture: true, passive: true })

  let pollTimer: ReturnType<typeof setInterval> | undefined
  const updateSW = registerSW({
    onNeedRefresh() {
      store.waiting = true
      pollTimer ??= setInterval(() => {
        const safe = store.canReload({
          nightActive: modes.nightActive,
          msSinceLastTouch: Date.now() - lastTouchAt,
          route: router.currentRoute.value.path,
        })
        if (safe) void updateSW(true)
      }, SAFE_MOMENT_POLL_MS)
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return
      setInterval(() => {
        if (navigator.onLine === false || registration.installing) return
        registration.update().catch(() => {
          // Offline or the server is down: the next check tries again.
        })
      }, UPDATE_CHECK_MS)
    },
  })
}
