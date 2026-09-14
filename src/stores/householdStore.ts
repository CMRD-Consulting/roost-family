import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { msUntilNextHouseholdMidnight } from '@/composables/householdMidnight'
import { applyCommand } from '@/data/applyCommand'
import { createDeviceCache } from '@/data/deviceCache'
import { isDemo, type HouseholdSource, type RealtimeStatus } from '@/data/householdSource'
import type { LogCommand } from '@/data/logCommands'
import type { HouseholdSnapshot } from '@/data/snapshot'

export type HouseholdStatus = 'idle' | 'loading' | 'ready' | 'error'

// Demo mode never writes household data (the child's health data) to disk.
const deviceCache = createDeviceCache()

export interface OverlayItem {
  command: LogCommand
  savedAt: string | null
  /** When the command was applied locally; used as its "now" (e.g. a dose's createdAt) so the view doesn't drift. */
  appliedAt: string
}

/** Deep-value equality: overlay items must match commands round-tripped through the offline
 *  queue's IndexedDB (plain JSON), which are structurally equal but not the same object. */
function sameCommand(a: LogCommand, b: LogCommand): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export const useHouseholdStore = defineStore('household', () => {
  const snapshot = ref<HouseholdSnapshot | null>(null)
  const status = ref<HouseholdStatus>('idle')
  const error = ref<string | null>(null)
  const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
  const realtime = ref<RealtimeStatus | 'unknown'>('unknown')
  /** ISO timestamp of the last successful load; used by `staleMinutes` while disconnected. */
  const freshAt = ref<string | null>(null)
  /** ISO time realtime was last seen not connected (since start, or since it dropped); null while connected. */
  const realtimeDownSince = ref<string | null>(null)
  /** True while `snapshot` is the device cache's last-known copy, not yet confirmed by a real load. */
  const fromCache = ref(false)
  /** Locally-applied log commands not yet reflected in `snapshot`, newest last. */
  const overlay = ref<OverlayItem[]>([])
  /** `snapshot` with every overlay command applied on top, for the UI to render. */
  const view = computed<HouseholdSnapshot | null>(() => {
    if (snapshot.value === null) return null
    return overlay.value.reduce((s, o) => applyCommand(s, o.command, new Date(o.appliedAt)), snapshot.value)
  })

  function addOverlay(cmd: LogCommand, appliedAt: Date = new Date()): void {
    overlay.value = [...overlay.value, { command: cmd, savedAt: null, appliedAt: appliedAt.toISOString() }]
  }

  function markSaved(cmd: LogCommand): void {
    const savedAt = new Date().toISOString()
    overlay.value = overlay.value.map((o) => (sameCommand(o.command, cmd) ? { ...o, savedAt } : o))
  }

  function removeOverlay(cmd: LogCommand): void {
    overlay.value = overlay.value.filter((o) => !sameCommand(o.command, cmd))
  }

  let currentHouseholdId: string | null = null
  /** The household the overlay belongs to; survives stop() so restarting the same household keeps pending commands. */
  let overlayHouseholdId: string | null = null
  let currentSource: HouseholdSource | null = null
  let unsubscribe: (() => void) | null = null
  /** Monotonic counter; a load result is applied only if it's still the latest one issued. */
  let loadSeq = 0
  /** Fires a reload right at the household's next local midnight, so "today"/"tomorrow"
   *  data (routine progress, day overrides) rolls over even with no other trigger. */
  let midnightTimer: ReturnType<typeof setTimeout> | null = null

  function handleOnline(): void {
    online.value = true
    void reload()
  }

  function handleOffline(): void {
    online.value = false
  }

  /** (Re)schedule the midnight timer against the current snapshot's household time zone. */
  function scheduleMidnightReload(): void {
    if (midnightTimer !== null) {
      clearTimeout(midnightTimer)
      midnightTimer = null
    }
    if (snapshot.value === null) return
    const tz = snapshot.value.household.timeZone
    const ms = msUntilNextHouseholdMidnight(new Date(), tz)
    midnightTimer = setTimeout(() => {
      midnightTimer = null
      void reload()
    }, ms)
  }

  async function reload(): Promise<void> {
    if (currentHouseholdId === null || currentSource === null) return
    const householdId = currentHouseholdId
    const source = currentSource
    const seq = ++loadSeq
    const loadStartedAt = new Date().toISOString()
    /** True once a newer load has started, this household was left, or the store stopped. */
    const isStale = () => seq !== loadSeq || currentHouseholdId !== householdId
    try {
      const next = await source.load(householdId, new Date())
      if (isStale()) return
      snapshot.value = next
      status.value = 'ready'
      error.value = null
      freshAt.value = next.loadedAt
      fromCache.value = false
      if (!isDemo) void deviceCache.saveSnapshot(next)
      // Overlay items saved before this reload started are already reflected in `next`; drop them.
      overlay.value = overlay.value.filter((o) => o.savedAt === null || o.savedAt >= loadStartedAt)
      scheduleMidnightReload()
    } catch (e) {
      if (isStale()) return
      error.value = e instanceof Error ? e.message : String(e)
      if (snapshot.value === null) status.value = 'error'
    }
  }

  async function start(householdId: string, source: HouseholdSource): Promise<void> {
    if (currentHouseholdId === householdId) return
    stop()
    currentHouseholdId = householdId
    currentSource = source
    snapshot.value = null
    error.value = null
    realtime.value = 'unknown'
    realtimeDownSince.value = new Date().toISOString()
    freshAt.value = null
    fromCache.value = false
    if (overlayHouseholdId !== householdId) overlay.value = []
    overlayHouseholdId = householdId
    status.value = 'loading'
    if (!isDemo) {
      const cached = await deviceCache.loadSnapshot(householdId)
      // A stop() or a switch to another household during that read must not resurrect a stale one.
      if (currentHouseholdId === householdId && cached !== null) {
        snapshot.value = cached
        status.value = 'ready'
        fromCache.value = true
      }
    }
    await reload()
    // A stop() or a switch to another household during that first load must not subscribe.
    if (currentHouseholdId !== householdId) return
    unsubscribe = source.subscribe(
      householdId,
      () => {
        void reload()
      },
      (s) => {
        realtime.value = s
        if (s === 'connected') realtimeDownSince.value = null
        else realtimeDownSince.value ??= new Date().toISOString()
      },
    )
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
  }

  function stop(): void {
    unsubscribe?.()
    unsubscribe = null
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
    currentHouseholdId = null
    currentSource = null
    realtime.value = 'unknown'
    if (midnightTimer !== null) {
      clearTimeout(midnightTimer)
      midnightTimer = null
    }
  }

  /** Minutes of staleness for the header's "Updated N min ago" badge. Always 0 while realtime is connected. */
  function staleMinutes(now: Date): number {
    if (realtime.value === 'connected') return 0
    if (freshAt.value === null) return 0
    return Math.floor((now.getTime() - Date.parse(freshAt.value)) / 60_000)
  }

  /** How long realtime has not been connected (0 while connected). Counts from start() until the first connect. */
  function realtimeDownMs(now: Date): number {
    if (realtime.value === 'connected' || realtimeDownSince.value === null) return 0
    return Math.max(0, now.getTime() - Date.parse(realtimeDownSince.value))
  }

  return {
    snapshot, status, error, online, realtime, realtimeDownSince, realtimeDownMs, start, reload, stop, staleMinutes,
    overlay, view, addOverlay, markSaved, removeOverlay, fromCache,
  }
})
