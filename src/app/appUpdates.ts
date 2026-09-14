import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Router } from 'vue-router'
import { useHouseholdStore } from '@/stores/householdStore'
import { useModesStore } from '@/stores/modesStore'
import { useSettingsSessionStore } from '@/stores/settingsSession'
import { hasReloadHold } from './reloadHolds'

/** How often an always-on display asks the server for a new app version (spec §5.8). */
export const UPDATE_CHECK_MS = 30 * 60_000
/** How long the screen must go untouched before a waiting update may reload it. */
export const IDLE_BEFORE_RELOAD_MS = 5 * 60_000
/** A critical update still waits this long after the last touch or key press, so it never reloads during input. */
export const CRITICAL_IDLE_MS = 60_000
/** How often a waiting update re-checks whether now is a safe moment. */
const SAFE_MOMENT_POLL_MS = 30_000
/** A second chunk failure within this window doesn't reload again (no reload loops). */
const CHUNK_RELOAD_COOLDOWN_MS = 60_000
const CHUNK_RELOAD_KEY = 'roost-chunk-reload-at'
/** Where the build writes the reload-now flag (spec §5.8); see vite.config.ts. */
const VERSION_URL = '/version.json'

export interface ReloadMomentInput {
  nightActive: boolean
  /** Since the last pointer or keyboard activity. */
  msSinceLastTouch: number
  timerRunning: boolean
  route: string
  /** The route is a public page (Manage household, the Take list): any browser, maybe mid-task with a temporary
   *  sign-in. It never reloads on its own; a waiting version applies on the next visit. */
  publicRoute?: boolean
  /** Set from a critical `version.json` (spec §5.8): reload sooner than the normal rules allow. */
  critical?: boolean
  /** A sheet, dialog or PIN pad is open. */
  dialogOpen?: boolean
  /** A Settings PIN session is open. */
  settingsSessionOpen?: boolean
  /** An adult sign-in is open (waiting for an email code, or signed in). */
  adultSignInActive?: boolean
  /** Photos are being prepared or uploaded. */
  photoUploading?: boolean
}

/**
 * Pure: may a waiting app update reload the display now? (spec §5.8)
 *
 * Never on a public page (a phone or laptop, not a display: the update applies on its next visit), never while a
 * visual timer runs (losing a child's countdown is worse than running the old version a little longer) and never
 * while photos upload. Otherwise yes while Night Mode is active, or after 5 minutes without a touch outside Kids'
 * Corner. A critical deploy doesn't wait for those: a minute without a touch or key press is enough, even in Kids'
 * Corner, once no sheet or dialog, Settings PIN session or adult sign-in is open — a critical fix still never
 * reloads under someone's hands.
 */
export function isSafeReloadMoment(input: ReloadMomentInput): boolean {
  if (input.publicRoute) return false
  if (input.timerRunning) return false
  if (input.photoUploading) return false
  if (input.nightActive) return true
  if (input.msSinceLastTouch >= IDLE_BEFORE_RELOAD_MS && input.route !== '/corner') return true
  if (!input.critical) return false
  return (
    input.msSinceLastTouch >= CRITICAL_IDLE_MS &&
    !input.dialogOpen &&
    !input.settingsSessionOpen &&
    !input.adultSignInActive
  )
}

/** True while a modal sheet or dialog is in the page. */
export function isDialogOpen(doc: Pick<Document, 'querySelector'>): boolean {
  return doc.querySelector('[aria-modal="true"], dialog[open]') !== null
}

/** Whether `pathname` is one of the router's public routes (the Take list, Manage household). */
export function isPublicPath(router: Pick<Router, 'resolve'>, pathname: string): boolean {
  try {
    return router.resolve(pathname).meta.public === true
  } catch {
    return false
  }
}

export const useAppUpdatesStore = defineStore('appUpdates', () => {
  /** True once a new app version is installed and waiting for a safe moment to take over. */
  const waiting = ref(false)
  const timerRunning = ref(false)
  /** True once a version check finds a newer, critical version.json (spec §5.8). Never cleared: once a
   *  critical deploy is known, every later reload decision for this session stays maximally eager. */
  const critical = ref(false)

  /** Screens with a visual timer report it here, so an update never reloads mid-countdown. */
  function setTimerRunning(running: boolean): void {
    timerRunning.value = running
  }

  function canReload(
    input: Omit<ReloadMomentInput, 'timerRunning' | 'critical' | 'adultSignInActive' | 'photoUploading'>,
  ): boolean {
    return isSafeReloadMoment({
      ...input,
      timerRunning: timerRunning.value,
      critical: critical.value,
      adultSignInActive: hasReloadHold('signIn'),
      photoUploading: hasReloadHold('photoUpload'),
    })
  }

  return { waiting, timerRunning, critical, setTimerRunning, canReload }
})

export interface VersionInfo {
  version: string
  critical: boolean
}

export type VersionFetcher = () => Promise<VersionInfo | null>

/**
 * Fetches `version.json` bypassing every cache (spec §5.8: a stale copy would defeat the whole check) —
 * the service worker must also never precache it (vite.config.ts `globIgnores`). Never throws: any
 * failure (offline, non-200, malformed body) resolves null so a check is simply skipped, not crashed.
 */
export function createVersionFetcher(url: string = VERSION_URL): VersionFetcher {
  return async () => {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) return null
      const data = (await res.json()) as Partial<VersionInfo> | null
      if (typeof data?.version !== 'string') return null
      return { version: data.version, critical: data.critical === true }
    } catch {
      return null
    }
  }
}

/**
 * One version check (spec §5.8, §13): always reconnects Realtime first (in case it dropped and its own
 * retry hasn't fired yet), then — only when `version.json`'s version differs from the running build —
 * reports whether the deploy is critical, so the caller can trigger a service-worker update and, if
 * critical, reload sooner than the usual safe-moment rules allow.
 */
export async function checkForUpdate(
  fetchVersion: VersionFetcher,
  runningVersion: string,
  onNewerVersion: (critical: boolean) => void,
  reconnectRealtime: () => void,
): Promise<void> {
  reconnectRealtime()
  const info = await fetchVersion()
  if (info !== null && info.version !== runningVersion) onNewerVersion(info.critical)
}

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
 * every 30 minutes and, once one is waiting, reloads only when `isSafeReloadMoment` allows it. The same
 * 30-minute cadence (and every `online` event) also fetches `version.json` — the only source of the
 * critical-reload flag — and reconnects Realtime if it had dropped (spec §13).
 *
 * Not on a public page opened directly (`pathname`, the page the app booted on): a shopper's phone on the Take list
 * or a laptop on Manage household should not precache the whole app. Resolves whether it started.
 */
export async function startAppUpdates(router: Router, pathname: string = window.location.pathname): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false
  if (isPublicPath(router, pathname)) return false
  const { registerSW } = await import('virtual:pwa-register')
  const store = useAppUpdatesStore()
  const modes = useModesStore()
  const householdStore = useHouseholdStore()
  const settingsSession = useSettingsSessionStore()

  let lastTouchAt = Date.now()
  for (const activity of ['pointerdown', 'keydown'] as const) {
    window.addEventListener(activity, () => (lastTouchAt = Date.now()), { capture: true, passive: true })
  }

  let registration: ServiceWorkerRegistration | undefined
  let pollTimer: ReturnType<typeof setInterval> | undefined
  const startSafeMomentPolling = () => {
    pollTimer ??= setInterval(() => {
      const safe = store.canReload({
        nightActive: modes.nightActive,
        msSinceLastTouch: Date.now() - lastTouchAt,
        route: router.currentRoute.value.path,
        publicRoute: router.currentRoute.value.meta.public === true,
        dialogOpen: isDialogOpen(document) || modes.nightHeld,
        settingsSessionOpen: settingsSession.info !== null,
      })
      if (safe) void updateSW(true)
    }, SAFE_MOMENT_POLL_MS)
  }

  const updateSW = registerSW({
    onNeedRefresh() {
      store.waiting = true
      startSafeMomentPolling()
    },
    onRegisteredSW(_url, reg) {
      registration = reg
      if (!reg) return
      setInterval(() => {
        if (navigator.onLine === false || reg.installing) return
        reg.update().catch(() => {
          // Offline or the server is down: the next check tries again.
        })
      }, UPDATE_CHECK_MS)
    },
  })

  const fetchVersion = createVersionFetcher()
  const checkVersion = () =>
    checkForUpdate(
      fetchVersion,
      __APP_VERSION__,
      (critical) => {
        if (critical) store.critical = true
        if (registration && navigator.onLine !== false && !registration.installing) {
          registration.update().catch(() => {
            // Offline or the server is down: the next check tries again.
          })
        }
      },
      () => householdStore.reconnectRealtime(),
    )
  setInterval(() => void checkVersion(), UPDATE_CHECK_MS)
  window.addEventListener('online', () => void checkVersion())
  return true
}
