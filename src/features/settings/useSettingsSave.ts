import { computed, onBeforeUnmount, ref } from 'vue'
import type { SettingsApi, SettingsAuth } from '@/data/settingsApi'
import { useHouseholdStore } from '@/stores/householdStore'
import { useSettingsSessionStore } from '@/stores/settingsSession'
import { loadSettingsApi } from './settingsApiLoader'
import { settingsErrorMessage } from './settingsErrors'

const SAVED_TOAST_MS = 3_000

/** True when Settings can't save (spec §7.9 / plan Decisions: configuration changes are online-only). */
export function useSettingsOffline() {
  const household = useHouseholdStore()
  return computed(() => !household.online || (typeof navigator !== 'undefined' && navigator.onLine === false))
}

/**
 * Save state for one Settings form: runs a `SettingsApi` call with the settings session's credentials, shows
 * "Saved" for a few seconds on success, and keeps an adult-worded error on failure. Never saves offline.
 */
export function useSettingsSave() {
  const session = useSettingsSessionStore()
  const offline = useSettingsOffline()
  const saving = ref(false)
  const saved = ref(false)
  const error = ref<string | null>(null)
  let savedTimer: ReturnType<typeof setTimeout> | undefined

  async function save(action: (api: SettingsApi, auth: SettingsAuth) => Promise<unknown>): Promise<boolean> {
    if (saving.value || offline.value) return false
    const auth = session.auth
    if (auth === null) return false
    saving.value = true
    saved.value = false
    error.value = null
    clearTimeout(savedTimer)
    try {
      await action(await loadSettingsApi(), auth)
      saved.value = true
      savedTimer = setTimeout(() => (saved.value = false), SAVED_TOAST_MS)
      return true
    } catch (e) {
      error.value = settingsErrorMessage(e)
      return false
    } finally {
      saving.value = false
    }
  }

  onBeforeUnmount(() => clearTimeout(savedTimer))

  return { saving, saved, error, offline, save }
}
