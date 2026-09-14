import { describe, it, expect } from 'vitest'
import {
  parseHourMinute,
  minutesOfDay,
  isInWindow,
  householdDate,
  startOfHouseholdDay,
  householdWeekday,
  formatDuration,
  formatClock,
} from './time'

const NY = 'America/New_York'

describe('parseHourMinute', () => {
  it('parses HH:mm to minutes', () => {
    expect(parseHourMinute('18:00')).toBe(1080)
    expect(parseHourMinute('05:30')).toBe(330)
  })
  it('rejects invalid times', () => {
    expect(() => parseHourMinute('24:00')).toThrow()
    expect(() => parseHourMinute('7:00')).toThrow()
  })
})

describe('minutesOfDay', () => {
  it('uses the household time zone', () => {
    // 22:10Z = 18:10 EDT
    expect(minutesOfDay(new Date('2026-09-14T22:10:00Z'), NY)).toBe(18 * 60 + 10)
  })
})

describe('isInWindow', () => {
  const night = { start: '18:00', end: '05:00' }
  it('handles windows that cross midnight', () => {
    expect(isInWindow(new Date('2026-09-14T22:10:00Z'), night, NY)).toBe(true) // 18:10
    expect(isInWindow(new Date('2026-09-15T08:30:00Z'), night, NY)).toBe(true) // 04:30
    expect(isInWindow(new Date('2026-09-14T13:00:00Z'), night, NY)).toBe(false) // 09:00
  })
  it('treats the end as exclusive and the start as inclusive', () => {
    expect(isInWindow(new Date('2026-09-15T09:00:00Z'), night, NY)).toBe(false) // 05:00
    expect(isInWindow(new Date('2026-09-14T22:00:00Z'), night, NY)).toBe(true) // 18:00
  })
  it('handles same-day windows', () => {
    expect(isInWindow(new Date('2026-09-14T16:00:00Z'), { start: '09:00', end: '17:00' }, NY)).toBe(true)
  })
})

describe('householdDate and startOfHouseholdDay', () => {
  it('returns the local calendar date', () => {
    // 02:30Z on the 15th is 22:30 on the 14th in New York
    expect(householdDate(new Date('2026-09-15T02:30:00Z'), NY)).toBe('2026-09-14')
  })
  it('returns local midnight as a UTC instant', () => {
    expect(startOfHouseholdDay(new Date('2026-09-15T02:30:00Z'), NY).toISOString()).toBe('2026-09-14T04:00:00.000Z')
  })
  it('handles the DST change day', () => {
    // Nov 1 2026, 10:00 EST; midnight that day was still EDT (UTC-4)
    expect(startOfHouseholdDay(new Date('2026-11-01T15:00:00Z'), NY).toISOString()).toBe('2026-11-01T04:00:00.000Z')
  })
})

describe('householdWeekday', () => {
  it('returns 0-6 in the household zone', () => {
    expect(householdWeekday(new Date('2026-09-14T16:00:00Z'), NY)).toBe(1) // Monday
    expect(householdWeekday(new Date('2026-09-14T03:00:00Z'), NY)).toBe(0) // still Sunday 23:00
  })
})

describe('formatDuration', () => {
  it('formats hours and minutes', () => {
    expect(formatDuration(160 * 60_000)).toBe('2h 40m')
    expect(formatDuration(45 * 60_000)).toBe('45m')
    expect(formatDuration(-5000)).toBe('0m')
  })
})

describe('formatClock', () => {
  it('formats 12-hour time in the household zone', () => {
    expect(formatClock(new Date('2026-09-14T19:10:00Z'), NY)).toBe('3:10 PM')
  })
})
