import ICAL from 'ical.js'
import { describe, expect, it, vi } from 'vitest'
import { CalendarProviderError, type ConnectionStatus } from '../_shared/calendarProvider.ts'
import { createIcsParser } from '../_shared/ics.ts'
import { IcsFetchError } from '../_shared/icsFetch.ts'
import {
  collectDayEvents,
  EVENTS_CACHE_TTL_MS,
  type CalendarStore,
  type ConnectionRow,
  type EventsCache,
  type HouseholdCalendars,
  type SelectionRow,
} from './collect.ts'
import { createIcsSource, createOAuthSource, type CalendarSources, type OAuthSource } from './sources.ts'

const HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-000000000001'
const SAM = 'bbbbbbbb-0000-0000-0000-000000000001'
const IVY = 'cccccccc-0000-0000-0000-000000000001'
const NOW = new Date('2026-09-14T16:00:00Z') // noon in New York
const TZ = 'America/New_York'
const parser = createIcsParser(ICAL)

const FIXTURE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Test//EN',
  'X-WR-CALNAME:Ivy school',
  'BEGIN:VEVENT',
  'UID:swim@test',
  'DTSTART:20260914T210000Z',
  'DTEND:20260914T220000Z',
  'SUMMARY:Swim lesson',
  'LOCATION:Y pool',
  'DESCRIPTION:Bring goggles. Door code 4321',
  'ATTENDEE;CN=Coach:mailto:coach@example.com',
  'ORGANIZER:mailto:school@example.com',
  'URL:https://school.example.com/secret-link',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:dropoff@test',
  'DTSTART;TZID=America/New_York:20260901T080000',
  'DTEND;TZID=America/New_York:20260901T083000',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  'SUMMARY:School drop-off',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n')

function connection(overrides: Partial<ConnectionRow> = {}): ConnectionRow {
  return { id: 'conn-ics', provider: 'ics', status: 'ok', ownerName: 'Sam', ...overrides }
}

function selection(overrides: Partial<SelectionRow> = {}): SelectionRow {
  return { id: 'sel-ics', connectionId: 'conn-ics', externalCalendarId: 'ics', assignedMembershipId: null, assignedChildId: IVY, ...overrides }
}

function fakeStore(data: Partial<HouseholdCalendars> = {}, secrets: Record<string, string | null> = {}) {
  const calls = { setStatus: [] as Array<[string, ConnectionStatus]>, updateSecret: [] as Array<[string, string]>, gone: [] as string[] }
  const store: CalendarStore = {
    load: vi.fn(async () => ({
      timeZone: TZ,
      connections: [connection()],
      selections: [selection()],
      memberColors: { [SAM]: '#2A2A98' },
      childColors: { [IVY]: '#982A5D' },
      ...data,
    })),
    secret: vi.fn(async (id: string) => (id in secrets ? secrets[id]! : `https://calendar.example.com/${id}.ics`)),
    updateSecret: vi.fn(async (id: string, secret: string) => {
      calls.updateSecret.push([id, secret])
    }),
    setStatus: vi.fn(async (id: string, status: ConnectionStatus) => {
      calls.setStatus.push([id, status])
    }),
    setSelectionGone: vi.fn(async (id: string) => {
      calls.gone.push(id)
    }),
  }
  return { store, calls }
}

function icsSources(fetchIcs: (url: URL, signal: AbortSignal) => Promise<string> = async () => FIXTURE): CalendarSources {
  return { ics: createIcsSource(fetchIcs, parser), google: null, microsoft: null }
}

const collect = (store: CalendarStore, sources: CalendarSources, cache: EventsCache = new Map(), extra: Record<string, unknown> = {}) =>
  collectDayEvents(HOUSEHOLD, { store, sources, cache, now: NOW, ...extra })

describe('collectDayEvents: ICS', () => {
  it('returns today\'s events, including a recurring one, with only the allowed fields', async () => {
    const { store } = fakeStore()
    const fetchIcs = vi.fn(async () => FIXTURE)
    const result = await collect(store, icsSources(fetchIcs))
    expect(result).toEqual({
      events: [
        {
          title: 'School drop-off',
          startAt: '2026-09-14T12:00:00.000Z',
          endAt: '2026-09-14T12:30:00.000Z',
          allDay: false,
          location: null,
          personType: 'child',
          personId: IVY,
          calendarColor: '#982A5D',
        },
        {
          title: 'Swim lesson',
          startAt: '2026-09-14T21:00:00.000Z',
          endAt: '2026-09-14T22:00:00.000Z',
          allDay: false,
          location: 'Y pool',
          personType: 'child',
          personId: IVY,
          calendarColor: '#982A5D',
        },
      ],
      connections: [{ id: 'conn-ics', ownerName: 'Sam', status: 'ok' }],
      partial: false,
      generatedAt: NOW.toISOString(),
    })
    expect(fetchIcs).toHaveBeenCalledWith(new URL('https://calendar.example.com/conn-ics.ics'), expect.any(AbortSignal))
    for (const event of result!.events) {
      expect(Object.keys(event).sort()).toEqual(['allDay', 'calendarColor', 'endAt', 'location', 'personId', 'personType', 'startAt', 'title'])
    }
    const serialized = JSON.stringify(result)
    for (const leaked of ['goggles', '4321', 'coach@example.com', 'school@example.com', 'secret-link']) expect(serialized).not.toContain(leaked)
  })

  it('serves a connection from the cache within 5 minutes and fetches again after', async () => {
    const { store } = fakeStore({}, { 'conn-ics': 'https://calendar.example.com/a.ics' })
    const fetchIcs = vi.fn(async () => FIXTURE)
    const cache: EventsCache = new Map()
    const first = await collect(store, icsSources(fetchIcs), cache)
    const second = await collectDayEvents(HOUSEHOLD, { store, sources: icsSources(fetchIcs), cache, now: new Date(NOW.getTime() + 4 * 60_000) })
    expect(fetchIcs).toHaveBeenCalledTimes(1)
    expect(second!.events).toEqual(first!.events)
    expect(store.secret).toHaveBeenCalledTimes(1)
    await collectDayEvents(HOUSEHOLD, { store, sources: icsSources(fetchIcs), cache, now: new Date(NOW.getTime() + EVENTS_CACHE_TTL_MS + 1) })
    expect(fetchIcs).toHaveBeenCalledTimes(2)
  })

  it('does not cache failures', async () => {
    const { store } = fakeStore()
    let fail = true
    const fetchIcs = vi.fn(async () => {
      if (fail) throw new IcsFetchError('unreachable', 'down')
      return FIXTURE
    })
    const cache: EventsCache = new Map()
    expect((await collect(store, icsSources(fetchIcs), cache))!.connections[0]!.status).toBe('unreachable')
    fail = false
    expect((await collect(store, icsSources(fetchIcs), cache))!.connections[0]!.status).toBe('ok')
    expect(fetchIcs).toHaveBeenCalledTimes(2)
  })

  it('records status transitions only when the status changed', async () => {
    let { store, calls } = fakeStore({ connections: [connection({ status: 'unreachable' })] })
    await collect(store, icsSources())
    expect(calls.setStatus).toEqual([['conn-ics', 'ok']])

    ;({ store, calls } = fakeStore())
    await collect(store, icsSources())
    expect(calls.setStatus).toEqual([])

    ;({ store, calls } = fakeStore())
    let result = await collect(store, icsSources(async () => { throw new IcsFetchError('gone', 'HTTP 404') }))
    expect(calls.setStatus).toEqual([['conn-ics', 'auth_expired']])
    expect(result).toMatchObject({ events: [], partial: true, connections: [{ status: 'auth_expired' }] })

    ;({ store, calls } = fakeStore({ connections: [connection({ status: 'auth_expired' })] }))
    result = await collect(store, icsSources(async () => '<html>not a calendar</html>'))
    expect(calls.setStatus).toEqual([['conn-ics', 'unreachable']])
    expect(result!.connections[0]!.status).toBe('unreachable')
  })

  it('skips selections without a known person and connections without shown calendars', async () => {
    const { store } = fakeStore({
      connections: [connection(), connection({ id: 'conn-empty', ownerName: 'Alex' })],
      selections: [selection({ assignedChildId: 'unknown-child' })],
    })
    const fetchIcs = vi.fn(async () => FIXTURE)
    expect(await collect(store, icsSources(fetchIcs))).toMatchObject({ events: [], connections: [], partial: false })
    expect(fetchIcs).not.toHaveBeenCalled()
  })

  it('returns null for an unknown household', async () => {
    const { store } = fakeStore()
    store.load = vi.fn(async () => null)
    expect(await collect(store, icsSources())).toBeNull()
  })

  it('leaves a connection whose secret is gone (member just left) without events or status writes', async () => {
    const { store, calls } = fakeStore({}, { 'conn-ics': null })
    const fetchIcs = vi.fn(async () => FIXTURE)
    expect(await collect(store, icsSources(fetchIcs))).toMatchObject({ events: [], connections: [{ status: 'ok' }] })
    expect(fetchIcs).not.toHaveBeenCalled()
    expect(calls.setStatus).toEqual([])
  })
})

describe('collectDayEvents: Google and Microsoft', () => {
  const googleConnection = connection({ id: 'conn-g', provider: 'google', ownerName: 'Sam' })
  const samCalendar = selection({ id: 'sel-work', connectionId: 'conn-g', externalCalendarId: 'sam@example.com', assignedChildId: null, assignedMembershipId: SAM })
  const ivyCalendar = selection({ id: 'sel-ivy', connectionId: 'conn-g', externalCalendarId: 'ivy-group@group.calendar.google.com' })

  function tokenResponse(body: Record<string, unknown>) {
    return new Response(JSON.stringify({ access_token: 'access-1', expires_in: 3600, token_type: 'Bearer', ...body }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  it('marks one calendar gone on a 404, keeps the others, and leaves the connection ok', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) return tokenResponse({})
      if (url.includes(encodeURIComponent('ivy-group@group.calendar.google.com'))) {
        return new Response(JSON.stringify({ error: { code: 404, message: 'Not Found' } }), { status: 404 })
      }
      return new Response(
        JSON.stringify({
          items: [
            {
              status: 'confirmed',
              summary: 'Dentist',
              description: 'Bring insurance card',
              start: { dateTime: '2026-09-14T14:00:00-04:00' },
              end: { dateTime: '2026-09-14T15:00:00-04:00' },
              attendees: [{ email: 'dr@example.com', self: false }],
            },
          ],
        }),
      )
    })
    const { store, calls } = fakeStore({ connections: [googleConnection], selections: [samCalendar, ivyCalendar] })
    const sources: CalendarSources = { ics: createIcsSource(async () => FIXTURE, parser), google: createOAuthSource('google', fetch, { clientId: 'id', clientSecret: 'secret' }), microsoft: null }
    const result = await collect(store, sources)
    expect(calls.gone).toEqual(['sel-ivy'])
    expect(calls.setStatus).toEqual([])
    expect(result!.connections).toEqual([{ id: 'conn-g', ownerName: 'Sam', status: 'ok' }])
    expect(result!.events).toEqual([
      expect.objectContaining({ title: 'Dentist', personType: 'member', personId: SAM, calendarColor: '#2A2A98', location: null }),
    ])
    expect(JSON.stringify(result)).not.toMatch(/insurance|dr@example/)
    expect(calls.updateSecret).toEqual([])
  })

  it('saves a rotated Microsoft refresh token, and not an unchanged one', async () => {
    const msConnection = connection({ id: 'conn-ms', provider: 'microsoft', ownerName: 'Alex' })
    const msCalendar = selection({ id: 'sel-ms', connectionId: 'conn-ms', externalCalendarId: 'AAMk-cal', assignedChildId: null, assignedMembershipId: SAM })
    for (const [issued, expected] of [
      ['refresh-2', [['conn-ms', 'refresh-2']]],
      ['https://calendar.example.com/conn-ms.ics', []],
    ] as const) {
      const fetch = vi.fn(async (url: string) =>
        url.startsWith('https://login.microsoftonline.com/') ? tokenResponse({ refresh_token: issued }) : new Response(JSON.stringify({ value: [] })),
      )
      const { store, calls } = fakeStore({ connections: [msConnection], selections: [msCalendar] })
      const sources: CalendarSources = { ics: createIcsSource(async () => FIXTURE, parser), google: null, microsoft: createOAuthSource('microsoft', fetch, { clientId: 'id', clientSecret: 's' }) }
      expect((await collect(store, sources))!.connections[0]!.status).toBe('ok')
      expect(calls.updateSecret).toEqual(expected)
    }
  })

  it('marks a revoked grant auth_expired and hides that connection\'s events', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }))
    const { store, calls } = fakeStore({ connections: [googleConnection], selections: [samCalendar] })
    const sources: CalendarSources = { ics: createIcsSource(async () => FIXTURE, parser), google: createOAuthSource('google', fetch, { clientId: 'id', clientSecret: 's' }), microsoft: null }
    expect(await collect(store, sources)).toMatchObject({ events: [], partial: true, connections: [{ status: 'auth_expired' }] })
    expect(calls.setStatus).toEqual([['conn-g', 'auth_expired']])
  })

  it('reports an unconfigured provider as unreachable', async () => {
    const { store } = fakeStore({ connections: [googleConnection], selections: [samCalendar] })
    expect((await collect(store, icsSources()))!.connections[0]!.status).toBe('unreachable')
  })
})

describe('collectDayEvents: concurrency and deadline', () => {
  it('reports a connection still running at the deadline as unreachable without blocking the others or storing it', async () => {
    const slow: OAuthSource = {
      refresh: (_token, _now, signal) =>
        new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new CalendarProviderError('unreachable', 'aborted')))),
      dayEvents: async () => [],
    }
    const { store, calls } = fakeStore({
      connections: [connection({ id: 'conn-slow', provider: 'google', ownerName: 'Alex' }), connection()],
      selections: [selection({ id: 'sel-slow', connectionId: 'conn-slow', externalCalendarId: 'x' }), selection()],
    })
    const started = Date.now()
    const result = await collect(store, { ics: createIcsSource(async () => FIXTURE, parser), google: slow, microsoft: null }, new Map(), { deadlineMs: 50 })
    expect(Date.now() - started).toBeLessThan(2000)
    expect(result!.connections).toEqual([
      { id: 'conn-slow', ownerName: 'Alex', status: 'unreachable' },
      { id: 'conn-ics', ownerName: 'Sam', status: 'ok' },
    ])
    expect(result!.events).toHaveLength(2)
    expect(result!.partial).toBe(true)
    await new Promise((r) => setTimeout(r, 10))
    expect(calls.setStatus).toEqual([])
  })

  it('runs at most `concurrency` connections at once', async () => {
    let running = 0
    let peak = 0
    const fetchIcs = vi.fn(async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 5))
      running--
      return FIXTURE
    })
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const { store } = fakeStore({
      connections: ids.map((id) => connection({ id })),
      selections: ids.map((id) => selection({ id: `sel-${id}`, connectionId: id })),
    })
    const result = await collect(store, icsSources(fetchIcs), new Map(), { concurrency: 3 })
    expect(fetchIcs).toHaveBeenCalledTimes(7)
    expect(peak).toBe(3)
    expect(result!.connections.every((c) => c.status === 'ok')).toBe(true)
  })
})
