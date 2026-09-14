import type { LogWriter } from './logWriter'
import type { SettingsApi } from './settingsApi'
import type { HouseholdSnapshot } from './snapshot'

export type RealtimeStatus = 'connected' | 'disconnected'

export interface HouseholdSource {
  /** Load the current snapshot for a household. */
  load(householdId: string, now: Date): Promise<HouseholdSnapshot>
  /**
   * Call `onChange` whenever household data may have changed, and `onStatus` (if given)
   * whenever the realtime connection transitions between connected and disconnected.
   * Returns an unsubscribe function.
   */
  subscribe(householdId: string, onChange: () => void, onStatus?: (status: RealtimeStatus) => void): () => void
}

export const isDemo = import.meta.env.VITE_DATA_SOURCE === 'demo'

export const DEMO_DISPLAY = {
  displayId: 'demo-display',
  householdId: 'aaaaaaaa-0000-0000-0000-000000000001',
  name: 'Kitchen',
} as const

export async function selectSource(): Promise<HouseholdSource> {
  if (isDemo) return (await import('./demo/demoSource')).demoSource
  const [{ displayClient }, { createSupabaseSource }] = await Promise.all([
    import('./supabase'),
    import('./supabaseSource'),
  ])
  return createSupabaseSource(displayClient)
}

export async function selectWriter(): Promise<LogWriter> {
  if (isDemo) return (await import('./demo/demoLogWriter')).createDemoLogWriter()
  const [{ displayClient }, { createSupabaseLogWriter }] = await Promise.all([
    import('./supabase'),
    import('./supabaseLogWriter'),
  ])
  return createSupabaseLogWriter(displayClient)
}

export async function selectSettingsApi(): Promise<SettingsApi> {
  if (isDemo) return (await import('./demo/demoSettingsApi')).createDemoSettingsApi()
  const [{ displayClient }, { createSupabaseSettingsApi }] = await Promise.all([
    import('./supabase'),
    import('./supabaseSettingsApi'),
  ])
  return createSupabaseSettingsApi(displayClient)
}
