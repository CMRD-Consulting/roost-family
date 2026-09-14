import { describe, expect, it } from 'vitest'
import { buildDemoSnapshot } from '@/data/demo/demoFixture'
import type { HouseholdSnapshot } from '@/data/snapshot'
import type { DoseWarning } from '@/domain/medicine'
import type { Medicine } from '@/domain/types'
import {
  attributionFor, defaultChildId, doseWarningMessages, eligibleChildren, feedingAmounts,
  medicineScheduleLabel, openSleepFor, startedAtLabel, visibleGroceries,
} from './logSheetModel'

const now = new Date('2026-09-14T19:00:00Z') // 3:00 PM EDT
const H = 3_600_000
const IVY = 'cccccccc-0000-0000-0000-000000000001' // 3 y
const THEO = 'cccccccc-0000-0000-0000-000000000002' // 15 mo
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()
const ids = (s: HouseholdSnapshot, kind: Parameters<typeof eligibleChildren>[1]) =>
  eligibleChildren(s, kind, now).map((c) => c.id)

describe('eligibleChildren', () => {
  it('sleep: children with the wake window enabled (Theo), not Ivy with no recent sleep', () => {
    expect(ids(buildDemoSnapshot(now), 'sleep')).toEqual([THEO])
  })

  it('sleep: includes an older child who has a sleep started in the last 18 h', () => {
    const s = buildDemoSnapshot(now)
    s.sleeps.push({ id: 's-ivy', childId: IVY, startAt: ago(17 * H), endAt: ago(6 * H), type: 'night' })
    expect(ids(s, 'sleep')).toEqual([IVY, THEO])
    s.sleeps = s.sleeps.map((e) => (e.id === 's-ivy' ? { ...e, startAt: ago(19 * H) } : e))
    expect(ids(s, 'sleep')).toEqual([THEO])
  })

  it('feeding: Theo only; sticker: Ivy only', () => {
    const s = buildDemoSnapshot(now)
    expect(ids(s, 'feeding')).toEqual([THEO])
    expect(ids(s, 'sticker')).toEqual([IVY])
  })

  it('diaper: nobody while the household has diaper logging off; honors per-child overrides when on', () => {
    const s = buildDemoSnapshot(now)
    expect(ids(s, 'diaper')).toEqual([])
    s.household.diaperLogEnabled = true
    s.children = s.children.map((c) => (c.id === IVY ? { ...c, overrides: { diaper: false } } : c))
    expect(ids(s, 'diaper')).toEqual([THEO])
  })

  it('medicine: children with at least one medicine', () => {
    const s = buildDemoSnapshot(now)
    expect(ids(s, 'medicine')).toEqual([IVY, THEO])
    s.medicines = s.medicines.filter((m) => m.childId !== IVY)
    expect(ids(s, 'medicine')).toEqual([THEO])
  })

  it('orders by sortOrder and returns nothing for jots and groceries', () => {
    const s = buildDemoSnapshot(now)
    s.children = s.children.map((c) => ({ ...c, sortOrder: c.id === IVY ? 5 : 0 }))
    expect(ids(s, 'medicine')).toEqual([THEO, IVY])
    expect(ids(s, 'jot')).toEqual([])
    expect(ids(s, 'grocery')).toEqual([])
  })
})

describe('defaultChildId', () => {
  it('is the only child when there is exactly one, else null', () => {
    const s = buildDemoSnapshot(now)
    expect(defaultChildId([s.children[1]!])).toBe(THEO)
    expect(defaultChildId(s.children)).toBeNull()
    expect(defaultChildId([])).toBeNull()
  })
})

describe('openSleepFor', () => {
  it('returns null when every sleep has ended', () => {
    expect(openSleepFor(buildDemoSnapshot(now), THEO)).toBeNull()
  })

  it('returns the latest open sleep for that child only', () => {
    const s = buildDemoSnapshot(now)
    s.sleeps.push(
      { id: 'open-old', childId: THEO, startAt: ago(90 * 60_000), endAt: null, type: 'nap' },
      { id: 'open-new', childId: THEO, startAt: ago(30 * 60_000), endAt: null, type: 'nap' },
      { id: 'open-ivy', childId: IVY, startAt: ago(10 * 60_000), endAt: null, type: 'nap' },
    )
    expect(openSleepFor(s, THEO)?.id).toBe('open-new')
    expect(openSleepFor(s, IVY)?.id).toBe('open-ivy')
  })

  it('ignores an open sleep followed by a later ended sleep', () => {
    const s = buildDemoSnapshot(now)
    s.sleeps.push({ id: 'stray', childId: THEO, startAt: ago(5 * H), endAt: null, type: 'nap' })
    expect(openSleepFor(s, THEO)).toBeNull()
  })
})

describe('medicineScheduleLabel', () => {
  it('shows the interval and the daily maximum, dropping a trailing .0', () => {
    expect(medicineScheduleLabel({ id: 'm', childId: THEO, name: 'X', minIntervalHours: 6, maxDosesPer24h: 4 })).toBe('Every 6h · max 4/day')
    expect(medicineScheduleLabel({ id: 'm', childId: THEO, name: 'X', minIntervalHours: 4.5, maxDosesPer24h: null })).toBe('Every 4.5h')
  })
})

describe('doseWarningMessages', () => {
  const med: Medicine = { id: 'm', childId: THEO, name: 'Infant ibuprofen', minIntervalHours: 6, maxDosesPer24h: 4 }
  const early = (over: Partial<Extract<DoseWarning, { kind: 'early' }>>): DoseWarning => ({
    kind: 'early', nearestDoseAt: now, nearestDoseBy: 'Sam', gapMs: 3 * H + 20 * 60_000,
    direction: 'before', minIntervalHours: 6, ...over,
  })

  it('formats early-before with the logger', () => {
    expect(doseWarningMessages([early({})], med)).toEqual(['Last dose was 3h 20m ago by Sam. Minimum is 6h.'])
  })

  it('formats early-after without a logger', () => {
    expect(doseWarningMessages([early({ direction: 'after', nearestDoseBy: null, gapMs: 45 * 60_000 })], med)).toEqual([
      'Another dose was logged 45m after this time. Minimum is 6h.',
    ])
  })

  it('formats over-max and keeps fractional hours', () => {
    const half = { ...med, minIntervalHours: 4.5 }
    expect(doseWarningMessages([early({}), { kind: 'overMax', doseNumber: 5, max: 4 }], half)).toEqual([
      'Last dose was 3h 20m ago by Sam. Minimum is 4.5h.',
      'This would be dose 5 in 24 hours. Maximum is 4.',
    ])
  })
})

describe('attributionFor', () => {
  const members = buildDemoSnapshot(now).members

  it('includes the display and the chosen adult with their name', () => {
    expect(attributionFor({ displayId: 'd1' }, members[0]!.id, members)).toEqual({
      displayId: 'd1', loggedByMembershipId: members[0]!.id, sitterSessionId: null, loggedByName: 'Sam',
    })
  })

  it('leaves the adult empty when nobody was picked or there is no display', () => {
    expect(attributionFor(null, null, members)).toEqual({
      displayId: null, loggedByMembershipId: null, sitterSessionId: null, loggedByName: null,
    })
  })
})

describe('startedAtLabel', () => {
  const tz = 'America/New_York'
  it('says today, yesterday, or the date', () => {
    expect(startedAtLabel(new Date('2026-09-14T13:05:00Z'), now, tz)).toBe('9:05 AM today')
    expect(startedAtLabel(new Date('2026-09-14T00:02:00Z'), now, tz)).toBe('8:02 PM yesterday')
    expect(startedAtLabel(new Date('2026-09-12T00:02:00Z'), now, tz)).toBe('8:02 PM on Sep 11')
  })
})

describe('feedingAmounts', () => {
  it('uses ounces for milk and portions for meals and snacks', () => {
    expect(feedingAmounts('milk')).toEqual(['2 oz', '4 oz', '6 oz', '8 oz'])
    expect(feedingAmounts('meal')).toEqual(['A little', 'Some', 'All'])
    expect(feedingAmounts('snack')).toEqual(['A little', 'Some', 'All'])
  })
})

describe('visibleGroceries', () => {
  it('lists unchecked first, then items checked within 24 h, hiding older checked items', () => {
    const items = [
      { id: 'a', text: 'A', createdAt: ago(5 * H), checkedAt: ago(H) },
      { id: 'b', text: 'B', createdAt: ago(4 * H), checkedAt: null },
      { id: 'c', text: 'C', createdAt: ago(30 * H), checkedAt: ago(25 * H) },
      { id: 'd', text: 'D', createdAt: ago(6 * H), checkedAt: null },
    ]
    expect(visibleGroceries(items, now).map((i) => i.id)).toEqual(['d', 'b', 'a'])
  })
})
