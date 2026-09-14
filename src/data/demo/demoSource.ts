import type { HouseholdSource } from '../householdSource'
import { getDemoSnapshot, onDemoChange } from './demoHousehold'

export const demoSource: HouseholdSource = {
  async load(_householdId, now) {
    return getDemoSnapshot(now)
  },
  subscribe(_householdId, onChange, onStatus) {
    onStatus?.('connected')
    return onDemoChange(onChange)
  },
}
