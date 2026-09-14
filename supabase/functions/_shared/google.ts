/**
 * Google Calendar client (spec §5.5): token refresh, calendar list, and the day's events mapped to `SourceEvent`.
 *
 * Mapping and error classification are pure functions over status + JSON and are unit-tested with recorded-shape
 * fixtures. The network functions take an injected `fetch`; they cannot be exercised against Google locally
 * without OAuth credentials (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`).
 */
import {
  CalendarProviderError,
  MAX_PAGES,
  exchangeAuthorizationCode,
  connectionLevel,
  dateTimeToUtcMs,
  dateToUtcMs,
  isExpiredGrantError,
  isRecord,
  oauthErrorCode,
  parseTokenResponse,
  requestJson,
  stringOrNull,
  type AccessToken,
  type AuthUrlInput,
  type CodeExchangeInput,
  type CodeExchangeResult,
  type FetchLike,
  type OAuthClientCredentials,
  type ProviderCalendar,
  type ProviderFailure,
} from './calendarProvider.ts'
import { cleanLocation, cleanTitle, type DayWindow, type SourceEvent } from './events.ts'

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
/**
 * Consent scopes: `calendar.readonly` (the one documented read-only scope covering both calendarList.list and
 * events.list) plus `openid email`, so the connection can be labelled with the account's email.
 */
export const GOOGLE_OAUTH_SCOPES = `openid email ${GOOGLE_CALENDAR_SCOPE}`

const DAY_MS = 86_400_000

/** 403 reasons that reconnecting fixes. Every other 403 (quotas, rate limits, API not enabled) is `unreachable`. */
const RECONNECT_REASONS = new Set(['insufficientPermissions', 'forbidden', 'authError'])

/** Event types shown on the Today panel; `workingLocation` and `focusTime` are left out. */
const SHOWN_EVENT_TYPES = ['default', 'birthday', 'fromGmail', 'outOfOffice']

function googleErrorReasons(body: unknown): string[] {
  if (!isRecord(body) || !isRecord(body.error) || !Array.isArray(body.error.errors)) return []
  return body.error.errors.map((e) => (isRecord(e) ? stringOrNull(e.reason) : null)).filter((r): r is string => r !== null)
}

/**
 * What a failed Google response means.
 * - `auth_expired` (the owner must reconnect): token endpoint `invalid_grant` (revoked, expired, or a Testing-status
 *   app's 7-day token), API 401, and 403 with `insufficientPermissions`, `forbidden` or `authError`.
 * - `calendar_gone`: 404/410 for one calendar (deleted or unshared); only that selection is affected.
 * - `unreachable`: `invalid_client` / `unauthorized_client` (our credentials; reconnecting cannot help), any other 403
 *   (`dailyLimitExceeded`, `rateLimitExceeded`, `accessNotConfigured`, unparseable), 429, 5xx and everything else.
 */
export function classifyGoogleError(status: number, body: unknown): ProviderFailure {
  if (isExpiredGrantError(body)) return 'auth_expired'
  const oauthCode = oauthErrorCode(body)
  if (oauthCode === 'invalid_client' || oauthCode === 'unauthorized_client') return 'unreachable'
  if (status === 401) return 'auth_expired'
  if (status === 403) return googleErrorReasons(body).some((r) => RECONNECT_REASONS.has(r)) ? 'auth_expired' : 'unreachable'
  if (status === 404 || status === 410) return 'calendar_gone'
  return 'unreachable'
}

/** True when the calendar owner declined the event. Attendee data is read for this check only, never copied. */
function selfDeclined(attendees: unknown): boolean {
  return Array.isArray(attendees) && attendees.some((a) => isRecord(a) && a.self === true && a.responseStatus === 'declined')
}

export function parseGoogleTokenResponse(status: number, body: unknown, now: Date): AccessToken {
  return parseTokenResponse(status, body, now, classifyGoogleError)
}

/** Maps a `calendarList.list` page. The user's own name for a calendar (`summaryOverride`) wins. */
export function mapGoogleCalendarList(body: unknown): { calendars: ProviderCalendar[]; nextPageToken: string | null } {
  if (!isRecord(body)) return { calendars: [], nextPageToken: null }
  const items = Array.isArray(body.items) ? body.items : []
  const calendars: ProviderCalendar[] = []
  for (const item of items) {
    if (!isRecord(item) || item.deleted === true) continue
    const id = stringOrNull(item.id)
    if (!id) continue
    calendars.push({
      externalCalendarId: id,
      name: stringOrNull(item.summaryOverride) ?? stringOrNull(item.summary) ?? id,
      primary: item.primary === true,
    })
  }
  return { calendars, nextPageToken: stringOrNull(body.nextPageToken) }
}

/**
 * Maps an `events.list` page (requested with `singleEvents=true`, so recurring events arrive as instances).
 * All-day events use `date` values (end exclusive) placed at midnight in the household zone; timed events use
 * `dateTime` with its offset. Cancelled instances, events the owner declined, working-location and focus-time
 * blocks, and events without usable times are dropped.
 */
export function mapGoogleEvents(body: unknown, timeZone: string): { events: SourceEvent[]; nextPageToken: string | null } {
  if (!isRecord(body)) return { events: [], nextPageToken: null }
  const items = Array.isArray(body.items) ? body.items : []
  const events: SourceEvent[] = []
  for (const item of items) {
    if (!isRecord(item) || item.status === 'cancelled') continue
    if (item.eventType === 'workingLocation' || item.eventType === 'focusTime') continue
    if (selfDeclined(item.attendees)) continue
    const start = isRecord(item.start) ? item.start : {}
    const end = isRecord(item.end) ? item.end : {}
    const allDay = typeof start.date === 'string'
    let startMs: number
    let endMs: number
    if (allDay) {
      startMs = dateToUtcMs(start.date, timeZone)
      endMs = typeof end.date === 'string' ? dateToUtcMs(end.date, timeZone) : startMs + DAY_MS
    } else {
      startMs = dateTimeToUtcMs(start.dateTime, start.timeZone)
      endMs = dateTimeToUtcMs(end.dateTime, end.timeZone ?? start.timeZone)
    }
    if (Number.isNaN(startMs)) continue
    if (!(endMs >= startMs)) endMs = startMs
    events.push({
      title: cleanTitle(item.summary),
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(endMs).toISOString(),
      allDay,
      location: cleanLocation(item.location),
    })
  }
  return { events, nextPageToken: stringOrNull(body.nextPageToken) }
}

// ---- Network (injected fetch) ----

export async function refreshGoogleAccessToken(fetch: FetchLike, credentials: OAuthClientCredentials, now: Date): Promise<AccessToken> {
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken,
  })
  let res: Response
  try {
    res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
    })
  } catch (e) {
    throw new CalendarProviderError('unreachable', `token request failed: ${e instanceof Error ? e.name : 'error'}`)
  }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return parseGoogleTokenResponse(res.status, body, now)
}

function authHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
}

export async function listGoogleCalendars(fetch: FetchLike, accessToken: string): Promise<ProviderCalendar[]> {
  const calendars: ProviderCalendar[] = []
  let pageToken: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ maxResults: '250', fields: 'items(id,summary,summaryOverride,primary,deleted),nextPageToken' })
    if (pageToken) params.set('pageToken', pageToken)
    const { body } = await requestJson(
      fetch,
      `${GOOGLE_CALENDAR_API}/users/me/calendarList?${params}`,
      { headers: authHeaders(accessToken) },
      connectionLevel(classifyGoogleError),
    )
    const mapped = mapGoogleCalendarList(body)
    calendars.push(...mapped.calendars)
    pageToken = mapped.nextPageToken
    if (!pageToken) break
  }
  return calendars
}

/**
 * Events around the household day (Google's `timeMin` filters by end, `timeMax` by start). The query is widened by a
 * day on each side so zone and all-day edge cases are never cut off; `mergeDayEvents` clamps to the day. A 404 throws
 * `calendar_gone`.
 */
export async function listGoogleEventsForDay(
  fetch: FetchLike,
  accessToken: string,
  calendarId: string,
  window: DayWindow,
  timeZone: string,
): Promise<SourceEvent[]> {
  const events: SourceEvent[] = []
  let pageToken: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      timeMin: new Date(window.dayStartUtc.getTime() - DAY_MS).toISOString(),
      timeMax: new Date(window.dayEndUtc.getTime() + DAY_MS).toISOString(),
      maxResults: '250',
      // Only what Roost shows, plus the owner's own response and the event type for filtering: never descriptions,
      // other attendees' details, links or conference data.
      fields: 'items(status,summary,location,start,end,eventType,attendees(self,responseStatus)),nextPageToken',
    })
    for (const type of SHOWN_EVENT_TYPES) params.append('eventTypes', type)
    if (pageToken) params.set('pageToken', pageToken)
    const { body } = await requestJson(
      fetch,
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      { headers: authHeaders(accessToken) },
      classifyGoogleError,
    )
    const mapped = mapGoogleEvents(body, timeZone)
    events.push(...mapped.events)
    pageToken = mapped.nextPageToken
    if (!pageToken) break
  }
  return events
}

// ---- Connecting an account (authorization code + PKCE) ----

/**
 * The consent URL. `access_type=offline` asks for a refresh token and `prompt=consent` makes Google issue one even
 * when the account consented before (otherwise a reconnect would get no refresh token).
 */
export function buildGoogleAuthUrl({ clientId, redirectUri, state, codeChallenge }: AuthUrlInput): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_OAUTH_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })
  return `${GOOGLE_AUTH_URL}?${params}`
}

export function exchangeGoogleCode(fetch: FetchLike, input: CodeExchangeInput, now: Date): Promise<CodeExchangeResult> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    code_verifier: input.codeVerifier,
    redirect_uri: input.redirectUri,
  })
  return exchangeAuthorizationCode(fetch, GOOGLE_TOKEN_URL, form, now, classifyGoogleError)
}
