import { describe, expect, it } from 'vitest'
import { CalendarProviderError, emailFromIdToken, subjectFromIdToken } from './calendarProvider'
import { householdDayWindow } from './events'
import {
  buildGoogleAuthUrl,
  classifyGoogleError,
  exchangeGoogleCode,
  listGoogleCalendars,
  listGoogleEventsForDay,
  mapGoogleCalendarList,
  mapGoogleEvents,
  parseGoogleTokenResponse,
  refreshGoogleAccessToken,
} from './google'

const TZ = 'America/New_York'
const NOW = new Date('2026-09-14T16:00:00Z')

/** Recorded shape of `GET /calendar/v3/users/me/calendarList`. */
const calendarListFixture = {
  kind: 'calendar#calendarList',
  etag: '"p33c9ro2pdm8fe0o"',
  nextSyncToken: 'CPDAlvWDx70CEPDAlvWDx70CGAU=',
  items: [
    {
      kind: 'calendar#calendarListEntry',
      etag: '"1690000000000000"',
      id: 'sam@example.com',
      summary: 'sam@example.com',
      timeZone: 'America/New_York',
      colorId: '14',
      backgroundColor: '#9fe1e7',
      foregroundColor: '#000000',
      selected: true,
      accessRole: 'owner',
      defaultReminders: [{ method: 'popup', minutes: 10 }],
      primary: true,
    },
    {
      kind: 'calendar#calendarListEntry',
      id: 'abc123@group.calendar.google.com',
      summary: 'Kids activities',
      summaryOverride: 'Mara & Theo',
      description: 'Shared with grandparents',
      accessRole: 'writer',
    },
    {
      kind: 'calendar#calendarListEntry',
      id: 'en.usa#holiday@group.v.calendar.google.com',
      summary: 'Holidays in United States',
      accessRole: 'reader',
    },
    { kind: 'calendar#calendarListEntry', id: 'gone@group.calendar.google.com', summary: 'Old', deleted: true },
    { kind: 'calendar#calendarListEntry', summary: 'No id' },
  ],
}

/** Recorded shape of `GET /calendar/v3/calendars/{id}/events?singleEvents=true&orderBy=startTime`. */
const eventsFixture = {
  kind: 'calendar#events',
  summary: 'sam@example.com',
  timeZone: 'America/New_York',
  accessRole: 'owner',
  nextPageToken: 'page-2',
  items: [
    {
      kind: 'calendar#event',
      id: 'evt1',
      status: 'confirmed',
      htmlLink: 'https://www.google.com/calendar/event?eid=ZXZ0MQ',
      summary: 'Dentist',
      description: 'Bring the insurance card',
      location: '12 Oak St, Raleigh, NC',
      creator: { email: 'sam@example.com', self: true },
      organizer: { email: 'sam@example.com', self: true },
      start: { dateTime: '2026-09-14T09:30:00-04:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-09-14T10:30:00-04:00', timeZone: 'America/New_York' },
      attendees: [{ email: 'office@example.com', responseStatus: 'accepted' }],
      hangoutLink: 'https://meet.google.com/abc-defg-hij',
      conferenceData: { entryPoints: [{ uri: 'https://meet.google.com/abc-defg-hij' }] },
    },
    {
      kind: 'calendar#event',
      id: 'evt2',
      status: 'confirmed',
      summary: 'Teacher workday',
      start: { date: '2026-09-14' },
      end: { date: '2026-09-15' },
    },
    {
      kind: 'calendar#event',
      id: 'evt3_20260914T200000Z',
      status: 'cancelled',
      recurringEventId: 'evt3',
      originalStartTime: { dateTime: '2026-09-14T16:00:00-04:00' },
    },
    {
      kind: 'calendar#event',
      id: 'evt4_20260914T210000Z',
      status: 'tentative',
      recurringEventId: 'evt4',
      start: { dateTime: '2026-09-14T21:00:00Z', timeZone: 'UTC' },
      end: { dateTime: '2026-09-14T22:00:00Z', timeZone: 'UTC' },
      visibility: 'private',
    },
    {
      kind: 'calendar#event',
      id: 'declined',
      status: 'confirmed',
      summary: 'Declined meeting',
      start: { dateTime: '2026-09-14T11:00:00-04:00' },
      end: { dateTime: '2026-09-14T12:00:00-04:00' },
      attendees: [
        { email: 'boss@example.com', responseStatus: 'accepted', organizer: true },
        { email: 'sam@example.com', self: true, responseStatus: 'declined' },
      ],
    },
    {
      kind: 'calendar#event',
      id: 'accepted',
      status: 'confirmed',
      summary: 'School meeting',
      eventType: 'default',
      start: { dateTime: '2026-09-14T15:00:00-04:00' },
      end: { dateTime: '2026-09-14T15:30:00-04:00' },
      attendees: [
        { email: 'teacher@example.com', displayName: 'Ms. Lee', responseStatus: 'accepted' },
        { email: 'sam@example.com', self: true, responseStatus: 'needsAction' },
      ],
    },
    {
      kind: 'calendar#event',
      id: 'wfh',
      status: 'confirmed',
      summary: 'Home',
      eventType: 'workingLocation',
      start: { date: '2026-09-14' },
      end: { date: '2026-09-15' },
      workingLocationProperties: { type: 'homeOffice', homeOffice: {} },
    },
    {
      kind: 'calendar#event',
      id: 'focus',
      status: 'confirmed',
      summary: 'Focus time',
      eventType: 'focusTime',
      start: { dateTime: '2026-09-14T13:00:00-04:00' },
      end: { dateTime: '2026-09-14T14:00:00-04:00' },
    },
    { kind: 'calendar#event', id: 'broken', status: 'confirmed', summary: 'Broken', start: {}, end: {} },
  ],
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('mapGoogleCalendarList', () => {
  it('maps entries to calendars, preferring the user’s own name and skipping deleted or id-less entries', () => {
    expect(mapGoogleCalendarList(calendarListFixture)).toEqual({
      calendars: [
        { externalCalendarId: 'sam@example.com', name: 'sam@example.com', primary: true },
        { externalCalendarId: 'abc123@group.calendar.google.com', name: 'Mara & Theo', primary: false },
        { externalCalendarId: 'en.usa#holiday@group.v.calendar.google.com', name: 'Holidays in United States', primary: false },
      ],
      nextPageToken: null,
    })
  })

  it('returns the next page token and tolerates a missing items array', () => {
    expect(mapGoogleCalendarList({ nextPageToken: 'abc' })).toEqual({ calendars: [], nextPageToken: 'abc' })
    expect(mapGoogleCalendarList(null)).toEqual({ calendars: [], nextPageToken: null })
  })
})

describe('mapGoogleEvents', () => {
  it('maps timed and all-day events to the shared shape, dropping cancelled, declined, working-location, focus-time and unusable ones', () => {
    const { events, nextPageToken } = mapGoogleEvents(eventsFixture, TZ)
    expect(nextPageToken).toBe('page-2')
    expect(events).toEqual([
      { title: 'Dentist', startAt: '2026-09-14T13:30:00.000Z', endAt: '2026-09-14T14:30:00.000Z', allDay: false, location: '12 Oak St, Raleigh, NC' },
      { title: 'Teacher workday', startAt: '2026-09-14T04:00:00.000Z', endAt: '2026-09-15T04:00:00.000Z', allDay: true, location: null },
      { title: '(No title)', startAt: '2026-09-14T21:00:00.000Z', endAt: '2026-09-14T22:00:00.000Z', allDay: false, location: null },
      { title: 'School meeting', startAt: '2026-09-14T19:00:00.000Z', endAt: '2026-09-14T19:30:00.000Z', allDay: false, location: null },
    ])
    expect(JSON.stringify(events)).not.toMatch(/insurance|meet\.google|office@example|teacher@example|Ms\. Lee|needsAction/)
  })
})

describe('parseGoogleTokenResponse', () => {
  it('reads the access token and computes its expiry', () => {
    const token = parseGoogleTokenResponse(
      200,
      { access_token: 'ya29.a0Af', expires_in: 3599, scope: 'https://www.googleapis.com/auth/calendar.readonly', token_type: 'Bearer' },
      NOW,
    )
    expect(token).toEqual({ accessToken: 'ya29.a0Af', expiresAt: new Date('2026-09-14T16:59:59Z'), refreshToken: null })
  })

  it('returns a refresh token when Google sends one (code exchange)', () => {
    expect(parseGoogleTokenResponse(200, { access_token: 'a', expires_in: 3600, refresh_token: '1//0g' }, NOW).refreshToken).toBe('1//0g')
  })

  it('throws auth_expired for invalid_grant and unreachable for a malformed success', () => {
    const expired = () =>
      parseGoogleTokenResponse(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, NOW)
    expect(expired).toThrow(CalendarProviderError)
    expect(catchStatus(expired)).toBe('auth_expired')
    expect(catchStatus(() => parseGoogleTokenResponse(200, { token_type: 'Bearer' }, NOW))).toBe('unreachable')
  })
})

describe('classifyGoogleError', () => {
  it('treats revoked or expired credentials as auth_expired', () => {
    expect(classifyGoogleError(400, { error: 'invalid_grant' })).toBe('auth_expired')
    expect(classifyGoogleError(401, { error: { code: 401, status: 'UNAUTHENTICATED', errors: [{ reason: 'authError' }] } })).toBe('auth_expired')
    expect(classifyGoogleError(403, { error: { code: 403, errors: [{ reason: 'insufficientPermissions' }] } })).toBe('auth_expired')
    expect(classifyGoogleError(403, { error: { code: 403, errors: [{ reason: 'forbidden' }] } })).toBe('auth_expired')
    expect(classifyGoogleError(403, { error: { code: 403, errors: [{ reason: 'authError' }] } })).toBe('auth_expired')
  })

  it('reports a missing calendar as calendar_gone, for that selection only', () => {
    expect(classifyGoogleError(404, { error: { code: 404, errors: [{ reason: 'notFound' }] } })).toBe('calendar_gone')
    expect(classifyGoogleError(410, { error: { code: 410, errors: [{ reason: 'deleted' }] } })).toBe('calendar_gone')
  })

  it('treats rate limits, server errors and our own misconfiguration as unreachable', () => {
    expect(classifyGoogleError(403, { error: { code: 403, errors: [{ reason: 'rateLimitExceeded' }] } })).toBe('unreachable')
    expect(classifyGoogleError(403, { error: { code: 403, errors: [{ reason: 'userRateLimitExceeded' }] } })).toBe('unreachable')
    expect(classifyGoogleError(403, { error: { code: 403, errors: [{ reason: 'dailyLimitExceeded' }] } })).toBe('unreachable')
    expect(classifyGoogleError(403, { error: { code: 403, errors: [{ reason: 'accessNotConfigured' }] } })).toBe('unreachable')
    expect(classifyGoogleError(403, { error: { code: 403, status: 'PERMISSION_DENIED' } })).toBe('unreachable')
    expect(classifyGoogleError(403, '<html>Forbidden</html>')).toBe('unreachable')
    expect(classifyGoogleError(429, {})).toBe('unreachable')
    expect(classifyGoogleError(500, 'Internal error')).toBe('unreachable')
    expect(classifyGoogleError(503, null)).toBe('unreachable')
    expect(classifyGoogleError(401, { error: 'invalid_client' })).toBe('unreachable')
    expect(classifyGoogleError(400, { error: { code: 400, errors: [{ reason: 'badRequest' }] } })).toBe('unreachable')
  })
})

describe('Google network paths (injected fetch)', () => {
  it('refreshes an access token with a form-encoded POST', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const token = await refreshGoogleAccessToken(
      async (url, init) => {
        calls.push({ url, init })
        return jsonResponse(200, { access_token: 'fresh', expires_in: 3600 })
      },
      { clientId: 'cid', clientSecret: 'secret', refreshToken: 'rt' },
      NOW,
    )
    expect(token.accessToken).toBe('fresh')
    expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/token')
    expect(calls[0]!.init!.method).toBe('POST')
    const body = new URLSearchParams(String(calls[0]!.init!.body))
    expect(Object.fromEntries(body)).toEqual({ grant_type: 'refresh_token', client_id: 'cid', client_secret: 'secret', refresh_token: 'rt' })
  })

  it('reports a network failure as unreachable', async () => {
    const failing = async () => {
      throw new TypeError('fetch failed')
    }
    await expect(
      refreshGoogleAccessToken(failing, { clientId: 'c', clientSecret: 's', refreshToken: 'r' }, NOW).catch((e: CalendarProviderError) => e.status),
    ).resolves.toBe('unreachable')
  })

  it('lists calendars across pages with the bearer token', async () => {
    const urls: string[] = []
    const calendars = await listGoogleCalendars(async (url, init) => {
      urls.push(url)
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer tok')
      return url.includes('pageToken=p2')
        ? jsonResponse(200, { items: [{ id: 'b', summary: 'B' }] })
        : jsonResponse(200, { items: [{ id: 'a', summary: 'A', primary: true }], nextPageToken: 'p2' })
    }, 'tok')
    expect(calendars.map((c) => c.externalCalendarId)).toEqual(['a', 'b'])
    expect(urls[0]).toMatch(/^https:\/\/www\.googleapis\.com\/calendar\/v3\/users\/me\/calendarList\?/)
  })

  it('lists the day’s events with singleEvents, a window widened by a day each side, event types and a minimal field mask', async () => {
    const window = householdDayWindow(NOW, TZ)
    let requested = ''
    const events = await listGoogleEventsForDay(
      async (url) => {
        requested = url
        return jsonResponse(200, { ...eventsFixture, nextPageToken: undefined })
      },
      'tok',
      'abc123@group.calendar.google.com',
      window,
      TZ,
    )
    const url = new URL(requested)
    expect(url.pathname).toBe('/calendar/v3/calendars/abc123%40group.calendar.google.com/events')
    expect(url.searchParams.get('singleEvents')).toBe('true')
    expect(url.searchParams.get('timeMin')).toBe('2026-09-13T04:00:00.000Z')
    expect(url.searchParams.get('timeMax')).toBe('2026-09-16T04:00:00.000Z')
    const fields = url.searchParams.get('fields')!
    expect(fields).toContain('attendees(self,responseStatus)')
    expect(fields).toContain('eventType')
    expect(fields).not.toMatch(/description|email|displayName|hangoutLink|conferenceData|htmlLink/)
    expect(url.searchParams.getAll('eventTypes')).toContain('default')
    expect(url.searchParams.getAll('eventTypes')).not.toContain('workingLocation')
    expect(url.searchParams.getAll('eventTypes')).not.toContain('focusTime')
    expect(events.map((e) => e.title)).toEqual(['Dentist', 'Teacher workday', '(No title)', 'School meeting'])
  })

  it('throws calendar_gone for a 404 on one calendar, but not for the calendar list or token', async () => {
    const window = householdDayWindow(NOW, TZ)
    const notFound = async () => jsonResponse(404, { error: { code: 404, errors: [{ reason: 'notFound' }] } })
    expect(await listGoogleEventsForDay(notFound, 'tok', 'gone', window, TZ).catch((e: CalendarProviderError) => e.status)).toBe('calendar_gone')
    expect(await listGoogleCalendars(notFound, 'tok').catch((e: CalendarProviderError) => e.status)).toBe('unreachable')
    expect(
      await refreshGoogleAccessToken(notFound, { clientId: 'c', clientSecret: 's', refreshToken: 'r' }, NOW).catch((e: CalendarProviderError) => e.status),
    ).toBe('unreachable')
  })

  it('throws auth_expired when the events call returns 401', async () => {
    const window = householdDayWindow(NOW, TZ)
    const status = await listGoogleEventsForDay(async () => jsonResponse(401, { error: { code: 401 } }), 'tok', 'primary', window, TZ).catch(
      (e: CalendarProviderError) => e.status,
    )
    expect(status).toBe('auth_expired')
  })
})

function catchStatus(run: () => unknown): string | undefined {
  try {
    run()
    return undefined
  } catch (e) {
    return (e as CalendarProviderError).status
  }
}

function idToken(claims: Record<string, unknown>): string {
  const b64 = (v: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(v)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64({ alg: 'RS256' })}.${b64(claims)}.signature`
}

describe('Google account connection (authorization code + PKCE)', () => {
  it('builds the consent URL with offline access, forced consent, the read-only scope and the S256 challenge', () => {
    const url = new URL(buildGoogleAuthUrl({ clientId: 'cid', redirectUri: 'https://x.test/functions/v1/calendar-oauth-callback', state: 'st', codeChallenge: 'ch' }))
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'cid',
      redirect_uri: 'https://x.test/functions/v1/calendar-oauth-callback',
      response_type: 'code',
      scope: 'openid email https://www.googleapis.com/auth/calendar.readonly',
      access_type: 'offline',
      prompt: 'consent',
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
    })
  })

  it('exchanges the code with the verifier and reads the refresh token and email', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const result = await exchangeGoogleCode(
      async (url, init) => {
        calls.push({ url, init })
        return jsonResponse(200, { access_token: 'at', expires_in: 3599, refresh_token: 'rt', id_token: idToken({ sub: '1098765', email: 'sam@example.com' }) })
      },
      { clientId: 'cid', clientSecret: 'cs', code: 'code-1', codeVerifier: 'v'.repeat(43), redirectUri: 'https://x.test/cb' },
      NOW,
    )
    expect(result).toEqual({
      token: { accessToken: 'at', expiresAt: new Date(NOW.getTime() + 3599_000), refreshToken: 'rt' },
      email: 'sam@example.com',
      subject: '1098765',
    })
    expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/token')
    expect(Object.fromEntries(new URLSearchParams(String(calls[0]!.init!.body)))).toEqual({
      grant_type: 'authorization_code',
      client_id: 'cid',
      client_secret: 'cs',
      code: 'code-1',
      code_verifier: 'v'.repeat(43),
      redirect_uri: 'https://x.test/cb',
    })
  })

  it('reports a rejected code as auth_expired and a network failure as unreachable', async () => {
    const input = { clientId: 'c', clientSecret: 's', code: 'bad', codeVerifier: 'v'.repeat(43), redirectUri: 'https://x.test/cb' }
    await expect(exchangeGoogleCode(async () => jsonResponse(400, { error: 'invalid_grant' }), input, NOW).catch((e: CalendarProviderError) => e.status)).resolves.toBe('auth_expired')
    await expect(exchangeGoogleCode(async () => { throw new TypeError('x') }, input, NOW).catch((e: CalendarProviderError) => e.status)).resolves.toBe('unreachable')
  })
})

describe('emailFromIdToken', () => {
  it('reads email, else an email-shaped preferred_username', () => {
    expect(emailFromIdToken(idToken({ email: 'sam@example.com', preferred_username: 'other@example.com' }))).toBe('sam@example.com')
    expect(emailFromIdToken(idToken({ preferred_username: 'alex@contoso.com' }))).toBe('alex@contoso.com')
    expect(emailFromIdToken(idToken({ email: 'Zoë@exämple.com' }))).toBe('Zoë@exämple.com')
  })

  it('reads the first present subject claim', () => {
    expect(subjectFromIdToken(idToken({ sub: 's-1', oid: 'o-1' }), ['oid', 'sub'])).toBe('o-1')
    expect(subjectFromIdToken(idToken({ sub: 's-1' }), ['oid', 'sub'])).toBe('s-1')
    expect(subjectFromIdToken(idToken({ oid: '' }), ['oid'])).toBeNull()
    expect(subjectFromIdToken('garbage', ['sub'])).toBeNull()
  })

  it('returns null for anything else', () => {
    expect(emailFromIdToken(idToken({ preferred_username: 'not-an-email' }))).toBeNull()
    expect(emailFromIdToken(idToken({ email: `${'a'.repeat(200)}@example.com` }))).toBeNull()
    expect(emailFromIdToken('garbage')).toBeNull()
    expect(emailFromIdToken('a.!!!.c')).toBeNull()
    expect(emailFromIdToken(undefined)).toBeNull()
  })
})
