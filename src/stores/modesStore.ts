import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useNow } from '@/composables/useNow'
import { isInWindow } from '@/domain/time'
import type { HouseholdInfo, HouseholdSnapshot } from '@/data/snapshot'
import { setMuted } from '@/ui/sound'
import { useHouseholdStore } from './householdStore'

export interface NapState {
  startedAt: string
  openSleepIds: string[]
}

const PEEK_MS = 60_000
const NAP_MAX_MS = 3 * 60 * 60_000
const NAP_STORAGE_KEY = 'roost-nap'

/** Pure: is `now` inside the household's night window? */
export function isNight(now: Date, household: HouseholdInfo): boolean {
  return isInWindow(now, household.nightMode, household.timeZone)
}

/** Pure: the ids of every sleep entry (for any child) still open when a nap starts. */
export function startNap(snapshot: HouseholdSnapshot, now: Date): NapState {
  return {
    startedAt: now.toISOString(),
    openSleepIds: snapshot.sleeps.filter((s) => s.endAt === null).map((s) => s.id),
  }
}

/**
 * Pure: should this nap end now? True once every sleep entry that was open when the nap started has
 * since ended (or no longer exists), or after 3 hours, whichever comes first. A nap that started with
 * no open sleep only ends by the 3-hour cap (the caller must otherwise end it explicitly, e.g. the moon
 * button).
 */
export function napShouldEnd(nap: NapState, snapshot: HouseholdSnapshot, now: Date): boolean {
  if (now.getTime() - Date.parse(nap.startedAt) >= NAP_MAX_MS) return true
  if (nap.openSleepIds.length === 0) return false
  return nap.openSleepIds.every((id) => {
    const entry = snapshot.sleeps.find((s) => s.id === id)
    return entry === undefined || entry.endAt !== null
  })
}

function loadNap(): NapState | null {
  try {
    const raw = localStorage.getItem(NAP_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as NapState) : null
  } catch {
    return null
  }
}

function saveNap(nap: NapState | null): void {
  try {
    if (nap === null) localStorage.removeItem(NAP_STORAGE_KEY)
    else localStorage.setItem(NAP_STORAGE_KEY, JSON.stringify(nap))
  } catch {
    // Private mode or quota exceeded: nap state just won't survive a reload.
  }
}

/** Nap/Night mode state. Ticks its own clock so `nightActive` and the mute watcher track the household's
 *  night window even when nothing else changes. */
export const useModesStore = defineStore('modes', () => {
  const householdStore = useHouseholdStore()
  const now = useNow()

  /** Epoch ms until which a tap during Night Mode shows the dimmed main screen instead of the night screen. */
  const nightPeekUntil = ref<number | null>(null)
  const nap = ref<NapState | null>(loadNap())

  const nightActive = computed<boolean>(() => {
    const household = householdStore.view?.household
    if (household === undefined) return false
    if (!isNight(now.value, household)) return false
    const until = nightPeekUntil.value
    return !(until !== null && until > now.value.getTime())
  })

  const napActive = computed<boolean>(() => nap.value !== null)

  function peek(): void {
    nightPeekUntil.value = now.value.getTime() + PEEK_MS
  }

  function endNap(): void {
    nap.value = null
    saveNap(null)
  }

  function toggleNap(): void {
    if (nap.value !== null) {
      endNap()
      return
    }
    const snapshot = householdStore.view
    if (snapshot === null) return
    nap.value = startNap(snapshot, now.value)
    saveNap(nap.value)
  }

  // `flush: 'sync'` so sound is muted/unmuted in the same tick as the mode change, not on the next
  // microtask — a chime triggered right after toggling nap must never slip through unmuted.
  watch(() => napActive.value || nightActive.value, (muted) => setMuted(muted), { immediate: true, flush: 'sync' })

  return { nightPeekUntil, nightActive, nap, napActive, peek, toggleNap, endNap }
})
