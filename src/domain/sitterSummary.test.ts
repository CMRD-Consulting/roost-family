import { describe, it, expect } from 'vitest'
import { sitterSummary } from './sitterSummary'
import type { DoseEntry, FeedingEntry, SleepEntry } from './types'

const session = { startAt: '2026-09-14T22:00:00Z', endAt: '2026-09-15T02:00:00Z' }
const children = [{ id: 'leona' }, { id: 'mara' }]

const sleep = (childId: string, startAt: string, endAt: string | null): SleepEntry => ({
  id: crypto.randomUUID(), childId, startAt, endAt, type: 'night',
})
const feeding = (childId: string, at: string): FeedingEntry => ({
  id: crypto.randomUUID(), childId, at, type: 'milk', amount: '6 oz', note: null,
})
const dose = (childId: string, at: string): DoseEntry => ({
  id: crypto.randomUUID(), childId, medicineId: 'ibu', at, loggedByName: 'Jess (sitter)', loggedOffline: false, voidedAt: null, conflictAcknowledgedAt: null,
})

describe('sitterSummary', () => {
  it('groups entries inside the session by child, oldest first', () => {
    const [leona, mara] = sitterSummary(
      session,
      children,
      {
        sleeps: [sleep('mara', '2026-09-14T23:30:00Z', null), sleep('leona', '2026-09-14T20:00:00Z', '2026-09-14T21:00:00Z')],
        feedings: [feeding('mara', '2026-09-14T23:00:00Z'), feeding('mara', '2026-09-14T22:15:00Z'), feeding('mara', '2026-09-15T03:00:00Z')],
        doses: [dose('leona', '2026-09-14T23:40:00Z')],
        stickers: [],
        diapers: [],
      },
      new Date('2026-09-15T03:00:00Z'),
    )
    expect(leona?.childId).toBe('leona')
    expect(leona?.sleeps).toHaveLength(0) // ended before the session
    expect(leona?.doses).toHaveLength(1)
    expect(mara?.sleeps).toHaveLength(1) // still open, overlaps the session
    expect(mara?.feedings.map((f) => f.at)).toEqual(['2026-09-14T22:15:00Z', '2026-09-14T23:00:00Z'])
  })

  it('uses now as the end of an open session', () => {
    const [, mara] = sitterSummary(
      { startAt: session.startAt, endAt: null },
      children,
      { sleeps: [], feedings: [feeding('mara', '2026-09-15T03:00:00Z')], doses: [], stickers: [], diapers: [] },
      new Date('2026-09-15T04:00:00Z'),
    )
    expect(mara?.feedings).toHaveLength(1)
  })
})
