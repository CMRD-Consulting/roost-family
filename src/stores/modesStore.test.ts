import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { buildDemoSnapshot } from '@/data/demo/demoFixture'
import type { HouseholdSnapshot } from '@/data/snapshot'
import { isMuted, resetSoundForTests } from '@/ui/sound'
import { useHouseholdStore } from './householdStore'
import { isNight, napShouldEnd, startNap, useModesStore, type NapState } from './modesStore'

const TZ = 'America/New_York'
// 2026-09-14 is EDT (UTC-4): 20:00 EDT == 2026-09-15T00:00:00Z, 06:00 EDT == 2026-09-15T10:00:00Z.
const NIGHT_MODE = { start: '20:00', end: '06:00' }

function household(overrides: Partial<HouseholdSnapshot['household']> = {}) {
  const base = buildDemoSnapshot(new Date('2026-09-14T12:00:00Z')).household
  return { ...base, timeZone: TZ, nightMode: NIGHT_MODE, ...overrides }
}

describe('isNight', () => {
  it('is true inside a window crossing midnight (11pm household time)', () => {
    expect(isNight(new Date('2026-09-15T03:00:00Z'), household())).toBe(true)
  })

  it('is false outside a window crossing midnight (2pm household time)', () => {
    expect(isNight(new Date('2026-09-14T18:00:00Z'), household())).toBe(false)
  })

  it('is false right at the end boundary (6am household time)', () => {
    expect(isNight(new Date('2026-09-15T10:00:00Z'), household())).toBe(false)
  })

  it('is true right at the start boundary (8pm household time)', () => {
    expect(isNight(new Date('2026-09-15T00:00:00Z'), household())).toBe(true)
  })
})

describe('startNap / napShouldEnd', () => {
  const now = new Date('2026-09-14T18:00:00Z')

  function snapshotWithSleeps(sleeps: HouseholdSnapshot['sleeps']): HouseholdSnapshot {
    return { ...buildDemoSnapshot(now), sleeps }
  }

  it('startNap records the ids of currently open sleep entries for any child', () => {
    const snapshot = snapshotWithSleeps([
      { id: 'open-1', childId: 'child-a', startAt: now.toISOString(), endAt: null, type: 'nap', sitterSessionId: null },
      { id: 'closed-1', childId: 'child-b', startAt: now.toISOString(), endAt: now.toISOString(), type: 'nap', sitterSessionId: null },
      { id: 'open-2', childId: 'child-b', startAt: now.toISOString(), endAt: null, type: 'night', sitterSessionId: null },
    ])
    const nap = startNap(snapshot, now)
    expect(nap.startedAt).toBe(now.toISOString())
    expect(nap.openSleepIds.sort()).toEqual(['open-1', 'open-2'])
  })

  it('napShouldEnd is false while a tracked sleep is still open, even if an unrelated sleep ends', () => {
    const snapshot = snapshotWithSleeps([
      { id: 'tracked', childId: 'child-a', startAt: now.toISOString(), endAt: null, type: 'nap', sitterSessionId: null },
    ])
    const nap = startNap(snapshot, now)

    // An unrelated sleep starts and ends after the nap began; it was never tracked.
    const withUnrelatedEnded = snapshotWithSleeps([
      { id: 'tracked', childId: 'child-a', startAt: now.toISOString(), endAt: null, type: 'nap', sitterSessionId: null },
      { id: 'unrelated', childId: 'child-b', startAt: now.toISOString(), endAt: now.toISOString(), type: 'nap', sitterSessionId: null },
    ])
    expect(napShouldEnd(nap, withUnrelatedEnded, new Date(now.getTime() + 5 * 60_000))).toBe(false)
  })

  it('napShouldEnd is true once every tracked sleep has ended', () => {
    const snapshot = snapshotWithSleeps([
      { id: 'tracked-1', childId: 'child-a', startAt: now.toISOString(), endAt: null, type: 'nap', sitterSessionId: null },
      { id: 'tracked-2', childId: 'child-b', startAt: now.toISOString(), endAt: null, type: 'nap', sitterSessionId: null },
    ])
    const nap = startNap(snapshot, now)

    const oneStillOpen = snapshotWithSleeps([
      { id: 'tracked-1', childId: 'child-a', startAt: now.toISOString(), endAt: now.toISOString(), type: 'nap', sitterSessionId: null },
      { id: 'tracked-2', childId: 'child-b', startAt: now.toISOString(), endAt: null, type: 'nap', sitterSessionId: null },
    ])
    expect(napShouldEnd(nap, oneStillOpen, new Date(now.getTime() + 5 * 60_000))).toBe(false)

    const bothEnded = snapshotWithSleeps([
      { id: 'tracked-1', childId: 'child-a', startAt: now.toISOString(), endAt: now.toISOString(), type: 'nap', sitterSessionId: null },
      { id: 'tracked-2', childId: 'child-b', startAt: now.toISOString(), endAt: now.toISOString(), type: 'nap', sitterSessionId: null },
    ])
    expect(napShouldEnd(nap, bothEnded, new Date(now.getTime() + 5 * 60_000))).toBe(true)
  })

  it('napShouldEnd treats a tracked sleep that was discarded (no longer exists) as ended', () => {
    const snapshot = snapshotWithSleeps([
      { id: 'tracked', childId: 'child-a', startAt: now.toISOString(), endAt: null, type: 'nap', sitterSessionId: null },
    ])
    const nap = startNap(snapshot, now)
    const discarded = snapshotWithSleeps([])
    expect(napShouldEnd(nap, discarded, new Date(now.getTime() + 5 * 60_000))).toBe(true)
  })

  it('napShouldEnd with no open sleeps is false until 3 hours have passed', () => {
    const snapshot = snapshotWithSleeps([])
    const nap = startNap(snapshot, now)
    expect(nap.openSleepIds).toEqual([])

    expect(napShouldEnd(nap, snapshot, new Date(now.getTime() + 2 * 60 * 60_000))).toBe(false)
    expect(napShouldEnd(nap, snapshot, new Date(now.getTime() + 3 * 60 * 60_000))).toBe(true)
  })

  it('napShouldEnd is true after 3 hours even if a tracked sleep is still open', () => {
    const snapshot = snapshotWithSleeps([
      { id: 'tracked', childId: 'child-a', startAt: now.toISOString(), endAt: null, type: 'nap', sitterSessionId: null },
    ])
    const nap = startNap(snapshot, now)
    expect(napShouldEnd(nap, snapshot, new Date(now.getTime() + 3 * 60 * 60_000))).toBe(true)
  })
})

describe('useModesStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    resetSoundForTests()
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
  })

  function withHousehold(now: Date, overrides: Partial<HouseholdSnapshot['household']> = {}) {
    vi.setSystemTime(now)
    const householdStore = useHouseholdStore()
    const snapshot = buildDemoSnapshot(now)
    householdStore.snapshot = { ...snapshot, household: { ...snapshot.household, ...overrides } }
    return householdStore
  }

  describe('nightActive', () => {
    it('is true during the household night window', () => {
      withHousehold(new Date('2026-09-15T03:00:00Z'), { timeZone: TZ, nightMode: NIGHT_MODE })
      const modes = useModesStore()
      expect(modes.nightActive).toBe(true)
    })

    it('is false outside the window', () => {
      withHousehold(new Date('2026-09-14T18:00:00Z'), { timeZone: TZ, nightMode: NIGHT_MODE })
      const modes = useModesStore()
      expect(modes.nightActive).toBe(false)
    })

    it('is false with no household loaded yet', () => {
      setActivePinia(createPinia())
      const modes = useModesStore()
      expect(modes.nightActive).toBe(false)
    })
  })

  describe('peek', () => {
    it('suppresses nightActive for 60 seconds, then it resumes', () => {
      withHousehold(new Date('2026-09-15T03:00:00Z'), { timeZone: TZ, nightMode: NIGHT_MODE })
      const modes = useModesStore()
      expect(modes.nightActive).toBe(true)

      modes.peek()
      expect(modes.nightActive).toBe(false)

      vi.advanceTimersByTime(45_000)
      expect(modes.nightActive).toBe(false)

      vi.advanceTimersByTime(30_000)
      expect(modes.nightActive).toBe(true)
    })
  })

  describe('peek clock', () => {
    it('ticks every second during a peek, so the countdown is live and Night Mode returns on time', () => {
      withHousehold(new Date('2026-09-15T03:00:00Z'), { timeZone: TZ, nightMode: NIGHT_MODE })
      const modes = useModesStore()
      vi.advanceTimersByTime(7_000) // between two 15 s ticks
      modes.peek()
      const until = modes.nightPeekUntil!

      vi.advanceTimersByTime(1_000)
      expect(modes.now.getTime()).toBe(until - 59_000)

      vi.advanceTimersByTime(58_000)
      expect(modes.nightActive).toBe(false)
      vi.advanceTimersByTime(1_000)
      expect(modes.nightActive).toBe(true)
    })

    it('goes back to a 15 second tick once the peek is over', () => {
      withHousehold(new Date('2026-09-15T03:00:00Z'), { timeZone: TZ, nightMode: NIGHT_MODE })
      const modes = useModesStore()
      modes.peek()
      vi.advanceTimersByTime(60_000)
      expect(modes.nightActive).toBe(true)
      const at = modes.now.getTime()
      vi.advanceTimersByTime(14_000)
      expect(modes.now.getTime()).toBe(at)
      vi.advanceTimersByTime(1_000)
      expect(modes.now.getTime()).toBe(at + 15_000)
    })

    it('ticks every 15 seconds outside a peek', () => {
      withHousehold(new Date('2026-09-14T18:00:00Z'), { timeZone: TZ, nightMode: NIGHT_MODE })
      const modes = useModesStore()
      const at = modes.now.getTime()
      vi.advanceTimersByTime(14_000)
      expect(modes.now.getTime()).toBe(at)
    })
  })

  describe('night holds (an open sheet keeps Night Mode away)', () => {
    it('a hold taken before the night boundary keeps Night Mode off until it is released', () => {
      withHousehold(new Date('2026-09-14T23:59:45Z'), { timeZone: TZ, nightMode: NIGHT_MODE })
      const modes = useModesStore()
      modes.holdNight('sheet')

      vi.advanceTimersByTime(15_000)
      expect(modes.nightActive).toBe(false)
      expect(modes.peeking).toBe(true)

      modes.releaseNight('sheet')
      expect(modes.nightActive).toBe(true)
      expect(modes.peeking).toBe(false)
    })

    it('needs every hold released, and releasing an unknown key is harmless', () => {
      withHousehold(new Date('2026-09-15T03:00:00Z'), { timeZone: TZ, nightMode: NIGHT_MODE })
      const modes = useModesStore()
      modes.holdNight('a')
      modes.holdNight('b')
      modes.releaseNight('a')
      modes.releaseNight('nope')
      expect(modes.nightActive).toBe(false)
      modes.releaseNight('b')
      expect(modes.nightActive).toBe(true)
    })

    it('a hold outlasts the peek: Night Mode waits for the release', () => {
      withHousehold(new Date('2026-09-15T03:00:00Z'), { timeZone: TZ, nightMode: NIGHT_MODE })
      const modes = useModesStore()
      modes.peek()
      modes.holdNight('sheet')
      vi.advanceTimersByTime(120_000)
      expect(modes.nightActive).toBe(false)
      modes.releaseNight('sheet')
      expect(modes.nightActive).toBe(true)
    })
  })

  describe('extendPeek (a tap on the peeked screen)', () => {
    it('restarts the 60 second peek from the tap', () => {
      withHousehold(new Date('2026-09-15T03:00:00Z'), { timeZone: TZ, nightMode: NIGHT_MODE })
      const modes = useModesStore()
      modes.peek()
      vi.advanceTimersByTime(50_000)
      modes.extendPeek()
      expect(modes.nightPeekUntil).toBe(Date.now() + 60_000)

      vi.advanceTimersByTime(59_000)
      expect(modes.nightActive).toBe(false)
      vi.advanceTimersByTime(1_000)
      expect(modes.nightActive).toBe(true)
    })

    it('does nothing while the Night screen is showing or outside the night window', () => {
      withHousehold(new Date('2026-09-15T03:00:00Z'), { timeZone: TZ, nightMode: NIGHT_MODE })
      const modes = useModesStore()
      modes.extendPeek()
      expect(modes.nightPeekUntil).toBeNull()
      expect(modes.nightActive).toBe(true)

      setActivePinia(createPinia())
      withHousehold(new Date('2026-09-14T18:00:00Z'), { timeZone: TZ, nightMode: NIGHT_MODE })
      const day = useModesStore()
      day.extendPeek()
      expect(day.nightPeekUntil).toBeNull()
    })

    it('starts a peek when a hold is keeping Night Mode away, so closing the sheet with a tap is not abrupt', () => {
      withHousehold(new Date('2026-09-15T03:00:00Z'), { timeZone: TZ, nightMode: NIGHT_MODE })
      const modes = useModesStore()
      modes.holdNight('sheet')
      modes.extendPeek()
      modes.releaseNight('sheet')
      expect(modes.nightActive).toBe(false)
      vi.advanceTimersByTime(75_000)
      expect(modes.nightActive).toBe(true)
    })
  })

  describe('nap', () => {
    it('toggleNap starts a nap that tracks currently open sleeps, and again ends it', () => {
      const householdStore = withHousehold(new Date('2026-09-14T18:00:00Z'))
      const openSleep = { id: 'sleep-x', childId: 'cccccccc-0000-0000-0000-000000000002', startAt: new Date().toISOString(), endAt: null, type: 'nap' as const, sitterSessionId: null }
      householdStore.snapshot = { ...householdStore.snapshot!, sleeps: [...householdStore.snapshot!.sleeps, openSleep] }

      const modes = useModesStore()
      expect(modes.napActive).toBe(false)

      modes.toggleNap()
      expect(modes.napActive).toBe(true)
      expect(modes.nap?.openSleepIds).toContain('sleep-x')

      modes.toggleNap()
      expect(modes.napActive).toBe(false)
      expect(modes.nap).toBeNull()
    })

    it('endNap clears the nap', () => {
      const householdStore = withHousehold(new Date('2026-09-14T18:00:00Z'))
      void householdStore
      const modes = useModesStore()
      modes.toggleNap()
      expect(modes.napActive).toBe(true)
      modes.endNap()
      expect(modes.napActive).toBe(false)
    })

    it('persists nap across store re-creation (localStorage)', () => {
      withHousehold(new Date('2026-09-14T18:00:00Z'))
      const first = useModesStore()
      first.toggleNap()
      const savedNap = first.nap
      expect(savedNap).not.toBeNull()

      setActivePinia(createPinia())
      const second = useModesStore()
      expect(second.nap).toEqual(savedNap)
      expect(second.napActive).toBe(true)
    })

    it('does not persist across a cleared localStorage (private-mode-like failure degrades to no nap)', () => {
      withHousehold(new Date('2026-09-14T18:00:00Z'))
      const first = useModesStore()
      first.toggleNap()
      localStorage.clear()

      setActivePinia(createPinia())
      const second = useModesStore()
      expect(second.nap).toBeNull()
    })
  })

  describe('mute follows modes', () => {
    it('mutes when night becomes active (crossed by the clock alone) and stays unmuted before that', () => {
      // 15s before the 8pm household boundary (2026-09-15T00:00:00Z); useNow's next 15s tick lands on it.
      withHousehold(new Date('2026-09-14T23:59:45Z'), { timeZone: TZ, nightMode: NIGHT_MODE })
      useModesStore()
      expect(isMuted()).toBe(false)

      vi.advanceTimersByTime(15_000)
      expect(isMuted()).toBe(true)
    })

    it('stays muted while peeking at the main screen during the night window', () => {
      withHousehold(new Date('2026-09-15T03:00:00Z'), { timeZone: TZ, nightMode: NIGHT_MODE })
      const modes = useModesStore()
      expect(isMuted()).toBe(true)

      modes.peek()
      expect(modes.nightActive).toBe(false)
      expect(isMuted()).toBe(true)
    })

    it('mutes while a nap is active and unmutes when it ends', () => {
      withHousehold(new Date('2026-09-14T18:00:00Z'))
      const modes = useModesStore()
      expect(isMuted()).toBe(false)

      modes.toggleNap()
      expect(isMuted()).toBe(true)

      modes.endNap()
      expect(isMuted()).toBe(false)
    })
  })
})

// Type-only sanity check that NapState matches the plan's shape.
const _napShape: NapState = { startedAt: '2026-09-14T18:00:00.000Z', openSleepIds: [] }
void _napShape
