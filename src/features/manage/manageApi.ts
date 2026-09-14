import { isDemo } from '@/data/householdSource'
import { SettingsError, type AdultClient, type SettingsApi } from '@/data/settingsApi'

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

/**
 * The /manage route's `onRequestExport`: records and starts an export of the household on the signed-in owner's client
 * (spec §11.3). The export code loads only when an owner asks for one. Demo mode has no accounts or email.
 */
export async function requestManageExport(target: { client: AdultClient; householdId: string }): Promise<void> {
  if (isDemo) throw new SettingsError('Not available in demo', 'other')
  const { requestExport } = await import('@/data/exportApi')
  await requestExport(target.client, target.householdId)
}
