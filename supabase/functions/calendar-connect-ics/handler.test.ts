import ICAL from 'ical.js'
import { describe, expect, it, vi } from 'vitest'
import { AuthError } from '../_shared/auth.ts'
import { createIcsParser } from '../_shared/ics.ts'
import { fetchIcsText, type IcsFetchOptions } from '../_shared/icsFetch.ts'
import { createConnectIcsHandler, icsLabel, type ConnectIcsDeps } from './handler.ts'

const HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-000000000001'
const MEMBERSHIP = 'bbbbbbbb-0000-0000-0000-000000000001'
const OTHER_MEMBERSHIP = 'bbbbbbbb-0000-0000-0000-000000000002'
const ENDPOINT = 'http://127.0.0.1:55321/functions/v1/calendar-connect-ics'
const FEED = 'https://calendar.example.com/private/SECRET-TOKEN/basic.ics'
const parser = createIcsParser(ICAL)

const ics = (name: string | null) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//EN',
    ...(name === null ? [] : [`X-WR-CALNAME:${name}`]),
    'BEGIN:VEVENT',
    'UID:1@test',
    'DTSTART:20260914T150000Z',
    'DTEND:20260914T160000Z',
    'SUMMARY:Swim',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n')

function fetchOptions(overrides: Partial<IcsFetchOptions> = {}): IcsFetchOptions {
  return {
    fetch: vi.fn(async () => new Response(ics('Ivy school'))),
    resolveHost: vi.fn(async () => ['93.184.215.14']),
    allowPrivateHosts: false,
    ...overrides,
  }
}

function deps(overrides: Partial<ConnectIcsDeps> = {}, fetchOverrides: Partial<IcsFetchOptions> = {}) {
  const options = fetchOptions(fetchOverrides)
  const d: ConnectIcsDeps = {
    requireFullSignInAdult: vi.fn(async () => MEMBERSHIP),
    allowPrivateHosts: false,
    fetchIcs: vi.fn((url: URL) => fetchIcsText(url, options)),
    readCalendarName: (text) => parser.readIcsCalendarName(text),
    createConnection: vi.fn(async () => 'conn-1'),
    addSelection: vi.fn(async () => 'sel-1'),
    ...overrides,
  }
  return { d, options }
}

const post = (body: unknown, headers: Record<string, string> = { Authorization: 'Bearer adult' }) =>
  new Request(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

async function call(d: ConnectIcsDeps, req: Request) {
  const res = await createConnectIcsHandler(d)(req)
  return { res, body: (await res.json()) as Record<string, unknown> }
}

describe('calendar-connect-ics handler', () => {
  it('answers CORS preflight and refuses other methods', async () => {
    const { d } = deps()
    const pre = await createConnectIcsHandler(d)(new Request(ENDPOINT, { method: 'OPTIONS' }))
    expect(pre.status).toBe(200)
    expect(pre.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
    expect((await createConnectIcsHandler(d)(new Request(ENDPOINT, { method: 'GET' }))).status).toBe(405)
  })

  it('connects a subscription: webcal becomes https, the label is the calendar name, one hidden unassigned selection', async () => {
    const { d, options } = deps()
    const { res, body } = await call(d, post({ householdId: HOUSEHOLD, url: 'webcal://calendar.example.com/private/SECRET-TOKEN/basic.ics' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(body).toEqual({ connectionId: 'conn-1', selectionId: 'sel-1', name: 'Ivy school' })
    expect(options.fetch).toHaveBeenCalledWith(FEED, expect.anything())
    expect(d.createConnection).toHaveBeenCalledWith({ householdId: HOUSEHOLD, membershipId: MEMBERSHIP, label: 'Ivy school', secret: FEED })
    expect(d.addSelection).toHaveBeenCalledWith({ connectionId: 'conn-1', externalCalendarId: 'ics', name: 'Ivy school' })
  })

  it('creates the connection for the caller\'s own membership, never one named in the request', async () => {
    const { d } = deps()
    await call(d, post({ householdId: HOUSEHOLD, url: FEED, membershipId: OTHER_MEMBERSHIP, membership_id: OTHER_MEMBERSHIP }))
    expect(d.requireFullSignInAdult).toHaveBeenCalledWith(expect.any(Request), HOUSEHOLD)
    expect(d.createConnection).toHaveBeenCalledWith(expect.objectContaining({ membershipId: MEMBERSHIP }))
    expect(JSON.stringify(vi.mocked(d.createConnection).mock.calls)).not.toContain(OTHER_MEMBERSHIP)
  })

  it('uses "Calendar subscription" when the calendar has no name', async () => {
    const { d } = deps({}, { fetch: vi.fn(async () => new Response(ics(null))) })
    const { body } = await call(d, post({ householdId: HOUSEHOLD, url: FEED }))
    expect(body.name).toBe('Calendar subscription')
    expect(d.createConnection).toHaveBeenCalledWith(expect.objectContaining({ label: 'Calendar subscription' }))
  })

  it('never uses the URL as the label, even when the calendar is named after it', async () => {
    for (const name of [FEED, 'webcal://calendar.example.com/private/SECRET-TOKEN/basic.ics', 'Feed at /private/SECRET-TOKEN/basic.ics']) {
      const { d } = deps({}, { fetch: vi.fn(async () => new Response(ics(name))) })
      const { body } = await call(d, post({ householdId: HOUSEHOLD, url: FEED }))
      expect(body.name, name).toBe('Calendar subscription')
      const label = vi.mocked(d.createConnection).mock.calls[0]![0].label
      expect(label).not.toContain('SECRET-TOKEN')
      expect(label).not.toMatch(/:\/\//)
    }
  })

  it('cuts long names to 200 characters', () => {
    expect(icsLabel('x'.repeat(300), new URL(FEED))).toHaveLength(200)
    expect(icsLabel('  Soccer   club  ', new URL(FEED))).toBe('Soccer club')
  })

  it('refuses callers who are not full sign-in adults before fetching anything', async () => {
    for (const status of [401, 403] as const) {
      const { d, options } = deps({ requireFullSignInAdult: vi.fn(async () => { throw new AuthError(status, 'forbidden') }) })
      const { res, body } = await call(d, post({ householdId: HOUSEHOLD, url: FEED }))
      expect(res.status).toBe(status)
      expect(body).toEqual({ error: 'forbidden' })
      expect(options.fetch).not.toHaveBeenCalled()
      expect(d.createConnection).not.toHaveBeenCalled()
    }
  })

  it('rejects a malformed body', async () => {
    const { d } = deps()
    for (const body of [{}, { householdId: 'nope', url: FEED }, [HOUSEHOLD]]) {
      const { res, body: out } = await call(d, post(body))
      expect(res.status).toBe(400)
      expect(out).toEqual({ error: 'invalid_request' })
    }
    expect(d.requireFullSignInAdult).not.toHaveBeenCalled()
  })

  it('rejects invalid URLs: other schemes, credentials, ports, private addresses', async () => {
    for (const url of [
      'http://calendar.example.com/a.ics',
      'https://me:pw@calendar.example.com/a.ics',
      'https://calendar.example.com:444/a.ics',
      'https://10.0.0.5/a.ics',
      'https://[fd00::1]/a.ics',
      'ftp://x.example.com/a.ics',
      '',
      null,
    ]) {
      const { d, options } = deps()
      const { res, body } = await call(d, post({ householdId: HOUSEHOLD, url }))
      expect(res.status, String(url)).toBe(400)
      expect(body).toEqual({ error: 'invalid_url' })
      expect(options.fetch).not.toHaveBeenCalled()
    }
  })

  it('rejects a host that resolves to a private address, and a redirect to one', async () => {
    let { d } = deps({}, { resolveHost: vi.fn(async () => ['127.0.0.1']) })
    expect((await call(d, post({ householdId: HOUSEHOLD, url: FEED }))).body).toEqual({ error: 'invalid_url' })

    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { Location: 'https://metadata.example.com/latest' } }))
    const resolveHost = vi.fn(async (host: string) => (host === 'metadata.example.com' ? ['169.254.169.254'] : ['93.184.215.14']))
    ;({ d } = deps({}, { fetch, resolveHost }))
    const { res, body } = await call(d, post({ householdId: HOUSEHOLD, url: FEED }))
    expect(res.status).toBe(400)
    expect(body).toEqual({ error: 'invalid_url' })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(d.createConnection).not.toHaveBeenCalled()
  })

  it('reports an oversized calendar as too_large', async () => {
    const big = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(256_000))
      },
    })
    const { d } = deps({}, { fetch: vi.fn(async () => new Response(big)) })
    const { res, body } = await call(d, post({ householdId: HOUSEHOLD, url: FEED }))
    expect(res.status).toBe(413)
    expect(body).toEqual({ error: 'too_large' })
    expect(d.createConnection).not.toHaveBeenCalled()
  })

  it('reports something that is not an iCalendar as not_a_calendar', async () => {
    const { d } = deps({}, { fetch: vi.fn(async () => new Response('<html><body>Sign in</body></html>')) })
    const { res, body } = await call(d, post({ householdId: HOUSEHOLD, url: FEED }))
    expect(res.status).toBe(422)
    expect(body).toEqual({ error: 'not_a_calendar' })
    expect(d.createConnection).not.toHaveBeenCalled()
  })

  it('reports unreachable, failing and revoked links as unreachable', async () => {
    for (const fetch of [
      vi.fn(async () => new Response('gone', { status: 404 })),
      vi.fn(async () => new Response('oops', { status: 500 })),
      vi.fn(async () => {
        throw new TypeError('dns')
      }),
    ]) {
      const { d } = deps({}, { fetch })
      const { res, body } = await call(d, post({ householdId: HOUSEHOLD, url: FEED }))
      expect(res.status).toBe(502)
      expect(body).toEqual({ error: 'unreachable' })
    }
  })

  it('maps a membership that changed meanwhile to forbidden, other failures to a generic 500 without the URL in logs', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    let { d } = deps({ createConnection: vi.fn(async () => { throw Object.assign(new Error('member not found'), { code: '42501' }) }) })
    expect((await call(d, post({ householdId: HOUSEHOLD, url: FEED }))).res.status).toBe(403)
    ;({ d } = deps({ addSelection: vi.fn(async () => { throw new Error('db down') }) }))
    const { res, body } = await call(d, post({ householdId: HOUSEHOLD, url: FEED }))
    expect(res.status).toBe(500)
    expect(body).toEqual({ error: 'internal' })
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET-TOKEN')
    log.mockRestore()
  })
})
