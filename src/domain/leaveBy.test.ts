import { describe, it, expect } from 'vitest'
import { leaveInMinutes } from './leaveBy'
import type { CalendarEvent } from './types'

const now = new Date('2026-09-14T20:00:00Z')
const event = (over: Partial<CalendarEvent>): CalendarEvent => ({
  title: 'Soccer',
  startAt: '2026-09-14T21:00:00Z',
  endAt: '2026-09-14T22:00:00Z',
  allDay: false,
  location: 'Riverside Park',
  ...over,
})

describe('leaveInMinutes', () => {
  it('subtracts the buffer from the time until start', () => {
    expect(leaveInMinutes(event({}), now, 20)).toBe(40)
  })
  it('returns 0 when it is already time to leave', () => {
    expect(leaveInMinutes(event({ startAt: '2026-09-14T20:10:00Z' }), now, 20)).toBe(0)
  })
  it('ignores events without a location, all-day events, started events, and events over 2h away', () => {
    expect(leaveInMinutes(event({ location: null }), now, 20)).toBeNull()
    expect(leaveInMinutes(event({ allDay: true }), now, 20)).toBeNull()
    expect(leaveInMinutes(event({ startAt: '2026-09-14T19:59:00Z' }), now, 20)).toBeNull()
    expect(leaveInMinutes(event({ startAt: '2026-09-14T22:01:00Z' }), now, 20)).toBeNull()
  })
})
