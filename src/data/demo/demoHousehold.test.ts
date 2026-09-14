import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDemoSnapshot, mutateDemo, onDemoChange, resetDemoForTests } from './demoHousehold'

afterEach(() => resetDemoForTests())

describe('demoHousehold', () => {
  it('getDemoSnapshot returns a snapshot with loadedAt set to now', () => {
    const now = new Date('2026-09-14T19:00:00Z')
    const snap = getDemoSnapshot(now)
    expect(snap.loadedAt).toBe(now.toISOString())
    expect(snap.household.name).toBe('Rivera')
  })

  it('returns a structured clone: mutating the result does not affect shared state', () => {
    const first = getDemoSnapshot(new Date())
    first.household.dinnerTonight = 'Mutated!'
    const second = getDemoSnapshot(new Date())
    expect(second.household.dinnerTonight).not.toBe('Mutated!')
  })

  it('mutateDemo applies a transform that getDemoSnapshot then reflects', () => {
    mutateDemo((s) => ({ ...s, household: { ...s.household, dinnerTonight: 'Pizza' } }))
    expect(getDemoSnapshot(new Date()).household.dinnerTonight).toBe('Pizza')
  })

  it('onDemoChange notifies listeners on mutateDemo; unsubscribe stops notifications', () => {
    const listener = vi.fn()
    const unsubscribe = onDemoChange(listener)

    mutateDemo((s) => s)
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    mutateDemo((s) => s)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('resetDemoForTests restores a fresh fixture', () => {
    mutateDemo((s) => ({ ...s, household: { ...s.household, dinnerTonight: 'Changed' } }))
    resetDemoForTests()
    expect(getDemoSnapshot(new Date()).household.dinnerTonight).toBe('Tacos')
  })
})
