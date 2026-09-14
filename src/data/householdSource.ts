import type { HouseholdSnapshot } from './snapshot'

export interface HouseholdSource {
  /** Load the current snapshot for a household. */
  load(householdId: string, now: Date): Promise<HouseholdSnapshot>
  /** Call `onChange` whenever household data may have changed. Returns an unsubscribe function. */
  subscribe(householdId: string, onChange: () => void): () => void
}

export const isDemo = import.meta.env.VITE_DATA_SOURCE === 'demo'

export const DEMO_DISPLAY = {
  displayId: 'demo-display',
  householdId: 'aaaaaaaa-0000-0000-0000-000000000001',
  name: 'Kitchen',
} as const
