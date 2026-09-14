import { describe, it, expect } from 'vitest'
import { classifySleep, nightWindowFor, sleepStatus, STALE_SLEEP_MS, WAKE_WINDOW_LOOKBACK_MS } from './sleep'
import type { SleepEntry } from './types'

const NY = 'America/New_York'
const householdDefault = { start: '18:00', end: '05:00' }

const entry = (over: Partial<SleepEntry>): SleepEntry => ({
  id: crypto.randomUUID(),
  childId: 'mara',
  startAt: '2026-09-14T17:00:00Z',
  endAt: null,
  type: 'nap',
  sitterSessionId: null,
  ...over,
})

describe('nightWindowFor', () => {
  it('uses the child window when set, else the household default', () => {
    expect(nightWindowFor({ nightSleep: null }, householdDefault)).toEqual(householdDefault)
    expect(nightWindowFor({ nightSleep: { start: '19:00', end: '06:00' } }, householdDefault)).toEqual({
      start: '19:00',
      end: '06:00',
    })
  })
})

describe('classifySleep', () => {
  it('is night inside the window and nap outside', () => {
    expect(classifySleep(new Date('2026-09-14T22:15:00Z'), householdDefault, NY)).toBe('night') // 18:15
    expect(classifySleep(new Date('2026-09-14T17:00:00Z'), householdDefault, NY)).toBe('nap') // 13:00
  })
  it('respects a later per-child bedtime', () => {
    expect(classifySleep(new Date('2026-09-14T22:30:00Z'), { start: '19:00', end: '06:00' }, NY)).toBe('nap') // 18:30
  })
})

describe('sleepStatus', () => {
  const now = new Date('2026-09-14T20:00:00Z') // 16:00 EDT

  it('is sleeping when an entry is open', () => {
    const s = sleepStatus([entry({ startAt: '2026-09-14T19:15:00Z' })], 'mara', now)
    expect(s).toEqual({ kind: 'sleeping', since: new Date('2026-09-14T19:15:00Z'), durationMs: 45 * 60_000 })
  })

  it('is awake since the most recent sleep that ended within the last 18 hours', () => {
    const s = sleepStatus(
      [
        entry({ startAt: '2026-09-14T13:00:00Z', endAt: '2026-09-14T14:00:00Z' }),
        entry({ startAt: '2026-09-14T16:30:00Z', endAt: '2026-09-14T17:20:00Z' }),
      ],
      'mara',
      now,
    )
    expect(s).toEqual({ kind: 'awake', since: new Date('2026-09-14T17:20:00Z'), durationMs: 160 * 60_000 })
  })

  it('counts a night sleep that ended this morning', () => {
    const s = sleepStatus(
      [entry({ startAt: '2026-09-13T23:00:00Z', endAt: '2026-09-14T10:30:00Z', type: 'night' })],
      'mara',
      now,
    )
    expect(s.kind).toBe('awake')
  })

  it('is unknown when nothing ended in the last 18 hours', () => {
    const s = sleepStatus([entry({ startAt: '2026-09-13T17:00:00Z', endAt: '2026-09-13T18:00:00Z' })], 'mara', now)
    expect(s).toEqual({ kind: 'unknown' })
  })

  it('ignores other children', () => {
    const s = sleepStatus([entry({ childId: 'leona', startAt: '2026-09-14T19:00:00Z' })], 'mara', now)
    expect(s).toEqual({ kind: 'unknown' })
  })

  it('crosses midnight: a sleep that ended at 23:50 still counts at 00:10', () => {
    const s = sleepStatus(
      [entry({ startAt: '2026-09-14T23:00:00Z', endAt: '2026-09-14T23:50:00Z' })],
      'mara',
      new Date('2026-09-15T00:10:00Z'),
    )
    expect(s).toEqual({ kind: 'awake', since: new Date('2026-09-14T23:50:00Z'), durationMs: 20 * 60_000 })
  })

  it('ignores an open entry superseded by a later sleep that ended after it started', () => {
    const s = sleepStatus(
      [
        // Stray open entry, superseded by the closed entry below which ended after this one started.
        entry({ id: 'stray', startAt: '2026-09-14T15:00:00Z', endAt: null }),
        entry({ startAt: '2026-09-14T14:00:00Z', endAt: '2026-09-14T16:00:00Z' }),
      ],
      'mara',
      now,
    )
    expect(s).toEqual({ kind: 'awake', since: new Date('2026-09-14T16:00:00Z'), durationMs: 4 * 60 * 60_000 })
  })

  it('reports a stale open sleep that started more than 16 hours ago', () => {
    const since = new Date(now.getTime() - 17 * 60 * 60_000)
    const s = sleepStatus([entry({ startAt: since.toISOString() })], 'mara', now)
    expect(s).toEqual({ kind: 'stale', since })
  })

  it('does not treat a sleep right at the stale threshold as stale', () => {
    const since = new Date(now.getTime() - (STALE_SLEEP_MS - 60_000))
    const s = sleepStatus([entry({ startAt: since.toISOString() })], 'mara', now)
    expect(s.kind).toBe('sleeping')
  })

  it('clamps a negative duration to 0 for an open entry starting in the future', () => {
    const future = new Date(now.getTime() + 60 * 60_000)
    const s = sleepStatus([entry({ startAt: future.toISOString() })], 'mara', now)
    expect(s).toEqual({ kind: 'sleeping', since: future, durationMs: 0 })
  })

  it('exports the thresholds used', () => {
    expect(STALE_SLEEP_MS).toBe(16 * 60 * 60_000)
    expect(WAKE_WINDOW_LOOKBACK_MS).toBe(18 * 60 * 60_000)
  })
})
