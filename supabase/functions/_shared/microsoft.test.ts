import { describe, expect, it } from 'vitest'
import { CalendarProviderError } from './calendarProvider'
import { householdDayWindow } from './events'
import {
  buildMicrosoftAuthUrl,
  classifyMicrosoftError,
  exchangeMicrosoftCode,
  listMicrosoftCalendars,
  listMicrosoftEventsForDay,
  mapMicrosoftCalendars,
  mapMicrosoftEvents,
  parseMicrosoftTokenResponse,
  refreshMicrosoftAccessToken,
} from './microsoft'

const TZ = 'America/New_York'
const NOW = new Date('2026-09-14T16:00:00Z')

/** Recorded shape of `GET /v1.0/me/calendars`. */
const calendarsFixture = {
  '@odata.context': "https://graph.microsoft.com/v1.0/$metadata#users('sam%40example.com')/calendars",
  value: [
    {
      id: 'AAMkAGI2TGuLAAA=',
      name: 'Calendar',
      color: 'auto',
      hexColor: '',
      isDefaultCalendar: true,
      changeKey: 'nfZyf7VcrEKLNoU37KWlkQAAA0x0+w==',
      canShare: true,
      canViewPrivateItems: true,
      canEdit: true,
      owner: { name: 'Sam Rivera', address: 'sam@example.com' },
    },
    {
      id: 'AAMkAGI2TGuLBBB=',
      name: 'Kids',
      color: 'lightGreen',
      hexColor: '#87d28e',
      isDefaultCalendar: false,
      canEdit: true,
      owner: { name: 'Sam Rivera', address: 'sam@example.com' },
    },
    { name: 'No id' },
  ],
  '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/calendars?$skip=10',
}

/** Recorded shape of `GET /v1.0/me/calendars/{id}/calendarView` with `Prefer: outlook.timezone="UTC"`. */
const calendarViewFixture = {
  '@odata.context': "https://graph.microsoft.com/v1.0/$metadata#users('sam%40example.com')/calendars('AAMk')/calendarView(subject,start,end,isAllDay,isCancelled,location)",
  value: [
    {
      '@odata.etag': 'W/"ZlnW4RIAV06KYYwlrfNZvQAALfZeRQ=="',
      id: 'AAMkAGI2TG93AAA=',
      subject: 'Parent-teacher conference',
      bodyPreview: 'Room 12, bring the reading log',
      body: { contentType: 'html', content: '<html><body>Room 12</body></html>' },
      isAllDay: false,
      isCancelled: false,
      responseStatus: { response: 'accepted', time: '2026-09-10T12:00:00Z' },
      start: { dateTime: '2026-09-14T19:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-09-14T19:30:00.0000000', timeZone: 'UTC' },
      location: { displayName: 'Oak Elementary', locationType: 'default', address: { street: '1 School Rd' } },
      attendees: [{ emailAddress: { name: 'Ms. Lee', address: 'lee@school.example' } }],
      organizer: { emailAddress: { name: 'Ms. Lee', address: 'lee@school.example' } },
      webLink: 'https://outlook.office365.com/owa/?itemid=AAMk',
      onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc' },
    },
    {
      id: 'AAMkAGI2TG94AAA=',
      subject: 'Field trip',
      isAllDay: true,
      isCancelled: false,
      start: { dateTime: '2026-09-14T00:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-09-15T00:00:00.0000000', timeZone: 'UTC' },
      location: { displayName: '' },
    },
    {
      id: 'AAMkAGI2TG95AAA=',
      subject: 'Cancelled standup',
      isAllDay: false,
      isCancelled: true,
      start: { dateTime: '2026-09-14T13:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-09-14T13:15:00.0000000', timeZone: 'UTC' },
    },
    {
      id: 'AAMkAGI2TG96AAA=',
      subject: 'Local-zone meeting',
      isAllDay: false,
      isCancelled: false,
      start: { dateTime: '2026-09-14T09:00:00.0000000', timeZone: 'America/New_York' },
      end: { dateTime: '2026-09-14T09:45:00.0000000', timeZone: 'America/New_York' },
      location: { displayName: 'Kitchen' },
    },
    {
      id: 'AAMkAGI2TG97AAA=',
      subject: 'Declined review',
      isAllDay: false,
      isCancelled: false,
      responseStatus: { response: 'declined', time: '2026-09-10T12:00:00Z' },
      start: { dateTime: '2026-09-14T15:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-09-14T16:00:00.0000000', timeZone: 'UTC' },
    },
    { id: 'broken', subject: 'Broken', isAllDay: false, start: { dateTime: 'soon' }, end: null },
  ],
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('mapMicrosoftCalendars', () => {
  it('maps calendars and the next link, skipping entries without an id', () => {
    expect(mapMicrosoftCalendars(calendarsFixture)).toEqual({
      calendars: [
        { externalCalendarId: 'AAMkAGI2TGuLAAA=', name: 'Calendar', primary: true },
        { externalCalendarId: 'AAMkAGI2TGuLBBB=', name: 'Kids', primary: false },
      ],
      nextLink: 'https://graph.microsoft.com/v1.0/me/calendars?$skip=10',
    })
    expect(mapMicrosoftCalendars(undefined)).toEqual({ calendars: [], nextLink: null })
  })
})

describe('mapMicrosoftEvents', () => {
  it('maps calendarView events to the shared shape, dropping cancelled, declined and unusable ones', () => {
    const { events, nextLink } = mapMicrosoftEvents(calendarViewFixture, TZ)
    expect(nextLink).toBeNull()
    expect(events).toEqual([
      { title: 'Parent-teacher conference', startAt: '2026-09-14T19:00:00.000Z', endAt: '2026-09-14T19:30:00.000Z', allDay: false, location: 'Oak Elementary' },
      { title: 'Field trip', startAt: '2026-09-14T04:00:00.000Z', endAt: '2026-09-15T04:00:00.000Z', allDay: true, location: null },
      { title: 'Local-zone meeting', startAt: '2026-09-14T13:00:00.000Z', endAt: '2026-09-14T13:45:00.000Z', allDay: false, location: 'Kitchen' },
    ])
    expect(JSON.stringify(events)).not.toMatch(/reading log|Room 12|teams\.microsoft|lee@school|Declined|accepted/)
  })
})

describe('parseMicrosoftTokenResponse', () => {
  it('reads the access token and the rotated refresh token', () => {
    expect(
      parseMicrosoftTokenResponse(
        200,
        { token_type: 'Bearer', scope: 'Calendars.Read', expires_in: 4865, ext_expires_in: 4865, access_token: 'eyJ0', refresh_token: 'M.C5' },
        NOW,
      ),
    ).toEqual({ accessToken: 'eyJ0', expiresAt: new Date(NOW.getTime() + 4865_000), refreshToken: 'M.C5' })
  })

  it('throws auth_expired for invalid_grant / interaction_required and unreachable otherwise', () => {
    const status = (httpStatus: number, body: unknown) => {
      try {
        parseMicrosoftTokenResponse(httpStatus, body, NOW)
        return undefined
      } catch (e) {
        expect(e).toBeInstanceOf(CalendarProviderError)
        return (e as CalendarProviderError).status
      }
    }
    expect(status(400, { error: 'invalid_grant', error_description: 'AADSTS70008: The refresh token has expired', error_codes: [70008] })).toBe(
      'auth_expired',
    )
    expect(status(400, { error: 'interaction_required', error_codes: [50076] })).toBe('auth_expired')
    expect(status(401, { error: 'invalid_client', error_codes: [7000215] })).toBe('unreachable')
    expect(status(200, { token_type: 'Bearer' })).toBe('unreachable')
  })
})

describe('classifyMicrosoftError', () => {
  it('classifies Graph and token endpoint failures', () => {
    expect(classifyMicrosoftError(401, { error: { code: 'InvalidAuthenticationToken', message: 'Lifetime validation failed' } })).toBe('auth_expired')
    expect(classifyMicrosoftError(403, { error: { code: 'ErrorAccessDenied' } })).toBe('auth_expired')
    expect(classifyMicrosoftError(404, { error: { code: 'ErrorItemNotFound' } })).toBe('calendar_gone')
    expect(classifyMicrosoftError(400, { error: 'invalid_grant' })).toBe('auth_expired')
    expect(classifyMicrosoftError(429, { error: { code: 'TooManyRequests' } })).toBe('unreachable')
    expect(classifyMicrosoftError(503, { error: { code: 'ServiceNotAvailable' } })).toBe('unreachable')
    expect(classifyMicrosoftError(400, { error: 'invalid_client' })).toBe('unreachable')
    expect(classifyMicrosoftError(502, '<html>Bad gateway</html>')).toBe('unreachable')
  })
})

describe('Microsoft network paths (injected fetch)', () => {
  it('refreshes an access token with the calendar scope', async () => {
    let request: { url: string; body: URLSearchParams } | undefined
    const token = await refreshMicrosoftAccessToken(
      async (url, init) => {
        request = { url, body: new URLSearchParams(String(init?.body)) }
        return jsonResponse(200, { access_token: 'fresh', expires_in: 3600, refresh_token: 'rotated' })
      },
      { clientId: 'cid', clientSecret: 'secret', refreshToken: 'rt' },
      NOW,
    )
    expect(token).toMatchObject({ accessToken: 'fresh', refreshToken: 'rotated' })
    expect(request!.url).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token')
    expect(request!.body.get('grant_type')).toBe('refresh_token')
    expect(request!.body.get('refresh_token')).toBe('rt')
    expect(request!.body.get('scope')).toContain('Calendars.Read')
    expect(request!.body.get('scope')).toContain('offline_access')
  })

  it('lists calendars following @odata.nextLink', async () => {
    const calendars = await listMicrosoftCalendars(
      async (url) =>
        url.includes('$skip=10')
          ? jsonResponse(200, { value: [{ id: 'b', name: 'B' }] })
          : jsonResponse(200, { value: [{ id: 'a', name: 'A', isDefaultCalendar: true }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/calendars?$skip=10' }),
      'tok',
    )
    expect(calendars.map((c) => c.externalCalendarId)).toEqual(['a', 'b'])
  })

  it('does not send the token to a next link outside Microsoft Graph', async () => {
    const urls: string[] = []
    const status = await listMicrosoftCalendars(async (url) => {
      urls.push(url)
      return jsonResponse(200, { value: [], '@odata.nextLink': 'https://evil.example/steal' })
    }, 'tok').catch((e: CalendarProviderError) => e.status)
    expect(status).toBe('unreachable')
    expect(urls).toHaveLength(1)
  })

  it('requests calendarView for the day widened by a day each side, in UTC, with a minimal $select', async () => {
    const window = householdDayWindow(NOW, TZ)
    let requested: { url: string; prefer: string | null } | undefined
    const events = await listMicrosoftEventsForDay(
      async (url, init) => {
        requested = { url, prefer: new Headers(init?.headers).get('Prefer') }
        return jsonResponse(200, calendarViewFixture)
      },
      'tok',
      'AAMkAGI2TGuLBBB=',
      window,
      TZ,
    )
    const url = new URL(requested!.url)
    expect(url.origin + url.pathname).toBe('https://graph.microsoft.com/v1.0/me/calendars/AAMkAGI2TGuLBBB%3D/calendarView')
    expect(url.searchParams.get('startDateTime')).toBe('2026-09-13T04:00:00.000Z')
    expect(url.searchParams.get('endDateTime')).toBe('2026-09-16T04:00:00.000Z')
    expect(url.searchParams.get('$select')).toContain('responseStatus')
    expect(url.searchParams.get('$select')).not.toMatch(/body|attendees|organizer|webLink|onlineMeeting/)
    expect(requested!.prefer).toBe('outlook.timezone="UTC"')
    expect(events).toHaveLength(3)
  })

  it('throws calendar_gone for a 404 on one calendar, but not for the calendar list or token', async () => {
    const window = householdDayWindow(NOW, TZ)
    const notFound = async () => jsonResponse(404, { error: { code: 'ErrorItemNotFound' } })
    expect(await listMicrosoftEventsForDay(notFound, 'tok', 'gone', window, TZ).catch((e: CalendarProviderError) => e.status)).toBe('calendar_gone')
    expect(await listMicrosoftCalendars(notFound, 'tok').catch((e: CalendarProviderError) => e.status)).toBe('unreachable')
    expect(
      await refreshMicrosoftAccessToken(notFound, { clientId: 'c', clientSecret: 's', refreshToken: 'r' }, NOW).catch(
        (e: CalendarProviderError) => e.status,
      ),
    ).toBe('unreachable')
  })

  it('throws auth_expired when Graph returns 401', async () => {
    const window = householdDayWindow(NOW, TZ)
    const status = await listMicrosoftEventsForDay(
      async () => jsonResponse(401, { error: { code: 'InvalidAuthenticationToken' } }),
      'tok',
      'id',
      window,
      TZ,
    ).catch((e: CalendarProviderError) => e.status)
    expect(status).toBe('auth_expired')
  })
})

function idToken(claims: Record<string, unknown>): string {
  const b64 = (v: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(v)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64({ alg: 'RS256' })}.${b64(claims)}.signature`
}

describe('Microsoft account connection (authorization code + PKCE)', () => {
  it('builds the consent URL for the common tenant with offline access and the S256 challenge', () => {
    const url = new URL(buildMicrosoftAuthUrl({ clientId: 'cid', redirectUri: 'https://x.test/cb', state: 'st', codeChallenge: 'ch' }))
    expect(`${url.origin}${url.pathname}`).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'cid',
      redirect_uri: 'https://x.test/cb',
      response_type: 'code',
      response_mode: 'query',
      scope: 'openid email profile offline_access Calendars.Read',
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
    })
  })

  it('exchanges the code with the verifier and scopes, reading the refresh token and the username as email', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const result = await exchangeMicrosoftCode(
      async (url, init) => {
        calls.push({ url, init })
        return jsonResponse(200, { access_token: 'at', expires_in: 3600, refresh_token: 'rt', id_token: idToken({ preferred_username: 'alex@contoso.com', oid: '00000000-aaaa-bbbb', sub: 'pairwise' }) })
      },
      { clientId: 'cid', clientSecret: 'cs', code: 'code-1', codeVerifier: 'v'.repeat(43), redirectUri: 'https://x.test/cb' },
      NOW,
    )
    expect(result.token.refreshToken).toBe('rt')
    expect(result.email).toBe('alex@contoso.com')
    expect(result.subject).toBe('00000000-aaaa-bbbb')
    expect(calls[0]!.url).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token')
    expect(Object.fromEntries(new URLSearchParams(String(calls[0]!.init!.body)))).toEqual({
      grant_type: 'authorization_code',
      client_id: 'cid',
      client_secret: 'cs',
      code: 'code-1',
      code_verifier: 'v'.repeat(43),
      redirect_uri: 'https://x.test/cb',
      scope: 'openid email profile offline_access Calendars.Read',
    })
  })
})
