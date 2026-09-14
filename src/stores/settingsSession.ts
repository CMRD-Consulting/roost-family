import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { SettingsApi, SettingsAuth } from '@/data/settingsApi'
import { ADULT_SESSION_IDLE_MS, startIdleTimer } from '@/session/idleTimer'
import { useModesStore } from './modesStore'

export interface SettingsSessionInfo {
  membershipId: string
  displayName: string
  role: string
}

/**
 * The Settings session (spec §7.9, plan Decisions): a verified membership and PIN held in memory only, used
 * to re-authenticate every PIN-checked `SettingsApi` call. Ends after 5 minutes idle (reusing the adult
 * session's idle timer/period), when Night Mode starts, or explicitly via `end()` (e.g. leaving /settings).
 */
export const useSettingsSessionStore = defineStore('settingsSession', () => {
  const modes = useModesStore()

  const info = ref<SettingsSessionInfo | null>(null)
  let pin: string | null = null
  let stopIdle: (() => void) | null = null
  let api: SettingsApi | null = null

  /** Must be called (once) before `enter`, with the API this device should verify PINs against. */
  function init(settingsApi: SettingsApi): void {
    api = settingsApi
  }

  function clearIdle(): void {
    stopIdle?.()
    stopIdle = null
  }

  function armIdle(): void {
    clearIdle()
    stopIdle = startIdleTimer(end, ADULT_SESSION_IDLE_MS)
  }

  function end(): void {
    info.value = null
    pin = null
    clearIdle()
  }

  /** Verifies `pin` for `membershipId` and opens a session on success; throws (via the API) on failure. */
  async function enter(membershipId: string, candidatePin: string): Promise<void> {
    if (api === null) throw new Error('useSettingsSessionStore().init() must be called before use')
    const result = await api.settingsVerify({ membershipId, pin: candidatePin })
    info.value = { membershipId, displayName: result.displayName, role: result.role }
    pin = candidatePin
    armIdle()
  }

  /** The credentials for a PIN-checked `SettingsApi` call, or null with no open session. */
  const auth = computed<SettingsAuth | null>(() => (info.value === null || pin === null ? null : { membershipId: info.value.membershipId, pin }))

  const isOwner = computed<boolean>(() => info.value?.role === 'owner')

  // Night Mode starting ends the session (plan Decisions): the tablet is about to show the Night screen.
  // `flush: 'sync'` so the session is gone in the same tick Night Mode turns on, not on a later microtask.
  watch(
    () => modes.nightActive,
    (active) => {
      if (active) end()
    },
    { flush: 'sync' },
  )

  return { info, auth, isOwner, init, enter, end }
})
