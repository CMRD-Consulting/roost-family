import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDemoLogWriter } from './demoLogWriter'
import { getDemoSnapshot, onDemoChange, resetDemoForTests } from './demoHousehold'
import { LogWriteError } from '../logWriter'

const SAM_ID = 'bbbbbbbb-0000-0000-0000-000000000001'
const ALEX_ID = 'bbbbbbbb-0000-0000-0000-000000000002'
const DOSE_ID = 'ffffffff-0000-0000-0000-000000000001'

afterEach(() => {
  resetDemoForTests()
  vi.useRealTimers()
})

describe('createDemoLogWriter', () => {
  it('execute mutates the demo household (after a delay) and notifies listeners', async () => {
    vi.useFakeTimers()
    const writer = createDemoLogWriter()
    const listener = vi.fn()
    onDemoChange(listener)

    const promise = writer.execute({ kind: 'dinner.set', householdId: 'h', text: 'Sushi', previous: null })
    expect(listener).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(150)
    await promise

    expect(listener).toHaveBeenCalled()
    expect(getDemoSnapshot(new Date()).household.dinnerTonight).toBe('Sushi')
  })

  it('rejects dose.void with the wrong PIN and does not mutate', async () => {
    vi.useFakeTimers()
    const writer = createDemoLogWriter()
    const promise = writer.execute({
      kind: 'dose.void', householdId: 'h', doseId: DOSE_ID, membershipId: SAM_ID, pin: '0000', reason: 'test',
    })
    const assertion = expect(promise).rejects.toMatchObject({ message: 'Wrong PIN', network: false, code: '42501' })
    await vi.advanceTimersByTimeAsync(150)
    await assertion
    expect(await promise.catch((e: unknown) => e)).toBeInstanceOf(LogWriteError)

    const dose = getDemoSnapshot(new Date()).doses.find((d) => d.id === DOSE_ID)
    expect(dose?.voidedAt).toBeNull()
  })

  it('accepts dose.void with the correct PIN', async () => {
    vi.useFakeTimers()
    const writer = createDemoLogWriter()
    const promise = writer.execute({
      kind: 'dose.void', householdId: 'h', doseId: DOSE_ID, membershipId: SAM_ID, pin: '1234', reason: 'test',
    })
    await vi.advanceTimersByTimeAsync(150)
    await promise

    const dose = getDemoSnapshot(new Date()).doses.find((d) => d.id === DOSE_ID)
    expect(dose?.voidedAt).not.toBeNull()
  })

  it('verifyPin resolves true/false against the stored demo PINs', async () => {
    const writer = createDemoLogWriter()
    await expect(writer.verifyPin(ALEX_ID, '5678')).resolves.toBe(true)
    await expect(writer.verifyPin(ALEX_ID, '0000')).resolves.toBe(false)
    await expect(writer.verifyPin(SAM_ID, '1234')).resolves.toBe(true)
  })
})
