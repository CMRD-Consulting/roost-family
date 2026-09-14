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
})

describe('unacknowledgedConflicts', () => {
  it('returns offline doses that conflict and are not acknowledged', () => {
    const offline = dose({ id: 'off', at: '2026-09-14T13:00:00Z', loggedOffline: true })
    const acked = dose({ id: 'ack', at: '2026-09-14T13:30:00Z', loggedOffline: true, conflictAcknowledgedAt: '2026-09-14T14:00:00Z' })
    const online = dose({ id: 'on', at: '2026-09-14T12:00:00Z' })
    expect(unacknowledgedConflicts([ibuprofen], [online, offline, acked]).map((d) => d.id)).toEqual(['off'])
  })
})
