import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { createDeviceCache } from '@/data/deviceCache'
import { DEMO_DISPLAY, isDemo } from '@/data/householdSource'
import { loadDisplayState, type DisplayIdentity, type DisplayState } from './displaySession'

/** The display state as the app sees it: `offline` when the server or session could not be read. */
export type DisplayStoreState = DisplayState | { kind: 'offline' }
export type DisplayStoreKind = DisplayStoreState['kind']

export const DISPLAY_REFRESH_MS = 60_000

// Demo mode never persists to the device cache (spec: no household data written to disk in demo).
const deviceCache = createDeviceCache()

export const useDisplayStore = defineStore('display', () => {
  const state = ref<DisplayStoreState | null>(null)
  /** The last state read successfully; survives going offline so a registered tablet keeps its identity. */
  const lastKnown = ref<DisplayState | null>(null)
  /** Reads the cached identity at most once per store instance, before the first network attempt. */
  let seedFromCache: Promise<void> | null = null

  const identity = computed<DisplayIdentity | null>(() => {
    const s = state.value?.kind === 'offline' ? lastKnown.value : state.value
    return s?.kind === 'registered' ? s.identity : null
  })

  function seedLastKnownFromCache(): Promise<void> {
    if (seedFromCache) return seedFromCache
    seedFromCache = (async () => {
      if (isDemo) return
      const cached = await deviceCache.loadIdentity()
      // A concurrent refresh() may already have produced a real answer; don't clobber it.
      if (cached && lastKnown.value === null) {
        lastKnown.value = { kind: 'registered', identity: cached }
      }
    })()
    return seedFromCache
  }

  async function refresh(): Promise<DisplayStoreState> {
    try {
      // Demo mode has no backend (and usually no Supabase env), so never load the client there.
      const next: DisplayState = isDemo
        ? { kind: 'registered', identity: { ...DEMO_DISPLAY } }
        : await loadDisplayState((await import('@/data/supabase')).displayClient)
      lastKnown.value = next
      state.value = next
      if (!isDemo) {
        if (next.kind === 'registered') void deviceCache.saveIdentity(next.identity)
        // Revoked or unregistered: this tablet no longer owns whatever household data was cached.
        else void deviceCache.clear()
      }
    } catch {
      state.value = { kind: 'offline' }
    }
    return state.value
  }

  /** Returns the cached state, reading it if there is none yet or the last read failed. Never throws. */
  async function ensure(): Promise<DisplayStoreState> {
    if (state.value && state.value.kind !== 'offline') return state.value
    await seedLastKnownFromCache()
    return refresh()
  }

  /** Refreshes every `intervalMs` and whenever the browser comes back online. Returns a stop function. */
  function watch(intervalMs = DISPLAY_REFRESH_MS): () => void {
    const onOnline = () => void refresh()
    const timer = setInterval(onOnline, intervalMs)
    window.addEventListener('online', onOnline)
    return () => {
      clearInterval(timer)
      window.removeEventListener('online', onOnline)
    }
  }

  return { state, lastKnown, identity, refresh, ensure, watch }
})
