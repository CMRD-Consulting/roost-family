import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { HouseholdSource } from '@/data/householdSource'
import type { HouseholdSnapshot } from '@/data/snapshot'

export type HouseholdStatus = 'idle' | 'loading' | 'ready' | 'error'

export const useHouseholdStore = defineStore('household', () => {
  const snapshot = ref<HouseholdSnapshot | null>(null)
  const status = ref<HouseholdStatus>('idle')
  const error = ref<string | null>(null)
  const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)

  let currentHouseholdId: string | null = null
  let currentSource: HouseholdSource | null = null
  let unsubscribe: (() => void) | null = null

  function handleOnline(): void {
    online.value = true
    void reload()
  }

  function handleOffline(): void {
    online.value = false
  }

  async function reload(): Promise<void> {
    if (currentHouseholdId === null || currentSource === null) return
    try {
      const next = await currentSource.load(currentHouseholdId, new Date())
      snapshot.value = next
      status.value = 'ready'
      error.value = null
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      if (snapshot.value === null) status.value = 'error'
    }
  }

  async function start(householdId: string, source: HouseholdSource): Promise<void> {
    if (currentHouseholdId === householdId) return
    stop()
    currentHouseholdId = householdId
    currentSource = source
    status.value = 'loading'
    await reload()
    unsubscribe = source.subscribe(householdId, () => {
      void reload()
    })
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
  }

  function staleMinutes(now: Date): number {
    if (snapshot.value === null) return 0
    return Math.floor((now.getTime() - Date.parse(snapshot.value.loadedAt)) / 60_000)
  }

  return { snapshot, status, error, online, start, reload, stop, staleMinutes }
})
