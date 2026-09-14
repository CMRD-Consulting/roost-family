import { describe, it, expect } from 'vitest'
import { sitterSummary } from './sitterSummary'
import { STALE_SLEEP_MS } from './sleep'
import type { DoseEntry, FeedingEntry, SleepEntry } from './types'

const SESSION = 'session-1'
const session = { id: SESSION, startAt: '2026-09-14T22:00:00Z', endAt: '2026-09-15T02:00:00Z' }
const children = [{ id: 'leona' }, { id: 'mara' }]

const sleep = (childId: string, startAt: string, endAt: string | null, sitterSessionId: string | null = SESSION): SleepEntry => ({
  id: crypto.randomUUID(), childId, startAt, endAt, type: 'night', sitterSessionId,
})
const feeding = (childId: string, at: string, sitterSessionId: string | null = SESSION): FeedingEntry => ({
  id: crypto.randomUUID(), childId, at, type: 'milk', amount: '6 oz', note: null, sitterSessionId,
})
const dose = (childId: string, at: string, sitterSessionId: string | null = SESSION): DoseEntry => ({
  id: crypto.randomUUID(),
  childId,
  medicineId: 'ibu',
  at,
  loggedByName: sitterSessionId ? 'Jess (sitter)' : 'Sam',
  loggedOffline: false,
  voidedAt: null,
  conflictAcknowledgedAt: null,
  createdAt: at,
  note: null,
  warningsConfirmed: [],
  sitterSessionId,
})
const empty = { sleeps: [], feedings: [], doses: [], stickers: [], diapers: [] }
const later = new Date('2026-09-15T03:00:00Z')

describe('sitterSummary', () => {
  it('groups the entries logged in the session by child, oldest first', () => {
    const [leona, mara] = sitterSummary(
      session,
      children,
      {
        ...empty,
        sleeps: [sleep('mara', '2026-09-14T23:30:00Z', null)],
        feedings: [feeding('mara', '2026-09-14T23:00:00Z'), feeding('mara', '2026-09-14T22:15:00Z')],
        doses: [dose('leona', '2026-09-14T23:40:00Z')],
      },
      later,
    )
    expect(leona?.childId).toBe('leona')
    expect(leona?.sleeps).toHaveLength(0)
    expect(leona?.doses).toHaveLength(1)
    expect(mara?.sleeps).toHaveLength(1)
    expect(mara?.feedings.map((f) => f.at)).toEqual(['2026-09-14T22:15:00Z', '2026-09-14T23:00:00Z'])
  })

  it("includes the sitter's backdated feeding from before the session started", () => {
    const [, mara] = sitterSummary(session, children, { ...empty, feedings: [feeding('mara', '2026-09-14T21:30:00Z')] }, later)
    expect(mara?.feedings).toHaveLength(1)
  })

  it("leaves out a parent's dose logged during the session window", () => {
    const [leona] = sitterSummary(
      session,
      children,
      { ...empty, doses: [dose('leona', '2026-09-14T23:00:00Z', null), dose('leona', '2026-09-14T23:10:00Z', 'other-session')] },
      later,
    )
    expect(leona?.doses).toHaveLength(0)
  })

  it("includes a sitter log whose time is after the session ended (the device's clock was off)", () => {
    const [, mara] = sitterSummary(session, children, { ...empty, feedings: [feeding('mara', '2026-09-15T02:20:00Z')] }, later)
    expect(mara?.feedings).toHaveLength(1)
  })

  it("leaves out a parent's sleep that overlaps the session", () => {
    const [, mara] = sitterSummary(
      session,
      children,
      { ...empty, sleeps: [sleep('mara', '2026-09-14T21:00:00Z', '2026-09-14T23:00:00Z', null)] },
      later,
    )
    expect(mara?.sleeps).toHaveLength(0)
  })

  it('uses now as the end of an open session', () => {
    const recentStart = new Date(Date.parse('2026-09-15T04:00:00Z') - STALE_SLEEP_MS + 60_000).toISOString()
    const [, mara] = sitterSummary(
      { ...session, endAt: null },
      children,
      { ...empty, sleeps: [sleep('mara', recentStart, null)] },
      new Date('2026-09-15T04:00:00Z'),
    )
    expect(mara?.sleeps).toHaveLength(1)
  })

  it('excludes a still-open sleep that started long before the session ended (stale, not "still going")', () => {
    const staleStart = new Date(Date.parse(session.endAt) - STALE_SLEEP_MS - 60_000).toISOString()
    const [, mara] = sitterSummary(session, children, { ...empty, sleeps: [sleep('mara', staleStart, null)] }, later)
    expect(mara?.sleeps).toHaveLength(0)
  })

  it('keeps an open sleep that started within the stale window before the session ended', () => {
    const recentStart = new Date(Date.parse(session.endAt) - STALE_SLEEP_MS + 60_000).toISOString()
    const [, mara] = sitterSummary(session, children, { ...empty, sleeps: [sleep('mara', recentStart, null)] }, later)
    expect(mara?.sleeps).toHaveLength(1)
  })
})
