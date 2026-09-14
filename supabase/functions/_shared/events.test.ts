import { describe, expect, it } from 'vitest'
import { householdDayWindow, isValidTimeZone, mergeDayEvents, zonedWallTimeToUtc, type SourceEvent } from './events'

const TZ = 'America/New_York'

describe('zonedWallTimeToUtc', () => {
  it('converts wall-clock times on both sides of DST changes', () => {
    const at = (year: number, month: number, day: number, hour: number, minute = 0) =>
      zonedWallTimeToUtc({ year, month, day, hour, minute, second: 0 }, TZ).toISOString()
    expect(at(2026, 9, 14, 9, 30)).toBe('2026-09-14T13:30:00.000Z')
    expect(at(2026, 12, 1, 9)).toBe('2026-12-01T14:00:00.000Z')
    expect(at(2026, 11, 1, 0, 30)).toBe('2026-11-01T04:30:00.000Z')
    expect(at(2026, 11, 1, 3, 30)).toBe('2026-11-01T08:30:00.000Z')
    expect(at(2026, 3, 8, 3)).toBe('2026-03-08T07:00:00.000Z')
    expect(zonedWallTimeToUtc({ year: 2026, month: 9, day: 14, hour: 0, minute: 0, second: 0 }, 'UTC').toISOString()).toBe(
      '2026-09-14T00:00:00.000Z',
    )
  })
})

describe('householdDayWindow', () => {
  it("returns today's midnight-to-midnight in the household zone", () => {
    const w = householdDayWindow(new Date('2026-09-14T03:59:00Z'), TZ)
    expect(w.dayStartUtc.toISOString()).toBe('2026-09-13T04:00:00.000Z')
    expect(w.dayEndUtc.toISOString()).toBe('2026-09-14T04:00:00.000Z')
  })

  it('is 25 hours long on the fall-back day and 23 on the spring-forward day', () => {
    const fall = householdDayWindow(new Date('2026-11-01T12:00:00Z'), TZ)
    expect(fall.dayStartUtc.toISOString()).toBe('2026-11-01T04:00:00.000Z')
    expect(fall.dayEndUtc.toISOString()).toBe('2026-11-02T05:00:00.000Z')
    const spring = householdDayWindow(new Date('2026-03-08T12:00:00Z'), TZ)
    expect(spring.dayEndUtc.getTime() - spring.dayStartUtc.getTime()).toBe(23 * 3_600_000)
  })

  it('crosses month and year boundaries', () => {
    const w = householdDayWindow(new Date('2026-12-31T20:00:00Z'), TZ)
    expect(w.dayStartUtc.toISOString()).toBe('2026-12-31T05:00:00.000Z')
    expect(w.dayEndUtc.toISOString()).toBe('2027-01-01T05:00:00.000Z')
  })
})

describe('isValidTimeZone', () => {
  it('accepts IANA names and rejects others', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true)
    expect(isValidTimeZone('UTC')).toBe(true)
    expect(isValidTimeZone('Eastern Standard Time')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
  })
})

describe('mergeDayEvents', () => {
  const window = householdDayWindow(new Date('2026-09-14T16:00:00Z'), TZ)
  const sam = { personType: 'member' as const, personId: 'm-sam', calendarColor: '#3366ff' }
  const mara = { personType: 'child' as const, personId: 'c-mara', calendarColor: '#ff8800' }
  const ev = (title: string, startAt: string, endAt: string, extra: Partial<SourceEvent> = {}): SourceEvent => ({
    title,
    startAt,
    endAt,
    allDay: false,
    location: null,
    ...extra,
  })

  it('attaches person and color, sorts all-day first then by start, and drops everything else', () => {
    const merged = mergeDayEvents(
      [
        {
          selection: sam,
          events: [
            ev('Dentist', '2026-09-14T13:30:00.000Z', '2026-09-14T14:30:00.000Z', { location: '12 Oak St' }),
            {
              ...ev('Leaky', '2026-09-14T12:00:00.000Z', '2026-09-14T12:30:00.000Z'),
              description: 'secret notes',
              attendees: ['a@example.com'],
              url: 'https://example.com',
              organizer: 'boss@example.com',
            } as SourceEvent,
          ],
        },
        {
          selection: mara,
          events: [
            ev('Soccer', '2026-09-14T20:00:00.000Z', '2026-09-14T21:00:00.000Z'),
            ev('Teacher workday', '2026-09-14T04:00:00.000Z', '2026-09-15T04:00:00.000Z', { allDay: true }),
          ],
        },
      ],
      window,
    )
    expect(merged).toEqual([
      {
        title: 'Teacher workday',
        startAt: '2026-09-14T04:00:00.000Z',
        endAt: '2026-09-15T04:00:00.000Z',
        allDay: true,
        location: null,
        personType: 'child',
        personId: 'c-mara',
        calendarColor: '#ff8800',
      },
      {
        title: 'Leaky',
        startAt: '2026-09-14T12:00:00.000Z',
        endAt: '2026-09-14T12:30:00.000Z',
        allDay: false,
        location: null,
        personType: 'member',
        personId: 'm-sam',
        calendarColor: '#3366ff',
      },
      {
        title: 'Dentist',
        startAt: '2026-09-14T13:30:00.000Z',
        endAt: '2026-09-14T14:30:00.000Z',
        allDay: false,
        location: '12 Oak St',
        personType: 'member',
        personId: 'm-sam',
        calendarColor: '#3366ff',
      },
      {
        title: 'Soccer',
        startAt: '2026-09-14T20:00:00.000Z',
        endAt: '2026-09-14T21:00:00.000Z',
        allDay: false,
        location: null,
        personType: 'child',
        personId: 'c-mara',
        calendarColor: '#ff8800',
      },
    ])
  })

  it('keeps events overlapping the day (including in-progress ones) and drops the rest', () => {
    const merged = mergeDayEvents(
      [
        {
          selection: sam,
          events: [
            ev('In progress', '2026-09-14T02:00:00.000Z', '2026-09-14T05:00:00.000Z'),
            ev('Ended at midnight', '2026-09-14T03:00:00.000Z', '2026-09-14T04:00:00.000Z'),
            ev('Tomorrow', '2026-09-15T04:00:00.000Z', '2026-09-15T05:00:00.000Z'),
            ev('Instant at midnight', '2026-09-14T04:00:00.000Z', '2026-09-14T04:00:00.000Z'),
            ev('Bad date', 'not a date', '2026-09-14T05:00:00.000Z'),
          ],
        },
      ],
      window,
    )
    expect(merged.map((e) => e.title)).toEqual(['In progress', 'Instant at midnight'])
  })

  it('normalizes titles and locations: trims, caps length, and blanks become defaults', () => {
    const merged = mergeDayEvents(
      [
        {
          selection: sam,
          events: [
            ev('  ', '2026-09-14T13:00:00.000Z', '2026-09-14T14:00:00.000Z', { location: '   ' }),
            ev('T'.repeat(500), '2026-09-14T15:00:00.000Z', '2026-09-14T16:00:00.000Z', { location: 'L'.repeat(500) }),
          ],
        },
      ],
      window,
    )
    expect(merged[0]).toMatchObject({ title: '(No title)', location: null })
    expect(merged[1]!.title.length).toBeLessThanOrEqual(200)
    expect(merged[1]!.location!.length).toBeLessThanOrEqual(200)
  })

  it('orders same-start events by end and then title so output is stable', () => {
    const merged = mergeDayEvents(
      [
        { selection: mara, events: [ev('B', '2026-09-14T13:00:00.000Z', '2026-09-14T15:00:00.000Z')] },
        { selection: sam, events: [ev('C', '2026-09-14T13:00:00.000Z', '2026-09-14T14:00:00.000Z'), ev('A', '2026-09-14T13:00:00.000Z', '2026-09-14T15:00:00.000Z')] },
      ],
      window,
    )
    expect(merged.map((e) => e.title)).toEqual(['C', 'A', 'B'])
  })
})
