import { selectSettingsApi } from '@/data/householdSource'
import type { SettingsApi } from '@/data/settingsApi'
import { useSettingsSessionStore } from '@/stores/settingsSession'

let loading: Promise<SettingsApi> | null = null

/** This device's `SettingsApi` (demo or Supabase), loaded once and shared by the PIN gate and every section. */
export function loadSettingsApi(): Promise<SettingsApi> {
  loading ??= selectSettingsApi().catch((e: unknown) => {
    loading = null
    throw e
  })
  return loading
}

/** Loads the API and hands it to the settings session store, which needs it before `enter`. */
export async function prepareSettingsSession(): Promise<ReturnType<typeof useSettingsSessionStore>> {
  const session = useSettingsSessionStore()
  session.init(await loadSettingsApi())
  return session
}

/** Test-only: forgets the loaded API so the next load picks up a new mock. */
export function resetSettingsApiLoaderForTests(): void {
  loading = null
}
