import { describe, expect, it, vi } from 'vitest'
import { AuthError } from '../_shared/auth.ts'
import { CalendarProviderError } from '../_shared/calendarProvider.ts'
import { createGoogleEvent, refreshGoogleAccessToken } from '../_shared/google.ts'
import { createMicrosoftEvent, refreshMicrosoftAccessToken } from '../_shared/microsoft.ts'
import { createCreateEventHandler, type CreateEventDeps, type CreateEventTarget, type EventWriter } from './handler.ts'

const HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-000000000001'
const OTHER_HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-000000000002'
const MEMBERSHIP = 'bbbbbbbb-0000-0000-0000-000000000001'
const OTHER_MEMBERSHIP = 'bbbbbbbb-0000-0000-0000-000000000002'
const SELECTION = 'dddddddd-0000-0000-0000-000000000001'
const ENDPOINT = 'http://127.0.0.1:55321/functions/v1/calendar-create-event'
const TZ = 'America/New_York'
const NOW = new Date('2026-09-14T16:00:00Z')

const target = (over: Partial<CreateEventTarget> = {}): CreateEventTarget => ({
  householdId: HOUSEHOLD,
  connectionId: 'conn-1',
  ownerMembershipId: MEMBERSHIP,
  provider: 'google',
  status: 'ok',
  canWrite: true,
  externalCalendarId: 'kids@group.calendar.google.com',
  gone: false,
  timeZone: TZ,
  ...over,
})

/** A writer that records what it was handed and answers with a provider event id. */
function writer(over: Partial<EventWriter> = {}) {
  const created: Array<{ accessToken: string; calendarId: string; draft: unknown }> = []
  const w: EventWriter = {
    refresh: vi.fn(async () => ({ accessToken: 'at-1', expiresAt: new Date(NOW.getTime() + 3600_000), refreshToken: null, scope: null })),
    createEvent: vi.fn(async (accessToken: string, calendarId: string, draft) => {
      created.push({ accessToken, calendarId, draft })
      return 'evt-1'
    }),
    ...over,
  }
  return { w, created }
}

function deps(over: Partial<CreateEventDeps> = {}, writerOver: Partial<EventWriter> = {}) {
  const { w, created } = writer(writerOver)
  const saved: Array<[string, string]> = []
  const statuses: Array<[string, string]> = []
  const recorded: Array<[string, string]> = []
  const d: CreateEventDeps = {
    requireFullSignInAdult: vi.fn(async () => MEMBERSHIP),
    requirePinMembership: vi.fn(async (_req: Request, _householdId: string, membershipId: string) => membershipId),
    recordAttempt: vi.fn(async () => true),
    load: vi.fn(async () => target()),
    secret: vi.fn(async () => 'refresh-1'),
    writers: { google: w, microsoft: w },
    updateSecret: vi.fn(async (id: string, secret: string) => void saved.push([id, secret])),
    setStatus: vi.fn(async (id: string, status: string) => void statuses.push([id, status])),
    recordCreated: vi.fn(async (membershipId: string, selectionId: string) => void recorded.push([membershipId, selectionId])),
    now: () => NOW,
    ...over,
  }
  return { d, created, saved, statuses, recorded, w }
}

const event = (over: Record<string, unknown> = {}) => ({
  householdId: HOUSEHOLD,
  selectionId: SELECTION,
  title: 'Swim lesson',
  allDay: false,
  start: '2026-09-14T20:00:00Z',
  end: '2026-09-14T20:45:00Z',
  ...over,
})

const post = (body: unknown, headers: Record<string, string> = { Authorization: 'Bearer adult' }) =>
  new Request(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

async function call(d: CreateEventDeps, req: Request) {
  const res = await createCreateEventHandler(d)(req)
  return { res, body: (await res.json()) as Record<string, unknown> }
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('calendar-create-event handler', () => {
  it('answers CORS preflight and refuses other methods', async () => {
    const { d } = deps()
    const pre = await createCreateEventHandler(d)(new Request(ENDPOINT, { method: 'OPTIONS' }))
    expect(pre.status).toBe(200)
    expect(pre.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
    const get = await createCreateEventHandler(d)(new Request(ENDPOINT, { method: 'GET' }))
    expect(get.status).toBe(405)
  })

  it('writes a timed event to Google and answers with the event the panel should show', async () => {
    const { d, created, recorded } = deps()
    const { res, body } = await call(d, post(event({ location: 'YMCA Pool' })))
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(body).toEqual({
      created: true,
      selectionId: SELECTION,
      title: 'Swim lesson',
      startAt: '2026-09-14T20:00:00.000Z',
      endAt: '2026-09-14T20:45:00.000Z',
      allDay: false,
      location: 'YMCA Pool',
    })
    expect(created).toHaveLength(1)
    expect(created[0]!.accessToken).toBe('at-1')
    expect(created[0]!.calendarId).toBe('kids@group.calendar.google.com')
    expect(created[0]!.draft).toMatchObject({ title: 'Swim lesson', allDay: false, timeZone: TZ })
    // Audited, and the connection's events cache invalidated.
    expect(recorded).toEqual([[MEMBERSHIP, SELECTION]])
  })

  it('writes to Microsoft when the connection is a Microsoft account', async () => {
    const google = writer()
    const microsoft = writer()
    const { d } = deps({ load: async () => target({ provider: 'microsoft', externalCalendarId: 'AAMk=' }), writers: { google: google.w, microsoft: microsoft.w } })
    expect((await call(d, post(event()))).res.status).toBe(200)
    expect(microsoft.created).toHaveLength(1)
    expect(google.created).toHaveLength(0)
  })

  it('writes an all-day event as household dates with an exclusive end', async () => {
    const { d, created } = deps()
    const { res, body } = await call(d, post(event({ allDay: true, start: '2026-09-15', end: '2026-09-16' })))
    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      allDay: true,
      // Midnight in New York, not UTC.
      startAt: '2026-09-15T04:00:00.000Z',
      endAt: '2026-09-16T04:00:00.000Z',
      location: null,
    })
    expect(created[0]!.draft).toMatchObject({ startDate: '2026-09-15', endDate: '2026-09-16', allDay: true })
  })

  it('saves a rotated refresh token before writing', async () => {
    const order: string[] = []
    const { d, saved } = deps(
      { updateSecret: vi.fn(async (id: string, secret: string) => void (order.push('save'), saved.push([id, secret]))) },
      {
        refresh: vi.fn(async () => ({ accessToken: 'at-1', expiresAt: NOW, refreshToken: 'rotated', scope: null })),
        createEvent: vi.fn(async () => (order.push('create'), 'evt')),
      },
    )
    expect((await call(d, post(event()))).res.status).toBe(200)
    expect(saved).toEqual([['conn-1', 'rotated']])
    expect(order).toEqual(['save', 'create'])
  })

  // ─── Authorisation ──────────────────────────────────────────────────────
  it('takes the acting membership from a display’s Settings PIN, never from the body', async () => {
    const { d, recorded } = deps()
    const { res } = await call(d, post({ ...event(), membershipId: MEMBERSHIP, pin: '1234' }, { Authorization: 'Bearer display' }))
    expect(res.status).toBe(200)
    expect(d.requirePinMembership).toHaveBeenCalledWith(expect.anything(), HOUSEHOLD, MEMBERSHIP, '1234')
    expect(d.requireFullSignInAdult).not.toHaveBeenCalled()
    expect(recorded).toEqual([[MEMBERSHIP, SELECTION]])
  })

  it('refuses a wrong PIN, and never reaches the provider', async () => {
    const { d, created } = deps({
      requirePinMembership: vi.fn(async () => {
        throw new AuthError(403, 'forbidden')
      }),
    })
    const { res, body } = await call(d, post({ ...event(), membershipId: MEMBERSHIP, pin: '9999' }, { Authorization: 'Bearer display' }))
    expect(res.status).toBe(403)
    expect(body).toEqual({ error: 'forbidden' })
    expect(created).toHaveLength(0)
    expect(d.recordAttempt).not.toHaveBeenCalled()
  })

  it('refuses a caller who is not a signed-in adult of the household', async () => {
    const { d } = deps({
      requireFullSignInAdult: vi.fn(async () => {
        throw new AuthError(401, 'sign-in required')
      }),
    })
    expect((await call(d, post(event()))).res.status).toBe(401)
  })

  it('refuses a calendar of another household, another adult’s, or one that does not exist', async () => {
    for (const load of [
      async () => target({ householdId: OTHER_HOUSEHOLD }),
      async () => target({ ownerMembershipId: OTHER_MEMBERSHIP }),
      async () => null,
    ]) {
      const { d, created } = deps({ load })
      const { res, body } = await call(d, post(event()))
      expect(res.status).toBe(403)
      expect(body).toEqual({ error: 'forbidden' })
      expect(created).toHaveLength(0)
    }
  })

  it('refuses when the connection can no longer be used', async () => {
    const { d, created } = deps({ secret: async () => null })
    expect((await call(d, post(event()))).res.status).toBe(403)
    expect(created).toHaveLength(0)
  })

  // ─── What a connection may do ───────────────────────────────────────────
  it('answers not_writable for an ICS subscription and for a read-only account', async () => {
    for (const t of [target({ provider: 'ics', canWrite: false }), target({ canWrite: false }), target({ provider: 'microsoft', canWrite: false })]) {
      const { d, created } = deps({ load: async () => t })
      const { res, body } = await call(d, post(event()))
      expect(res.status).toBe(403)
      expect(body).toEqual({ error: 'not_writable' })
      expect(created).toHaveLength(0)
    }
  })

  it('answers calendar_gone for a calendar the provider no longer has', async () => {
    const { d } = deps({ load: async () => target({ gone: true }) })
    const { res, body } = await call(d, post(event()))
    expect(res.status).toBe(410)
    expect(body).toEqual({ error: 'calendar_gone' })
  })

  it('answers with the connection’s own trouble when it is not ok', async () => {
    const expired = await call(deps({ load: async () => target({ status: 'auth_expired' }) }).d, post(event()))
    expect([expired.res.status, expired.body]).toEqual([422, { error: 'auth_expired' }])
    const down = await call(deps({ load: async () => target({ status: 'unreachable' }) }).d, post(event()))
    expect([down.res.status, down.body]).toEqual([502, { error: 'unreachable' }])
  })

  it('answers not_configured when that provider has no client id and secret here', async () => {
    const { d } = deps({ writers: { google: null, microsoft: null } })
    const { res, body } = await call(d, post(event()))
    expect(res.status).toBe(503)
    expect(body).toEqual({ error: 'not_configured' })
  })

  // ─── Input ──────────────────────────────────────────────────────────────
  it('refuses a body that is not { householdId, selectionId, … }', async () => {
    const { d } = deps()
    for (const body of [
      {},
      { householdId: 'nope', selectionId: SELECTION },
      { householdId: HOUSEHOLD },
      { householdId: HOUSEHOLD, selectionId: 'nope' },
      { ...event(), pin: '1234' },
      { ...event(), pin: '1234', membershipId: 'nope' },
    ]) {
      const { res, body: answer } = await call(d, post(body))
      expect([res.status, answer]).toEqual([400, { error: 'invalid_request' }])
    }
  })

  it('refuses an event that breaks a rule, after authorising and before the provider', async () => {
    const { d, created } = deps()
    for (const over of [
      { title: '' },
      { title: 'x'.repeat(201) },
      { title: '<b>Swim</b>' },
      { location: 'y'.repeat(201) },
      { end: '2026-09-14T19:00:00Z' },
      { start: '2026-09-14T20:00:00' },
      { allDay: 'yes' },
      { allDay: true, start: '2026-09-15', end: '2026-09-15' },
      { start: '2030-01-01T10:00:00Z', end: '2030-01-01T11:00:00Z' },
    ]) {
      const { res, body } = await call(d, post(event(over)))
      expect([res.status, body]).toEqual([400, { error: 'invalid_request' }])
    }
    expect(created).toHaveLength(0)
  })

  it('refuses a member who has added too many events this hour', async () => {
    const { d, created } = deps({ recordAttempt: vi.fn(async () => false) })
    const { res, body } = await call(d, post(event()))
    expect(res.status).toBe(429)
    expect(body).toEqual({ error: 'rate_limited' })
    expect(created).toHaveLength(0)
  })

  // ─── Provider failures ──────────────────────────────────────────────────
  it('marks the connection for reconnecting when the grant has expired', async () => {
    const { d, statuses } = deps({}, { createEvent: async () => { throw new CalendarProviderError('auth_expired', 'HTTP 401') } })
    const { res, body } = await call(d, post(event()))
    expect([res.status, body]).toEqual([422, { error: 'auth_expired' }])
    expect(statuses).toEqual([['conn-1', 'auth_expired']])
  })

  it('reports a provider 5xx as unreachable without touching the connection’s status', async () => {
    const { d, statuses, recorded } = deps({}, { createEvent: async () => { throw new CalendarProviderError('unreachable', 'HTTP 503') } })
    const { res, body } = await call(d, post(event()))
    expect([res.status, body]).toEqual([502, { error: 'unreachable' }])
    expect(statuses).toEqual([])
    expect(recorded).toEqual([])
  })

  it('reports a calendar the provider lost as calendar_gone', async () => {
    const { d } = deps({}, { createEvent: async () => { throw new CalendarProviderError('calendar_gone', 'HTTP 404') } })
    const { res, body } = await call(d, post(event()))
    expect([res.status, body]).toEqual([410, { error: 'calendar_gone' }])
  })

  it('still answers 200 when only the audit and cache bump failed', async () => {
    const { d } = deps({ recordCreated: async () => { throw new Error('db down') } })
    expect((await call(d, post(event()))).res.status).toBe(200)
  })

  it('answers internal for anything else, without echoing the request', async () => {
    const { d } = deps({ load: async () => { throw new Error('boom: Swim lesson at YMCA Pool') } })
    const { res, body } = await call(d, post(event()))
    expect(res.status).toBe(500)
    expect(body).toEqual({ error: 'internal' })
  })
})

describe('calendar-create-event over the real provider clients', () => {
  /** The handler wired to the real Google client over an injected fetch, as index.ts wires it. */
  function googleDeps(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, over: Partial<CreateEventDeps> = {}) {
    const google: EventWriter = {
      refresh: (refreshToken, now) => refreshGoogleAccessToken(fetchImpl, { clientId: 'cid', clientSecret: 'cs', refreshToken }, now),
      createEvent: (accessToken, calendarId, draft) => createGoogleEvent(fetchImpl, accessToken, calendarId, draft),
    }
    return deps({ writers: { google, microsoft: null }, ...over }).d
  }

  it('refreshes the token and posts the event Google expects', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const d = googleDeps(async (url, init) => {
      calls.push({ url, init })
      if (url === 'https://oauth2.googleapis.com/token') return jsonResponse(200, { access_token: 'fresh', expires_in: 3600 })
      return jsonResponse(200, { id: 'evt-9' })
    })
    expect((await call(d, post(event({ location: 'YMCA Pool' })))).res.status).toBe(200)
    expect(calls).toHaveLength(2)
    expect(calls[1]!.url).toBe('https://www.googleapis.com/calendar/v3/calendars/kids%40group.calendar.google.com/events?fields=id')
    expect(JSON.parse(String(calls[1]!.init!.body))).toEqual({
      summary: 'Swim lesson',
      location: 'YMCA Pool',
      start: { dateTime: '2026-09-14T20:00:00.000Z', timeZone: TZ },
      end: { dateTime: '2026-09-14T20:45:00.000Z', timeZone: TZ },
    })
    expect(String(calls[1]!.init!.headers && JSON.stringify(calls[1]!.init!.headers))).toContain('Bearer fresh')
  })

  it('turns a refused refresh token into auth_expired before any event is posted', async () => {
    const calls: string[] = []
    const d = googleDeps(async (url) => {
      calls.push(url)
      return jsonResponse(400, { error: 'invalid_grant' })
    })
    const { res, body } = await call(d, post(event()))
    expect([res.status, body]).toEqual([422, { error: 'auth_expired' }])
    expect(calls).toEqual(['https://oauth2.googleapis.com/token'])
  })

  it('posts the event Microsoft Graph expects', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (url.includes('/oauth2/v2.0/token')) return jsonResponse(200, { access_token: 'fresh', expires_in: 3600 })
      return jsonResponse(201, { id: 'AAMk=' })
    }
    const microsoft: EventWriter = {
      refresh: (refreshToken, now) => refreshMicrosoftAccessToken(fetchImpl, { clientId: 'cid', clientSecret: 'cs', refreshToken }, now),
      createEvent: (accessToken, calendarId, draft) => createMicrosoftEvent(fetchImpl, accessToken, calendarId, draft),
    }
    const { d } = deps({ load: async () => target({ provider: 'microsoft', externalCalendarId: 'AAMkAGI2=' }), writers: { google: null, microsoft } })
    expect((await call(d, post(event({ allDay: true, start: '2026-09-15', end: '2026-09-16' })))).res.status).toBe(200)
    expect(calls[1]!.url).toBe('https://graph.microsoft.com/v1.0/me/calendars/AAMkAGI2%3D/events')
    expect(JSON.parse(String(calls[1]!.init!.body))).toEqual({
      subject: 'Swim lesson',
      isAllDay: true,
      start: { dateTime: '2026-09-15T00:00:00', timeZone: TZ },
      end: { dateTime: '2026-09-16T00:00:00', timeZone: TZ },
    })
  })
})
