import { describe, it, expect } from 'vitest'
import { buildDemoSnapshot } from '@/data/demo/demoFixture'
import type { HouseholdSnapshot, SnapshotChild } from '@/data/snapshot'
import { ageLabel, buildMainScreenModel } from './mainScreenModel'

const now = new Date('2026-09-14T19:00:00Z') // 3:00 PM EDT, Monday

function minimalSnapshot(overrides: Partial<HouseholdSnapshot> = {}): HouseholdSnapshot {
  return {
    household: {
      id: 'h1',
      name: 'Test',
      timeZone: 'America/New_York',
      defaultNightSleep: { start: '18:00', end: '05:00' },
      nightMode: { start: '20:00', end: '06:00' },
      leaveByBufferMin: 20,
      diaperLogEnabled: false,
      dinnerTonight: null,
    },
    members: [],
    children: [],
    medicines: [],
    doses: [],
    sleeps: [],
    feedings: [],
    diapers: [],
    stickerCategories: [],
    stickers: [],
    routines: [],
    routineProgress: [],
    routineOverrides: [],
    jots: [],
    groceries: [],
    activeSitterSession: null,
    loadedAt: now.toISOString(),
    ...overrides,
  }
}

const makeChild = (over: Partial<SnapshotChild> = {}): SnapshotChild => ({
  id: 'kid1',
  name: 'Kid',
  birthday: '2024-09-14', // 24 months old at `now`
  color: '#111111',
  nightSleep: null,
  sortOrder: 0,
  overrides: {},
  ...over,
})

describe('buildMainScreenModel', () => {
  it('formats clock and date', () => {
    const model = buildMainScreenModel(buildDemoSnapshot(now), now)
    expect(model.clock).toBe('3:00 PM')
    expect(model.dateLabel).toBe('Monday, September 14')
  })

  it('layout is full with 2 kids and compact with manyKids', () => {
    const full = buildMainScreenModel(buildDemoSnapshot(now), now)
    expect(full.layout).toBe('full')
    const compact = buildMainScreenModel(buildDemoSnapshot(now, { manyKids: true }), now)
    expect(compact.layout).toBe('compact')
  })

  describe('kid cards from the demo snapshot', () => {
    const model = buildMainScreenModel(buildDemoSnapshot(now), now)
    const theoCard = model.kidCards.find((c) => c.name === 'Theo')!
    const ivyCard = model.kidCards.find((c) => c.name === 'Ivy')!

    it('Theo: age 1 yr, awake 2h 40m, milk 1h 10m ago, kidsCorner off', () => {
      expect(theoCard.ageLabel).toBe('1 yr')
      expect(theoCard.sleep).toEqual({ kind: 'awake', label: 'Awake 2h 40m' })
      expect(theoCard.feeding).toBe('Milk · 1h 10m ago')
      expect(theoCard.nowNext).toBeNull()
    })

    it('Ivy: age 3 yrs, no sleep line, no feeding, Now = Nap, Next = Books', () => {
      expect(ivyCard.ageLabel).toBe('3 yrs')
      expect(ivyCard.sleep).toBeNull()
      expect(ivyCard.feeding).toBeNull()
      expect(ivyCard.nowNext?.now?.label).toBe('Nap')
      expect(ivyCard.nowNext?.next?.label).toBe('Books')
    })

    it('kid cards are ordered by sortOrder', () => {
      expect(model.kidCards.map((c) => c.name)).toEqual(['Ivy', 'Theo'])
    })
  })

  describe('sleep line labels', () => {
    it('shows "Sleeping Xh Ym" while sleeping', () => {
      const snapshot = minimalSnapshot({
        children: [makeChild()],
        sleeps: [{ id: 's1', childId: 'kid1', startAt: new Date(now.getTime() - 45 * 60_000).toISOString(), endAt: null, type: 'nap' }],
      })
      const card = buildMainScreenModel(snapshot, now).kidCards[0]!
      expect(card.sleep).toEqual({ kind: 'sleeping', label: 'Sleeping 45m' })
    })

    it('shows "Still sleeping?" when stale', () => {
      const snapshot = minimalSnapshot({
        children: [makeChild()],
        sleeps: [{ id: 's1', childId: 'kid1', startAt: new Date(now.getTime() - 17 * 3_600_000).toISOString(), endAt: null, type: 'night' }],
      })
      const card = buildMainScreenModel(snapshot, now).kidCards[0]!
      expect(card.sleep).toEqual({ kind: 'stale', label: 'Still sleeping?' })
    })

    it('shows "Log wake-up" when the feature is on with no sleep data', () => {
      const snapshot = minimalSnapshot({ children: [makeChild()], sleeps: [] })
      const card = buildMainScreenModel(snapshot, now).kidCards[0]!
      expect(card.sleep).toEqual({ kind: 'unknown', label: 'Log wake-up' })
    })

    it('shows the sleep line for a child over 3 with a sleep entry started in the last 18h', () => {
      const snapshot = minimalSnapshot({
        children: [makeChild({ id: 'kid2', birthday: '2022-01-01' })], // well over 3 years old
        sleeps: [{ id: 's1', childId: 'kid2', startAt: new Date(now.getTime() - 3 * 3_600_000).toISOString(), endAt: null, type: 'nap' }],
      })
      const card = buildMainScreenModel(snapshot, now).kidCards[0]!
      expect(card.sleep).not.toBeNull()
      expect(card.sleep?.kind).toBe('sleeping')
    })

    it('hides the sleep line for a child over 3 once an open sleep is more than 18h old', () => {
      const snapshot = minimalSnapshot({
        children: [makeChild({ id: 'kid2', birthday: '2022-01-01' })], // well over 3 years old
        sleeps: [{ id: 's1', childId: 'kid2', startAt: new Date(now.getTime() - 20 * 3_600_000).toISOString(), endAt: null, type: 'night' }],
      })
      const card = buildMainScreenModel(snapshot, now).kidCards[0]!
      expect(card.sleep).toBeNull()
    })

    it('hides the sleep line (rather than "Log wake-up") for a child over 3 whose recent entry resolves to unknown status', () => {
      // A closed entry whose end is slightly in the future (e.g. clock skew between
      // devices) is neither "open" nor a valid latest-end, so sleepStatus is 'unknown'.
      const snapshot = minimalSnapshot({
        children: [makeChild({ id: 'kid2', birthday: '2022-01-01' })], // well over 3, wakeWindow off
        sleeps: [{
          id: 's1', childId: 'kid2',
          startAt: new Date(now.getTime() - 2 * 3_600_000).toISOString(),
          endAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
          type: 'nap',
        }],
      })
      const card = buildMainScreenModel(snapshot, now).kidCards[0]!
      expect(card.sleep).toBeNull()
    })

    it('still shows "Log wake-up" for an unknown status when wakeWindow is on', () => {
      const snapshot = minimalSnapshot({
        children: [makeChild()], // default birthday: under 3, wakeWindow on
        sleeps: [{
          id: 's1', childId: 'kid1',
          startAt: new Date(now.getTime() - 2 * 3_600_000).toISOString(),
          endAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
          type: 'nap',
        }],
      })
      const card = buildMainScreenModel(snapshot, now).kidCards[0]!
      expect(card.sleep).toEqual({ kind: 'unknown', label: 'Log wake-up' })
    })
  })

  describe('ageLabel', () => {
    it('formats months, one year, and multiple years', () => {
      expect(ageLabel(5)).toBe('5 mo')
      expect(ageLabel(15)).toBe('1 yr')
      expect(ageLabel(39)).toBe('3 yrs')
    })
  })

  describe('medicine', () => {
    it('shows one line for the Theo ibuprofen dose', () => {
      const model = buildMainScreenModel(buildDemoSnapshot(now), now)
      const theo = buildDemoSnapshot(now).children.find((c) => c.name === 'Theo')!
      expect(model.medicine).toHaveLength(1)
      expect(model.medicine[0]).toEqual({
        doseChildId: theo.id,
        childName: 'Theo',
        childColor: theo.color,
        medicineName: 'Infant ibuprofen',
        givenAt: '1:00 PM',
        givenBy: 'Sam',
        nextAfter: '7:00 PM',
        nextAllowed: false,
      })
    })
  })

  describe('conflicts', () => {
    it('is empty by default', () => {
      const model = buildMainScreenModel(buildDemoSnapshot(now), now)
      expect(model.conflicts).toEqual([])
    })

    it('has one entry with { conflict: true }', () => {
      const snapshot = buildDemoSnapshot(now, { conflict: true })
      const model = buildMainScreenModel(snapshot, now)
      const offline = snapshot.doses.find((d) => d.loggedOffline)!
      expect(model.conflicts).toEqual([
        {
          doseId: offline.id,
          childName: 'Theo',
          medicineName: 'Infant ibuprofen',
          message: 'Theo · Infant ibuprofen logged offline at 2:00 PM by Alex conflicts with another dose.',
        },
      ])
    })
  })

  describe('dinner', () => {
    it('shows dinnerTonight', () => {
      const model = buildMainScreenModel(buildDemoSnapshot(now), now)
      expect(model.dinner).toBe('Tacos')
    })

    it('is null when dinnerTonight is null', () => {
      const snapshot = minimalSnapshot({ household: { ...minimalSnapshot().household, dinnerTonight: null } })
      expect(buildMainScreenModel(snapshot, now).dinner).toBeNull()
    })

    it('is null when dinnerTonight is blank', () => {
      const snapshot = minimalSnapshot({ household: { ...minimalSnapshot().household, dinnerTonight: '   ' } })
      expect(buildMainScreenModel(snapshot, now).dinner).toBeNull()
    })
  })

  describe('logButtons', () => {
    it('has the base 6 buttons without diaper logging', () => {
      const model = buildMainScreenModel(buildDemoSnapshot(now), now)
      expect(model.logButtons).toEqual(['sleep', 'feeding', 'medicine', 'sticker', 'jot', 'grocery'])
    })

    it('adds diaper when diaperLogEnabled', () => {
      const snapshot = minimalSnapshot({ household: { ...minimalSnapshot().household, diaperLogEnabled: true } })
      const model = buildMainScreenModel(snapshot, now)
      expect(model.logButtons).toEqual(['sleep', 'feeding', 'medicine', 'sticker', 'jot', 'grocery', 'diaper'])
    })
  })
})
