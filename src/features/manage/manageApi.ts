import { isDemo } from '@/data/householdSource'
import type { SettingsApi } from '@/data/settingsApi'

/**
 * The `SettingsApi` for Manage household. Every method it uses takes the signed-in adult's client, so the base
 * client is a session-less anon one: a browser that is not a display never builds or reads the display's client.
 */
export async function loadManageApi(): Promise<SettingsApi> {
  if (isDemo) return (await import('@/data/demo/demoSettingsApi')).createDemoSettingsApi()
  const [{ createAnonClient }, { createSupabaseSettingsApi }] = await Promise.all([
    import('@/data/sessionlessClients'),
    import('@/data/supabaseSettingsApi'),
  ])
  return createSupabaseSettingsApi(createAnonClient())
}
