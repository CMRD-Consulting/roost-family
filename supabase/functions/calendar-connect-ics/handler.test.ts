import ICAL from 'ical.js'
import { describe, expect, it, vi } from 'vitest'
import { AuthError } from '../_shared/auth.ts'
import { createIcsParser } from '../_shared/ics.ts'
import { fetchIcsFiltered, type IcsFetchOptions } from '../_shared/icsFetch.ts'
import { hmacSha256Hex } from '../_shared/pkce.ts'
import { createConnectIcsHandler, icsLabel, type ConnectIcsDeps } from './handler.ts'

const HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-000000000001'
const MEMBERSHIP = 'bbbbbbbb-0000-0000-0000-000000000001'
const OTHER_MEMBERSHIP = 'bbbbbbbb-0000-0000-0000-000000000002'
const ENDPOINT = 'http://127.0.0.1:55321/functions/v1/calendar-connect-ics'
const FEED = 'https://calendar.example.com/private/SECRET-TOKEN/basic.ics'
const parser = createIcsParser(ICAL)
const KEY = 'k'.repeat(32)

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
    requirePinMembership: vi.fn(async (_req: Request, _householdId: string, membershipId: string) => membershipId),
    allowPrivateHosts: false,
    fetchIcs: vi.fn(async (url: URL) => (await fetchIcsFiltered(url, options, { headerOnly: true })).text),
    readCalendarName: (text) => parser.readIcsCalendarName(text),
    fingerprint: vi.fn((value: string) => hmacSha256Hex(KEY, value)),
    recordConnectAttempt: vi.fn(async () => true),
    connect: vi.fn(async (input) => ({ connectionId: 'conn-1', alreadyConnected: false, label: input.label, selectionIds: ['sel-1'] })),
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
    expect(body).toEqual({ connectionId: 'conn-1', selectionId: 'sel-1', name: 'Ivy school', alreadyConnected: false })
    expect(options.fetch).toHaveBeenCalledWith(FEED, expect.anything())
    expect(d.recordConnectAttempt).toHaveBeenCalledWith(MEMBERSHIP)
    expect(d.connect).toHaveBeenCalledWith({
      householdId: HOUSEHOLD,
      membershipId: MEMBERSHIP,
      label: 'Ivy school',
      secret: FEED,
      fingerprint: await hmacSha256Hex(KEY, `ics:${FEED}`),
      calendars: [{ id: 'ics', name: 'Ivy school' }],
    })
  })

  it('creates the connection for the caller\'s own membership, never one named in the request', async () => {
    const { d } = deps()
    await call(d, post({ householdId: HOUSEHOLD, url: FEED, membershipId: OTHER_MEMBERSHIP, membership_id: OTHER_MEMBERSHIP }))
    expect(d.requireFullSignInAdult).toHaveBeenCalledWith(expect.any(Request), HOUSEHOLD)
    expect(d.connect).toHaveBeenCalledWith(expect.objectContaining({ membershipId: MEMBERSHIP }))
    expect(JSON.stringify(vi.mocked(d.connect).mock.calls)).not.toContain(OTHER_MEMBERSHIP)
  })

  it('uses "Calendar subscription" when the calendar has no name', async () => {
    const { d } = deps({}, { fetch: vi.fn(async () => new Response(ics(null))) })
    const { body } = await call(d, post({ householdId: HOUSEHOLD, url: FEED }))
    expect(body.name).toBe('Calendar subscription')
    expect(d.connect).toHaveBeenCalledWith(expect.objectContaining({ label: 'Calendar subscription' }))
  })

  it('never uses the URL as the label, even when the calendar is named after it', async () => {
    for (const name of [FEED, 'webcal://calendar.example.com/private/SECRET-TOKEN/basic.ics', 'Feed at /private/SECRET-TOKEN/basic.ics']) {
      const { d } = deps({}, { fetch: vi.fn(async () => new Response(ics(name))) })
      const { body } = await call(d, post({ householdId: HOUSEHOLD, url: FEED }))
      expect(body.name, name).toBe('Calendar subscription')
      const label = vi.mocked(d.connect).mock.calls[0]![0].label
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
      expect(d.connect).not.toHaveBeenCalled()
    }
  })

  it('connects from a display with the Settings PIN instead of a full sign-in', async () => {
    const { d } = deps()
    const { res, body } = await call(
      d,
      post({ householdId: HOUSEHOLD, url: FEED, membershipId: MEMBERSHIP, pin: '1234' }, { Authorization: 'Bearer display' }),
    )
    expect(res.status).toBe(200)
    expect(body).toEqual({ connectionId: 'conn-1', selectionId: 'sel-1', name: 'Ivy school', alreadyConnected: false })
    expect(d.requirePinMembership).toHaveBeenCalledWith(expect.any(Request), HOUSEHOLD, MEMBERSHIP, '1234')
    expect(d.requireFullSignInAdult).not.toHaveBeenCalled()
    expect(d.recordConnectAttempt).toHaveBeenCalledWith(MEMBERSHIP)
    expect(d.connect).toHaveBeenCalledWith(expect.objectContaining({ householdId: HOUSEHOLD, membershipId: MEMBERSHIP }))
  })

  it('connects for the membership the PIN check confirmed, never the one in the body', async () => {
    const { d } = deps({ requirePinMembership: vi.fn(async () => MEMBERSHIP) })
    await call(d, post({ householdId: HOUSEHOLD, url: FEED, membershipId: OTHER_MEMBERSHIP, pin: '1234' }))
    expect(d.connect).toHaveBeenCalledWith(expect.objectContaining({ membershipId: MEMBERSHIP }))
    expect(JSON.stringify(vi.mocked(d.connect).mock.calls)).not.toContain(OTHER_MEMBERSHIP)
  })

  it('refuses a wrong PIN, and a caregiver, before fetching anything', async () => {
    for (const status of [401, 403] as const) {
      const { d, options } = deps({ requirePinMembership: vi.fn(async () => { throw new AuthError(status, 'forbidden') }) })
      const { res, body } = await call(d, post({ householdId: HOUSEHOLD, url: FEED, membershipId: MEMBERSHIP, pin: '0000' }))
      expect(res.status).toBe(status)
      expect(body).toEqual({ error: 'forbidden' })
      expect(options.fetch).not.toHaveBeenCalled()
      expect(d.recordConnectAttempt).not.toHaveBeenCalled()
      expect(d.connect).not.toHaveBeenCalled()
    }
  })

  it('rejects a PIN without a well-formed membership id, without checking anything', async () => {
    const { d } = deps()
    for (const body of [{ pin: '1234' }, { membershipId: 'nope', pin: '1234' }, { membershipId: MEMBERSHIP, pin: 1234 }]) {
      const { res, body: out } = await call(d, post({ householdId: HOUSEHOLD, url: FEED, ...body }))
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(out).toEqual({ error: 'invalid_request' })
    }
    expect(d.requirePinMembership).not.toHaveBeenCalled()
    expect(d.requireFullSignInAdult).not.toHaveBeenCalled()
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

  it('rejects invalid URLs: other schemes, credentials, ports', async () => {
    for (const url of [
      'http://calendar.example.com/a.ics',
      'https://me:pw@calendar.example.com/a.ics',
      'https://calendar.example.com:444/a.ics',
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

  it('answers blocked hosts exactly like unreachable ones, so internal names cannot be probed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const unreachable = await call(deps({}, { fetch: vi.fn(async () => { throw new TypeError('dns') }) }).d, post({ householdId: HOUSEHOLD, url: FEED }))
    for (const [url, fetchOverrides] of [
      ['https://10.0.0.5/a.ics', {}],
      ['https://[fd00::1]/a.ics', {}],
      ['https://intranet.corp.internal/a.ics', {}],
      [FEED, { resolveHost: vi.fn(async () => ['127.0.0.1']) }],
      [
        FEED,
        {
          fetch: vi.fn(async () => new Response(null, { status: 302, headers: { Location: 'https://metadata.example.com/latest' } })),
          resolveHost: vi.fn(async (host: string) => (host === 'metadata.example.com' ? ['169.254.169.254'] : ['93.184.215.14'])),
        },
      ],
    ] as const) {
      const { d } = deps({}, fetchOverrides)
      const blocked = await call(d, post({ householdId: HOUSEHOLD, url }))
      expect(blocked.res.status, url).toBe(unreachable.res.status)
      expect(blocked.body).toEqual(unreachable.body)
      expect(d.connect).not.toHaveBeenCalled()
    }
    expect(unreachable).toMatchObject({ body: { error: 'unreachable' } })
    expect(unreachable.res.status).toBe(422)
    expect(JSON.stringify(warn.mock.calls)).toContain('blocked_host')
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/intranet|metadata|10\.0\.0\.5/)
    warn.mockRestore()
  })

  it('returns the existing connection when the same link is connected again', async () => {
    const { d } = deps({ connect: vi.fn(async () => ({ connectionId: 'conn-old', alreadyConnected: true, label: 'Old name', selectionIds: ['sel-old'] })) })
    const { res, body } = await call(d, post({ householdId: HOUSEHOLD, url: FEED }))
    expect(res.status).toBe(200)
    expect(body).toEqual({ connectionId: 'conn-old', selectionId: 'sel-old', name: 'Old name', alreadyConnected: true })
  })

  it('fingerprints the normalized URL, so webcal and https forms of one link match', async () => {
    const { d } = deps()
    await call(d, post({ householdId: HOUSEHOLD, url: 'webcal://calendar.example.com/private/SECRET-TOKEN/basic.ics#frag' }))
    await call(d, post({ householdId: HOUSEHOLD, url: FEED }))
    const [a, b] = vi.mocked(d.connect).mock.calls.map((c) => c[0].fingerprint)
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toContain('SECRET')
  })

  it('refuses more attempts than the hourly limit before fetching', async () => {
    const { d, options } = deps({ recordConnectAttempt: vi.fn(async () => false) })
    const { res, body } = await call(d, post({ householdId: HOUSEHOLD, url: FEED }))
    expect(res.status).toBe(429)
    expect(body).toEqual({ error: 'rate_limited' })
    expect(options.fetch).not.toHaveBeenCalled()
  })

  it('answers not_configured without a fingerprint key', async () => {
    const { d, options } = deps({ fingerprint: null })
    const { res, body } = await call(d, post({ householdId: HOUSEHOLD, url: FEED }))
    expect(res.status).toBe(503)
    expect(body).toEqual({ error: 'not_configured' })
    expect(options.fetch).not.toHaveBeenCalled()
  })

  it('reports a calendar that declares more than the download budget as too_large', async () => {
    const fetch = vi.fn(async () => new Response(ics('Ivy school'), { headers: { 'Content-Length': String(30_000_000) } }))
    const { d } = deps({}, { fetch })
    const { res, body } = await call(d, post({ householdId: HOUSEHOLD, url: FEED }))
    expect(res.status).toBe(413)
    expect(body).toEqual({ error: 'too_large' })
    expect(d.connect).not.toHaveBeenCalled()
  })

  it('connects a calendar with years of history without reading past its header', async () => {
    let pulled = 0
    const head = new TextEncoder().encode('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Ivy school\r\n')
    const event = new TextEncoder().encode('BEGIN:VEVENT\r\nUID:x@t\r\nDTSTART:20100101T120000Z\r\nSUMMARY:Old\r\nEND:VEVENT\r\n'.repeat(2_000))
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(head)
      },
      pull(controller) {
        pulled++
        controller.enqueue(event.slice())
      },
    })
    const { d } = deps({}, { fetch: vi.fn(async () => new Response(body)) })
    const { res, body: answer } = await call(d, post({ householdId: HOUSEHOLD, url: FEED }))
    expect(res.status).toBe(200)
    expect(answer.name).toBe('Ivy school')
    expect(pulled).toBeLessThanOrEqual(2)
  })

  it('reports something that is not an iCalendar as not_a_calendar', async () => {
    const { d } = deps({}, { fetch: vi.fn(async () => new Response('<html><body>Sign in</body></html>')) })
    const { res, body } = await call(d, post({ householdId: HOUSEHOLD, url: FEED }))
    expect(res.status).toBe(422)
    expect(body).toEqual({ error: 'not_a_calendar' })
    expect(d.connect).not.toHaveBeenCalled()
  })

  it('reports unreachable, failing and revoked links as unreachable (422)', async () => {
    for (const fetch of [
      vi.fn(async () => new Response('gone', { status: 404 })),
      vi.fn(async () => new Response('oops', { status: 500 })),
      vi.fn(async () => {
        throw new TypeError('dns')
      }),
    ]) {
      const { d } = deps({}, { fetch })
      const { res, body } = await call(d, post({ householdId: HOUSEHOLD, url: FEED }))
      expect(res.status).toBe(422)
      expect(body).toEqual({ error: 'unreachable' })
    }
  })

  it('maps a membership that changed meanwhile to forbidden, other failures to a generic 500 without the URL in logs', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    let { d } = deps({ connect: vi.fn(async () => { throw Object.assign(new Error('member not found'), { code: '42501' }) }) })
    expect((await call(d, post({ householdId: HOUSEHOLD, url: FEED }))).res.status).toBe(403)
    ;({ d } = deps({ connect: vi.fn(async () => { throw new Error('db down') }) }))
    const { res, body } = await call(d, post({ householdId: HOUSEHOLD, url: FEED }))
    expect(res.status).toBe(500)
    expect(body).toEqual({ error: 'internal' })
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET-TOKEN')
    log.mockRestore()
  })
})
