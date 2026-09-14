import { defineStore } from 'pinia'
import { ref } from 'vue'
import { msUntilNextHouseholdMidnight } from '@/composables/householdMidnight'
import type { HouseholdSource, RealtimeStatus } from '@/data/householdSource'
import type { HouseholdSnapshot } from '@/data/snapshot'

export type HouseholdStatus = 'idle' | 'loading' | 'ready' | 'error'

export const useHouseholdStore = defineStore('household', () => {
  const snapshot = ref<HouseholdSnapshot | null>(null)
  const status = ref<HouseholdStatus>('idle')
  const error = ref<string | null>(null)
  const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
  const realtime = ref<RealtimeStatus | 'unknown'>('unknown')
  /** ISO timestamp of the last successful load; used by `staleMinutes` while disconnected. */
  const freshAt = ref<string | null>(null)

  let currentHouseholdId: string | null = null
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
    /** True once a newer load has started, this household was left, or the store stopped. */
    const isStale = () => seq !== loadSeq || currentHouseholdId !== householdId
    try {
      const next = await source.load(householdId, new Date())
      if (isStale()) return
      snapshot.value = next
      status.value = 'ready'
      error.value = null
      freshAt.value = next.loadedAt
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
    freshAt.value = null
    status.value = 'loading'
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

  return { snapshot, status, error, online, realtime, start, reload, stop, staleMinutes }
})
