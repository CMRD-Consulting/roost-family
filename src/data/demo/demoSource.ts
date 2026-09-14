import type { HouseholdSource } from '../householdSource'
import { buildDemoSnapshot } from './demoFixture'

function optionsFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return { conflict: params.has('conflict'), manyKids: params.has('manyKids') }
}

export const demoSource: HouseholdSource = {
  async load(_householdId, now) {
    return buildDemoSnapshot(now, optionsFromUrl())
  },
  subscribe(_householdId, _onChange, onStatus) {
    onStatus?.('connected')
    return () => {}
  },
}
