import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { buildDemoSnapshot } from '@/data/demo/demoFixture'
import { useHouseholdStore } from '@/stores/householdStore'
import { getRedactionTerms } from './redactionTerms'

describe('getRedactionTerms', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('is empty with no snapshot loaded', () => {
    expect(getRedactionTerms()).toEqual([])
  })

  it('collects children, members and medicine names from the current snapshot', () => {
    const store = useHouseholdStore()
    store.snapshot = buildDemoSnapshot(new Date('2026-09-14T18:00:00Z'))

    const terms = getRedactionTerms()
    expect(terms).toEqual(expect.arrayContaining(['Ivy', 'Theo', 'Sam', 'Alex', 'Infant ibuprofen', "Children's ibuprofen"]))
  })

  it('includes the active sitter\'s name', () => {
    const store = useHouseholdStore()
    store.snapshot = buildDemoSnapshot(new Date('2026-09-14T18:00:00Z'), { sitter: true })

    expect(getRedactionTerms()).toContain('Jess')
  })

  it('has no duplicates and no blank entries', () => {
    const store = useHouseholdStore()
    store.snapshot = buildDemoSnapshot(new Date('2026-09-14T18:00:00Z'), { sitter: true })

    const terms = getRedactionTerms()
    expect(new Set(terms).size).toBe(terms.length)
    expect(terms.every((t) => t.trim().length > 0)).toBe(true)
  })
})
