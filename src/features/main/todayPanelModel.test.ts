import { describe, expect, it } from 'vitest'
import type { TodayEvent, TodayEvents } from '@/data/calendarApi'
import { buildTodayModel, leaveLabel, type TodayModelInput } from './todayPanelModel'

const TZ = 'America/New_York'
const NOW = new Date('2026-09-14T19:00:00Z') // 3:00 PM
const SAM = 'member-sam'
const IVY = 'child-ivy'

const event = (over: Partial<TodayEvent>): TodayEvent => ({
  title: 'Swim lesson',
  startAt: '2026-09-14T20:00:00Z',
  endAt: '2026-09-14T21:00:00Z',
  allDay: false,
  location: null,
  personType: 'child',
  personId: IVY,
  calendarColor: '#D9A441',
  ...over,
})

const events = (list: TodayEvent[], over: Partial<TodayEvents> = {}): TodayEvents => ({
  events: list,
  connections: [],
  partial: false,
  updatedAt: NOW.toISOString(),
  receivedAt: NOW.toISOString(),
  ...over,
})

const input = (over: Partial<TodayModelInput>): TodayModelInput => ({
  events: events([]),
  failed: false,
  now: NOW,
  timeZone: TZ,
  leaveByBufferMin: 20,
  members: [{ id: SAM, displayName: 'Sam', color: '#5B6ACF' }],
  children: [{ id: IVY, name: 'Ivy', color: '#D9A441' }],
  ...over,
})

describe('buildTodayModel', () => {
  it('lists all-day events first, then timed events by start', () => {
    const m = buildTodayModel(input({
      events: events([
        event({ title: 'Dinner out', startAt: '2026-09-14T22:30:00Z', endAt: '2026-09-14T23:30:00Z' }),
        event({ title: 'Swim', startAt: '2026-09-14T20:00:00Z', endAt: '2026-09-14T20:45:00Z' }),
        event({ title: 'Books due', allDay: true, startAt: '2026-09-14T04:00:00Z', endAt: '2026-09-15T04:00:00Z' }),
      ]),
    }))
    expect(m.rows.map((r) => [r.title, r.time])).toEqual([
      ['Books due', 'All day'],
      ['Swim', '4:00 – 4:45 PM'],
      ['Dinner out', '6:30 – 7:30 PM'],
    ])
  })

  it('drops ended events, marks events in progress as Now, and spans AM to PM in full', () => {
    const m = buildTodayModel(input({
      events: events([
        event({ title: 'Ended', startAt: '2026-09-14T17:00:00Z', endAt: '2026-09-14T19:00:00Z' }),
        event({ title: 'Going on', startAt: '2026-09-14T15:30:00Z', endAt: '2026-09-14T19:30:00Z' }),
      ]),
    }))
    expect(m.rows).toHaveLength(1)
    expect(m.rows[0]).toMatchObject({ title: 'Going on', now: true, time: 'Now · until 3:30 PM' })
    const later = buildTodayModel(input({ events: events([event({ startAt: '2026-09-14T15:30:00Z', endAt: '2026-09-14T19:30:00Z' })]), now: new Date('2026-09-14T14:00:00Z') }))
    expect(later.rows[0]!.time).toBe('11:30 AM – 3:30 PM')
  })

  it('shows a leave-by for events with a location starting within 2 hours', () => {
    const m = buildTodayModel(input({
      events: events([
        event({ title: 'Swim', location: 'YMCA Pool', startAt: '2026-09-14T19:45:00Z', endAt: '2026-09-14T20:30:00Z' }),
        event({ title: 'Home', location: null, startAt: '2026-09-14T19:45:00Z', endAt: '2026-09-14T20:30:00Z' }),
        event({ title: 'Far off', location: 'Zoo', startAt: '2026-09-14T22:00:00Z', endAt: '2026-09-14T23:00:00Z' }),
      ]),
    }))
    expect(m.rows.map((r) => [r.title, r.leave])).toEqual([['Home', null], ['Swim', 'Leave in 25 min'], ['Far off', null]])
  })

  it('pairs each event with its person, and falls back to the person color for the bar', () => {
    const m = buildTodayModel(input({
      events: events([
        event({ title: 'A', personType: 'member', personId: SAM, calendarColor: '' }),
        event({ title: 'B', personType: 'child', personId: IVY, calendarColor: '#123456' }),
        event({ title: 'C', personType: 'member', personId: 'gone', calendarColor: '#654321' }),
      ]),
    }))
    expect(m.rows.map((r) => [r.person, r.barColor])).toEqual([
      [{ name: 'Sam', color: '#5B6ACF' }, '#5B6ACF'],
      [{ name: 'Ivy', color: '#D9A441' }, '#123456'],
      [null, '#654321'],
    ])
  })

  it('puts tomorrow’s events under their own heading, after today’s', () => {
    const m = buildTodayModel(input({
      events: events([
        event({ title: 'Swim lesson', startAt: '2026-09-14T20:00:00Z', endAt: '2026-09-14T21:00:00Z' }),
        event({ title: 'Dentist', startAt: '2026-09-15T12:30:00Z', endAt: '2026-09-15T13:15:00Z', personType: 'member', personId: SAM }),
        event({ title: 'Soccer', startAt: '2026-09-15T21:30:00Z', endAt: '2026-09-15T22:30:00Z' }),
      ]),
    }))
    expect(m.rows.map((r) => r.title)).toEqual(['Swim lesson'])
    expect(m.tomorrow?.label).toBe('Tomorrow · Tue')
    expect(m.tomorrow?.rows.map((r) => [r.title, r.time])).toEqual([
      ['Dentist', '8:30 – 9:15 AM'],
      ['Soccer', '5:30 – 6:30 PM'],
    ])
    expect(m.tomorrow?.rows[0]?.person?.name).toBe('Sam')
    expect(m.tomorrow?.more).toBe(0)
    expect(m.empty).toBe(false)
  })

  it('has no tomorrow section when tomorrow is empty, or before the first answer', () => {
    expect(buildTodayModel(input({ events: events([event({})]) })).tomorrow).toBeNull()
    expect(buildTodayModel(input({ events: null })).tomorrow).toBeNull()
  })

  it('still says "Nothing else today" when today is over but tomorrow has events', () => {
    const m = buildTodayModel(input({
      events: events([event({ title: 'Dentist', startAt: '2026-09-15T12:30:00Z', endAt: '2026-09-15T13:15:00Z' })]),
    }))
    expect(m.rows).toEqual([])
    expect(m.empty).toBe(true)
    expect(m.tomorrow?.rows.map((r) => r.title)).toEqual(['Dentist'])
  })

  it('gives tomorrow only the room today leaves, and counts what did not fit', () => {
    const today = [0, 1, 2, 3].map((i) =>
      event({ title: `Today ${i}`, startAt: `2026-09-14T2${i}:00:00Z`, endAt: `2026-09-14T2${i}:30:00Z` }),
    )
    const tomorrow = [0, 1, 2].map((i) =>
      event({ title: `Tomorrow ${i}`, startAt: `2026-09-15T1${i}:00:00Z`, endAt: `2026-09-15T1${i}:30:00Z` }),
    )
    const m = buildTodayModel(input({ events: events([...today, ...tomorrow]) }))
    expect(m.rows).toHaveLength(4)
    expect(m.tomorrow?.rows.map((r) => r.title)).toEqual(['Tomorrow 0', 'Tomorrow 1'])
    expect(m.tomorrow?.more).toBe(1)
  })

  it('drops the tomorrow section entirely when today already fills the panel', () => {
    const today = [0, 1, 2, 3, 4, 5].map((i) =>
      event({ title: `Today ${i}`, startAt: `2026-09-14T2${i % 4}:0${i}:00Z`, endAt: '2026-09-14T23:59:00Z' }),
    )
    const m = buildTodayModel(input({
      events: events([...today, event({ title: 'Dentist', startAt: '2026-09-15T12:30:00Z', endAt: '2026-09-15T13:15:00Z' })]),
    }))
    expect(m.rows).toHaveLength(6)
    expect(m.tomorrow).toBeNull()
  })

  it('shows an all-day event that spans both days under each, and a night-owl event only under today', () => {
    const m = buildTodayModel(input({
      events: events([
        event({ title: 'Sam in Denver', startAt: '2026-09-14T04:00:00Z', endAt: '2026-09-16T04:00:00Z', allDay: true, personType: 'member', personId: SAM }),
        event({ title: 'Late flight', startAt: '2026-09-15T02:00:00Z', endAt: '2026-09-15T05:00:00Z' }),
      ]),
    }))
    expect(m.rows.map((r) => [r.title, r.time])).toEqual([
      ['Sam in Denver', 'All day'],
      ['Late flight', '10:00 PM – 1:00 AM'],
    ])
    expect(m.tomorrow?.rows.map((r) => r.title)).toEqual(['Sam in Denver'])
  })

  it('moves tomorrow’s events up to today the moment the clock passes midnight', () => {
    const list = events([event({ title: 'Dentist', startAt: '2026-09-15T12:30:00Z', endAt: '2026-09-15T13:15:00Z' })])
    // 00:01 in New York on the 15th: the same answer, one minute later.
    const m = buildTodayModel(input({ events: list, now: new Date('2026-09-15T04:01:00Z') }))
    expect(m.rows.map((r) => r.title)).toEqual(['Dentist'])
    expect(m.tomorrow).toBeNull()
  })

  it('keeps the leave-by on a tomorrow event that is already within two hours', () => {
    const m = buildTodayModel(input({
      now: new Date('2026-09-15T03:00:00Z'), // 11:00 PM on the 14th
      events: events([
        event({ title: 'Red-eye', startAt: '2026-09-15T04:30:00Z', endAt: '2026-09-15T06:00:00Z', location: 'CLT' }),
      ]),
    }))
    expect(m.rows).toEqual([])
    expect(m.tomorrow?.rows.map((r) => [r.title, r.leave])).toEqual([['Red-eye', 'Leave in 1 h 10 min']])
  })

  it('says "Nothing else today" when nothing is left, and nothing at all before the first answer', () => {
    expect(buildTodayModel(input({})).empty).toBe(true)
    const loading = buildTodayModel(input({ events: null }))
    expect(loading.empty).toBe(false)
    expect(loading.unreachable).toBe(false)
  })

  it('notes a calendar received more than 30 minutes ago, by this device’s clock', () => {
    const age = (min: number) => buildTodayModel(input({ events: events([], { receivedAt: new Date(NOW.getTime() - min * 60_000).toISOString() }) })).stale
    // The server's clock doesn't matter: a skewed generatedAt alone never makes it stale.
    expect(buildTodayModel(input({ events: events([], { updatedAt: '2026-09-14T10:00:00Z' }) })).stale).toBeNull()
    expect(age(30)).toBeNull()
    expect(age(45)).toBe('Calendar updated 45 min ago')
    expect(age(135)).toBe('Calendar updated 2 h ago')
  })

  it('asks for reconnecting once per adult whose calendar sign-in expired', () => {
    const m = buildTodayModel(input({
      events: events([], {
        connections: [
          { id: '1', ownerName: 'Sam', status: 'auth_expired' },
          { id: '2', ownerName: 'Sam', status: 'auth_expired' },
          { id: '3', ownerName: 'Alex', status: 'unreachable' },
          { id: '4', ownerName: 'Alex', status: 'ok' },
        ],
      }),
    }))
    expect(m.reconnect).toEqual(['Sam’s calendar needs reconnecting'])
    expect(m.unreachable).toBe(false)
    expect(m.empty).toBe(true)
  })

  it('says the calendar couldn’t be reached only when every connection is unreachable and nothing shows', () => {
    const unreachable = events([], { connections: [{ id: '1', ownerName: 'Sam', status: 'unreachable' }] })
    expect(buildTodayModel(input({ events: unreachable }))).toMatchObject({ unreachable: true, empty: false })
    const withEvent = { ...unreachable, events: [event({})] }
    expect(buildTodayModel(input({ events: withEvent })).unreachable).toBe(false)
    expect(buildTodayModel(input({ events: null, failed: true }))).toMatchObject({ unreachable: true, empty: false })
  })
})

describe('row keys', () => {
  it('are stable across refreshes and ticks, and distinct for identical events', () => {
    const a = event({ title: 'Swim' })
    const b = event({ title: 'Nap', startAt: '2026-09-14T19:30:00Z', endAt: '2026-09-14T20:30:00Z' })
    const first = buildTodayModel(input({ events: events([a, b, { ...a }]) })).rows.map((r) => r.key)
    const later = buildTodayModel(input({ events: events([{ ...b }, { ...a }, { ...a }]), now: new Date(NOW.getTime() + 60_000) })).rows.map((r) => r.key)
    expect(new Set(first).size).toBe(3)
    expect(later).toEqual(first)
    // Removing the earlier event doesn't change the others' keys (no index in the key).
    const without = buildTodayModel(input({ events: events([a]) })).rows.map((r) => r.key)
    expect(without[0]).toBe(first[1])
  })
})

describe('leaveLabel', () => {
  it('words minutes and hours', () => {
    expect(leaveLabel(0)).toBe('Leave now')
    expect(leaveLabel(1)).toBe('Leave in 1 min')
    expect(leaveLabel(60)).toBe('Leave in 1 h')
    expect(leaveLabel(95)).toBe('Leave in 1 h 35 min')
  })
})
