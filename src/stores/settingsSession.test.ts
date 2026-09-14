import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { buildDemoSnapshot } from '@/data/demo/demoFixture'
import { SettingsError, type SettingsApi } from '@/data/settingsApi'
import type { HouseholdSnapshot } from '@/data/snapshot'
import { useHouseholdStore } from './householdStore'
import { useSettingsSessionStore } from './settingsSession'

const TZ = 'America/New_York'
// 2026-09-14 is EDT (UTC-4): 20:00 EDT == 2026-09-15T00:00:00Z.
const NIGHT_MODE = { start: '20:00', end: '06:00' }

function withHousehold(now: Date, overrides: Partial<HouseholdSnapshot['household']> = {}) {
  vi.setSystemTime(now)
  const householdStore = useHouseholdStore()
  const snapshot = buildDemoSnapshot(now)
  householdStore.snapshot = { ...snapshot, household: { ...snapshot.household, ...overrides } }
  return householdStore
}

function fakeApi(verify: SettingsApi['settingsVerify'] = vi.fn().mockResolvedValue({ role: 'owner', displayName: 'Sam' })): SettingsApi {
  return { settingsVerify: verify } as unknown as SettingsApi
}

describe('useSettingsSessionStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('enter verifies the PIN and opens a session', async () => {
    const verify = vi.fn().mockResolvedValue({ role: 'owner', displayName: 'Sam' })
    const store = useSettingsSessionStore()
    store.init(fakeApi(verify))

    await store.enter('mem-1', '1234')

    expect(verify).toHaveBeenCalledWith({ membershipId: 'mem-1', pin: '1234' })
    expect(store.info).toEqual({ membershipId: 'mem-1', displayName: 'Sam', role: 'owner' })
    expect(store.auth).toEqual({ membershipId: 'mem-1', pin: '1234' })
    expect(store.isOwner).toBe(true)
  })

  it('isOwner is false for an adult', async () => {
    const store = useSettingsSessionStore()
    store.init(fakeApi(vi.fn().mockResolvedValue({ role: 'adult', displayName: 'Alex' })))
    await store.enter('mem-2', '5678')
    expect(store.isOwner).toBe(false)
  })

  it('enter throws if init() was never called, and opens no session', async () => {
    const store = useSettingsSessionStore()
    await expect(store.enter('mem-1', '1234')).rejects.toThrow()
    expect(store.info).toBeNull()
  })

  it('a rejected verify leaves no session and does not arm the idle timer', async () => {
    const verify = vi.fn().mockRejectedValue(new SettingsError('Incorrect PIN', 'auth'))
    const store = useSettingsSessionStore()
    store.init(fakeApi(verify))

    await expect(store.enter('mem-1', '0000')).rejects.toMatchObject({ message: 'Incorrect PIN', code: 'auth' })
    expect(store.info).toBeNull()
    expect(store.auth).toBeNull()

    vi.advanceTimersByTime(10 * 60_000)
    expect(store.info).toBeNull() // still nothing to expire
  })

  it('end() clears the session and its idle timer', async () => {
    const store = useSettingsSessionStore()
    store.init(fakeApi())
    await store.enter('mem-1', '1234')

    store.end()
    expect(store.info).toBeNull()
    expect(store.auth).toBeNull()

    // The idle timer from enter() must not still be armed after end().
    vi.advanceTimersByTime(10 * 60_000)
    expect(store.info).toBeNull()
  })

  describe('idle expiry (5 minutes, spec §6.3 / plan Decisions)', () => {
    it('ends the session after 5 minutes with no pointer or key activity', async () => {
      const store = useSettingsSessionStore()
      store.init(fakeApi())
      await store.enter('mem-1', '1234')

      vi.advanceTimersByTime(5 * 60_000 - 1)
      expect(store.info).not.toBeNull()

      vi.advanceTimersByTime(1)
      expect(store.info).toBeNull()
    })

    it('activity resets the idle period', async () => {
      const store = useSettingsSessionStore()
      store.init(fakeApi())
      await store.enter('mem-1', '1234')

      vi.advanceTimersByTime(4 * 60_000)
      window.dispatchEvent(new Event('pointerdown'))
      vi.advanceTimersByTime(4 * 60_000)
      expect(store.info).not.toBeNull()

      vi.advanceTimersByTime(60_000 + 1)
      expect(store.info).toBeNull()
    })

    it('re-entering after an expiry arms a fresh idle period', async () => {
      const store = useSettingsSessionStore()
      store.init(fakeApi())
      await store.enter('mem-1', '1234')
      vi.advanceTimersByTime(5 * 60_000)
      expect(store.info).toBeNull()

      await store.enter('mem-1', '1234')
      vi.advanceTimersByTime(5 * 60_000 - 1)
      expect(store.info).not.toBeNull()
      vi.advanceTimersByTime(1)
      expect(store.info).toBeNull()
    })
  })

  it('ends the session as soon as Night Mode becomes active', async () => {
    withHousehold(new Date('2026-09-14T23:59:45Z'), { timeZone: TZ, nightMode: NIGHT_MODE })
    const store = useSettingsSessionStore()
    store.init(fakeApi())
    await store.enter('mem-1', '1234')
    expect(store.info).not.toBeNull()

    // modesStore ticks every 15s and crosses the 8pm household boundary here.
    vi.advanceTimersByTime(15_000)
    expect(store.info).toBeNull()
    expect(store.auth).toBeNull()
  })

  it('does nothing when Night Mode is not active', async () => {
    withHousehold(new Date('2026-09-14T18:00:00Z'), { timeZone: TZ, nightMode: NIGHT_MODE })
    const store = useSettingsSessionStore()
    store.init(fakeApi())
    await store.enter('mem-1', '1234')

    vi.advanceTimersByTime(60_000)
    expect(store.info).not.toBeNull()
  })
})
