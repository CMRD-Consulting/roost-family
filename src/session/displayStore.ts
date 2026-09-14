import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { displayClient } from '@/data/supabase'
import { loadDisplayState, type DisplayIdentity, type DisplayState } from './displaySession'

/** The display state as the app sees it: `offline` when the server or session could not be read. */
export type DisplayStoreState = DisplayState | { kind: 'offline' }
export type DisplayStoreKind = DisplayStoreState['kind']

export const DISPLAY_REFRESH_MS = 60_000

export const useDisplayStore = defineStore('display', () => {
  const state = ref<DisplayStoreState | null>(null)
  /** The last state read successfully; survives going offline so a registered tablet keeps its identity. */
  const lastKnown = ref<DisplayState | null>(null)

  const identity = computed<DisplayIdentity | null>(() => {
    const s = state.value?.kind === 'offline' ? lastKnown.value : state.value
    return s?.kind === 'registered' ? s.identity : null
  })

  async function refresh(): Promise<DisplayStoreState> {
    try {
      const next = await loadDisplayState(displayClient)
      lastKnown.value = next
      state.value = next
    } catch {
      state.value = { kind: 'offline' }
    }
    return state.value
  }

  /** Returns the cached state, reading it if there is none yet or the last read failed. Never throws. */
  async function ensure(): Promise<DisplayStoreState> {
    if (state.value && state.value.kind !== 'offline') return state.value
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
