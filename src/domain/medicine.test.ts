import { describe, it, expect } from 'vitest'
import { checkDose, nextDoseAfter, recentDoses, unacknowledgedConflicts } from './medicine'
import type { DoseEntry, Medicine } from './types'

const H = 3_600_000
const ibuprofen: Medicine = { id: 'ibu', childId: 'mara', name: 'Infant ibuprofen', minIntervalHours: 6, maxDosesPer24h: 4 }
const tylenol: Medicine = { id: 'tyl', childId: 'mara', name: 'Infant acetaminophen', minIntervalHours: 4, maxDosesPer24h: null }

const dose = (over: Partial<DoseEntry>): DoseEntry => ({
  id: crypto.randomUUID(),
  childId: 'mara',
  medicineId: 'ibu',
  at: '2026-09-14T12:00:00Z',
  loggedByName: 'Sam',
  loggedOffline: false,
  voidedAt: null,
  conflictAcknowledgedAt: null,
  ...over,
})

describe('nextDoseAfter', () => {
  it('adds the minimum interval', () => {
    expect(nextDoseAfter(dose({ at: '2026-09-14T19:10:00Z' }), ibuprofen).toISOString()).toBe('2026-09-15T01:10:00.000Z')
  })
})

describe('checkDose', () => {
  it('warns when too early, naming who gave the nearest dose', () => {
    const at = new Date('2026-09-14T15:20:00Z')
    expect(checkDose(ibuprofen, [dose({ at: '2026-09-14T12:00:00Z' })], at)).toEqual([
      {
        kind: 'early',
        nearestDoseAt: new Date('2026-09-14T12:00:00Z'),
        nearestDoseBy: 'Sam',
        elapsedMs: 200 * 60_000,
        minIntervalHours: 6,
      },
    ])
  })

  it('does not warn at exactly the interval', () => {
    expect(checkDose(ibuprofen, [dose({ at: '2026-09-14T12:00:00Z' })], new Date('2026-09-14T18:00:00Z'))).toEqual([])
  })

  it('warns for a backdated dose close to a later one', () => {
    const warnings = checkDose(ibuprofen, [dose({ at: '2026-09-14T12:00:00Z' })], new Date('2026-09-14T10:00:00Z'))
    expect(warnings.map((w) => w.kind)).toEqual(['early'])
  })

  it('warns when over the daily maximum', () => {
    const doses = ['T00:00', 'T06:00', 'T12:00', 'T18:00'].map((t) => dose({ at: `2026-09-14${t}:00Z` }))
    expect(checkDose(ibuprofen, doses, new Date('2026-09-14T23:30:00Z'))).toContainEqual({
      kind: 'overMax',
      doseNumber: 5,
      max: 4,
    })
  })

  it('counts a 24h window on either side of a backdated dose', () => {
    // Doses at 00:00, 06:00, 18:00, 23:00; checking a backdated dose at 12:00.
    // The window [00:00, 24:00) holds all four existing doses plus the checked one = 5.
    const doses = ['T00:00', 'T06:00', 'T18:00', 'T23:00'].map((t) => dose({ at: `2026-09-14${t}:00Z` }))
    expect(checkDose(ibuprofen, doses, new Date('2026-09-14T12:00:00Z'))).toContainEqual({
      kind: 'overMax',
      doseNumber: 5,
      max: 4,
    })
  })

  it('counts doses given after the checked dose toward its window', () => {
    // Checking 10:00 with later doses at 12, 14, 16, 18 — the window starting at
    // the checked dose covers all five doses.
    const doses = ['T12:00', 'T14:00', 'T16:00', 'T18:00'].map((t) => dose({ at: `2026-09-14${t}:00Z` }))
    expect(checkDose(ibuprofen, doses, new Date('2026-09-14T10:00:00Z'))).toContainEqual({
      kind: 'overMax',
      doseNumber: 5,
      max: 4,
    })
  })

  it('does not count two doses exactly 24h apart in the same window', () => {
    const strict: Medicine = { ...ibuprofen, maxDosesPer24h: 2 }
    const doses = [dose({ at: '2026-09-13T12:00:00Z' }), dose({ at: '2026-09-14T00:00:00Z' })]
    // If the 13th's noon dose combined with the 14th's midnight dose and the checked
    // dose in one window, that would be 3 (over max 2). It should only ever be 2.
    expect(checkDose(strict, doses, new Date('2026-09-14T12:00:00Z'))).toEqual([])
  })

  it('ignores voided doses, other medicines, and the dose being checked', () => {
    const own = dose({ id: 'self', at: '2026-09-14T12:00:00Z' })
    const doses = [
      own,
      dose({ at: '2026-09-14T11:00:00Z', voidedAt: '2026-09-14T11:05:00Z' }),
      dose({ medicineId: 'tyl', at: '2026-09-14T11:30:00Z' }),
    ]
    expect(checkDose(ibuprofen, doses, new Date('2026-09-14T12:00:00Z'), 'self')).toEqual([])
  })

  it('skips the max check when no maximum is set', () => {
    const doses = ['T00:00', 'T04:00', 'T08:00', 'T12:00', 'T16:00'].map((t) =>
      dose({ medicineId: 'tyl', at: `2026-09-14${t}:00Z` }),
    )
    expect(checkDose(tylenol, doses, new Date('2026-09-14T20:00:00Z'))).toEqual([])
  })
})

describe('recentDoses', () => {
  it('returns the latest active dose per medicine in the last 24h', () => {
    const now = new Date('2026-09-14T21:00:00Z')
    const summaries = recentDoses(
      [ibuprofen, tylenol],
      [
        dose({ at: '2026-09-14T13:00:00Z' }),
        dose({ at: '2026-09-14T19:10:00Z', loggedByName: 'Jess (sitter)' }),
        dose({ medicineId: 'tyl', at: '2026-09-13T18:00:00Z' }),
      ],
      now,
    )
    expect(summaries).toEqual([
      {
        childId: 'mara',
        medicineId: 'ibu',
        medicineName: 'Infant ibuprofen',
        givenAt: new Date('2026-09-14T19:10:00Z'),
        givenBy: 'Jess (sitter)',
        nextAfter: new Date('2026-09-15T01:10:00Z'),
        nextAllowed: false,
      },
    ])
  })

  it('marks the next dose allowed once the time has passed', () => {
    const [s] = recentDoses([ibuprofen], [dose({ at: '2026-09-14T12:00:00Z' })], new Date('2026-09-14T18:00:00Z'))
    expect(s?.nextAllowed).toBe(true)
  })

  it('still shows a dose logged a few minutes in the future', () => {
    const now = new Date('2026-09-14T12:00:00Z')
    const [s] = recentDoses([ibuprofen], [dose({ at: '2026-09-14T12:05:00Z' })], now)
    expect(s?.givenAt).toEqual(new Date('2026-09-14T12:05:00Z'))
    expect(s?.nextAllowed).toBe(false)
  })
})

describe('unacknowledgedConflicts', () => {
  it('returns offline doses that conflict and are not acknowledged', () => {
    const offline = dose({ id: 'off', at: '2026-09-14T13:00:00Z', loggedOffline: true })
    const acked = dose({ id: 'ack', at: '2026-09-14T13:30:00Z', loggedOffline: true, conflictAcknowledgedAt: '2026-09-14T14:00:00Z' })
    const online = dose({ id: 'on', at: '2026-09-14T12:00:00Z' })
    expect(unacknowledgedConflicts([ibuprofen], [online, offline, acked]).map((d) => d.id)).toEqual(['off'])
  })
})
